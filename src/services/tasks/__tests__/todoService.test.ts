/**
 * TodoSyncService orchestration: enable (list -> preferences -> first sync), setList, disable
 * cleanup, sync, the not-configured / not-connected / not-enabled guards, and the list new tasks
 * go to (remembered on the device, put back when another device erases it).
 */
import { AppError } from '../../../core/errors';
import { createDefaultPreferences, EMPTY_TASK_EXTERNAL_REFS, type Preferences, type PreferencesPatch, type Task } from '../../../core/types';
import { createCalendarStatusStore } from '../../calendar/status';
import { createTodoSyncService } from '../todo/service';
import { defaultTodoSyncState, todoSyncStateSchema, type TodoSyncState } from '../todo/state';
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

function setup(options: { clientId?: string | null; hasToken?: boolean; state?: TodoSyncState } = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeTodoApi(clock);
  const tasks = new FakeTasks(clock);
  const state = memoryStateStore<TodoSyncState>(options.state ?? defaultTodoSyncState());
  const status = createCalendarStatusStore();
  let preferences: Preferences = createDefaultPreferences();
  const prefsRepo = {
    get: jest.fn(async () => preferences),
    update: jest.fn(async (patch: PreferencesPatch) => {
      // Like the repository: every write stamps updatedAt.
      preferences = { ...preferences, ...patch, updatedAt: clock.now().toISOString() };
      return preferences;
    }),
  };
  /** A write made elsewhere (another device, an older build), straight into the shared preferences. */
  const setPrefs = (patch: Partial<Preferences>): void => {
    preferences = { ...preferences, ...patch };
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
  return { service, clock, api, tasks, state, status, prefsRepo, prefs: () => preferences, setPrefs };
}

/** Messages the tasks logger wrote at info level (console.log is mocked in beforeEach). */
function infoMessages(): unknown[] {
  return jest.spyOn(console, 'log').mock.calls.map((call) => call[1]);
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

describe('the list new tasks go to', () => {
  const RESTORED = 'Putting back the To Do list another device erased';

  it('remembers the chosen list on this device', async () => {
    const { service, state } = setup();
    await service.enable(LIST);
    expect(state.value).toMatchObject({ enabled: true, listId: LIST.id, listName: LIST.name });
    await service.setList({ id: 'list-work', name: 'Work' });
    expect(state.value).toMatchObject({ listId: 'list-work', listName: 'Work' });
  });

  it('puts back the list an older build erased, so the card, the editor and the assistant name it again', async () => {
    const { service, status, prefs, setPrefs } = setup();
    await service.enable(LIST);
    // The iPhone on 1.5.0 saves its settings as a whole document without the list keys.
    setPrefs({ todoListId: null, todoListName: null });

    await service.refreshStatus();

    expect(prefs()).toMatchObject({ todoListId: LIST.id, todoListName: LIST.name });
    expect(status.get().todo).toMatchObject({ enabled: true, listId: LIST.id, listName: LIST.name });
    await service.refreshStatus();
    await service.sync();
    expect(infoMessages().filter((message) => message === RESTORED)).toHaveLength(1);
  });

  it('puts the list back for a push when it is erased in the middle of a sync, and sends the new task there', async () => {
    const { service, api, tasks, prefs, setPrefs } = setup();
    await service.enable(LIST);
    const later = tasks.add({ title: 'Recorded after the iPhone saved its settings' });
    await service.enqueue([{ id: later.id, op: 'upsert' }]);
    // The erase lands after the status was read, while the queue is being sent.
    const list = tasks.list.bind(tasks);
    jest.spyOn(tasks, 'list').mockImplementationOnce(async () => {
      setPrefs({ todoListId: null, todoListName: null });
      return list();
    });
    api.calls = [];

    await expect(service.flushPending()).resolves.toMatchObject({ pushed: 1, pending: 0 });

    expect(prefs()).toMatchObject({ todoListId: LIST.id, todoListName: LIST.name });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([['create', LIST.id]]);
    expect((await tasks.get(later.id))?.external).toMatchObject({ todoListId: LIST.id, todoTaskId: 'AAMk1=' });
  });

  it('follows a list changed on another device, and puts that one back when it is erased', async () => {
    const { service, state, status, prefs, setPrefs } = setup();
    await service.enable(LIST);
    setPrefs({ todoListId: 'list-work', todoListName: 'Work' });

    await service.refreshStatus();

    expect(state.value).toMatchObject({ listId: 'list-work', listName: 'Work' });
    expect(status.get().todo).toMatchObject({ listId: 'list-work', listName: 'Work' });
    setPrefs({ todoListId: null, todoListName: null });
    await service.refreshStatus();
    expect(prefs()).toMatchObject({ todoListId: 'list-work', todoListName: 'Work' });
  });

  it('keeps syncing without any list: new tasks wait, linked tasks and the pull go on', async () => {
    const { service, api, tasks, state, status, setPrefs } = setup();
    const linked = tasks.add({ title: 'Linked' });
    await service.enable(LIST);
    // A state from before the list was remembered, and the shared choice erased: no list is known.
    await state.update((current) => ({ ...current, listId: null, listName: null }));
    setPrefs({ todoListId: null, todoListName: null });
    const waiting = tasks.add({ title: 'Waits for a list' });
    await tasks.update(linked.id, { title: 'Linked, renamed' });
    await service.enqueue([
      { id: waiting.id, op: 'upsert' },
      { id: linked.id, op: 'upsert' },
    ]);
    api.calls = [];

    const result = await service.sync();

    expect(result.counts).toMatchObject({ pushed: 1, failed: 0 });
    expect(api.calls.map((call) => call.method)).toEqual(['patch', 'deltaPage']);
    expect(Object.keys(state.value.pending)).toEqual([waiting.id]);
    expect(status.get().todo).toMatchObject({ enabled: true, listId: null, listName: null, lastError: null });
  });

  it('setList sends the open tasks that waited for a list and patches a copy whose document lost its link', async () => {
    const { service, api, tasks, state, status, prefs, setPrefs } = setup();
    const pushedBefore = tasks.add({ title: 'Pushed before' });
    await service.enable(LIST);
    expect(state.value.links[pushedBefore.id]).toEqual({ listId: LIST.id, taskId: 'AAMk1=' });
    await state.update((current) => ({ ...current, listId: null, listName: null }));
    setPrefs({ todoListId: null, todoListName: null });
    // The older build also rewrote the pushed task without its link.
    const stored = await tasks.get(pushedBefore.id);
    tasks.tasks.set(pushedBefore.id, { ...(stored as NonNullable<typeof stored>), title: 'Pushed before, renamed', external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    const waiting = tasks.add({ title: 'Created while no list was known' });
    await service.enqueue([{ id: waiting.id, op: 'upsert' }]);
    await service.flushPending();
    expect(status.get().todo).toMatchObject({ enabled: true, listId: null });
    expect(Object.keys(state.value.pending)).toEqual([waiting.id]);
    api.calls = [];

    await service.setList(LIST);

    expect(prefs()).toMatchObject({ todoListId: LIST.id, todoListName: LIST.name });
    expect(state.value).toMatchObject({ listId: LIST.id, listName: LIST.name, pending: {} });
    expect(status.get().todo).toMatchObject({ listId: LIST.id, listName: LIST.name });
    expect(api.calls.map((call) => [call.method, call.listId, call.taskId ?? null])).toEqual([
      ['patch', LIST.id, 'AAMk1='],
      ['create', LIST.id, null],
    ]);
    expect((await tasks.get(pushedBefore.id))?.external).toMatchObject({ todoListId: LIST.id, todoTaskId: 'AAMk1=' });
    expect((await tasks.get(waiting.id))?.external).toMatchObject({ todoListId: LIST.id, todoTaskId: 'AAMk2=' });
  });

  it('keeps the chosen list when sending the waiting tasks fails, and shows why', async () => {
    const { service, api, tasks, state, status, prefs } = setup();
    await service.enable(LIST);
    jest.spyOn(tasks, 'list').mockRejectedValueOnce(new AppError('offline', 'No network'));

    await expect(service.setList({ id: 'list-work', name: 'Work' })).resolves.toBeUndefined();

    expect(prefs()).toMatchObject({ todoListId: 'list-work', todoListName: 'Work' });
    expect(state.value).toMatchObject({ listId: 'list-work', lastError: 'offline' });
    expect(status.get().todo).toMatchObject({ listId: 'list-work', lastError: 'offline', syncing: false });

    // A blocked send keeps the task queued and says why.
    const waiting = tasks.add({ title: 'Waits' });
    api.failures.push({ method: 'create', error: new AppError('unauthenticated', 'Token revoked') });
    await expect(service.setList(LIST)).resolves.toBeUndefined();
    expect(status.get().todo?.lastError).toBe('unauthenticated');
    expect(Object.keys(state.value.pending)).toEqual([waiting.id]);
  });

  it('puts nothing back once this device turned the sync off', async () => {
    const { service, state, status, prefsRepo, prefs } = setup();
    await service.enable(LIST);
    await service.disable();
    prefsRepo.update.mockClear();

    await service.refreshStatus();
    await expect(service.sync()).rejects.toMatchObject({ code: 'calendar_not_connected' });

    expect(state.value).toMatchObject({ enabled: false, listId: null, listName: null });
    expect(prefs()).toMatchObject({ todoListId: null, todoListName: null });
    expect(prefsRepo.update).not.toHaveBeenCalled();
    expect(status.get().todo).toMatchObject({ enabled: false, listId: null, listName: null });
  });

  it('leaves no remembered list behind when the disable cleanup fails', async () => {
    const { service, tasks, state } = setup();
    await service.enable(LIST);
    jest.spyOn(tasks, 'list').mockRejectedValueOnce(new AppError('offline', 'No network'));

    await expect(service.disable()).rejects.toMatchObject({ code: 'offline' });

    expect(state.value).toMatchObject({ enabled: false, listId: null, listName: null });
  });

  it('reads a state stored before the list was remembered and starts remembering the chosen one', async () => {
    const stored = { v: 1, enabled: true, lastSyncAt: null, lastError: null, lists: {}, pending: {}, hashes: {}, links: {} };
    const parsed = todoSyncStateSchema.parse(stored);
    expect(parsed).toEqual({ ...stored, listId: null, listName: null });
    const { service, state, prefs, setPrefs } = setup({ state: parsed });
    setPrefs({ todoListId: LIST.id, todoListName: LIST.name, updatedAt: NOW.toISOString() });

    await service.refreshStatus();
    expect(state.value).toMatchObject({ listId: LIST.id, listName: LIST.name });

    setPrefs({ todoListId: null, todoListName: null });
    await service.refreshStatus();
    expect(prefs()).toMatchObject({ todoListId: LIST.id, todoListName: LIST.name });
  });

  it('writes nothing while signed out or while the settings are still the session defaults', async () => {
    const { service, state, status, prefsRepo, setPrefs } = setup();
    await service.enable(LIST);
    setPrefs({ todoListId: null, todoListName: null });
    prefsRepo.update.mockClear();

    const load = jest.spyOn(state, 'load').mockRejectedValue(new AppError('unauthenticated', 'No active data session'));
    await service.refreshStatus();
    expect(prefsRepo.update).not.toHaveBeenCalled();
    load.mockRestore();

    // Defaults (no updatedAt) mean the settings have not arrived yet: nothing was erased. New
    // tasks still go to the list this device knows.
    setPrefs({ updatedAt: null });
    await service.refreshStatus();
    expect(prefsRepo.update).not.toHaveBeenCalled();
    expect(status.get().todo).toMatchObject({ listId: LIST.id, listName: LIST.name });
  });

  it('never writes back a list it read before a choice made here meanwhile', async () => {
    const { service, state, status, prefsRepo, prefs, setPrefs } = setup();
    await service.enable(LIST);
    setPrefs({ todoListId: null, todoListName: null });
    const erased = prefs();
    const gate: { release?: () => void } = {};
    prefsRepo.get.mockImplementationOnce(
      () =>
        new Promise<Preferences>((resolve) => {
          gate.release = () => resolve(erased);
        }),
    );
    const refreshing = service.refreshStatus();
    for (let i = 0; i < 20 && gate.release === undefined; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gate.release).toBeDefined();

    // The user picks another list while that read is still on its way.
    await service.setList({ id: 'list-work', name: 'Work' });
    gate.release?.();
    await refreshing;

    expect(prefs()).toMatchObject({ todoListId: 'list-work', todoListName: 'Work' });
    expect(state.value).toMatchObject({ listId: 'list-work', listName: 'Work' });
    expect(status.get().todo).toMatchObject({ listId: 'list-work', listName: 'Work' });
  });

  it('never shows the switch it read before a disable made here meanwhile', async () => {
    const { service, status, prefsRepo, prefs } = setup();
    await service.enable(LIST);
    const before = prefs();
    const gate: { release?: () => void } = {};
    prefsRepo.get.mockImplementationOnce(
      () =>
        new Promise<Preferences>((resolve) => {
          gate.release = () => resolve(before);
        }),
    );
    const refreshing = service.refreshStatus();
    for (let i = 0; i < 20 && gate.release === undefined; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gate.release).toBeDefined();

    // The user turns the sync off while that read (on, with a list) is still on its way.
    await service.disable();
    gate.release?.();
    await refreshing;

    // Off, not "on without a list" (which would offer to choose one).
    expect(status.get().todo).toMatchObject({ enabled: false, listId: null, listName: null, lastError: null });
  });

  it('still sends new tasks to the remembered list when putting it back fails', async () => {
    const { service, api, tasks, status, prefsRepo, setPrefs } = setup();
    await service.enable(LIST);
    setPrefs({ todoListId: null, todoListName: null });
    // The write that puts the list back fails (the session ended, a rule refused it).
    prefsRepo.update.mockRejectedValue(new AppError('unauthenticated', 'No active data session'));

    await expect(service.refreshStatus()).resolves.toMatchObject({ enabled: true });
    expect(status.get().todo).toMatchObject({ enabled: true, listId: LIST.id, listName: LIST.name });

    const later = tasks.add({ title: 'Recorded meanwhile' });
    await service.enqueue([{ id: later.id, op: 'upsert' }]);
    api.calls = [];
    await expect(service.flushPending()).resolves.toMatchObject({ pushed: 1, pending: 0, blockedBy: null });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([['create', LIST.id]]);
  });

  it('sends the open tasks an earlier build dropped once this device first learns its list', async () => {
    // A state from the build that did not remember the list, preferences that hold one again
    // (picked again on that build), and an open task that build dropped: no copy, no queue entry.
    const stored = todoSyncStateSchema.parse({ v: 1, enabled: true, lastSyncAt: null, lastError: null, lists: {}, pending: {}, hashes: {}, links: {} });
    const { service, api, tasks, state, setPrefs } = setup({ state: stored });
    setPrefs({ todoListId: LIST.id, todoListName: LIST.name, updatedAt: NOW.toISOString() });
    const dropped = tasks.add({ title: 'Recorded while the list was erased' });

    // Queueing them fails at first: the list is not remembered yet, so the next read tries again.
    jest.spyOn(tasks, 'list').mockRejectedValueOnce(new AppError('offline', 'No network'));
    await service.refreshStatus();
    expect(state.value).toMatchObject({ listId: null, pending: {} });

    await service.refreshStatus();
    await service.sync();

    expect(api.calls.filter((call) => call.method === 'create').map((call) => call.listId)).toEqual([LIST.id]);
    expect((await tasks.get(dropped.id))?.external).toMatchObject({ todoListId: LIST.id, todoTaskId: 'AAMk1=' });
    expect(state.value).toMatchObject({ listId: LIST.id, listName: LIST.name, pending: {} });

    // Once: with the list remembered, a status read queues nothing.
    tasks.add({ title: 'Added without a change event' });
    await service.refreshStatus();
    expect(state.value.pending).toEqual({});
  });

  it('never remembers a list it read before a choice made here meanwhile', async () => {
    const stored = todoSyncStateSchema.parse({ v: 1, enabled: true, lastSyncAt: null, lastError: null, lists: {}, pending: {}, hashes: {}, links: {} });
    const { service, tasks, state, setPrefs } = setup({ state: stored });
    setPrefs({ todoListId: LIST.id, todoListName: LIST.name, updatedAt: NOW.toISOString() });
    // The status read is queueing the open tasks before it stores the list it read.
    const gate: { release?: () => void } = {};
    const list = tasks.list.bind(tasks);
    jest.spyOn(tasks, 'list').mockImplementationOnce(
      () =>
        new Promise<Task[]>((resolve) => {
          gate.release = () => resolve(list());
        }),
    );
    const refreshing = service.refreshStatus();
    for (let i = 0; i < 20 && gate.release === undefined; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gate.release).toBeDefined();

    await service.setList({ id: 'list-work', name: 'Work' });
    gate.release?.();
    await refreshing;

    expect(state.value).toMatchObject({ listId: 'list-work', listName: 'Work' });
  });

  it('keeps one task when another device turns the sync off and this one goes on', async () => {
    const { service, clock, api, tasks, prefsRepo, prefs } = setup();
    const mine = tasks.add({ title: 'Prepare the proposal' });
    await service.enable(LIST);
    // Another phone on the same account: the same tasks, To Do lists and preferences.
    const other = createTodoSyncService({
      api,
      tasks,
      state: memoryStateStore<TodoSyncState>(defaultTodoSyncState()),
      hasRefreshToken: async () => true,
      preferences: prefsRepo,
      status: createCalendarStatusStore(),
      now: clock.now,
      defaultTimeZone: () => 'UTC',
      untitledTitle: () => '(No title)',
      config: { clientId: '11111111-2222-3333-4444-555555555555' },
    });
    await other.enable(LIST);
    await other.disable();
    expect((await tasks.get(mine.id))?.external.todoTaskId).toBeNull();

    // This phone puts the list back and goes on; the copy is renamed in To Do meanwhile.
    await service.refreshStatus();
    expect(prefs()).toMatchObject({ todoListId: LIST.id, todoListName: LIST.name });
    api.deltaResponses.push({
      value: [{ id: 'AAMk1=', title: 'Renamed in To Do', lastModifiedDateTime: '2026-10-01T09:00:00.000Z' }],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-2',
    });

    await service.sync();

    expect(tasks.all().map((task) => task.id)).toEqual([mine.id]);
    expect(await tasks.get(mine.id)).toMatchObject({ title: 'Renamed in To Do', external: { todoListId: LIST.id, todoTaskId: 'AAMk1=' } });
  });
});
