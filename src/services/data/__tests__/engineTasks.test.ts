/**
 * Task writes through the data engine: write options (origin, caller-chosen id, source) and the
 * `tasks:changed` event the Microsoft To Do sync engine listens to (M7).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEventBus, type AppEventMap, type TasksChangedEvent } from '../../../core/events';
import { firestorePaths } from '../../../core/identifiers';
import { DataEngine } from '../engine';
import type { NetworkMonitor } from '../platform';
import { FakeRemote, settle } from '../testing/fakeRemote';

const UID = 'user1';
const T0 = '2026-10-01T10:00:00.000Z';

interface Harness {
  engine: DataEngine;
  remote: FakeRemote;
  taskEvents: TasksChangedEvent[];
}

let current: Harness | null = null;

function harness(): Harness {
  const remote = new FakeRemote();
  const events = createEventBus<AppEventMap>();
  const taskEvents: TasksChangedEvent[] = [];
  events.on('tasks:changed', (event) => {
    taskEvents.push(event);
  });
  const network: NetworkMonitor = { fetch: async () => true, subscribe: () => () => undefined };
  const engine = new DataEngine({
    remote,
    storage: AsyncStorage,
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
  current = { engine, remote, taskEvents };
  return current;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (current) await current.engine.endSession({ wipeLocal: false });
  current = null;
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

    expect(linked.external).toEqual({ todoListId: 'list-work', todoTaskId: 'AAMk1', todoUpdatedAt: '2026-10-01T10:05:00.000Z' });
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
      removed: [{ id: task.id, external: { todoListId: 'list-work', todoTaskId: 'AAMk1', todoUpdatedAt: null } }],
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
});
