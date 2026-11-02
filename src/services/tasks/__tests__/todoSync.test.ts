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
  const defaultList = options.defaultList === undefined ? LIST : options.defaultList;
  const deps: TodoSyncDeps = {
    api,
    tasks,
    state,
    defaultList: async () => (defaultList === null ? null : { id: defaultList, name: 'Tasks' }),
    now: clock.now,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
  };
  return { clock, api, tasks, state, deps };
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

  it('sends nothing without a list and never creates a finished unsynced task', async () => {
    const { api, tasks, deps } = setup({ defaultList: null });
    const task = tasks.add({ title: 'No list chosen' });
    expect((await pushTodoTask(deps, task)).sent).toBe(false);
    const done = await tasks.update(task.id, { status: 'done' });
    const withList = setup();
    expect((await pushTodoTask(withList.deps, done)).sent).toBe(false);
    expect(api.calls).toEqual([]);
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
