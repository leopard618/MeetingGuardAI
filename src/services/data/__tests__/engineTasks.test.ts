/**
 * Task writes through the data engine: write options (origin, caller-chosen id, source) and the
 * `tasks:changed` event the Microsoft To Do sync engine listens to (M7), and task documents an
 * older build rewrote without `source` / `external` (build 1.5.0).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEventBus, type AppEventMap, type TasksChangedEvent } from '../../../core/events';
import { firestorePaths } from '../../../core/identifiers';
import { EMPTY_TASK_EXTERNAL_REFS, type Task, type TaskExternalRefs } from '../../../core/types';
import { cacheKeys, type KeyValueStorage } from '../cache';
import { DataEngine } from '../engine';
import type { NetworkMonitor } from '../platform';
import type { RemoteCollectionSnapshot } from '../remote';
import { FakeProviderError, FakeRemote, settle } from '../testing/fakeRemote';

const UID = 'user1';
const T0 = '2026-10-01T10:00:00.000Z';
/** When the older build saved its edit (after every write of this device). */
const T1 = '2026-10-01T10:05:00.000Z';

interface Harness {
  engine: DataEngine;
  remote: FakeRemote;
  taskEvents: TasksChangedEvent[];
}

let opened: Harness[] = [];

/** One phone. Another phone of the same account shares the server (`remote`) and has its own storage. */
function harness(options: { remote?: FakeRemote; storage?: KeyValueStorage } = {}): Harness {
  const remote = options.remote ?? new FakeRemote();
  const events = createEventBus<AppEventMap>();
  const taskEvents: TasksChangedEvent[] = [];
  events.on('tasks:changed', (event) => {
    taskEvents.push(event);
  });
  const network: NetworkMonitor = { fetch: async () => true, subscribe: () => () => undefined };
  const engine = new DataEngine({
    remote,
    storage: options.storage ?? AsyncStorage,
    events,
    network,
    now: () => new Date(T0),
    getLanguage: () => 'en',
    getTimeZone: () => 'Europe/Madrid',
    timeouts: {
      flushDelayMs: 0,
      commitMs: 2_000,
      fetchMs: 2_000,
      headlessMs: 2_000,
      preferencesFallbackMs: 60_000,
      migrationPreferencesWaitMs: 100,
      retryBaseMs: 60_000,
    },
  });
  const h: Harness = { engine, remote, taskEvents };
  opened.push(h);
  return h;
}

/** The storage of a second phone (AsyncStorage is the first phone's). */
function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
    removeItem: async (key) => {
      items.delete(key);
    },
    getAllKeys: async () => [...items.keys()],
    multiGet: async (keys) => keys.map((key) => [key, items.get(key) ?? null] as const),
    multiSet: async (pairs) => {
      for (const [key, value] of pairs) items.set(key, value);
    },
    multiRemove: async (keys) => {
      for (const key of keys) items.delete(key);
    },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const h of opened) await h.engine.endSession({ wipeLocal: false });
  opened = [];
  await settle();
  jest.restoreAllMocks();
});

