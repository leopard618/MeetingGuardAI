/**
 * Google Tasks API v1 resources (the fields Meeting Guard reads and writes).
 * Reference: https://developers.google.com/tasks/reference/rest/v1/tasks
 */

export interface GoogleTaskList {
  id: string;
  title?: string | null;
  /** RFC 3339. */
  updated?: string;
}

export type GoogleTaskStatus = 'needsAction' | 'completed';

export interface GoogleTask {
  id: string;
  title?: string | null;
  notes?: string | null;
  status?: GoogleTaskStatus | string;
  /**
   * RFC 3339 date-only due: the API keeps the date and drops the time part ("2026-10-05T00:00:00.000Z").
   */
  due?: string | null;
  /** RFC 3339 completion time (completed tasks only). */
  completed?: string | null;
  /** True for a deleted task (only with showDeleted); the entry disappears later. */
  deleted?: boolean;
  /** True for a completed task hidden by "clear completed" (only with showHidden). */
  hidden?: boolean;
  /** RFC 3339. Changes on every modification. */
  updated?: string;
  etag?: string;
  /** Parent task id (subtask); Meeting Guard flattens the hierarchy. */
  parent?: string;
}

/** Body of POST /lists/{listId}/tasks and PATCH /lists/{listId}/tasks/{taskId}. */
export interface GoogleTaskWrite {
  title?: string;
  notes?: string;
  status?: GoogleTaskStatus;
  /** RFC 3339 midnight UTC of the due date; null clears it. */
  due?: string | null;
  /** Clearing the completion time together with status needsAction (the API requires it). */
  completed?: string | null;
}

export interface GoogleTaskListPage {
  items?: GoogleTaskList[];
  nextPageToken?: string;
}

export interface GoogleTaskPage {
  items?: GoogleTask[];
  nextPageToken?: string;
}
