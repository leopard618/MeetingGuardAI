/**
 * Microsoft To Do sync state persisted per user in AsyncStorage (mg:{uid}:tasks.todo, wiped on
 * sign-out by the data layer). NEVER contains tokens: the Microsoft refresh token lives in
 * expo-secure-store (src/services/auth/microsoftTokens.ts), shared with the Outlook sync.
 */
import { z } from 'zod';

import { APP_ERROR_CODES } from '../../../core/errors';
import { USER_STORAGE } from '../../../core/identifiers';

const errorCodeSchema = z.enum(APP_ERROR_CODES);

/** Where a task's To Do copy lives (kept in the queue so a deleted task can still be removed there). */
export const todoLinkSchema = z.object({
  listId: z.string(),
  taskId: z.string(),
});
export type TodoLink = z.infer<typeof todoLinkSchema>;

export const pendingTodoPushSchema = z.object({
  /** Informational: the flush re-reads the task and does what it needs. */
  op: z.enum(['upsert', 'delete']),
  /** Enqueue order + identity (a newer change for the same task replaces the entry). */
  queuedAt: z.string(),
  attempts: z.number().int().min(0),
  lastError: errorCodeSchema.nullable(),
  /** The copy to delete when the local task is already gone (deletes only). */
  link: todoLinkSchema.nullable(),
});
export type PendingTodoPush = z.infer<typeof pendingTodoPushSchema>;

export const todoListStateSchema = z.object({
  /** @odata.deltaLink of the last completed pull of this list (null => next pull is a full one). */
  deltaLink: z.string().nullable(),
  lastFullSyncAt: z.string().nullable(),
});
export type TodoListState = z.infer<typeof todoListStateSchema>;

export const todoSyncStateSchema = z.object({
  v: z.literal(1),
  /** The per-device switch (the chosen list is shared through preferences). */
  enabled: z.boolean(),
  /**
   * The list new tasks go to as THIS device knows it (chosen here, or followed from preferences),
   * kept while its sync is on. An older build that saves the preferences as a whole document
   * erases the shared choice; the service then puts this one back (service.ts resolveList).
   * States stored before this field existed have none.
   */
  listId: z.string().nullable().default(null),
  listName: z.string().nullable().default(null),
  lastSyncAt: z.string().nullable(),
  lastError: errorCodeSchema.nullable(),
  /** List id -> delta state. Lists appear when they are synced for the first time. */
  lists: z.record(z.string(), todoListStateSchema),
  /** Local writes (task id -> entry) not yet pushed to To Do. */
  pending: z.record(z.string(), pendingTodoPushSchema),
  /** Graph task id -> hash of the To Do-visible fields last pushed/pulled (echo suppression). */
  hashes: z.record(z.string(), z.string()),
  /**
   * Local task id -> where its copy is (list + task id) as THIS device last saw it. The task
   * document carries the same link for other devices; this map tells a list change (desired list
   * in the document) from the actual location, so the copy is moved instead of duplicated.
   */
  links: z.record(z.string(), todoLinkSchema).default({}),
});
export type TodoSyncState = z.infer<typeof todoSyncStateSchema>;

export function defaultTodoSyncState(): TodoSyncState {
  return { v: 1, enabled: false, listId: null, listName: null, lastSyncAt: null, lastError: null, lists: {}, pending: {}, hashes: {}, links: {} };
}

export const TODO_STATE_NAME = USER_STORAGE.todoTasks;