describe('task writes', () => {
  it('creates a manual task by default and announces it with origin user', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();

    const task = await h.engine.createTask({ title: 'Prepare the proposal' });

    expect(task).toMatchObject({ source: 'manual', external: { todoListId: null, todoTaskId: null, todoUpdatedAt: null } });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'created', origin: 'user' });
    await settle();
    expect(h.remote.docs.get(firestorePaths.task(UID, task.id))).toMatchObject({ source: 'manual', external: { todoListId: null } });
  });

  it('marks assistant creates as ai_chat and keeps the chosen To Do list', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();

    const task = await h.engine.createTask({ title: 'Call Ana', todoListId: 'list-work' }, { origin: 'ai' });

    expect(task.source).toBe('ai_chat');
    expect(task.external.todoListId).toBe('list-work');
    expect(h.taskEvents.at(-1)).toMatchObject({ reason: 'created', origin: 'ai' });
  });

  it('imports with a caller-chosen id idempotently and never re-announces an existing task', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();

    const first = await h.engine.createTask({ title: 'From To Do' }, { id: 'td_abc', origin: 'tasks_todo', source: 'todo' });
    const again = await h.engine.createTask({ title: 'Changed title' }, { id: 'td_abc', origin: 'tasks_todo', source: 'todo' });

    expect(first).toMatchObject({ id: 'td_abc', source: 'todo' });
    expect(again).toEqual(first);
    expect(h.taskEvents.filter((e) => e.reason === 'created')).toHaveLength(1);
    expect(h.taskEvents.at(-1)).toMatchObject({ origin: 'tasks_todo' });
    await expect(h.engine.createTask({ title: 'x' }, { id: 'bad id!' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('writes back the To Do link through a patch and announces updates with their origin', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await h.engine.createTask({ title: 'Prepare the proposal' });

    const linked = await h.engine.updateTask(
      task.id,
      { external: { todoListId: 'list-work', todoTaskId: 'AAMk1', todoUpdatedAt: '2026-10-01T10:05:00.000Z' } },
      { origin: 'tasks_todo' },
    );

    expect(linked.external).toEqual({ ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-work', todoTaskId: 'AAMk1', todoUpdatedAt: '2026-10-01T10:05:00.000Z' });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'updated', origin: 'tasks_todo' });

    // A no-op patch announces nothing.
    const before = h.taskEvents.length;
    await h.engine.updateTask(task.id, { title: 'Prepare the proposal' });
    expect(h.taskEvents.length).toBe(before);
  });

  it('announces deletions together with the To Do link the task had', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await h.engine.createTask({ title: 'Prepare the proposal' });
    await h.engine.updateTask(task.id, { external: { todoListId: 'list-work', todoTaskId: 'AAMk1' } }, { origin: 'tasks_todo' });

    await h.engine.removeTask(task.id);

    expect(h.taskEvents.at(-1)).toEqual({
      uid: UID,
      changedIds: [task.id],
      reason: 'deleted',
      origin: 'user',
      removed: [{ id: task.id, external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: 'list-work', todoTaskId: 'AAMk1' } }],
    });
    expect(await h.engine.getTask(task.id)).toBeNull();
  });

  it('announces changes that arrive from another device as remote', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();

    h.remote.serverSet(firestorePaths.task(UID, 'fromTablet'), {
      userId: UID,
      title: 'Tablet task',
      timezone: 'Europe/Madrid',
      status: 'open',
      createdAt: T0,
      updatedAt: T0,
    });
    await settle();

    expect(await h.engine.getTask('fromTablet')).toMatchObject({ title: 'Tablet task', source: 'manual', external: { todoTaskId: null } });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: ['fromTablet'], reason: 'remote' });
  });

  it('reports documents the website flagged pushPending so the task sync engines push them (section 32)', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();

    h.remote.serverSet(firestorePaths.task(UID, 'fromWeb'), {
      userId: UID,
      title: 'Planned on the website',
      timezone: 'Europe/Madrid',
      status: 'open',
      createdAt: T0,
      updatedAt: T0,
      pushPending: true,
    });
    await settle();

    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: ['fromWeb'], reason: 'remote', pushRequested: ['fromWeb'] });
    // The flag never enters the model, so the next app write of the document leaves it out.
    const stored = (await h.engine.getTask('fromWeb')) as unknown as Record<string, unknown>;
    expect(stored.title).toBe('Planned on the website');
    expect('pushPending' in stored).toBe(false);
  });

  it('announces a document deleted on the server with the provider links its copy had (section 32)', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await h.engine.createTask({ title: 'Prepare the proposal' });
    await h.engine.updateTask(task.id, { external: { gtasksListId: 'gl-default', gtasksTaskId: 'g1' } }, { origin: 'tasks_gtasks' });
    await settle();

    h.remote.serverDelete(firestorePaths.task(UID, task.id));
    await settle();

    expect(await h.engine.getTask(task.id)).toBeNull();
    expect(h.taskEvents.at(-1)).toEqual({
      uid: UID,
      changedIds: [task.id],
      reason: 'remote',
      removed: [{ id: task.id, external: { ...EMPTY_TASK_EXTERNAL_REFS, gtasksListId: 'gl-default', gtasksTaskId: 'g1' } }],
    });
  });
});

