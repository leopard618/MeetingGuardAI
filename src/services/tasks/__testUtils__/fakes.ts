/**
 * In-memory fakes for the Microsoft To Do sync tests (not shipped: nothing in the app imports
 * this folder).
 */
import type { TaskWriteOptions } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import type { WriteOrigin } from '../../../core/events';
import { applyTaskPatch, buildTask, type Task, type TaskInput, type TaskPatch } from '../../../core/types';
import type { TodoGraphApi } from '../todo/api';
import type { GraphTodoDeltaPage, GraphTodoList, GraphTodoTask, GraphTodoTaskWrite } from '../todo/types';

export const USER_ID = 'user-1';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class FakeClock {
  constructor(public current: Date) {}
  now = (): Date => new Date(this.current.getTime());
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

/** TasksRepository fake with the write-option semantics of the data engine. */
export class FakeTasks {
  tasks = new Map<string, Task>();
  writes: { id: string; origin: WriteOrigin | undefined; kind: 'create' | 'update' | 'remove' }[] = [];
  private seq = 0;

  constructor(
    private clock: FakeClock,
    private timezone = 'UTC',
  ) {}

  add(input: TaskInput, options: { id?: string; source?: Task['source'] } = {}): Task {
    this.seq += 1;
    const task = buildTask(input, {
      id: options.id ?? `t${this.seq}`,
      userId: USER_ID,
      timezone: this.timezone,
      now: this.clock.now(),
      source: options.source,
    });
    this.tasks.set(task.id, task);
    return task;
  }

  all(): Task[] {
    return [...this.tasks.values()];
  }

  async list(): Promise<Task[]> {
    return this.all();
  }

  async get(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async create(input: TaskInput, options: TaskWriteOptions = {}): Promise<Task> {
    if (options.id !== undefined) {
      const existing = this.tasks.get(options.id);
      if (existing) return existing;
    }
    const origin = options.origin ?? 'user';
    const task = this.add(input, { id: options.id, source: options.source ?? (origin === 'ai' ? 'ai_chat' : 'manual') });
    this.writes.push({ id: task.id, origin, kind: 'create' });
    return task;
  }

  async update(id: string, patch: TaskPatch, options: TaskWriteOptions = {}): Promise<Task> {
    const task = this.tasks.get(id);
    if (!task) throw new AppError('not_found', 'missing');
    // Like the engine: a later write never shares the previous timestamp.
    const previous = Date.parse(task.updatedAt);
    const now = Math.max(this.clock.now().getTime(), previous + 1);
    const next = applyTaskPatch(task, patch, new Date(now));
    this.tasks.set(id, next);
    this.writes.push({ id, origin: options.origin ?? 'user', kind: 'update' });
    return next;
  }

  async remove(id: string, options: TaskWriteOptions = {}): Promise<void> {
    if (!this.tasks.has(id)) throw new AppError('not_found', 'missing');
    this.tasks.delete(id);
    this.writes.push({ id, origin: options.origin ?? 'user', kind: 'remove' });
  }
}

export interface TodoCall {
  method: 'lists' | 'startDelta' | 'deltaPage' | 'get' | 'create' | 'patch' | 'delete';
  listId?: string;
  taskId?: string;
  url?: string;
  body?: GraphTodoTaskWrite;
}

export function graphError(status: number, graphCode: string | null = null): AppError {
  const code = status === 404 || status === 410 ? 'not_found' : status === 403 ? 'permission_denied' : status === 409 ? 'conflict' : 'upstream_error';
  return new AppError(code, `HTTP ${status}`, { details: { status, graphCode }, retryable: status === 429 || status >= 500 });
}

/** Scriptable Graph To Do: stores tasks per list; delta responses can be queued explicitly. */
export class FakeTodoApi implements TodoGraphApi {
  lists: GraphTodoList[] = [{ id: 'list-tasks', displayName: 'Tasks', wellknownListName: 'defaultList' }];
  tasks = new Map<string, Map<string, GraphTodoTask>>();
  calls: TodoCall[] = [];
  /** Queued delta pages (consumed in order by startDelta / getDeltaPage). */
  deltaResponses: GraphTodoDeltaPage[] = [];
  /** Errors to throw on the next matching call. */
  failures: { method: TodoCall['method']; error: AppError; taskId?: string }[] = [];
  private seq = 0;

  constructor(private clock: FakeClock) {}

  private fail(method: TodoCall['method'], taskId?: string): void {
    const index = this.failures.findIndex((f) => f.method === method && (f.taskId === undefined || f.taskId === taskId));
    if (index === -1) return;
    const [failure] = this.failures.splice(index, 1);
    throw (failure as { error: AppError }).error;
  }

  private listTasks(listId: string): Map<string, GraphTodoTask> {
    let tasks = this.tasks.get(listId);
    if (!tasks) {
      tasks = new Map();
      this.tasks.set(listId, tasks);
    }
    return tasks;
  }

  /** Seeds a task in a list as if created in To Do. */
  seed(listId: string, task: Partial<GraphTodoTask> & { id: string }): GraphTodoTask {
    const full: GraphTodoTask = {
      title: `Task ${task.id}`,
      status: 'notStarted',
      body: { content: '', contentType: 'text' },
      isReminderOn: false,
      lastModifiedDateTime: this.clock.now().toISOString(),
      ...task,
    };
    this.listTasks(listId).set(task.id, full);
    return full;
  }

  /** A delta page listing every task of a list (what a full listing returns). */
  fullPage(listId: string, deltaLink = `https://graph.microsoft.com/v1.0/delta-${listId}`): GraphTodoDeltaPage {
    return { value: [...this.listTasks(listId).values()].map(clone), '@odata.deltaLink': deltaLink };
  }

  async listLists(): Promise<GraphTodoList[]> {
    this.calls.push({ method: 'lists' });
    this.fail('lists');
    return clone(this.lists);
  }

  async startDelta(listId: string): Promise<GraphTodoDeltaPage> {
    this.calls.push({ method: 'startDelta', listId });
    this.fail('startDelta');
    return this.deltaResponses.shift() ?? this.fullPage(listId);
  }

  async getDeltaPage(url: string): Promise<GraphTodoDeltaPage> {
    this.calls.push({ method: 'deltaPage', url });
    this.fail('deltaPage');
    const page = this.deltaResponses.shift();
    if (!page) return { value: [], '@odata.deltaLink': url };
    return page;
  }

  async getTask(listId: string, taskId: string): Promise<GraphTodoTask> {
    this.calls.push({ method: 'get', listId, taskId });
    this.fail('get', taskId);
    const task = this.listTasks(listId).get(taskId);
    if (!task) throw graphError(404, 'ErrorItemNotFound');
    return clone(task);
  }

  async createTask(listId: string, body: GraphTodoTaskWrite): Promise<GraphTodoTask> {
    this.calls.push({ method: 'create', listId, body });
    this.fail('create');
    this.seq += 1;
    const task: GraphTodoTask = {
      id: `AAMk${this.seq}=`,
      title: body.title ?? '',
      body: body.body ?? { content: '', contentType: 'text' },
      status: body.status ?? 'notStarted',
      isReminderOn: body.isReminderOn ?? false,
      reminderDateTime: body.reminderDateTime ?? null,
      dueDateTime: body.dueDateTime ?? null,
      createdDateTime: this.clock.now().toISOString(),
      lastModifiedDateTime: this.clock.now().toISOString(),
    };
    this.listTasks(listId).set(task.id, task);
    return clone(task);
  }

  async patchTask(listId: string, taskId: string, body: GraphTodoTaskWrite): Promise<GraphTodoTask> {
    this.calls.push({ method: 'patch', listId, taskId, body });
    this.fail('patch', taskId);
    const task = this.listTasks(listId).get(taskId);
    if (!task) throw graphError(404, 'ErrorItemNotFound');
    const next: GraphTodoTask = { ...task, ...body, lastModifiedDateTime: this.clock.now().toISOString() };
    this.listTasks(listId).set(taskId, next);
    return clone(next);
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    this.calls.push({ method: 'delete', listId, taskId });
    this.fail('delete', taskId);
    if (!this.listTasks(listId).delete(taskId)) throw graphError(404, 'ErrorItemNotFound');
  }
}

export function memoryStateStore<T>(initial: T): { load(): Promise<T>; update(mutate: (state: T) => T): Promise<T>; clear(): Promise<void>; value: T } {
  const store = {
    value: initial,
    async load() {
      return clone(store.value);
    },
    async update(mutate: (state: T) => T) {
      store.value = mutate(clone(store.value));
      return clone(store.value);
    },
    async clear() {
      store.value = clone(initial);
    },
  };
  return store;
}
