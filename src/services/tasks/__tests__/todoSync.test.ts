import { AppError } from '../../../core/errors';
import { defaultTodoSyncState, type TodoSyncState } from '../todo/state';
import {
  deleteTodoCopy,
  enqueueTodoPushes,
  enqueueUnlinkedOpenTasks,
  flushTodoPushes,
  isTodoPushable,
  pullTodoChanges,
  pushTodoTask,
  removeTodoLinks,
  syncedListIds,
  todoTaskLocalId,
  type TodoSyncDeps,
} from '../todo/sync';
import { EMPTY_TASK_EXTERNAL_REFS } from '../../../core/types';
import { FakeClock, FakeTasks, FakeTodoApi, graphError, memoryStateStore } from '../__testUtils__/fakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');
const LIST = 'list-tasks';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup(options: { defaultList?: string | null; state?: Partial<TodoSyncState> } = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeTodoApi(clock);
  const tasks = new FakeTasks(clock);
  const state = memoryStateStore<TodoSyncState>({ ...defaultTodoSyncState(), enabled: true, ...options.state });
  let defaultList = options.defaultList === undefined ? LIST : options.defaultList;
  const deps: TodoSyncDeps = {
    api,
    tasks,
    state,
    defaultList: async () => (defaultList === null ? null : { id: defaultList, name: 'Tasks' }),
    now: clock.now,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
  };
  const setDefaultList = (id: string | null): void => {
    defaultList = id;
  };
  return { clock, api, tasks, state, deps, setDefaultList };
}

