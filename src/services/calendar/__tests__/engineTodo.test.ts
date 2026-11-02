/**
 * The engine's optional Microsoft To Do branch: task changes are queued persist-first and
 * flushed, syncNow reports the To Do result, the quick foreground pull runs every minute while
 * enabled, and nothing happens when the provider is not registered.
 */
import type { CalendarPullResult, TodoSyncResult } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { createEventBus, type AppEventMap, type TasksChangedEvent } from '../../../core/events';
import { createDefaultPreferences, EMPTY_TASK_EXTERNAL_REFS, type Preferences } from '../../../core/types';
import type { GoogleTasksSyncServiceInternal } from '../../tasks/gtasks/service';
import { defaultGtasksSyncState } from '../../tasks/gtasks/state';
import type { TodoSyncServiceInternal } from '../../tasks/todo/service';
import { defaultTodoSyncState } from '../../tasks/todo/state';
import type { DeviceCalendarServiceInternal } from '../device/service';
import { createCalendarSyncEngine, FOREGROUND_INTERVAL_MS, PUSH_DEBOUNCE_MS, TODO_FOREGROUND_INTERVAL_MS } from '../engine';
import type { GoogleCalendarServiceInternal } from '../google/service';
import { defaultDeviceSyncState, defaultGoogleSyncState } from '../stateStore';
import { createCalendarStatusStore } from '../status';

const UID = 'user-1';

function todoResult(): TodoSyncResult {
  return { fullSync: false, counts: { created: 1, updated: 0, removed: 0, unchanged: 0, pushed: 0, failed: 0 }, syncedAt: '2026-10-01T08:00:00.000Z' };
}

function setup(options: { todo?: boolean; gtasks?: boolean; enabled?: boolean; appState?: boolean } = {}) {
  const preferences: Preferences = { ...createDefaultPreferences(), googleCalendarSyncEnabled: false };
  const status = createCalendarStatusStore();
  const enabled = options.enabled !== false;

  const google = {
    isConnected: jest.fn(async () => false),
    connect: jest.fn(),
    disconnect: jest.fn(),
    pushMeeting: jest.fn(),
    removeMeeting: jest.fn(),
    pullChanges: jest.fn(),
    createMeetLink: jest.fn(),
    enqueue: jest.fn(async () => undefined),
    flushPending: jest.fn(async () => ({ pushed: 0, failed: 0, pending: 0, blockedBy: null })),
    sync: jest.fn(async (): Promise<CalendarPullResult> => {
      throw new Error('google is off');
    }),
    loadState: jest.fn(async () => defaultGoogleSyncState()),
    resetLocalState: jest.fn(async () => undefined),
    refreshStatus: jest.fn(async () => ({ enabled: false, hasScope: false })),
  } satisfies GoogleCalendarServiceInternal;

  const device = {
    getPermission: jest.fn(async () => 'granted' as const),
    requestPermission: jest.fn(),
    listCalendars: jest.fn(),
    importFrom: jest.fn(),
    exportMeeting: jest.fn(),
    removeExported: jest.fn(),
    sync: jest.fn(async (): Promise<CalendarPullResult | null> => null),
    syncExports: jest.fn(async () => ({ exported: 0, removed: 0, failed: 0 })),
    ownSelection: jest.fn(async () => ({ importIds: [] as string[], exportId: null })),
    loadState: jest.fn(async () => defaultDeviceSyncState()),
  } satisfies DeviceCalendarServiceInternal;

  const todo = {
    isConfigured: jest.fn(() => true),
    isAccountConnected: jest.fn(async () => true),
    isEnabled: jest.fn(async () => enabled),
    listLists: jest.fn(),
    enable: jest.fn(),
    setList: jest.fn(),
    disable: jest.fn(),
    sync: jest.fn(async () => todoResult()),
    enqueue: jest.fn(async () => undefined),
    flushPending: jest.fn(async () => ({ pushed: 1, failed: 0, pending: 0, blockedBy: null })),
    loadState: jest.fn(async () => ({ ...defaultTodoSyncState(), enabled, lastSyncAt: '2026-09-30T08:00:00.000Z' })),
    refreshStatus: jest.fn(async () => {
      status.patchTodo({ configured: true, connected: true, enabled, listId: enabled ? 'list-tasks' : null, listName: enabled ? 'Tasks' : null });
      return { configured: true, connected: true, enabled };
    }),
  } satisfies TodoSyncServiceInternal;

  const gtasks = {
    isConfigured: jest.fn(() => true),
    isAccountConnected: jest.fn(async () => true),
    isEnabled: jest.fn(async () => enabled),
    listLists: jest.fn(),
    enable: jest.fn(),
    setList: jest.fn(),
    disable: jest.fn(),
    sync: jest.fn(async () => todoResult()),
    enqueue: jest.fn(async () => undefined),
    flushPending: jest.fn(async () => ({ pushed: 1, failed: 0, pending: 0, blockedBy: null })),
    loadState: jest.fn(async () => ({ ...defaultGtasksSyncState(), enabled, lastSyncAt: '2026-09-29T08:00:00.000Z' })),
    refreshStatus: jest.fn(async () => {
      status.patchGtasks({
        configured: true,
        connected: true,
        hasScope: true,
        enabled,
        listId: enabled ? 'gl-default' : null,
        listName: enabled ? 'My Tasks' : null,
      });
      return { configured: true, connected: true, hasScope: true, enabled };
    }),
  } satisfies GoogleTasksSyncServiceInternal;

  const events = createEventBus<AppEventMap>();
  let appState: 'active' | 'background' = 'active';
  const engine = createCalendarSyncEngine({
    google,
    device,
    todo: options.todo === false ? undefined : todo,
    gtasks: options.gtasks === true ? gtasks : undefined,
    preferences: { get: async () => preferences },
    getActiveUid: () => UID,
    status,
    events,
    appState: options.appState === true ? { currentState: () => appState, subscribe: () => () => undefined } : undefined,
    now: () => new Date(),
  });
  return { engine, todo, gtasks, events, status, setAppState: (next: typeof appState) => (appState = next) };
}

