import { AppError } from '../../../core/errors';
import { EMPTY_TASK_EXTERNAL_REFS } from '../../../core/types';
import { defaultGtasksSyncState, type GtasksSyncState } from '../gtasks/state';
import {
  deleteGtasksCopy,
  enqueueGtasksPushes,
  enqueueUnlinkedOpenTasksForGtasks,
  flushGtasksPushes,
  GTASKS_UPDATED_MIN_SKEW_MS,
  gtasksSyncedListIds,
  gtasksTaskLocalId,
  isGtasksPushable,
  pullGtasksChanges,
  pushGtasksTask,
  removeGtasksLinks,
  type GtasksSyncDeps,
} from '../gtasks/sync';
import { FakeClock, FakeTasks, memoryStateStore } from '../__testUtils__/fakes';
import { FakeGoogleTasksApi, googleTasksError } from '../__testUtils__/gtasksFakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');
const LIST = 'gl-default';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup(options: { defaultList?: string | null; state?: Partial<GtasksSyncState> } = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeGoogleTasksApi(clock);
  const tasks = new FakeTasks(clock);
  const state = memoryStateStore<GtasksSyncState>({ ...defaultGtasksSyncState(), enabled: true, ...options.state });
  let defaultList = options.defaultList === undefined ? LIST : options.defaultList;
  const deps: GtasksSyncDeps = {
    api,
    tasks,
    state,
    defaultList: async () => (defaultList === null ? null : { id: defaultList, name: 'My Tasks' }),
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
  it('derives a deterministic local id from the Google id (hash for odd ids)', () => {
    expect(gtasksTaskLocalId('MTIzNDU2Nzg5')).toBe('gt_MTIzNDU2Nzg5');
    const hashed = gtasksTaskLocalId('odd id/with=chars');
    expect(hashed).toMatch(/^gt_h[0-9a-f]{16}$/);
    expect(gtasksTaskLocalId('odd id/with=chars')).toBe(hashed);
    expect(() => gtasksTaskLocalId('')).toThrow();
  });

  it('syncs the default list plus every list a linked task lives in', () => {
    const { tasks } = setup();
    const linked = tasks.add({ title: 'Linked', gtasksListId: 'gl-work' });
    tasks.tasks.set(linked.id, { ...linked, external: { ...EMPTY_TASK_EXTERNAL_REFS, gtasksListId: 'gl-work', gtasksTaskId: 'w1' } });
    tasks.add({ title: 'Only chosen, not linked', gtasksListId: 'gl-home' });
    expect(gtasksSyncedListIds(LIST, tasks.all())).toEqual([LIST, 'gl-work']);
    expect(gtasksSyncedListIds(null, tasks.all())).toEqual(['gl-work']);
  });

  it('pushes open tasks and linked tasks, never finished tasks that Google never saw', () => {
    const { tasks } = setup();
    const open = tasks.add({ title: 'Open' });
    expect(isGtasksPushable(open)).toBe(true);
    expect(isGtasksPushable({ ...open, status: 'done' })).toBe(false);
    expect(isGtasksPushable({ ...open, status: 'done', external: { ...EMPTY_TASK_EXTERNAL_REFS, gtasksListId: LIST, gtasksTaskId: 'x' } })).toBe(true);
    expect(isGtasksPushable({ ...open, source: 'gtasks' })).toBe(false);
  });
});

