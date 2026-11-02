/**
 * Microsoft Graph To Do resources (the fields Meeting Guard reads and writes).
 * Reference: https://learn.microsoft.com/graph/api/resources/todotask
 */

export interface GraphDateTimeTimeZone {
  /** "2026-10-05T09:00:00.0000000" (no offset; the zone is in `timeZone`). */
  dateTime: string;
  /** "UTC" with our Prefer header; Windows or IANA names otherwise. */
  timeZone: string;
}

export interface GraphTodoList {
  id: string;
  displayName?: string | null;
  /** 'defaultList' = the built-in "Tasks" list; 'flaggedEmails' = Outlook flagged mail. */
  wellknownListName?: 'none' | 'defaultList' | 'flaggedEmails' | 'unknownFutureValue' | string;
  isOwner?: boolean;
  isShared?: boolean;
}

export type GraphTodoStatus = 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred';

export interface GraphTodoBody {
  content?: string | null;
  contentType?: 'text' | 'html' | string;
}

export interface GraphTodoTask {
  id: string;
  title?: string | null;
  body?: GraphTodoBody | null;
  status?: GraphTodoStatus | string;
  importance?: 'low' | 'normal' | 'high' | string;
  isReminderOn?: boolean;
  reminderDateTime?: GraphDateTimeTimeZone | null;
  dueDateTime?: GraphDateTimeTimeZone | null;
  completedDateTime?: GraphDateTimeTimeZone | null;
  createdDateTime?: string;
  /** UTC ISO. Changes on every modification (conflict resolution). */
  lastModifiedDateTime?: string;
  /** Delta: present (with a reason) when the task was deleted. */
  '@removed'?: { reason?: string };
}

/** Body of POST /me/todo/lists/{listId}/tasks and PATCH .../tasks/{taskId}. */
export interface GraphTodoTaskWrite {
  title?: string;
  body?: GraphTodoBody;
  status?: GraphTodoStatus;
  isReminderOn?: boolean;
  reminderDateTime?: GraphDateTimeTimeZone | null;
  dueDateTime?: GraphDateTimeTimeZone | null;
}

export interface GraphTodoListPage {
  value?: GraphTodoList[];
  '@odata.nextLink'?: string;
}

export interface GraphTodoDeltaPage {
  value?: GraphTodoTask[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}