function change(overrides: Partial<TasksChangedEvent> = {}): TasksChangedEvent {
  return { uid: UID, reason: 'updated', origin: 'user', changedIds: ['t1'], ...overrides };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('calendarSyncEngine + microsoft to do', () => {
  it('syncs To Do on session start and reports it', async () => {
    const { engine, todo, status } = setup();
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    expect(todo.sync).toHaveBeenCalledTimes(1);
    expect(status.get().todo).toMatchObject({ enabled: true, lastSyncAt: '2026-09-30T08:00:00.000Z' });

    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.todo?.counts.created).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it('queues local task changes persist-first with the removed links and flushes after the debounce', async () => {
    const { engine, todo, events } = setup();
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    todo.enqueue.mockClear();
    todo.flushPending.mockClear();

    events.emit('tasks:changed', change({ reason: 'created', origin: 'ai', changedIds: ['t1'] }));
    events.emit(
      'tasks:changed',
      change({
        reason: 'deleted',
        changedIds: ['t2'],
        removed: [{ id: 't2', external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-tasks', todoTaskId: 'AAMk2=' } }],
      }),
    );
    await Promise.resolve();
    expect(todo.enqueue).toHaveBeenCalledWith([{ id: 't1', op: 'upsert', link: null }]);
    expect(todo.enqueue).toHaveBeenCalledWith([{ id: 't2', op: 'delete', link: { listId: 'list-tasks', taskId: 'AAMk2=' } }]);
    expect(todo.flushPending).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(todo.flushPending).toHaveBeenCalledTimes(1);
    // The debounced flush re-queues the same batch (harmless) before pushing.
    expect(todo.enqueue).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        { id: 't1', op: 'upsert', link: null },
        { id: 't2', op: 'delete', link: { listId: 'list-tasks', taskId: 'AAMk2=' } },
      ]),
    );
  });

  it('ignores remote and sync-origin task changes', async () => {
    const { engine, todo, events } = setup();
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    todo.enqueue.mockClear();

    events.emit('tasks:changed', change({ reason: 'remote', origin: undefined }));
    events.emit('tasks:changed', change({ reason: 'updated', origin: 'tasks_todo' }));
    events.emit('tasks:changed', change({ uid: 'someone-else' }));
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(todo.enqueue).not.toHaveBeenCalled();
  });

  it('does nothing for tasks while the sync is off, and skips the To Do part of syncNow', async () => {
    const { engine, todo, events } = setup({ enabled: false });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    expect(todo.sync).not.toHaveBeenCalled();

    events.emit('tasks:changed', change());
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(todo.enqueue).not.toHaveBeenCalled();
    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.todo).toBeNull();
  });

  it('pulls To Do every minute while the app is active and enabled, on top of the calendar interval', async () => {
    const { engine, todo } = setup({ appState: true });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    todo.sync.mockClear();

    await jest.advanceTimersByTimeAsync(TODO_FOREGROUND_INTERVAL_MS * 3 + 10);
    expect(todo.sync).toHaveBeenCalledTimes(3);

    engine.stop();
    todo.sync.mockClear();
    await jest.advanceTimersByTimeAsync(FOREGROUND_INTERVAL_MS);
    expect(todo.sync).not.toHaveBeenCalled();
  });

  it('is absent from reports and events when the provider is not registered', async () => {
    const { engine, todo, events, status } = setup({ todo: false });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    events.emit('tasks:changed', change());
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.todo).toBeUndefined();
    expect(todo.enqueue).not.toHaveBeenCalled();
    expect(status.get().todo).toBeUndefined();
    expect(report.gtasks).toBeUndefined();
    expect(status.get().gtasks).toBeUndefined();
  });
});