describe('pullGtasksChanges', () => {
  it('imports open tasks from a full listing, skips finished history, and stores the watermark', async () => {
    const { api, tasks, state, deps } = setup();
    api.seed(LIST, { id: 'a1', title: 'From Google', due: '2026-10-05T00:00:00.000Z' });
    api.seed(LIST, { id: 'a2', title: 'Old and done', status: 'completed', hidden: true });

    const result = await pullGtasksChanges(deps);

    expect(result.fullSync).toBe(true);
    expect(result.counts).toMatchObject({ created: 1, unchanged: 1, removed: 0, updated: 0 });
    const imported = tasks.all();
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      id: gtasksTaskLocalId('a1'),
      title: 'From Google',
      source: 'gtasks',
      dueDate: '2026-10-05',
      external: { gtasksListId: LIST, gtasksTaskId: 'a1', todoListId: null },
    });
    expect(tasks.writes.every((write) => write.origin === 'tasks_gtasks')).toBe(true);
    expect(state.value.lists[LIST]?.updatedMin).toBe(new Date(NOW.getTime() - GTASKS_UPDATED_MIN_SKEW_MS).toISOString());
    expect(state.value.lists[LIST]?.lastFullSyncAt).toBe(NOW.toISOString());
    expect(state.value.hashes.a1).toBeDefined();
    expect(api.calls).toEqual([{ method: 'list', listId: LIST, params: { updatedMin: undefined, pageToken: undefined } }]);
  });

  it('applies incremental changes, completions and deletions with updatedMin', async () => {
    const { api, tasks, state, deps, clock } = setup();
    api.seed(LIST, { id: 'a1', title: 'From Google' });
    api.seed(LIST, { id: 'a2', title: 'Gone soon' });
    api.seed(LIST, { id: 'a3', title: 'Untouched' });
    await pullGtasksChanges(deps);
    const a1 = gtasksTaskLocalId('a1');
    const a2 = gtasksTaskLocalId('a2');
    api.calls = [];

    clock.advanceMinutes(10);
    api.seed(LIST, { id: 'a1', title: 'From Google', status: 'completed', completed: clock.now().toISOString() });
    api.markDeleted(LIST, 'a2');
    const result = await pullGtasksChanges(deps);

    expect(result.fullSync).toBe(false);
    // a3 falls inside the skew window (updated at the previous pull time): listed again, unchanged.
    expect(result.counts).toMatchObject({ updated: 1, removed: 1, created: 0, unchanged: 1 });
    expect((await tasks.get(a1))?.status).toBe('done');
    expect((await tasks.get(a1))?.external.gtasksUpdatedAt).toBe(clock.now().toISOString());
    expect(await tasks.get(a2)).toBeNull();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.params?.updatedMin).toBe(new Date(NOW.getTime() - GTASKS_UPDATED_MIN_SKEW_MS).toISOString());
    expect(state.value.hashes.a2).toBeUndefined();
    expect(state.value.lists[LIST]?.lastFullSyncAt).toBe(NOW.toISOString());
  });

  it('follows page tokens', async () => {
    const { api, tasks, deps } = setup();
    api.pageSize = 2;
    for (let i = 1; i <= 5; i += 1) api.seed(LIST, { id: `p${i}` });
    const result = await pullGtasksChanges(deps);
    expect(result.counts.created).toBe(5);
    expect(tasks.all()).toHaveLength(5);
    expect(api.calls.map((call) => call.params?.pageToken)).toEqual([undefined, '2', '4']);
  });

  it('leaves a task alone while a local change is queued for it (local wins)', async () => {
    const { api, tasks, deps, clock } = setup();
    api.seed(LIST, { id: 'a1', title: 'From Google' });
    await pullGtasksChanges(deps);
    const a1 = gtasksTaskLocalId('a1');
    await tasks.update(a1, { title: 'Edited here' });
    await enqueueGtasksPushes(deps, [{ id: a1, op: 'upsert' }]);

    clock.advanceMinutes(5);
    api.seed(LIST, { id: 'a1', title: 'Edited in Google' });
    const result = await pullGtasksChanges(deps);

    expect(result.counts.unchanged).toBe(1);
    expect((await tasks.get(a1))?.title).toBe('Edited here');
  });

  it('runs a full listing when the full-sync interval is due and deletes linked tasks the listing no longer has', async () => {
    const { api, tasks, state, deps, clock } = setup();
    api.seed(LIST, { id: 'a1', title: 'From Google' });
    await pullGtasksChanges(deps);
    const own = tasks.add({ title: 'Mine, pushed earlier' });
    tasks.tasks.set(own.id, { ...own, external: { ...EMPTY_TASK_EXTERNAL_REFS, gtasksListId: LIST, gtasksTaskId: 'b9' } });
    api.calls = [];

    clock.advanceMinutes(8 * 24 * 60);
    const result = await pullGtasksChanges(deps);

    expect(result.fullSync).toBe(true);
    expect(api.calls[0]?.params?.updatedMin).toBeUndefined();
    expect(await tasks.get(own.id)).toBeNull();
    expect(result.counts.removed).toBe(1);
    expect(state.value.lists[LIST]?.lastFullSyncAt).toBe(clock.now().toISOString());
  });

  it('pulls the lists of linked tasks too, with their own watermarks', async () => {
    const { api, tasks, state, deps } = setup();
    const work = tasks.add({ title: 'Work item', gtasksListId: 'gl-work' });
    tasks.tasks.set(work.id, { ...work, external: { ...EMPTY_TASK_EXTERNAL_REFS, gtasksListId: 'gl-work', gtasksTaskId: 'w1' } });
    api.seed('gl-work', { id: 'w1', title: 'Work item renamed', updated: '2026-10-01T09:00:00.000Z' });

    const result = await pullGtasksChanges(deps);

    expect(api.calls.map((call) => call.listId)).toEqual([LIST, 'gl-work']);
    expect(result.counts.updated).toBe(1);
    expect((await tasks.get(work.id))?.title).toBe('Work item renamed');
    expect(Object.keys(state.value.lists).sort()).toEqual([LIST, 'gl-work']);
  });

  it('links a document that lost its link to the copy this device knows of, never imports that copy', async () => {
    const { api, tasks, state, deps, clock } = setup();
    const pushed = (await pushGtasksTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // An older build rewrote the document without its link and renamed it (another device's
    // disable unlinks documents the same way).
    tasks.tasks.set(pushed.id, { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } });

    const full = await pullGtasksChanges(deps, { full: true });

    expect(full.counts).toMatchObject({ created: 0, removed: 0 });
    expect(tasks.all().map((task) => task.id)).toEqual([pushed.id]);
    // Linked again. The copy did not change in Google, so the edit in the document stays.
    expect(await tasks.get(pushed.id)).toMatchObject({ title: 'Prepare the final proposal', external: { gtasksListId: LIST, gtasksTaskId: 'g1' } });

    // Unlinked again, then renamed in Google: the same task gets the change and the link.
    const relinked = await tasks.get(pushed.id);
    tasks.tasks.set(pushed.id, { ...(relinked as NonNullable<typeof relinked>), external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    clock.advanceMinutes(10);
    api.seed(LIST, { id: 'g1', title: 'Renamed in Google' });

    const incremental = await pullGtasksChanges(deps);

    expect(incremental.counts).toMatchObject({ created: 0, updated: 1 });
    expect(tasks.all().map((task) => task.id)).toEqual([pushed.id]);
    expect(await tasks.get(pushed.id)).toMatchObject({ title: 'Renamed in Google', external: { gtasksListId: LIST, gtasksTaskId: 'g1' } });
    expect(state.value.links[pushed.id]).toEqual({ listId: LIST, taskId: 'g1' });
  });
});

