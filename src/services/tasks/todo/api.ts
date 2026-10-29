/**
 * Microsoft Graph To Do endpoints on the shared Graph HTTP core (src/services/microsoft/graphHttp.ts).
 * Lists: GET /me/todo/lists. Tasks: /me/todo/lists/{listId}/tasks (+ /delta for incremental
 * pulls). Delta links are absolute URLs and must stay on the Graph origin.
 */
import { createGraphHttp, type GraphTokenProvider } from '../../microsoft/graphHttp';
import type { GraphTodoDeltaPage, GraphTodoList, GraphTodoListPage, GraphTodoTask, GraphTodoTaskWrite } from './types';

export { graphErrorCode, graphHttpStatus, type GraphTokenProvider } from '../../microsoft/graphHttp';

/** Task fields MeetingGuard reads (delta supports $select). */
export const TODO_TASK_SELECT =
  'id,title,body,status,importance,isReminderOn,reminderDateTime,dueDateTime,completedDateTime,createdDateTime,lastModifiedDateTime';

/** UTC times (due and reminder instants are converted locally) + bounded pages. */
const PREFER_HEADER = 'outlook.timezone="UTC", odata.maxpagesize=100';
/** A To Do account rarely has more than a handful of lists; this caps a runaway listing. */
export const MAX_LIST_PAGES = 10;

export interface TodoApiOptions {
  tokens: GraphTokenProvider;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  baseUrl?: string;
}

export interface TodoGraphApi {
  /** Every list of the account (all pages). */
  listLists(): Promise<GraphTodoList[]>;
  /** First delta page of a list's tasks (full listing). */
  startDelta(listId: string): Promise<GraphTodoDeltaPage>;
  /** Follows an @odata.nextLink or @odata.deltaLink (absolute Graph URL). */
  getDeltaPage(url: string): Promise<GraphTodoDeltaPage>;
  getTask(listId: string, taskId: string): Promise<GraphTodoTask>;
  createTask(listId: string, body: GraphTodoTaskWrite): Promise<GraphTodoTask>;
  patchTask(listId: string, taskId: string, body: GraphTodoTaskWrite): Promise<GraphTodoTask>;
  deleteTask(listId: string, taskId: string): Promise<void>;
}

export function createTodoGraphApi(options: TodoApiOptions): TodoGraphApi {
  const http = createGraphHttp({ ...options, prefer: PREFER_HEADER });
  const base = http.base;
  const tasksUrl = (listId: string): string => `${base}/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
  const taskUrl = (listId: string, taskId: string): string => `${tasksUrl(listId)}/${encodeURIComponent(taskId)}`;

  return {
    async listLists() {
      const lists: GraphTodoList[] = [];
      let url: string | undefined = `${base}/me/todo/lists`;
      for (let count = 0; url !== undefined && count < MAX_LIST_PAGES; count += 1) {
        http.assertGraphUrl(url, 'a lists link');
        const page: GraphTodoListPage = await http.required<GraphTodoListPage>('GET', url, 'lists page');
        lists.push(...(page.value ?? []));
        url = page['@odata.nextLink'];
      }
      return lists;
    },
    startDelta(listId) {
      return http.required<GraphTodoDeltaPage>('GET', `${tasksUrl(listId)}/delta?$select=${encodeURIComponent(TODO_TASK_SELECT)}`, 'delta page');
    },
    async getDeltaPage(url) {
      http.assertGraphUrl(url, 'a delta link');
      return http.required<GraphTodoDeltaPage>('GET', url, 'delta page');
    },
    getTask(listId, taskId) {
      return http.required<GraphTodoTask>('GET', `${taskUrl(listId, taskId)}?$select=${encodeURIComponent(TODO_TASK_SELECT)}`, 'task');
    },
    createTask(listId, body) {
      return http.required<GraphTodoTask>('POST', tasksUrl(listId), 'task', body);
    },
    patchTask(listId, taskId, body) {
      return http.required<GraphTodoTask>('PATCH', taskUrl(listId, taskId), 'task', body);
    },
    async deleteTask(listId, taskId) {
      await http.request<void>('DELETE', taskUrl(listId, taskId));
    },
  };
}
