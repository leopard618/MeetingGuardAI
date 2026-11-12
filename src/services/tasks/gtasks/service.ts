/**
 * GoogleTasksSyncService (contract in src/core/contracts.ts) built from injected dependencies.
 * Every operation is serialized (one Google Tasks sync at a time per app) and reports to the
 * shared calendar status store under `gtasks`. The account is the Google account signed in
 * natively on this device; "enabled" is this device's switch; the tasks scope is asked for
 * incrementally on enable. The list new tasks go to is shared through preferences and also
 * remembered by this device while its sync is on (resolveList), so a device that erases it
 * cannot silently stop the sync here.
 */
import type { GoogleTasksSyncService, PreferencesRepository, TaskListInfo, TaskSyncResult } from '../../../core/contracts';
import { AppError, toAppError } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import type { Preferences } from '../../../core/types';
import { createMutex } from '../../calendar/shared';
import type { CalendarStatusStore } from '../../calendar/status';
import type { GtasksSyncState } from './state';
import {
  enqueueGtasksPushes,
  enqueueUnlinkedOpenTasksForGtasks,
  flushGtasksPushes,
  pullGtasksChanges,
  removeGtasksLinks,
  type GtasksFlushResult,
  type GtasksQueueItem,
  type GtasksSyncDeps,
} from './sync';
import type { GoogleTaskList } from './types';

const log = createLogger('tasks');

export interface GtasksAuthPort {
  /** A Google account is signed in natively (or can be restored silently). */
  isAccountConnected(): Promise<boolean>;
  hasTasksScope(): Promise<boolean>;
  /** Incremental consent; false = declined. */
  requestTasksScope(): Promise<boolean>;
}

export interface GtasksServiceDeps extends Omit<GtasksSyncDeps, 'defaultList'> {
  auth: GtasksAuthPort;
  preferences: Pick<PreferencesRepository, 'get' | 'update'>;
  status: CalendarStatusStore;
  /** The build switch (EXPO_PUBLIC_GOOGLE_TASKS_SYNC). */
  config: { enabled: boolean };
}

/** Contract methods plus the hooks the sync engine uses. */
export interface GoogleTasksSyncServiceInternal extends GoogleTasksSyncService {
  /** Persists local changes to push (engine: tasks:changed with origin user/ai). */
  enqueue(items: readonly GtasksQueueItem[]): Promise<void>;
  /** Pushes queued changes. Throws calendar_not_connected when the sync is off. */
  flushPending(): Promise<GtasksFlushResult>;
  /** Stored state (last sync time for the status on startup). */
  loadState(): Promise<GtasksSyncState>;
  /** Re-reads configuration, account, scope, switch and list into the status store. */
  refreshStatus(): Promise<{ configured: boolean; connected: boolean; hasScope: boolean; enabled: boolean }>;
  /** The sync is on for this device, the account is signed in and the scope granted. */
  isEnabled(): Promise<boolean>;
}

/** The account's first list is Google's built-in "My Tasks" (the API has no explicit flag). */
export function toTaskListInfo(list: GoogleTaskList, index: number): TaskListInfo {
  return { id: list.id, name: (list.title ?? '').trim(), isDefault: index === 0 };
}