const LINKS: TaskExternalRefs = {
  todoListId: 'list-work',
  todoTaskId: 'AAMk1',
  todoUpdatedAt: '2026-10-01T10:00:30.000Z',
  gtasksListId: 'gl-default',
  gtasksTaskId: 'g1',
  gtasksUpdatedAt: '2026-10-01T10:00:30.000Z',
};

/** An assistant task linked to To Do and Google Tasks, with every write of it on the server. */
async function linkedTask(h: Harness, title = 'Prepare the proposal'): Promise<Task> {
  const created = await h.engine.createTask({ title }, { origin: 'ai' });
  const linked = await h.engine.updateTask(created.id, { external: LINKS }, { origin: 'tasks_gtasks' });
  await h.engine.flushOutbox();
  await settle();
  expect(await h.engine.getPendingWriteCount()).toBe(0);
  return linked;
}

function serverDoc(h: Harness, path: string): Record<string, unknown> {
  const doc = h.remote.docs.get(path);
  if (!doc) throw new Error(`no server document at ${path}`);
  return doc;
}

/** The document as build 1.5.0 saves it: the whole task, without `source` and `external`. */
function asOlderBuild(doc: Record<string, unknown>, patch: Record<string, unknown> = {}): Record<string, unknown> {
  const { source: _source, external: _external, ...rest } = doc;
  return { ...rest, ...patch };
}

/** The task as its current-shape document (taskToDoc). */
function docOf(task: Task): Record<string, unknown> {
  const { id: _id, ...doc } = task;
  return doc;
}