describe('pushGtasksTask', () => {
  it('creates the copy in the default list, writes the link back with origin tasks_gtasks and stores the hash', async () => {
    const { api, tasks, state, deps } = setup();
    const task = tasks.add({ title: 'Prepare the proposal', dueDate: '2026-10-05', dueTime: '16:00', reminderMinutesBefore: 30 });

    const outcome = await pushGtasksTask(deps, task);

    expect(outcome.sent).toBe(true);
    expect(api.calls).toEqual([expect.objectContaining({ method: 'create', listId: LIST })]);
    expect(api.calls[0]?.body).toEqual({ title: 'Prepare the proposal', notes: '', status: 'needsAction', due: '2026-10-05T00:00:00.000Z', completed: null });
    const stored = await tasks.get(task.id);
    expect(stored?.external).toMatchObject({ gtasksListId: LIST, gtasksTaskId: 'g1' });
    expect(tasks.writes.at(-1)).toEqual({ id: task.id, origin: 'tasks_gtasks', kind: 'update' });
    expect(state.value.links[task.id]).toEqual({ listId: LIST, taskId: 'g1' });
    expect(state.value.hashes.g1).toBeDefined();

    // Unchanged: nothing is sent again.
    api.calls = [];
    const again = await pushGtasksTask(deps, stored as NonNullable<typeof stored>);
    expect(again.sent).toBe(false);
    expect(api.calls).toEqual([]);
  });

  it('patches a linked task and re-creates it when the copy is gone', async () => {
    const { api, tasks, deps } = setup();
    const task = tasks.add({ title: 'Prepare the proposal' });
    await pushGtasksTask(deps, task);
    const edited = await tasks.update(task.id, { title: 'Prepare the final proposal' });
    api.calls = [];

    await pushGtasksTask(deps, edited);
    expect(api.calls.map((call) => call.method)).toEqual(['patch']);

    api.failures.push({ method: 'patch', error: googleTasksError(404, 'notFound') });
    const renamed = await tasks.update(task.id, { title: 'Third title' });
    api.calls = [];
    const outcome = await pushGtasksTask(deps, renamed);
    expect(outcome.sent).toBe(true);
    expect(api.calls.map((call) => call.method)).toEqual(['patch', 'create']);
    expect(outcome.task.external.gtasksTaskId).toBe('g2');
  });

  it('moves a task whose list changed by deleting the old copy and creating a new one', async () => {
    const { api, tasks, state, deps } = setup();
    const task = tasks.add({ title: 'Prepare the proposal' });
    await pushGtasksTask(deps, task);
    const moved = await tasks.update(task.id, { gtasksListId: 'gl-work' });
    api.calls = [];

    const outcome = await pushGtasksTask(deps, moved);

    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([
      ['delete', LIST],
      ['create', 'gl-work'],
    ]);
    expect(outcome.task.external).toMatchObject({ gtasksListId: 'gl-work', gtasksTaskId: 'g2' });
    expect(state.value.links[task.id]).toEqual({ listId: 'gl-work', taskId: 'g2' });
    expect(state.value.hashes.g1).toBeUndefined();
  });

  it('keeps a change without a list queued, untouched, and sends it once a list exists', async () => {
    const { api, tasks, state, deps, setDefaultList } = setup({ defaultList: null });
    const task = tasks.add({ title: 'No list chosen' });
    expect(await pushGtasksTask(deps, task)).toEqual({ task, sent: false, listMissing: true });
    await enqueueGtasksPushes(deps, [{ id: task.id, op: 'upsert' }]);
    const queued = state.value.pending[task.id];

    // No call, the entry stays exactly as it was (no attempt counted) and `pending` counts it.
    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(api.calls).toEqual([]);
    expect(state.value.pending[task.id]).toEqual(queued);

    setDefaultList(LIST);
    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });
    expect(api.calls).toEqual([expect.objectContaining({ method: 'create', listId: LIST })]);
    expect((await tasks.get(task.id))?.external).toMatchObject({ gtasksListId: LIST, gtasksTaskId: 'g1' });
  });

  it('never creates a finished task that Google never saw', async () => {
    const { api, tasks, deps } = setup();
    const task = tasks.add({ title: 'Finished before any sync' });
    const done = await tasks.update(task.id, { status: 'done' });
    expect(await pushGtasksTask(deps, done)).toEqual({ task: done, sent: false });
    expect(api.calls).toEqual([]);
  });

  it('patches the copy this device knows of when the document lost its link, wherever the default list is', async () => {
    const { api, tasks, deps, setDefaultList } = setup();
    const pushed = (await pushGtasksTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // An older build rewrote the document without its link, and the default list changed since.
    const stripped = { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } };
    tasks.tasks.set(pushed.id, stripped);
    setDefaultList('gl-work');
    api.calls = [];

    const outcome = await pushGtasksTask(deps, stripped);

    expect(outcome.sent).toBe(true);
    expect(api.calls.map((call) => [call.method, call.listId, call.taskId])).toEqual([['patch', LIST, 'g1']]);
    expect(outcome.task.external).toMatchObject({ gtasksListId: LIST, gtasksTaskId: 'g1' });

    // With no default list at all it is patched the same way, never left waiting for a list.
    const strippedAgain = { ...outcome.task, title: 'Third title', external: { ...EMPTY_TASK_EXTERNAL_REFS } };
    tasks.tasks.set(pushed.id, strippedAgain);
    setDefaultList(null);
    api.calls = [];
    expect((await pushGtasksTask(deps, strippedAgain)).sent).toBe(true);
    expect(api.calls.map((call) => [call.method, call.listId, call.taskId])).toEqual([['patch', LIST, 'g1']]);
  });

  it('sends a completion of a task whose document lost its link to the copy this device knows of', async () => {
    const { api, tasks, deps } = setup();
    const pushed = (await pushGtasksTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // Ticked here after an older build rewrote the document without its link.
    const done = await tasks.update(pushed.id, { status: 'done' });
    tasks.tasks.set(pushed.id, { ...done, external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    await enqueueGtasksPushes(deps, [{ id: pushed.id, op: 'upsert' }]);
    api.calls = [];

    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });

    expect(api.calls.map((call) => [call.method, call.listId, call.taskId])).toEqual([['patch', LIST, 'g1']]);
    expect(api.calls[0]?.body).toMatchObject({ status: 'completed' });
    expect(api.tasks.get(LIST)?.get('g1')?.status).toBe('completed');
    expect((await tasks.get(pushed.id))?.external).toMatchObject({ gtasksListId: LIST, gtasksTaskId: 'g1' });
  });

  it('re-creates a gone copy of a document that lost its link in the default list, not in the list the copy was in', async () => {
    const { api, tasks, state, deps, setDefaultList } = setup();
    const pushed = (await pushGtasksTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    // An older build rewrote the document without its link. The list the copy was in is gone
    // since (deleted in Google with the copy), and another list is the default now.
    tasks.tasks.set(pushed.id, { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    api.tasks.delete(LIST);
    const create = api.createTask.bind(api);
    jest.spyOn(api, 'createTask').mockImplementation(async (listId, body) => {
      if (listId === LIST) throw googleTasksError(404, 'notFound');
      return create(listId, body);
    });
    setDefaultList('gl-work');
    await enqueueGtasksPushes(deps, [{ id: pushed.id, op: 'upsert' }]);
    api.calls = [];

    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });

    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([
      ['patch', LIST],
      ['create', 'gl-work'],
    ]);
    expect((await tasks.get(pushed.id))?.external).toMatchObject({ gtasksListId: 'gl-work', gtasksTaskId: 'g2' });
    expect(state.value.links[pushed.id]).toEqual({ listId: 'gl-work', taskId: 'g2' });
  });

  it('keeps a document that lost its link and its copy waiting when no default list exists', async () => {
    const { api, tasks, state, deps, setDefaultList } = setup();
    const pushed = (await pushGtasksTask(deps, tasks.add({ title: 'Prepare the proposal' }))).task;
    tasks.tasks.set(pushed.id, { ...pushed, title: 'Prepare the final proposal', external: { ...EMPTY_TASK_EXTERNAL_REFS } });
    api.tasks.get(LIST)?.delete('g1');
    setDefaultList(null);
    await enqueueGtasksPushes(deps, [{ id: pushed.id, op: 'upsert' }]);
    const queued = state.value.pending[pushed.id];
    api.calls = [];

    // The copy is gone and forgotten; with no list to re-create it in, the change waits.
    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([['patch', LIST]]);
    expect(state.value.links[pushed.id]).toBeUndefined();
    expect(state.value.pending[pushed.id]).toEqual(queued);

    setDefaultList('gl-work');
    api.calls = [];
    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 1, failed: 0, pending: 0, blockedBy: null });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([['create', 'gl-work']]);
  });

  it('deleteGtasksCopy treats a missing copy as deleted', async () => {
    const { api, deps } = setup();
    await expect(deleteGtasksCopy(deps, { listId: LIST, taskId: 'nope' })).resolves.toBeUndefined();
    expect(api.calls.map((call) => call.method)).toEqual(['delete']);
  });
});