export function createGoogleTasksSyncService(deps: GtasksServiceDeps): GoogleTasksSyncServiceInternal {
  const mutex = createMutex();
  const configured = deps.config.enabled;

  // enable / setList / disable choose or clear the list on purpose. refreshStatus is not
  // serialized with them, so a list resolve running beside one of them may have read an older
  // choice: it writes only when no choice started or ran since it began reading.
  let choiceEpoch = 0;
  let choiceRunning = false;

  async function choosingList<T>(work: () => Promise<T>): Promise<T> {
    choiceEpoch += 1;
    choiceRunning = true;
    try {
      return await work();
    } finally {
      choiceEpoch += 1;
      choiceRunning = false;
    }
  }

  /** No choice started or ran since `epoch` was read. */
  function settled(epoch: number): boolean {
    return !choiceRunning && epoch === choiceEpoch;
  }

  /**
   * Stores the list this device follows. A state that knew no list was written by a build that
   * did not remember it, and that build dropped the new tasks it had no list for: the open tasks
   * without a Google copy are queued once, like setList does (the next flush patches the copies
   * this device knows of and creates the rest). Queued first, so a failure leaves the list
   * unremembered and the next read tries both again.
   */
  async function rememberList(list: { id: string; name: string | null }, first: boolean, epoch: number): Promise<void> {
    try {
      if (first) {
        const queued = await enqueueUnlinkedOpenTasksForGtasks(deps);
        log.info('Queued the open tasks for the Google Tasks list this device now remembers', { queued });
      }
      await deps.state.update((current) => (current.enabled && settled(epoch) ? { ...current, listId: list.id, listName: list.name } : current));
    } catch (error) {
      log.warn('Could not remember the Google Tasks list', { code: toAppError(error).code });
    }
  }

  /**
   * The ONE answer to "which list do new tasks go to", for the sync (defaultList) and for the
   * status the card, the task editor and the assistant show (refreshStatus):
   * - the list in preferences (the shared choice). This device follows it when it remembers
   *   another one (the list was changed on another device), or none yet (a state from before
   *   the list was remembered: rememberList also queues the tasks that build could not send);
   * - no list in preferences while this device's sync is on with a remembered list: another
   *   device erased the shared choice (an older build rewriting the settings, or a disable
   *   there). It is written back to preferences and used;
   * - otherwise none: new tasks wait in the queue until a list is chosen.
   * Nothing is written while signed out (`state` null) or over preferences that are still the
   * session defaults (no updatedAt: the settings have not arrived yet, so nothing was erased).
   * The write-back happens only while preferences have no list, and it is a local change (the
   * engine re-reads the list after remote changes only), so it cannot loop; two callers at once
   * write the same value at worst.
   */
  async function resolveList(prefs: Preferences, state: GtasksSyncState | null, epoch: number): Promise<{ id: string; name: string | null } | null> {
    const writable = state !== null && state.enabled && settled(epoch);
    if (prefs.gtasksListId !== null) {
      const shared = { id: prefs.gtasksListId, name: prefs.gtasksListName };
      if (writable && (state.listId !== shared.id || state.listName !== shared.name)) await rememberList(shared, state.listId === null, epoch);
      return shared;
    }
    if (state === null || !state.enabled || state.listId === null) return null;
    const remembered = { id: state.listId, name: state.listName };
    if (writable && prefs.updatedAt !== null) {
      log.info('Putting back the Google Tasks list another device erased', { listId: remembered.id });
      deps.status.patchGtasks({ listId: remembered.id, listName: remembered.name });
      await deps.preferences
        .update({ gtasksListId: remembered.id, gtasksListName: remembered.name })
        .catch((error: unknown) => log.warn('Could not put back the Google Tasks list', { code: toAppError(error).code }));
    }
    return remembered;
  }

  const syncDeps: GtasksSyncDeps = {
    ...deps,
    async defaultList() {
      const epoch = choiceEpoch;
      const prefs = await deps.preferences.get();
      const list = await resolveList(prefs, await deps.state.load(), epoch);
      return list === null ? null : { id: list.id, name: list.name ?? '' };
    },
  };

  async function readState(): Promise<GtasksSyncState | null> {
    try {
      return await deps.state.load();
    } catch {
      // No active session (signed out): nothing to show.
      return null;
    }
  }

  async function refreshStatus(): Promise<{ configured: boolean; connected: boolean; hasScope: boolean; enabled: boolean }> {
    if (!configured) return { configured: false, connected: false, hasScope: false, enabled: false };
    const epoch = choiceEpoch;
    const connected = await deps.auth.isAccountConnected();
    const hasScope = connected ? await deps.auth.hasTasksScope() : false;
    const state = await readState();
    const prefs = await deps.preferences.get().catch(() => null);
    const enabled = connected && hasScope && state?.enabled === true;
    const list = prefs === null ? null : await resolveList(prefs, state, epoch);
    deps.status.patchGtasks({
      configured: true,
      connected,
      hasScope,
      // A choice made here meanwhile (enable, setList, disable) patched its own, newer switch,
      // list and outcome: the state and list read above are older.
      ...(settled(epoch)
        ? {
            enabled,
            listId: list?.id ?? null,
            listName: list?.name ?? null,
            ...(state ? { lastSyncAt: state.lastSyncAt, lastError: state.lastError } : {}),
          }
        : {}),
    });
    return { configured: true, connected, hasScope, enabled };
  }

  async function ensureAccount(): Promise<void> {
    if (!configured) throw new AppError('not_configured', 'Google Tasks sync is switched off in this build');
    const connected = await deps.auth.isAccountConnected();
    if (!connected) throw new AppError('google_not_signed_in', 'No Google account is signed in on this device');
  }

  /** Asks for the tasks scope when it is missing (incremental consent); a decline throws. */
  async function ensureScopeGranted(): Promise<void> {
    await ensureAccount();
    if (await deps.auth.hasTasksScope()) return;
    const granted = await deps.auth.requestTasksScope();
    if (!granted) {
      deps.status.patchGtasks({ configured: true, connected: true, hasScope: false });
      throw new AppError('tasks_scope_missing', 'The user declined the Google Tasks scope');
    }
    deps.status.patchGtasks({ configured: true, connected: true, hasScope: true });
  }

  async function ensureEnabled(): Promise<void> {
    const { enabled } = await refreshStatus();
    if (!configured) throw new AppError('not_configured', 'Google Tasks sync is switched off in this build');
    if (!enabled) throw new AppError('calendar_not_connected', 'Google Tasks sync is off');
  }

  /** Runs a sync operation with the syncing flag and records its outcome. */
  async function tracked<T>(operation: () => Promise<T>, onSuccess?: (value: T) => void): Promise<T> {
    const done = deps.status.beginSync('gtasks');
    try {
      const value = await operation();
      onSuccess?.(value);
      return value;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'cancelled') {
        deps.status.patchGtasks({ lastError: appError.code });
        await deps.state
          .update((current) => ({ ...current, lastError: appError.code }))
          .catch((stateError: unknown) => log.warn('Could not store the Google Tasks sync error', toAppError(stateError).code));
      }
      throw appError;
    } finally {
      done();
    }
  }

  async function flushAndPull(options: { full: boolean }): Promise<TaskSyncResult> {
    return tracked(
      async () => {
        const flushed = await flushGtasksPushes(syncDeps);
        if (flushed.blockedBy !== null) {
          // Same cause would fail the pull (offline or token problem): report it once.
          throw new AppError(flushed.blockedBy, 'Google Tasks sync is blocked');
        }
        const pulled = await pullGtasksChanges(syncDeps, { full: options.full });
        return { ...pulled, counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed } };
      },
      (value) => deps.status.patchGtasks({ lastSyncAt: value.syncedAt, lastError: null }),
    );
  }

  const service: GoogleTasksSyncServiceInternal = {
    isConfigured() {
      return configured;
    },

    async isAccountConnected() {
      if (!configured) return false;
      return deps.auth.isAccountConnected();
    },

    async isEnabled() {
      const { enabled } = await refreshStatus();
      return enabled;
    },

    listLists() {
      return mutex.run(async () => {
        // The list chooser comes before "Start sync": this is where the permission is asked.
        await ensureScopeGranted();
        const lists = await deps.api.listLists();
        return lists.map(toTaskListInfo);
      });
    },

    enable(list) {
      return mutex.run(async () => {
        await ensureScopeGranted();
        await choosingList(async () => {
          await deps.preferences.update({ gtasksListId: list.id, gtasksListName: list.name });
          // A fresh start: full listings, no stale queue, no stale links. The list is remembered here too.
          await deps.state.update((current) => ({ ...current, enabled: true, listId: list.id, listName: list.name, lists: {}, pending: {}, hashes: {}, links: {}, lastError: null }));
        });
        deps.status.patchGtasks({
          configured: true,
          connected: true,
          hasScope: true,
          enabled: true,
          listId: list.id,
          listName: list.name,
          lastError: null,
        });
        try {
          const result = await tracked(
            async () => {
              const pulled = await pullGtasksChanges(syncDeps, { full: true });
              await enqueueUnlinkedOpenTasksForGtasks(syncDeps);
              const flushed = await flushGtasksPushes(syncDeps);
              if (flushed.blockedBy !== null) deps.status.patchGtasks({ lastError: flushed.blockedBy });
              return { ...pulled, counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed } };
            },
            (value) => deps.status.patchGtasks({ lastSyncAt: value.syncedAt }),
          );
          return result;
        } catch (error) {
          // Enabled; the first sync failed (shown through status.lastError, retried by the engine).
          log.warn('Initial Google Tasks sync failed', { code: toAppError(error).code });
          return null;
        }
      });
    },

    setList(list) {
      return mutex.run(async () => {
        const state = await choosingList(async () => {
          await deps.preferences.update({ gtasksListId: list.id, gtasksListName: list.name });
          // Remembered while this device's sync is on (resolveList puts it back when erased).
          return deps.state.update((current) => (current.enabled ? { ...current, listId: list.id, listName: list.name } : current));
        });
        deps.status.patchGtasks({ listId: list.id, listName: list.name });
        if (!state.enabled) return;
        // The open tasks without a Google copy (those that waited for a list among them) go out
        // now. The choice is saved: a failure shows through the status and is not thrown.
        try {
          await tracked(async () => {
            await enqueueUnlinkedOpenTasksForGtasks(syncDeps);
            const flushed = await flushGtasksPushes(syncDeps);
            if (flushed.blockedBy !== null) deps.status.patchGtasks({ lastError: flushed.blockedBy });
            return flushed;
          });
        } catch (error) {
          log.warn('Sending the open tasks to the chosen Google Tasks list failed', { code: toAppError(error).code });
        }
      });
    },

    disable() {
      return mutex.run(() =>
        choosingList(async () => {
          // The remembered list goes first: nothing can put the list back, even if the cleanup fails.
          await deps.state.update((current) => ({ ...current, enabled: false, pending: {}, listId: null, listName: null }));
          deps.status.patchGtasks({ enabled: false, listId: null, listName: null, lastError: null });
          const done = deps.status.beginSync('gtasks');
          try {
            const { removed, unlinked } = await removeGtasksLinks(syncDeps);
            log.info('Google Tasks sync disabled', { removed, unlinked });
            await deps.state.clear();
          } finally {
            done();
          }
          await deps.preferences.update({ gtasksListId: null, gtasksListName: null });
        }),
      );
    },

    sync() {
      return mutex.run(async () => {
        await ensureEnabled();
        return flushAndPull({ full: false });
      });
    },

    enqueue(items) {
      return enqueueGtasksPushes(syncDeps, items);
    },

    flushPending() {
      return mutex.run(async () => {
        await ensureEnabled();
        return tracked(
          () => flushGtasksPushes(syncDeps),
          (result) => {
            if (result.blockedBy !== null) deps.status.patchGtasks({ lastError: result.blockedBy });
          },
        );
      });
    },

    loadState() {
      return deps.state.load();
    },

    refreshStatus,
  };
  return service;
}
