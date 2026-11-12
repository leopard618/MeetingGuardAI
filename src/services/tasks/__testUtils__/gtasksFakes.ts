/**
 * In-memory Google Tasks API fake for the Google Tasks sync tests (not shipped: nothing in the
 * app imports this folder). Shares FakeClock / FakeTasks / memoryStateStore with ./fakes.ts.
 */
import { AppError } from '../../../core/errors';
import type { GoogleTasksApi, ListTasksParams } from '../gtasks/api';
import type { GoogleTask, GoogleTaskList, GoogleTaskPage, GoogleTaskWrite } from '../gtasks/types';
import { clone, type FakeClock } from './fakes';

export interface GtasksCall {
  method: 'lists' | 'list' | 'get' | 'create' | 'patch' | 'delete';
  listId?: string;
  taskId?: string;
  params?: ListTasksParams;
  body?: GoogleTaskWrite;
}

export function googleTasksError(status: number, reason: string | null = null): AppError {
  const code =
    status === 404 || status === 410
      ? 'not_found'
      : status === 403
        ? reason === 'insufficientPermissions'
          ? 'tasks_scope_missing'
          : 'permission_denied'
        : status === 400
          ? 'invalid_input'
          : 'upstream_error';
  return new AppError(code, `HTTP ${status}`, { details: { status, reason }, retryable: status === 429 || status >= 500 });
}

/** Scriptable Google Tasks: stores tasks per list; listings honour updatedMin and page size. */
export class FakeGoogleTasksApi implements GoogleTasksApi {
  lists: GoogleTaskList[] = [{ id: 'gl-default', title: 'My Tasks' }];
  tasks = new Map<string, Map<string, GoogleTask>>();
  calls: GtasksCall[] = [];
  /** Errors to throw on the next matching call. */
  failures: { method: GtasksCall['method']; error: AppError; taskId?: string }[] = [];
  /** Listing page size (small values exercise paging). */
  pageSize = 100;
  private seq = 0;

  constructor(private clock: FakeClock) {}

  private fail(method: GtasksCall['method'], taskId?: string): void {
    const index = this.failures.findIndex((f) => f.method === method && (f.taskId === undefined || f.taskId === taskId));
    if (index === -1) return;
    const [failure] = this.failures.splice(index, 1);
    throw (failure as { error: AppError }).error;
  }

  private listTasksOf(listId: string): Map<string, GoogleTask> {
    let tasks = this.tasks.get(listId);
    if (!tasks) {
      tasks = new Map();
      this.tasks.set(listId, tasks);
    }
    return tasks;
  }

  /** Seeds a task in a list as if created in Google Tasks. */
  seed(listId: string, task: Partial<GoogleTask> & { id: string }): GoogleTask {
    const full: GoogleTask = {
      title: `Task ${task.id}`,
      status: 'needsAction',
      notes: '',
      updated: this.clock.now().toISOString(),
      ...task,
    };
    this.listTasksOf(listId).set(task.id, full);
    return full;
  }

  /** Marks a seeded task deleted (what the API returns with showDeleted until it is purged). */
  markDeleted(listId: string, taskId: string): void {
    const task = this.listTasksOf(listId).get(taskId);
    if (!task) throw new Error(`no task ${taskId}`);
    this.listTasksOf(listId).set(taskId, { ...task, deleted: true, updated: this.clock.now().toISOString() });
  }

  async listLists(): Promise<GoogleTaskList[]> {
    this.calls.push({ method: 'lists' });
    this.fail('lists');
    return clone(this.lists);
  }

  async listTasks(listId: string, params: ListTasksParams): Promise<GoogleTaskPage> {
    this.calls.push({ method: 'list', listId, params });
    this.fail('list');
    const all = [...this.listTasksOf(listId).values()].filter(
      (task) => params.updatedMin === undefined || (task.updated !== undefined && task.updated > params.updatedMin),
    );
    const start = params.pageToken === undefined ? 0 : Number(params.pageToken);
    const items = all.slice(start, start + this.pageSize).map(clone);
    const next = start + this.pageSize;
    return next < all.length ? { items, nextPageToken: String(next) } : { items };
  }

  async getTask(listId: string, taskId: string): Promise<GoogleTask> {
    this.calls.push({ method: 'get', listId, taskId });
    this.fail('get', taskId);
    const task = this.listTasksOf(listId).get(taskId);
    if (!task) throw googleTasksError(404, 'notFound');
    return clone(task);
  }

  async createTask(listId: string, body: GoogleTaskWrite): Promise<GoogleTask> {
    this.calls.push({ method: 'create', listId, body });
    this.fail('create');
    this.seq += 1;
    const task: GoogleTask = {
      id: `g${this.seq}`,
      title: body.title ?? '',
      notes: body.notes ?? '',
      status: body.status ?? 'needsAction',
      due: body.due ?? undefined,
      completed: body.completed ?? undefined,
      updated: this.clock.now().toISOString(),
    };
    this.listTasksOf(listId).set(task.id, task);
    return clone(task);
  }

  async patchTask(listId: string, taskId: string, body: GoogleTaskWrite): Promise<GoogleTask> {
    this.calls.push({ method: 'patch', listId, taskId, body });
    this.fail('patch', taskId);
    const task = this.listTasksOf(listId).get(taskId);
    if (!task || task.deleted === true) throw googleTasksError(404, 'notFound');
    const next: GoogleTask = {
      ...task,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.due !== undefined ? { due: body.due ?? undefined } : {}),
      ...(body.completed !== undefined ? { completed: body.completed ?? undefined } : {}),
      updated: this.clock.now().toISOString(),
    };
    this.listTasksOf(listId).set(taskId, next);
    return clone(next);
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    this.calls.push({ method: 'delete', listId, taskId });
    this.fail('delete', taskId);
    if (!this.listTasksOf(listId).delete(taskId)) throw googleTasksError(404, 'notFound');
  }
}
