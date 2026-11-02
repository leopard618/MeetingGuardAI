/**
 * TodoSyncService orchestration: enable (list -> preferences -> first sync), setList, disable
 * cleanup, sync, and the not-configured / not-connected / not-enabled guards.
 */
import { createDefaultPreferences, type Preferences, type PreferencesPatch } from '../../../core/types';
import { createCalendarStatusStore } from '../../calendar/status';
import { createTodoSyncService } from '../todo/service';
import { defaultTodoSyncState, type TodoSyncState } from '../todo/state';
import { todoTaskLocalId } from '../todo/sync';
import { FakeClock, FakeTasks, FakeTodoApi, graphError, memoryStateStore } from '../__testUtils__/fakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');
const LIST = { id: 'list-tasks', name: 'Tasks' };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup(options: { clientId?: string | null; hasToken?: boolean } = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeTodoApi(clock);
  const tasks = new FakeTasks(clock);
  const state = memoryStateStore<TodoSyncState>(defaultTodoSyncState());
  const status = createCalendarStatusStore();
  let preferences: Preferences = createDefaultPreferences();
  const prefsRepo = {
    get: jest.fn(async () => preferences),
    update: jest.fn(async (patch: PreferencesPatch) => {
      preferences = { ...preferences, ...patch };
      return preferences;
    }),
  };
  const hasToken = options.hasToken !== false;
  const service = createTodoSyncService({
    api,
    tasks,
    state,
    hasRefreshToken: async () => hasToken,
    preferences: prefsRepo,
    status,
    now: clock.now,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
    config: { clientId: options.clientId === undefined ? '11111111-2222-3333-4444-555555555555' : options.clientId },
  });
  return { service, api, tasks, state, status, prefsRepo, prefs: () => preferences };
}

describe('todo service', () => {
  it('is unconfigured without a client id and every method says so', async () => {
    const { service, status } = setup({ clientId: null });
    expect(service.isConfigured()).toBe(false);
    await expect(service.isAccountConnected()).resolves.toBe(false);
    await expect(service.listLists()).rejects.toMatchObject({ code: 'not_configured' });
    await expect(service.sync()).rejects.toMatchObject({ code: 'not_configured' });
    expect(status.get().todo).toBeUndefined();
  });

  it('needs the Microsoft account before listing or enabling', async () => {
    const { service, status } = setup({ hasToken: false });
    await expect(service.isAccountConnected()).resolves.toBe(false);
    await expect(service.listLists()).rejects.toMatchObject({ code: 'calendar_not_connected' });
    await expect(service.enable(LIST)).rejects.toMatchObject({ code: 'calendar_not_connected' });
    await expect(service.sync()).rejects.toMatchObject({ code: 'calendar_not_connected' });
    expect(status.get().todo).toMatchObject({ configured: true, connected: false, enabled: false });
  });

  it('lists the account lists without the flagged-email list and marks the default one', async () => {
    const { service, api } = setup();
    api.lists.push({ id: 'list-flag', displayName: 'Flagged Emails', wellknownListName: 'flaggedEmails' }, { id: 'list-work', displayName: ' Work ' });
    await expect(service.listLists()).resolves.toEqual([
      { id: 'list-tasks', name: 'Tasks', isDefault: true },
      { id: 'list-work', name: 'Work', isDefault: false },
    ]);
  });

  it('enables: stores the list, pulls it, pushes open tasks, and reports the status', async () => {
    const { service, api, tasks, state, status, prefs } = setup();
    api.seed(LIST.id, { id: 'A1', title: 'From To Do' });
    const mine = tasks.add({ title: 'Mine' });

    const result = await service.enable(LIST);

    expect(prefs()).toMatchObject({ todoListId: LIST.id, todoListName: LIST.name });
    expect(result).toMatchObject({ fullSync: true, counts: { created: 1, pushed: 1, failed: 0 } });
    expect(state.value.enabled).toBe(true);
    expect(await tasks.get(todoTaskLocalId('A1'))).not.toBeNull();
    expect((await tasks.get(mine.id))?.external.todoTaskId).toBe('AAMk1=');
    expect(status.get().todo).toMatchObject({ configured: true, connected: true, enabled: true, listId: LIST.id, listName: 'Tasks', lastError: null });
    expect(status.get().todo?.lastSyncAt).toBe(NOW.toISOString());
    await expect(service.isEnabled()).resolves.toBe(true);
  });

  it('stays enabled when the first sync fails and surfaces the error', async () => {
    const { service, api, status } = setup();
    api.failures.push({ method: 'startDelta', error: graphError(403, 'ErrorAccessDenied') });

    const result = await service.enable(LIST);

    expect(result).toBeNull();
    expect(status.get().todo).toMatchObject({ enabled: true, lastError: 'permission_denied' });
  });

  it('sync flushes then pulls and refreshes the status', async () => {
    const { service, api, tasks, status } = setup();
    await service.enable(LIST);
    const other = tasks.add({ title: 'Added later' });
    await service.enqueue([{ id: other.id, op: 'upsert' }]);
    api.seed(LIST.id, { id: 'A2', title: 'New in To Do' });
    api.deltaResponses.push(api.fullPage(LIST.id, 'https://graph.microsoft.com/v1.0/delta-2'));

    const result = await service.sync();

    expect(result.counts).toMatchObject({ pushed: 1, created: 1 });
    expect((await tasks.get(other.id))?.external.todoTaskId).toBeDefined();
    expect(status.get().todo).toMatchObject({ enabled: true, lastError: null, syncing: false });
  });

  it('setList only changes the default for new tasks', async () => {
    const { service, api, tasks, status, prefs } = setup();
    await service.enable(LIST);
    const mine = tasks.add({ title: 'Mine' });
    await service.enqueue([{ id: mine.id, op: 'upsert' }]);
    await service.sync();
    api.calls = [];

    await service.setList({ id: 'list-work', name: 'Work' });

    expect(prefs()).toMatchObject({ todoListId: 'list-work', todoListName: 'Work' });
    expect(status.get().todo).toMatchObject({ listId: 'list-work', listName: 'Work' });
    expect((await tasks.get(mine.id))?.external.todoListId).toBe(LIST.id);
    const later = tasks.add({ title: 'Later' });
    await service.enqueue([{ id: later.id, op: 'upsert' }]);
    await service.flushPending();
    expect(api.calls.filter((call) => call.method === 'create').map((call) => call.listId)).toEqual(['list-work']);
  });

  it('disable deletes imported tasks, unlinks the rest, clears the list and the state', async () => {
    const { service, api, tasks, state, status, prefs } = setup();
    api.seed(LIST.id, { id: 'A1', title: 'From To Do' });
    const mine = tasks.add({ title: 'Mine' });
    await service.enable(LIST);
    api.calls = [];

    await service.disable();

    expect(await tasks.get(todoTaskLocalId('A1'))).toBeNull();
    expect((await tasks.get(mine.id))?.external).toMatchObject({ todoListId: null, todoTaskId: null, todoUpdatedAt: null });
    expect(prefs()).toMatchObject({ todoListId: null, todoListName: null });
    expect(state.value.enabled).toBe(false);
    expect(status.get().todo).toMatchObject({ enabled: false, listId: null });
    expect(api.calls).toEqual([]);
    await expect(service.sync()).rejects.toMatchObject({ code: 'calendar_not_connected' });
  });
});