async function readJson(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

/** Lets a test hand the engine a tasks snapshot of its own (e.g. fromCache with changes). */
function captureTasksListener(remote: FakeRemote): () => (snapshot: RemoteCollectionSnapshot) => void {
  let captured: ((snapshot: RemoteCollectionSnapshot) => void) | undefined;
  const listen = remote.listenCollection.bind(remote);
  remote.listenCollection = (path, onNext, onError) => {
    if (path === firestorePaths.tasks(UID)) captured = onNext;
    return listen(path, onNext, onError);
  };
  return () => {
    if (!captured) throw new Error('the tasks listener is not attached');
    return captured;
  };
}

describe('task documents rewritten by an older build (1.5.0 drops source and external)', () => {
  it('keeps the links and the origin, takes the change, asks for its push and repairs the server copy', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    const commitsBefore = h.remote.commits.length;
    // The first send of the repair fails (offline), so its outbox entry can be checked.
    h.remote.commitFailures.push(new FakeProviderError('unavailable'));

    // The iPhone on build 1.5.0 renames and ticks the task.
    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path), { title: 'Proposal sent', status: 'done', completedAt: T1, updatedAt: T1 }));
    await settle();

    const kept = (await h.engine.getTask(task.id)) as Task;
    expect(kept).toMatchObject({ title: 'Proposal sent', status: 'done', completedAt: T1, updatedAt: T1, source: 'ai_chat', external: LINKS });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'remote', pushRequested: [task.id] });
    // The restored document, with the push request kept for a phone that syncs if this one does not.
    const repaired = { ...docOf(kept), pushPending: true };
    const outbox = (await readJson(cacheKeys.outbox(UID))) as { entries: Record<string, unknown>[] };
    expect(outbox.entries).toEqual([
      expect.objectContaining({ kind: 'task', docId: task.id, mode: 'set', origin: 'system', updatedAt: T1, data: repaired }),
    ]);
    const eventsBefore = h.taskEvents.length;

    await h.engine.flushOutbox();
    await settle();

    expect(h.remote.commits.slice(commitsBefore)).toEqual([{ path, decision: { type: 'write', data: repaired } }]);
    expect(h.remote.docs.get(path)).toEqual(repaired);
    // The echo of the repair carries both keys: nothing is repaired again or announced.
    expect(h.taskEvents.length).toBe(eventsBefore);
    expect(await h.engine.getTask(task.id)).toEqual(kept);
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('repairs the server copy without announcing anything when the older build changed nothing else', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    const commitsBefore = h.remote.commits.length;
    const eventsBefore = h.taskEvents.length;

    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path)));
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(h.taskEvents.length).toBe(eventsBefore);
    expect(await h.engine.getTask(task.id)).toEqual(task);
    expect(h.remote.commits.slice(commitsBefore)).toEqual([{ path, decision: { type: 'write', data: docOf(task) } }]);
    expect(h.remote.docs.get(path)).toEqual(docOf(task));
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('tells an unlink (external with nulls) from an older build: the unlinked task loses its links, unrepaired', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const stripped = await linkedTask(h, 'Ticked on the iPhone');
    const unlinked = await linkedTask(h, 'Unlinked on another phone');
    const strippedPath = firestorePaths.task(UID, stripped.id);
    const unlinkedPath = firestorePaths.task(UID, unlinked.id);
    const commitsBefore = h.remote.commits.length;

    // One snapshot: build 1.5.0 ticked one task, a current build unlinked the other.
    h.remote.docs.set(strippedPath, asOlderBuild(serverDoc(h, strippedPath), { status: 'done', completedAt: T1, updatedAt: T1 }));
    h.remote.docs.set(unlinkedPath, { ...serverDoc(h, unlinkedPath), external: { ...EMPTY_TASK_EXTERNAL_REFS }, updatedAt: T1 });
    h.remote.notifyListeners();
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(await h.engine.getTask(unlinked.id)).toMatchObject({ source: 'ai_chat', external: EMPTY_TASK_EXTERNAL_REFS, updatedAt: T1 });
    expect(await h.engine.getTask(stripped.id)).toMatchObject({ status: 'done', source: 'ai_chat', external: LINKS });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [stripped.id, unlinked.id], reason: 'remote', pushRequested: [stripped.id] });
    expect(h.remote.commits.slice(commitsBefore).map((commit) => commit.path)).toEqual([strippedPath]);
    expect(h.remote.docs.get(unlinkedPath)).toMatchObject({ external: EMPTY_TASK_EXTERNAL_REFS });
  });

  it('adopts a document without the keys that this device has no copy of as before: no push, no repair', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    const commitsBefore = h.remote.commits.length;

    // One snapshot: build 1.5.0 ticked the linked task and created another one.
    h.remote.docs.set(path, asOlderBuild(serverDoc(h, path), { status: 'done', completedAt: T1, updatedAt: T1 }));
    h.remote.docs.set(firestorePaths.task(UID, 'fromIphone'), {
      userId: UID,
      title: 'Created on the iPhone',
      description: '',
      dueDate: null,
      dueTime: null,
      timezone: 'Europe/Madrid',
      reminderMinutesBefore: null,
      status: 'open',
      meetingId: null,
      people: [],
      completedAt: null,
      createdAt: T1,
      updatedAt: T1,
    });
    h.remote.notifyListeners();
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(await h.engine.getTask('fromIphone')).toMatchObject({ title: 'Created on the iPhone', source: 'manual', external: EMPTY_TASK_EXTERNAL_REFS });
    expect(await h.engine.getTask(task.id)).toMatchObject({ status: 'done', source: 'ai_chat', external: LINKS });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id, 'fromIphone'], reason: 'remote', pushRequested: [task.id] });
    expect(h.remote.commits.slice(commitsBefore).map((commit) => commit.path)).toEqual([path]);
    expect(h.remote.docs.get(firestorePaths.task(UID, 'fromIphone'))).not.toHaveProperty('external');
  });

  it('keeps the links from a fromCache snapshot too, but repairs only from server snapshots', async () => {
    const h = harness();
    const tasksListener = captureTasksListener(h.remote);
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    const commitsBefore = h.remote.commits.length;

    tasksListener()({
      fromCache: true,
      ids: [task.id],
      changes: [{ type: 'modified', id: task.id, data: asOlderBuild(serverDoc(h, path), { title: 'Renamed on the iPhone', updatedAt: T1 }) }],
    });
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(await h.engine.getTask(task.id)).toMatchObject({ title: 'Renamed on the iPhone', source: 'ai_chat', external: LINKS });
    expect(h.remote.commits.slice(commitsBefore)).toEqual([]);
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('keeps the links when a queued edit loses on send to a newer version the listener already brought', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    h.remote.online = false;
    await h.engine.updateTask(task.id, { description: 'Edited offline' });
    await settle();
    h.remote.online = true;

    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path), { status: 'done', completedAt: T1, updatedAt: T1 }));
    await settle();
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'remote', pushRequested: [task.id] });
    // The queued edit is older than the server copy: skipped, then the repair goes out.
    await h.engine.flushOutbox();
    await settle();

    const kept = (await h.engine.getTask(task.id)) as Task;
    expect(kept).toMatchObject({ status: 'done', description: '', updatedAt: T1, source: 'ai_chat', external: LINKS });
    expect(h.remote.docs.get(path)).toEqual({ ...docOf(kept), pushPending: true });
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('leaves a newer version to the listener when a queued edit loses on send before the snapshot arrives', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    h.remote.online = false;
    await h.engine.updateTask(task.id, { description: 'Edited offline' });
    await settle();
    // Build 1.5.0 saved its edit while this device was offline; no snapshot has brought it yet.
    h.remote.docs.set(path, asOlderBuild(serverDoc(h, path), { status: 'done', completedAt: T1, updatedAt: T1 }));
    h.remote.online = true;

    await h.engine.flushOutbox();
    await settle();
    await h.engine.flushOutbox();
    await settle();

    const kept = (await h.engine.getTask(task.id)) as Task;
    expect(kept).toMatchObject({ status: 'done', description: '', updatedAt: T1, source: 'ai_chat', external: LINKS });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'remote', pushRequested: [task.id] });
    expect(h.remote.docs.get(path)).toEqual({ ...docOf(kept), pushPending: true });
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('never re-creates a task deleted on the server while its repair waits in the outbox', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    h.remote.commitFailures.push(new FakeProviderError('unavailable'));
    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path)));
    await settle();
    expect(await h.engine.getPendingWriteCount()).toBe(1);

    h.remote.serverDelete(path);
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(h.remote.docs.has(path)).toBe(false);
    expect(await h.engine.getTask(task.id)).toBeNull();
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'remote', removed: [{ id: task.id, external: LINKS }] });
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('keeps the links when the repair is rejected and the server copy is read back, without retrying it', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    const commitsBefore = h.remote.commits.length;
    h.remote.commitFailures.push(new FakeProviderError('permission-denied'));

    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path)));
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(await h.engine.getTask(task.id)).toEqual(task);
    expect(h.remote.commits.slice(commitsBefore)).toEqual([]);
    expect(h.remote.docs.get(path)).not.toHaveProperty('external');
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('never deletes the task when its repair meets a server copy this build cannot read', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    h.remote.commitFailures.push(new FakeProviderError('unavailable'));
    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path)));
    await settle();
    expect(await h.engine.getPendingWriteCount()).toBe(1);
    // Before the repair goes out, another client saves a version the rules accept but this build
    // cannot read (the rules do not check the people entries, the client schema rejects the email).
    const unreadable = { ...serverDoc(h, path), people: [{ name: 'Ana', email: 'not an email' }], updatedAt: T1 };
    h.remote.serverSet(path, unreadable);
    await settle();
    const commitsBefore = h.remote.commits.length;
    const eventsBefore = h.taskEvents.length;

    await h.engine.flushOutbox();
    await settle();

    // No legacy replacement (delete, then create) and no create: that copy stays as it is.
    expect(h.remote.commits.slice(commitsBefore)).toEqual([{ path, decision: { type: 'skip', reason: 'stale' } }]);
    expect(h.remote.docs.get(path)).toEqual(unreadable);
    expect(await h.engine.getTask(task.id)).toEqual(task);
    expect(h.taskEvents.length).toBe(eventsBefore);
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('leaves the newer version a repair loses to to the listener, so its push request still arrives', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    h.remote.commitFailures.push(new FakeProviderError('unavailable'));
    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path)));
    await settle();
    expect(await h.engine.getPendingWriteCount()).toBe(1);
    // Before the repair goes out, the website saves a newer version and flags it; no snapshot has
    // brought it yet when the repair is sent.
    h.remote.docs.set(path, { ...docOf(task), title: 'Renamed on the website', updatedAt: T1, pushPending: true });

    await h.engine.flushOutbox();
    await settle();

    expect(await h.engine.getTask(task.id)).toMatchObject({ title: 'Renamed on the website', updatedAt: T1, source: 'ai_chat', external: LINKS });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'remote', pushRequested: [task.id] });
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('asks for no push when an older build changes a task that has no copy in To Do or Google Tasks', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    // Never linked: a push would create a copy in each provider, on every phone that syncs.
    const task = await h.engine.createTask({ title: 'Call Ana' }, { origin: 'ai' });
    await h.engine.flushOutbox();
    await settle();
    const path = firestorePaths.task(UID, task.id);

    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path), { title: 'Call Ana today', updatedAt: T1 }));
    await settle();
    await h.engine.flushOutbox();
    await settle();

    const kept = (await h.engine.getTask(task.id)) as Task;
    expect(kept).toMatchObject({ title: 'Call Ana today', updatedAt: T1, source: 'ai_chat', external: EMPTY_TASK_EXTERNAL_REFS });
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'remote' });
    // The origin is still written back, without a push request.
    expect(h.remote.docs.get(path)).toEqual(docOf(kept));
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('repairs with the push request, so the phone that syncs still pushes a change it never saw without the keys', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const ticked = await linkedTask(h, 'Ticked on the iPhone');
    const planned = await linkedTask(h, 'Planned on the website');
    const tickedPath = firestorePaths.task(UID, ticked.id);
    const plannedPath = firestorePaths.task(UID, planned.id);
    // The phone with the task sync on has both tasks in its cache, and is closed.
    const syncing = harness({ remote: h.remote, storage: memoryStorage() });
    await syncing.engine.startSession(UID);
    await settle();
    expect(await syncing.engine.getTask(ticked.id)).toEqual(ticked);
    await syncing.engine.endSession({ wipeLocal: false });

    // One snapshot on the open phone: build 1.5.0 ticked one task, and the website rescheduled the
    // other one in a copy 1.5.0 had left without the keys, and flagged it.
    h.remote.docs.set(tickedPath, asOlderBuild(serverDoc(h, tickedPath), { status: 'done', completedAt: T1, updatedAt: T1 }));
    h.remote.docs.set(plannedPath, asOlderBuild(serverDoc(h, plannedPath), { dueDate: '2026-10-02', updatedAt: T1, pushPending: true }));
    h.remote.notifyListeners();
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [ticked.id, planned.id], reason: 'remote', pushRequested: [ticked.id, planned.id] });
    // Both repairs keep the push request: the open phone may not sync the tasks itself.
    expect(h.remote.docs.get(tickedPath)).toEqual({ ...docOf((await h.engine.getTask(ticked.id)) as Task), pushPending: true });
    expect(h.remote.docs.get(plannedPath)).toEqual({ ...docOf((await h.engine.getTask(planned.id)) as Task), pushPending: true });

    // The syncing phone opens on the repaired copies, keys included, and pushes both changes.
    await syncing.engine.startSession(UID);
    await settle();
    expect(await syncing.engine.getTask(ticked.id)).toMatchObject({ status: 'done', source: 'ai_chat', external: LINKS });
    expect(syncing.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [ticked.id, planned.id], reason: 'remote', pushRequested: [ticked.id, planned.id] });
  });

  it('adopts the older copy without the keys that an import create finds, with its links, and pushes and repairs it', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const id = 'gt_g1';
    const path = firestorePaths.task(UID, id);
    // The Google Tasks pull of a fresh install imports a task (deterministic id) before the tasks
    // listener has brought the server copy: the create waits in the outbox.
    h.remote.online = false;
    await h.engine.createTask({ title: 'Send the invoice', gtasksListId: 'gl-default' }, { id, origin: 'tasks_gtasks', source: 'gtasks' });
    const imported = await h.engine.updateTask(id, { external: { gtasksTaskId: 'g1', gtasksUpdatedAt: T0 } }, { origin: 'tasks_gtasks' });
    await settle();
    // The server copy: build 1.5.0 ticked the task in September, and that never reached Google.
    const tickedAt = '2026-09-30T09:00:00.000Z';
    h.remote.docs.set(path, {
      userId: UID,
      title: 'Send the invoice',
      description: '',
      dueDate: null,
      dueTime: null,
      timezone: 'Europe/Madrid',
      reminderMinutesBefore: null,
      status: 'done',
      meetingId: null,
      people: [],
      completedAt: tickedAt,
      createdAt: '2026-09-20T09:00:00.000Z',
      updatedAt: tickedAt,
    });
    h.remote.online = true;
    // The listener brings it first and turns it down: it is older than the import.
    h.remote.notifyListeners();
    await settle();
    expect(await h.engine.getTask(id)).toEqual(imported);
    const eventsBefore = h.taskEvents.length;

    await h.engine.flushOutbox();
    await settle();

    // The create finds the document, so the server version is kept, with this device's links.
    const kept = (await h.engine.getTask(id)) as Task;
    expect(kept).toMatchObject({ status: 'done', completedAt: tickedAt, updatedAt: tickedAt, source: 'gtasks', external: imported.external });
    expect(h.taskEvents.slice(eventsBefore)).toEqual([{ uid: UID, changedIds: [id], reason: 'remote', pushRequested: [id] }]);
    expect(h.remote.docs.get(path)).toEqual({ ...docOf(kept), pushPending: true });
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });

  it('drops at session start a task deleted on the server while only its repair waited in the outbox', async () => {
    const h = harness();
    await h.engine.startSession(UID);
    await settle();
    const task = await linkedTask(h);
    const path = firestorePaths.task(UID, task.id);
    h.remote.commitFailures.push(new FakeProviderError('unavailable'));
    h.remote.serverSet(path, asOlderBuild(serverDoc(h, path)));
    await settle();
    expect(await h.engine.getPendingWriteCount()).toBe(1);

    // The app is closed, and the task is deleted on the server meanwhile.
    await h.engine.endSession({ wipeLocal: false });
    h.remote.docs.delete(path);
    await h.engine.startSession(UID);
    await settle();
    await h.engine.flushOutbox();
    await settle();

    expect(await h.engine.getTask(task.id)).toBeNull();
    expect(h.taskEvents.at(-1)).toEqual({ uid: UID, changedIds: [task.id], reason: 'remote', removed: [{ id: task.id, external: LINKS }] });
    expect(h.remote.docs.has(path)).toBe(false);
    expect(await h.engine.getPendingWriteCount()).toBe(0);
  });
});