describe('queue and flush', () => {
  it('pushes queued upserts oldest first and deletes copies of tasks that are gone', async () => {
    const { api, tasks, state, deps } = setup();
    const a = tasks.add({ title: 'A' });
    const b = tasks.add({ title: 'B' });
    await pushGtasksTask(deps, b);
    const bLink = state.value.links[b.id];
    await tasks.remove(b.id);
    await enqueueGtasksPushes(deps, [
      { id: a.id, op: 'upsert' },
      { id: b.id, op: 'delete', link: bLink },
    ]);
    api.calls = [];

    const result = await flushGtasksPushes(deps);

    expect(result).toEqual({ pushed: 2, failed: 0, pending: 0, blockedBy: null });
    expect(api.calls.map((call) => call.method)).toEqual(['create', 'delete']);
    expect(state.value.pending).toEqual({});
    expect(state.value.links[b.id]).toBeUndefined();
  });

  it('keeps everything queued on a blocking error and retries retryable ones', async () => {
    const { api, tasks, state, deps } = setup();
    const a = tasks.add({ title: 'A' });
    await enqueueGtasksPushes(deps, [{ id: a.id, op: 'upsert' }]);

    // A missing tasks scope is about the connection: everything stays queued.
    api.failures.push({ method: 'create', error: googleTasksError(403, 'insufficientPermissions') });
    const blocked = await flushGtasksPushes(deps);
    expect(blocked).toMatchObject({ pushed: 0, failed: 0, pending: 1, blockedBy: 'tasks_scope_missing' });

    // A plain 403 is about this task: it counts an attempt and the flush goes on.
    api.failures.push({ method: 'create', error: googleTasksError(403, 'forbidden') });
    const denied = await flushGtasksPushes(deps);
    expect(denied).toMatchObject({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(state.value.pending[a.id]?.attempts).toBe(1);

    api.failures.push({ method: 'create', error: googleTasksError(503) });
    const retried = await flushGtasksPushes(deps);
    expect(retried).toMatchObject({ pushed: 0, failed: 0, pending: 1, blockedBy: null });
    expect(state.value.pending[a.id]?.attempts).toBe(2);

    api.failures.push({ method: 'create', error: googleTasksError(400, 'invalid') });
    const dropped = await flushGtasksPushes(deps);
    expect(dropped).toMatchObject({ failed: 1, pending: 0 });
  });

  it('sends the other changes while one waits for a list', async () => {
    const { api, tasks, state, deps } = setup({ defaultList: null });
    const waiting = tasks.add({ title: 'Waits for a list' });
    const own = tasks.add({ title: 'Has its own list', gtasksListId: 'gl-work' });
    const linked = tasks.add({ title: 'Linked' });
    tasks.tasks.set(linked.id, { ...linked, title: 'Linked, renamed', external: { ...EMPTY_TASK_EXTERNAL_REFS, gtasksListId: LIST, gtasksTaskId: 'x1' } });
    api.seed(LIST, { id: 'x1', title: 'Linked' });
    await enqueueGtasksPushes(deps, [
      { id: waiting.id, op: 'upsert' },
      { id: own.id, op: 'upsert' },
      { id: linked.id, op: 'upsert' },
    ]);

    const result = await flushGtasksPushes(deps);

    expect(result).toEqual({ pushed: 2, failed: 0, pending: 1, blockedBy: null });
    expect(api.calls.map((call) => [call.method, call.listId])).toEqual([
      ['create', 'gl-work'],
      ['patch', LIST],
    ]);
    expect(Object.keys(state.value.pending)).toEqual([waiting.id]);
  });

  it('reads the list new tasks go to once per flush, and again after a failed read', async () => {
    const { tasks, deps, setDefaultList } = setup({ defaultList: null });
    const read = jest.spyOn(deps, 'defaultList');
    const waiting = [tasks.add({ title: 'One' }), tasks.add({ title: 'Two' }), tasks.add({ title: 'Three' })];
    await enqueueGtasksPushes(
      deps,
      waiting.map((task) => ({ id: task.id, op: 'upsert' as const })),
    );

    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 0, failed: 0, pending: 3, blockedBy: null });
    expect(read).toHaveBeenCalledTimes(1);

    read.mockClear();
    read.mockRejectedValueOnce(new AppError('upstream_error', 'Preferences unavailable', { retryable: true }));
    setDefaultList(LIST);
    // The first entry counts a retry; the next one reads the list again and the rest go out.
    expect(await flushGtasksPushes(deps)).toEqual({ pushed: 2, failed: 0, pending: 1, blockedBy: null });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('queues every open unlinked task on enable, never imports or finished ones', async () => {
    const { tasks, state, deps } = setup();
    tasks.add({ title: 'Open one' });
    const done = tasks.add({ title: 'Finished' });
    await tasks.update(done.id, { status: 'done' });
    tasks.add({ title: 'Imported' }, { source: 'gtasks' });

    expect(await enqueueUnlinkedOpenTasksForGtasks(deps)).toBe(1);
    expect(Object.keys(state.value.pending)).toHaveLength(1);
  });
});

describe('removeGtasksLinks', () => {
  it('deletes imported tasks and unlinks the rest without touching Google, keeping To Do links', async () => {
    const { api, tasks, deps } = setup();
    api.seed(LIST, { id: 'a1', title: 'From Google' });
    await pullGtasksChanges(deps);
    const own = tasks.add({ title: 'Mine', todoListId: 'list-tasks' });
    await pushGtasksTask(deps, own);
    const plain = tasks.add({ title: 'Never synced' });
    api.calls = [];

    const result = await removeGtasksLinks(deps);

    expect(result).toEqual({ removed: 1, unlinked: 1 });
    expect(await tasks.get(gtasksTaskLocalId('a1'))).toBeNull();
    expect((await tasks.get(own.id))?.external).toEqual({ ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-tasks' });
    expect((await tasks.get(plain.id))?.external.gtasksListId).toBeNull();
    expect(api.calls).toEqual([]);
    expect(api.tasks.get(LIST)?.size).toBe(2);
  });
});
