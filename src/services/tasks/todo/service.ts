/**
 * TodoSyncService (contract in src/core/contracts.ts) built from injected dependencies. Every
 * operation is serialized (one To Do sync at a time per app) and reports to the shared calendar
 * status store under `todo`. The Microsoft account is the one the Outlook sync connects:
 * "connected" means its refresh token is stored; "enabled" is this device's switch.
 */
import type { PreferencesRepository, TodoList, TodoSyncResult, TodoSyncService } from '../../../core/contracts';
import { AppError, toAppError } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import { createMutex } from '../../calendar/shared';
import type { CalendarStatusStore } from '../../calendar/status';
import type { TodoSyncState } from './state';
import {
  enqueueTodoPushes,
  enqueueUnlinkedOpenTasks,
  flushTodoPushes,
  pullTodoChanges,
  removeTodoLinks,
  type FlushResult,
  type TodoQueueItem,
  type TodoSyncDeps,
} from './sync';
import type { GraphTodoList } from './types';

const log = createLogger('tasks');

export interface TodoServiceDeps extends Omit<TodoSyncDeps, 'defaultList'> {
  /** The Outlook token manager's "connected" probe (same Microsoft account). */
  hasRefreshToken(): Promise<boolean>;
  preferences: Pick<PreferencesRepository, 'get' | 'update'>;
  status: CalendarStatusStore;
  config: { clientId: string | null };
}

/** Contract methods plus the hooks the sync engine uses. */
export interface TodoSyncServiceInternal extends TodoSyncService {
  /** Persists local changes to push (engine: tasks:changed with origin user/ai). */
  enqueue(items: readonly TodoQueueItem[]): Promise<void>;
  /** Pushes queued changes. Throws calendar_not_connected when the sync is off. */
  flushPending(): Promise<FlushResult>;
  /** Stored state (last sync time for the status on startup). */
  loadState(): Promise<TodoSyncState>;
  /** Re-reads configuration, token presence, switch and list into the status store. */
  refreshStatus(): Promise<{ configured: boolean; connected: boolean; enabled: boolean }>;
  /** The sync is on for this device and the account is connected. */
  isEnabled(): Promise<boolean>;
}

export function toTodoList(list: GraphTodoList): TodoList {
  return { id: list.id, name: (list.displayName ?? '').trim(), isDefault: list.wellknownListName === 'defaultList' };
}