describe('ids and list selection', () => {
  it('derives a deterministic local id from the To Do id (hash for Graph-style ids)', () => {
    expect(todoTaskLocalId('simple-id')).toBe('td_simple-id');
    const hashed = todoTaskLocalId('AAMkAGI2THVSAAA=');
    expect(hashed).toMatch(/^td_h[0-9a-f]{16}$/);
    expect(todoTaskLocalId('AAMkAGI2THVSAAA=')).toBe(hashed);
    expect(todoTaskLocalId('AAMkAGI2THVSAAB=')).not.toBe(hashed);
  });

  it('syncs the default list plus every list a linked task lives in', () => {
    const { tasks } = setup();
    const linked = tasks.add({ title: 'Linked', todoListId: 'list-work' });
    tasks.tasks.set(linked.id, { ...linked, external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-work', todoTaskId: 'AAMk9=' } });
    tasks.add({ title: 'Only chosen, not linked', todoListId: 'list-home' });
    expect(syncedListIds(LIST, tasks.all())).toEqual([LIST, 'list-work']);
    expect(syncedListIds(null, tasks.all())).toEqual(['list-work']);
  });

  it('pushes open tasks and linked tasks, never finished tasks that To Do never saw', () => {
    const { tasks } = setup();
    const open = tasks.add({ title: 'Open' });
    expect(isTodoPushable(open)).toBe(true);
    expect(isTodoPushable({ ...open, status: 'done' })).toBe(false);
    expect(isTodoPushable({ ...open, status: 'done', external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: LIST, todoTaskId: 'x' } })).toBe(true);
    expect(isTodoPushable({ ...open, source: 'todo' })).toBe(false);
  });
});

describe('pullTodoChanges', () => {
  it('imports open tasks from a full listing, skips finished history, and stores the delta link', async () => {
    const { api, tasks, state, deps } = setup();
    api.seed(LIST, { id: 'A1', title: 'From To Do', dueDateTime: { dateTime: '2026-10-05T00:00:00.0000000', timeZone: 'UTC' } });
    api.seed(LIST, { id: 'A2', title: 'Old and done', status: 'completed' });

    const result = await pullTodoChanges(deps);

    expect(result.fullSync).toBe(true);
    expect(result.counts).toMatchObject({ created: 1, unchanged: 1, removed: 0, updated: 0 });
    const imported = tasks.all();
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      id: todoTaskLocalId('A1'),
      title: 'From To Do',
      source: 'todo',
      dueDate: '2026-10-05',
      external: { todoListId: LIST, todoTaskId: 'A1' },
    });
    expect(tasks.writes.every((write) => write.origin === 'tasks_todo')).toBe(true);
    expect(state.value.lists[LIST]?.deltaLink).toBe(`https://graph.microsoft.com/v1.0/delta-${LIST}`);
    expect(state.value.hashes.A1).toBeDefined();
    expect(api.calls.map((call) => call.method)).toEqual(['startDelta']);
  });

  it('applies incremental changes, completions and removals from the delta link', async () => {
    const { api, tasks, state, deps } = setup();
    api.seed(LIST, { id: 'A1', title: 'From To Do' });
    api.seed(LIST, { id: 'A2', title: 'Gone soon' });
    await pullTodoChanges(deps);
    const a1 = todoTaskLocalId('A1');
    const a2 = todoTaskLocalId('A2');
    api.calls = [];

    api.deltaResponses.push({
      value: [
        { id: 'A1', title: 'From To Do', status: 'completed', lastModifiedDateTime: '2026-10-01T09:00:00.000Z' },
        { id: 'A2', '@removed': { reason: 'deleted' } },
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-2',
    });
    const result = await pullTodoChanges(deps);

    expect(result.fullSync).toBe(false);
    expect(result.counts).toMatchObject({ updated: 1, removed: 1, created: 0 });
    expect((await tasks.get(a1))?.status).toBe('done');
    expect((await tasks.get(a1))?.external.todoUpdatedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(await tasks.get(a2)).toBeNull();
    expect(api.calls.map((call) => call.method)).toEqual(['deltaPage']);
    expect(state.value.lists[LIST]?.deltaLink).toBe('https://graph.microsoft.com/v1.0/delta-2');
    expect(state.value.hashes.A2).toBeUndefined();
  });

  it('leaves a task alone while a local change is queued for it (local wins)', async () => {
    const { api, tasks, deps } = setup();
    api.seed(LIST, { id: 'A1', title: 'From To Do' });
    await pullTodoChanges(deps);
    const a1 = todoTaskLocalId('A1');
    await tasks.update(a1, { title: 'Edited here' });
    await enqueueTodoPushes(deps, [{ id: a1, op: 'upsert' }]);

    api.deltaResponses.push({ value: [{ id: 'A1', title: 'Edited in To Do', lastModifiedDateTime: '2026-10-01T09:00:00.000Z' }], '@odata.deltaLink': 'x' });
    const result = await pullTodoChanges(deps);

    expect(result.counts.unchanged).toBe(1);
    expect((await tasks.get(a1))?.title).toBe('Edited here');
  });

  it('falls back to a full listing on 410 and deletes linked tasks the listing no longer has', async () => {
    const { api, tasks, state, deps } = setup();
    api.seed(LIST, { id: 'A1', title: 'From To Do' });
    await pullTodoChanges(deps);
    const own = tasks.add({ title: 'Mine, pushed earlier' });
    tasks.tasks.set(own.id, { ...own, external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: LIST, todoTaskId: 'B9' } });
    api.failures.push({ method: 'deltaPage', error: graphError(410, 'syncStateNotFound') });

    const result = await pullTodoChanges(deps);

    expect(result.fullSync).toBe(true);
    expect(api.calls.map((call) => call.method)).toEqual(['startDelta', 'deltaPage', 'startDelta']);
    expect(await tasks.get(own.id)).toBeNull();
    expect(result.counts.removed).toBe(1);
    expect(state.value.lists[LIST]?.lastFullSyncAt).toBe(NOW.toISOString());
  });

  it('pulls the lists of linked tasks too, with their own delta links', async () => {
    const { api, tasks, state, deps } = setup();
    const work = tasks.add({ title: 'Work item', todoListId: 'list-work' });
    tasks.tasks.set(work.id, { ...work, external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-work', todoTaskId: 'W1' } });
    api.seed('list-work', { id: 'W1', title: 'Work item renamed', lastModifiedDateTime: '2026-10-01T09:00:00.000Z' });

    const result = await pullTodoChanges(deps);

    expect(api.calls.filter((call) => call.method === 'startDelta').map((call) => call.listId)).toEqual([LIST, 'list-work']);
    expect(result.counts.updated).toBe(1);
    expect((await tasks.get(work.id))?.title).toBe('Work item renamed');
    expect(Object.keys(state.value.lists).sort()).toEqual([LIST, 'list-work']);
  });

  it('links a document that lost its link to the copy this device knows of, never imports that copy', async () => {
    const { api, tasks, state, deps } = setup();
    const pushed = (await pushTodoTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // An older build rewrote the document without its link and renamed it (another device's
    // disable unlinks documents the same way).
    tasks.tasks.set(pushed.id, { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } });

    const full = await pullTodoChanges(deps, { full: true });

    expect(full.counts).toMatchObject({ created: 0, removed: 0 });
    expect(tasks.all().map((task) => task.id)).toEqual([pushed.id]);
    // Linked again. The copy did not change in To Do, so the edit in the document stays.
    expect(await tasks.get(pushed.id)).toMatchObject({ title: 'Prepare the final proposal', external: { todoListId: LIST, todoTaskId: 'AAMk1=' } });

    // Unlinked again, then renamed in To Do: the same task gets the change and the link.
    const relinked = await tasks.get(pushed.id);
    tasks.tasks.set(pushed.id, { ...(relinked as NonNullable<typeof relinked>), external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    api.deltaResponses.push({
      value: [{ id: 'AAMk1=', title: 'Renamed in To Do', lastModifiedDateTime: '2026-10-01T09:00:00.000Z' }],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-2',
    });

    const incremental = await pullTodoChanges(deps);

    expect(incremental.counts).toMatchObject({ created: 0, updated: 1 });
    expect(tasks.all().map((task) => task.id)).toEqual([pushed.id]);
    expect(await tasks.get(pushed.id)).toMatchObject({ title: 'Renamed in To Do', external: { todoListId: LIST, todoTaskId: 'AAMk1=' } });
    expect(state.value.links[pushed.id]).toEqual({ listId: LIST, taskId: 'AAMk1=' });
  });
});

describe('pushTodoTask', () => {
  it('creates the copy in the default list, writes the link back with origin tasks_todo and stores the hash', async () => {
    const { api, tasks, state, deps } = setup();
    const task = tasks.add({ title: 'Prepare the proposal', dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });

    const outcome = await pushTodoTask(deps, task);

    expect(outcome.sent).toBe(true);
    expect(api.calls).toEqual([expect.objectContaining({ method: 'create', listId: LIST })]);
    expect(api.calls[0]?.body).toMatchObject({ title: 'Prepare the proposal', isReminderOn: true, status: 'notStarted' });
    const stored = await tasks.get(task.id);
    expect(stored?.external).toMatchObject({ todoListId: LIST, todoTaskId: 'AAMk1=' });
    expect(tasks.writes.at(-1)).toEqual({ id: task.id, origin: 'tasks_todo', kind: 'update' });
    expect(state.value.links[task.id]).toEqual({ listId: LIST, taskId: 'AAMk1=' });
    expect(state.value.hashes['AAMk1=']).toBeDefined();

    // Unchanged: nothing is sent again.
    api.calls = [];
    const again = await pushTodoTask(deps, stored as NonNullable<typeof stored>);
    expect(again.sent).toBe(false);
    expect(api.calls).toEqual([]);
  });

  it('patches a linked task and re-creates it when the copy is gone', async () => {
    const { api, tasks, deps } = setup();
    const task = tasks.add({ title: 'Prepare the proposal' });
    await pushTodoTask(deps, task);
    const edited = await tasks.update(task.id, { title: 'Prepare the final proposal' });
    api.calls = [];

    await pushTodoTask(deps, edited);
    expect(api.calls.map((call) => call.method)).toEqual(['patch']);

    api.failures.push({ method: 'patch', error: graphError(404, 'ErrorItemNotFound') });
    const renamed = await tasks.update(task.id, { title: 'Third title' });
    api.calls = [];
    const outcome = await pushTodoTask(deps, renamed);
    expect(outcome.sent).toBe(true);
    expect(api.calls.map((call) => call.method)).toEqual(['patch', 'create']);
    expect(outcome.task.external.todoTaskId).toBe('AAMk2=');
  });

  it('moves a task whose list changed by deleting the old copy and creating a new one', async () => {
    const { api, tasks, state, deps } = setup();
    const task = tasks.add({ title: 'Prepare the proposal' });
    await pushTodoTask(deps, task);
    const moved = await tasks.update(task.id, { todoListId: 'list-work' });
    api.calls = [];

    const outcome = await pushTodoTask(deps, moved);

    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([
      ['delete', LIST],
      ['create', 'list-work'],
    ]);
    expect(outcome.task.external).toMatchObject({ todoListId: 'list-work', todoTaskId: 'AAMk2=' });
    expect(state.value.links[task.id]).toEqual({ listId: 'list-work', taskId: 'AAMk2=' });
    expect(state.value.hashes['AAMk1=']).toBeUndefined();
  });

  it('keeps a change without a list queued, untouched, and sends it once a list exists', async () => {
    const { api, tasks, state, deps, setDefaultList } = setup({ defaultList: null });
    const task = tasks.add({ title: 'No list chosen' });
    expect(await pushTodoTask(deps, task)).toEqual({ task, sent: false, listMissing: true });
    await enqueueTodoPushes(deps, [{ id: task.id, op: 'upsert' }]);
    const queued = state.value.pending[task.id];

    // No call, the entry stays exactly as it was (no attempt counted) and `pending` counts it.
    expect(await flushTodoPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(await flushTodoPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(api.calls).toEqual([]);
    expect(state.value.pending[task.id]).toEqual(queued);

    setDefaultList(LIST);
    expect(await flushTodoPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });
    expect(api.calls).toEqual([expect.objectContaining({ method: 'create', listId: LIST })]);
    expect((await tasks.get(task.id))?.external).toMatchObject({ todoListId: LIST, todoTaskId: 'AAMk1=' });
  });

  it('never creates a finished task that To Do never saw', async () => {
    const { api, tasks, deps } = setup();
    const task = tasks.add({ title: 'Finished before any sync' });
    const done = await tasks.update(task.id, { status: 'done' });
    expect(await pushTodoTask(deps, done)).toEqual({ task: done, sent: false });
    expect(api.calls).toEqual([]);
  });

  it('patches the copy this device knows of when the document lost its link, wherever the default list is', async () => {
    const { api, tasks, deps, setDefaultList } = setup();
    const pushed = (await pushTodoTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // An older build rewrote the document without its link, and the default list changed since.
    const stripped = { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } };
    tasks.tasks.set(pushed.id, stripped);
    setDefaultList('list-work');
    api.calls = [];

    const outcome = await pushTodoTask(deps, stripped);

    expect(outcome.sent).toBe(true);
    expect(api.calls.map((call) => [call.method, call.listId, call.taskId])).toEqual([['patch', LIST, 'AAMk1=']]);
    expect(outcome.task.external).toMatchObject({ todoListId: LIST, todoTaskId: 'AAMk1=' });

    // With no default list at all it is patched the same way, never left waiting for a list.
    const strippedAgain = { ...outcome.task, title: 'Third title', external: { ...EMPTY_TASK_EXTERNAL_REFS } };
    tasks.tasks.set(pushed.id, strippedAgain);
    setDefaultList(null);
    api.calls = [];
    expect((await pushTodoTask(deps, strippedAgain)).sent).toBe(true);
    expect(api.calls.map((call) => [call.method, call.listId, call.taskId])).toEqual([['patch', LIST, 'AAMk1=']]);
  });

  it('sends a completion of a task whose document lost its link to the copy this device knows of', async () => {
    const { api, tasks, deps } = setup();
    const pushed = (await pushTodoTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // Ticked here after an older build rewrote the document without its link.
    const done = await tasks.update(pushed.id, { status: 'done' });
    tasks.tasks.set(pushed.id, { ...done, external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    await enqueueTodoPushes(deps, [{ id: pushed.id, op: 'upsert' }]);
    api.calls = [];

    expect(await flushTodoPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });

    expect(api.calls.map((call) => [call.method, call.listId, call.taskId])).toEqual([['patch', LIST, 'AAMk1=']]);
    expect(api.calls[0]?.body).toMatchObject({ status: 'completed' });
    expect(api.tasks.get(LIST)?.get('AAMk1=')?.status).toBe('completed');
    expect((await tasks.get(pushed.id))?.external).toMatchObject({ todoListId: LIST, todoTaskId: 'AAMk1=' });
  });

  it('re-creates a gone copy of a document that lost its link in the default list, not in the list the copy was in', async () => {
    const { api, tasks, state, deps, setDefaultList } = setup();
    const pushed = (await pushTodoTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // An older build rewrote the document without its link. The list the copy was in is gone
    // since (deleted in To Do with the copy), and another list is the default now.
    tasks.tasks.set(pushed.id, { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    api.tasks.delete(LIST);
    const create = api.createTask.bind(api);
    jest.spyOn(api, 'createTask').mockImplementation(async (listId, body) => {
      if (listId === LIST) throw graphError(404, 'ErrorItemNotFound');
      return create(listId, body);
    });
    setDefaultList('list-work');
    await enqueueTodoPushes(deps, [{ id: pushed.id, op: 'upsert' }]);
    api.calls = [];

    expect(await flushTodoPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });

    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([
      ['patch', LIST],
      ['create', 'list-work'],
    ]);
    expect((await tasks.get(pushed.id))?.external).toMatchObject({ todoListId: 'list-work', todoTaskId: 'AAMk2=' });
    expect(state.value.links[pushed.id]).toEqual({ listId: 'list-work', taskId: 'AAMk2=' });
  });

  it('keeps a document that lost its link and its copy waiting when no default list exists', async () => {
    const { api, tasks, state, deps, setDefaultList } = setup();
    const pushed = (await pushTodoTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    tasks.tasks.set(pushed.id, { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    api.tasks.get(LIST)?.delete('AAMk1=');
    setDefaultList(null);
    await enqueueTodoPushes(deps, [{ id: pushed.id, op: 'upsert' }]);
    const queued = state.value.pending[pushed.id];
    api.calls = [];

    // The copy is gone and forgotten; with no list to re-create it in, the change waits.
    expect(await flushTodoPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([['patch', LIST]]);
    expect(state.value.links[pushed.id]).toBeUndefined();
    expect(state.value.pending[pushed.id]).toEqual(queued);

    setDefaultList('list-work');
    api.calls = [];
    expect(await flushTodoPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([['create', 'list-work']]);
  });

  it('deleteTodoCopy treats a missing copy as deleted', async () => {
    const { api, deps } = setup();
    await expect(deleteTodoCopy(deps, { listId: LIST, taskId: 'nope' })).resolves.toBeUndefined();
    expect(api.calls.map((call) => call.method)).toEqual(['delete']);
  });
});

describe('queue and flush', () => {
  it('pushes queued upserts oldest first and deletes copies of tasks that are gone', async () => {
    const { api, tasks, state, deps } = setup();
    const a = tasks.add({ title: 'A' });
    const b = tasks.add({ title: 'B' });
    await pushTodoTask(deps, b);
    const bLink = state.value.links[b.id];
    await tasks.remove(b.id);
    await enqueueTodoPushes(deps, [
      { id: a.id, op: 'upsert' },
      { id: b.id, op: 'delete', link: bLink },
    ]);
    api.calls = [];

    const result = await flushTodoPushes(deps);

    expect(result).toEqual({ pushed: 2, failed: 0, pending: 0, blockedBy: null });
    expect(api.calls.map((call) => call.method)).toEqual(['create', 'delete']);
    expect(state.value.pending).toEqual({});
    expect(state.value.links[b.id]).toBeUndefined();
  });

  it('keeps everything queued on a blocking error and retries retryable ones', async () => {
    const { api, tasks, state, deps } = setup();
    const a = tasks.add({ title: 'A' });
    await enqueueTodoPushes(deps, [{ id: a.id, op: 'upsert' }]);

    // A 403 is about this task (a read-only list), never the connection: it counts an attempt
    // and the flush goes on, so the pull still runs and reports a missing consent itself.
    api.failures.push({ method: 'create', error: graphError(403, 'ErrorAccessDenied') });
    const denied = await flushTodoPushes(deps);
    expect(denied).toMatchObject({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(state.value.pending[a.id]?.lastError).toBe('permission_denied');
    expect(state.value.pending[a.id]?.attempts).toBe(1);

    api.failures.push({ method: 'create', error: graphError(503) });
    const retried = await flushTodoPushes(deps);
    expect(retried).toMatchObject({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(state.value.pending[a.id]?.attempts).toBe(2);

    api.failures.push({ method: 'create', error: graphError(400, 'invalidRequest') });
    const dropped = await flushTodoPushes(deps);
    expect(dropped).toMatchObject({ failed: 1, pending: 0 });
  });

  it('sends the other changes while one waits for a list', async () => {
    const { api, tasks, state, deps } = setup({ defaultList: null });
    const waiting = tasks.add({ title: 'Waits for a list' });
    const own = tasks.add({ title: 'Has its own list', todoListId: 'list-work' });
    const linked = tasks.add({ title: 'Linked' });
    tasks.tasks.set(linked.id, { ...linked, title: 'Linked, renamed', external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: LIST, todoTaskId: 'X1' } });
    api.seed(LIST, { id: 'X1', title: 'Linked' });
    await enqueueTodoPushes(deps, [
      { id: waiting.id, op: 'upsert' },
      { id: own.id, op: 'upsert' },
      { id: linked.id, op: 'upsert' },
    ]);

    const result = await flushTodoPushes(deps);

    expect(result).toEqual({ pushed: 2, failed: 0, pending: 1, blockedBy: null });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([
      ['create', 'list-work'],
      ['patch', LIST],
    ]);
    expect(Object.keys(state.value.pending)).toEqual([waiting.id]);
  });

  it('reads the list new tasks go to once per flush, and again after a failed read', async () => {
    const { tasks, deps, setDefaultList } = setup({ defaultList: null });
    const read = jest.spyOn(deps, 'defaultList');
    const waiting = [tasks.add({ title: 'One' }), tasks.add({ title: 'Two' }), tasks.add({ title: 'Three' })];
    await enqueueTodoPushes(
      deps,
      waiting.map((task) => ({ id: task.id, op: 'upsert' as const })),
    );

    expect(await flushTodoPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 3, blockedBy: null });
    expect(read).toHaveBeenCalledTimes(1);

    read.mockClear();
    read.mockRejectedValueOnce(new AppError('upstream_error', 'Preferences unavailable', { retryable: true }));
    setDefaultList(LIST);
    // The first entry counts a retry; the next one reads the list again and the rest go out.
    expect(await flushTodoPushes(deps)).toEqual({ pushed: 2, failed: 0, pending: 1, blockedBy: null });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('queues every open unlinked task on enable, never imports or finished ones', async () => {
    const { tasks, state, deps } = setup();
    tasks.add({ title: 'Open one' });
    const done = tasks.add({ title: 'Finished' });
    await tasks.update(done.id, { status: 'done' });
    tasks.add({ title: 'Imported' }, { source: 'todo' });

    expect(await enqueueUnlinkedOpenTasks(deps)).toBe(1);
    expect(Object.keys(state.value.pending)).toHaveLength(1);
  });
});

describe('removeTodoLinks', () => {
  it('deletes imported tasks and unlinks the rest without touching To Do', async () => {
    const { api, tasks, deps } = setup();
    api.seed(LIST, { id: 'A1', title: 'From To Do' });
    await pullTodoChanges(deps);
    const own = tasks.add({ title: 'Mine' });
    await pushTodoTask(deps, own);
    const plain = tasks.add({ title: 'Never synced' });
    api.calls = [];

    const result = await removeTodoLinks(deps);

    expect(result).toEqual({ removed: 1, unlinked: 1 });
    expect(await tasks.get(todoTaskLocalId('A1'))).toBeNull();
    expect((await tasks.get(own.id))?.external).toMatchObject({ todoListId: null, todoTaskId: null, todoUpdatedAt: null });
    expect((await tasks.get(plain.id))?.external.todoListId).toBeNull();
    expect(api.calls).toEqual([]);
    expect(api.tasks.get(LIST)?.size).toBe(2);
  });
});
