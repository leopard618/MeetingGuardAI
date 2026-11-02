/**
 * GoogleTasksSyncService (contract in src/core/contracts.ts) built from injected dependencies.
 * Every operation is serialized (one Google Tasks sync at a time per app) and reports to the
 * shared calendar status store under `gtasks`. The account is the Google account signed in
 * natively on this device; "enabled" is this device's switch; the tasks scope is asked for
 * incrementally on enable.
 */
import type { GoogleTasksSyncService, PreferencesRepository, TaskListInfo, TaskSyncResult } from '../../../core/contracts';
import { AppError, toAppError } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
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

  const syncDeps: GtasksSyncDeps = {
    ...deps,
    async defaultList() {
      const prefs = await deps.preferences.get();
      return prefs.gtasksListId === null ? null : { id: prefs.gtasksListId, name: prefs.gtasksListName ?? '' };
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
    const connected = await deps.auth.isAccountConnected();
    const hasScope = connected ? await deps.auth.hasTasksScope() : false;
    const state = await readState();
    const prefs = await deps.preferences.get().catch(() => null);
    const enabled = connected && hasScope && state?.enabled === true;
    deps.status.patchGtasks({
      configured: true,
      connected,
      hasScope,
      enabled,
      listId: prefs?.gtasksListId ?? null,
      listName: prefs?.gtasksListName ?? null,
      ...(state ? { lastSyncAt: state.lastSyncAt, lastError: state.lastError } : {}),
    });
    return { configured: true, connected, hasScope, enabled };
  }

  async function ensureAccount(): Promise<void> {
    if (!configured) throw new AppError('not_configured', 'Google Tasks sync is switched off in this build');
    const connected = await deps.auth.isAccountConnected();
    if (!connected) throw new AppError('google_not_signed_in', 'No Google account is signed in on this device');
  }

  async function ensureScope(): Promise<void> {
    await ensureAccount();
    if (!(await deps.auth.hasTasksScope())) throw new AppError('tasks_scope_missing', 'The Google Tasks scope has not been granted');
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
        await ensureScope();
        const lists = await deps.api.listLists();
        return lists.map(toTaskListInfo);
      });
    },

    enable(list) {
      return mutex.run(async () => {
        await ensureAccount();
        if (!(await deps.auth.hasTasksScope())) {
          const granted = await deps.auth.requestTasksScope();
          if (!granted) {
            deps.status.patchGtasks({ configured: true, connected: true, hasScope: false });
            throw new AppError('tasks_scope_missing', 'The user declined the Google Tasks scope');
          }
        }
        await deps.preferences.update({ gtasksListId: list.id, gtasksListName: list.name });
        // A fresh start: full listings, no stale queue, no stale links.
        await deps.state.update((current) => ({ ...current, enabled: true, lists: {}, pending: {}, hashes: {}, links: {}, lastError: null }));
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
        await deps.preferences.update({ gtasksListId: list.id, gtasksListName: list.name });
        deps.status.patchGtasks({ listId: list.id, listName: list.name });
      });
    },

    disable() {
      return mutex.run(async () => {
        await deps.state.update((current) => ({ ...current, enabled: false, pending: {} }));
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
      });
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