export function createTodoSyncService(deps: TodoServiceDeps): TodoSyncServiceInternal {
  const mutex = createMutex();
  const configured = deps.config.clientId !== null;

  const syncDeps: TodoSyncDeps = {
    ...deps,
    async defaultList() {
      const prefs = await deps.preferences.get();
      return prefs.todoListId === null ? null : { id: prefs.todoListId, name: prefs.todoListName ?? '' };
    },
  };

  async function readState(): Promise<TodoSyncState | null> {
    try {
      return await deps.state.load();
    } catch {
      // No active session (signed out): nothing to show.
      return null;
    }
  }

  async function refreshStatus(): Promise<{ configured: boolean; connected: boolean; enabled: boolean }> {
    if (!configured) return { configured: false, connected: false, enabled: false };
    const connected = await deps.hasRefreshToken();
    const state = await readState();
    const prefs = await deps.preferences.get().catch(() => null);
    const enabled = connected && state?.enabled === true;
    deps.status.patchTodo({
      configured: true,
      connected,
      enabled,
      listId: prefs?.todoListId ?? null,
      listName: prefs?.todoListName ?? null,
      ...(state ? { lastSyncAt: state.lastSyncAt, lastError: state.lastError } : {}),
    });
    return { configured: true, connected, enabled };
  }

  async function ensureConnected(): Promise<void> {
    if (!configured) throw new AppError('not_configured', 'Microsoft To Do is not configured (EXPO_PUBLIC_MSAL_CLIENT_ID missing)');
    const connected = await deps.hasRefreshToken();
    if (!connected) throw new AppError('calendar_not_connected', 'The Microsoft account is not connected');
  }

  async function ensureEnabled(): Promise<void> {
    const { enabled } = await refreshStatus();
    if (!configured) throw new AppError('not_configured', 'Microsoft To Do is not configured');
    if (!enabled) throw new AppError('calendar_not_connected', 'Microsoft To Do sync is off');
  }

  /** Runs a sync operation with the syncing flag and records its outcome. */
  async function tracked<T>(operation: () => Promise<T>, onSuccess?: (value: T) => void): Promise<T> {
    const done = deps.status.beginSync('todo');
    try {
      const value = await operation();
      onSuccess?.(value);
      return value;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'cancelled') {
        deps.status.patchTodo({ lastError: appError.code });
        await deps.state
          .update((current) => ({ ...current, lastError: appError.code }))
          .catch((stateError: unknown) => log.warn('Could not store the To Do sync error', toAppError(stateError).code));
      }
      throw appError;
    } finally {
      done();
    }
  }

  async function flushAndPull(options: { full: boolean }): Promise<TodoSyncResult> {
    return tracked(
      async () => {
        const flushed = await flushTodoPushes(syncDeps);
        if (flushed.blockedBy !== null) {
          // Same cause would fail the pull (offline or token problem): report it once.
          throw new AppError(flushed.blockedBy, 'Microsoft To Do sync is blocked');
        }
        const pulled = await pullTodoChanges(syncDeps, { full: options.full });
        return { ...pulled, counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed } };
      },
      (value) => deps.status.patchTodo({ lastSyncAt: value.syncedAt, lastError: null }),
    );
  }

  const service: TodoSyncServiceInternal = {
    isConfigured() {
      return configured;
    },

    async isAccountConnected() {
      if (!configured) return false;
      return deps.hasRefreshToken();
    },

    async isEnabled() {
      const { enabled } = await refreshStatus();
      return enabled;
    },

    listLists() {
      return mutex.run(async () => {
        await ensureConnected();
        const lists = await deps.api.listLists();
        return lists.filter((list) => list.wellknownListName !== 'flaggedEmails').map(toTodoList);
      });
    },

    enable(list) {
      return mutex.run(async () => {
        await ensureConnected();
        await deps.preferences.update({ todoListId: list.id, todoListName: list.name });
        // A fresh start: full listings, no stale queue, no stale links.
        await deps.state.update((current) => ({ ...current, enabled: true, lists: {}, pending: {}, hashes: {}, links: {}, lastError: null }));
        deps.status.patchTodo({ configured: true, connected: true, enabled: true, listId: list.id, listName: list.name, lastError: null });
        try {
          const result = await tracked(
            async () => {
              const pulled = await pullTodoChanges(syncDeps, { full: true });
              await enqueueUnlinkedOpenTasks(syncDeps);
              const flushed = await flushTodoPushes(syncDeps);
              if (flushed.blockedBy !== null) deps.status.patchTodo({ lastError: flushed.blockedBy });
              return { ...pulled, counts: { ...pulled.counts, pushed: flushed.pushed, failed: flushed.failed } };
            },
            (value) => deps.status.patchTodo({ lastSyncAt: value.syncedAt }),
          );
          return result;
        } catch (error) {
          // Enabled; the first sync failed (shown through status.lastError, retried by the engine).
          log.warn('Initial Microsoft To Do sync failed', { code: toAppError(error).code });
          return null;
        }
      });
    },

    setList(list) {
      return mutex.run(async () => {
        await deps.preferences.update({ todoListId: list.id, todoListName: list.name });
        deps.status.patchTodo({ listId: list.id, listName: list.name });
      });
    },

    disable() {
      return mutex.run(async () => {
        await deps.state.update((current) => ({ ...current, enabled: false, pending: {} }));
        deps.status.patchTodo({ enabled: false, listId: null, listName: null, lastError: null });
        const done = deps.status.beginSync('todo');
        try {
          const { removed, unlinked } = await removeTodoLinks(syncDeps);
          log.info('Microsoft To Do sync disabled', { removed, unlinked });
          await deps.state.clear();
        } finally {
          done();
        }
        await deps.preferences.update({ todoListId: null, todoListName: null });
      });
    },

    sync() {
      return mutex.run(async () => {
        await ensureEnabled();
        return flushAndPull({ full: false });
      });
    },

    enqueue(items) {
      return enqueueTodoPushes(syncDeps, items);
    },

    flushPending() {
      return mutex.run(async () => {
        await ensureEnabled();
        return tracked(
          () => flushTodoPushes(syncDeps),
          (result) => {
            if (result.blockedBy !== null) deps.status.patchTodo({ lastError: result.blockedBy });
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