describe('calendarSyncEngine + google tasks (M8)', () => {
  it('syncs Google Tasks on session start, reports it, and pulls it every minute while active', async () => {
    const { engine, gtasks, status } = setup({ gtasks: true, appState: true });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    expect(gtasks.sync).toHaveBeenCalled();
    expect(status.get().gtasks).toMatchObject({ enabled: true, lastSyncAt: '2026-09-29T08:00:00.000Z' });

    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.gtasks?.counts.created).toBe(1);
    expect(report.todo?.counts.created).toBe(1);
    expect(report.errors).toEqual([]);

    gtasks.sync.mockClear();
    await jest.advanceTimersByTimeAsync(TODO_FOREGROUND_INTERVAL_MS * 2 + 10);
    expect(gtasks.sync).toHaveBeenCalledTimes(2);
  });

  it('queues local task changes for both providers with each provider\'s own link', async () => {
    const { engine, todo, gtasks, events } = setup({ gtasks: true });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    todo.enqueue.mockClear();
    gtasks.enqueue.mockClear();

    events.emit(
      'tasks:changed',
      change({
        reason: 'deleted',
        changedIds: ['t2'],
        removed: [{ id: 't2', external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-tasks', todoTaskId: 'AAMk2=', gtasksListId: 'gl-default', gtasksTaskId: 'g2' } }],
      }),
    );
    await Promise.resolve();
    expect(todo.enqueue).toHaveBeenCalledWith([{ id: 't2', op: 'delete', link: { listId: 'list-tasks', taskId: 'AAMk2=' } }]);
    expect(gtasks.enqueue).toHaveBeenCalledWith([{ id: 't2', op: 'delete', link: { listId: 'gl-default', taskId: 'g2' } }]);

    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(gtasks.flushPending).toHaveBeenCalledTimes(1);
    expect(todo.flushPending).toHaveBeenCalledTimes(1);
  });

  it('ignores sync-origin task changes from either provider and skips Google Tasks while off', async () => {
    const { engine, gtasks, events } = setup({ gtasks: true, enabled: false });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    expect(gtasks.sync).not.toHaveBeenCalled();

    events.emit('tasks:changed', change({ origin: 'tasks_gtasks' }));
    events.emit('tasks:changed', change());
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(gtasks.enqueue).not.toHaveBeenCalled();
    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.gtasks).toBeNull();
  });

  it('reports a Google Tasks failure under its own provider name', async () => {
    const { engine, gtasks } = setup({ gtasks: true });
    gtasks.sync.mockRejectedValue(new AppError('tasks_scope_missing', 'declined'));
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.errors).toEqual([{ provider: 'gtasks', code: 'tasks_scope_missing' }]);
  });
});

describe('syncTasksNow (Tasks screen refresh and focus)', () => {
  it('flushes and pulls To Do and Google Tasks without the calendars, and shares one run', async () => {
    const { engine, todo, gtasks } = setup({ gtasks: true });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    todo.sync.mockClear();
    gtasks.sync.mockClear();

    const [first, second] = await Promise.all([engine.syncTasksNow(), engine.syncTasksNow()]);

    expect(first).toBe(second);
    expect(todo.sync).toHaveBeenCalledTimes(1);
    expect(gtasks.sync).toHaveBeenCalledTimes(1);
    expect(first.todo?.counts.created).toBe(1);
    expect(first.gtasks?.counts.created).toBe(1);
    expect(first.errors).toEqual([]);
  });

  it('reports a failing provider and still syncs the other one', async () => {
    const { engine, todo } = setup({ gtasks: true });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    todo.sync.mockRejectedValueOnce(new AppError('offline', 'no network'));

    const report = await engine.syncTasksNow();

    expect(report.todo).toBeNull();
    expect(report.gtasks?.counts.created).toBe(1);
    expect(report.errors).toEqual([{ provider: 'todo', code: 'offline' }]);
  });

  it('does nothing when no task sync is enabled', async () => {
    const { engine, todo } = setup({ gtasks: true, enabled: false });
    engine.start(UID);
    await jest.runOnlyPendingTimersAsync();
    todo.sync.mockClear();

    await expect(engine.syncTasksNow()).resolves.toEqual({ todo: null, gtasks: null, errors: [] });
    expect(todo.sync).not.toHaveBeenCalled();
  });
});
