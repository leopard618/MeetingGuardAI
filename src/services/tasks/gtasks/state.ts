/**
 * Google Tasks sync state persisted per user in AsyncStorage (mg:{uid}:tasks.gtasks, wiped on
 * sign-out by the data layer). NEVER contains tokens: Google access tokens come from the native
 * Google Sign-In SDK on demand (src/services/auth/authService.ts) and are never stored.
 */
import { z } from 'zod';

import { APP_ERROR_CODES } from '../../../core/errors';
import { USER_STORAGE } from '../../../core/identifiers';

const errorCodeSchema = z.enum(APP_ERROR_CODES);

/** Where a task's Google copy lives (kept in the queue so a deleted task can still be removed there). */
export const gtasksLinkSchema = z.object({
  listId: z.string(),
  taskId: z.string(),
});
export type GtasksLink = z.infer<typeof gtasksLinkSchema>;

export const pendingGtasksPushSchema = z.object({
  /** Informational: the flush re-reads the task and does what it needs. */
  op: z.enum(['upsert', 'delete']),
  /** Enqueue order + identity (a newer change for the same task replaces the entry). */
  queuedAt: z.string(),
  attempts: z.number().int().min(0),
  lastError: errorCodeSchema.nullable(),
  /** The copy to delete when the local task is already gone (deletes only). */
  link: gtasksLinkSchema.nullable(),
});
export type PendingGtasksPush = z.infer<typeof pendingGtasksPushSchema>;

export const gtasksListStateSchema = z.object({
  /**
   * `updated` watermark of the last completed pull of this list (the pull time minus a skew
   * margin), sent as updatedMin next time; null => next pull is a full listing.
   */
  updatedMin: z.string().nullable(),
  lastFullSyncAt: z.string().nullable(),
});
export type GtasksListState = z.infer<typeof gtasksListStateSchema>;

export const gtasksSyncStateSchema = z.object({
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
  /** List id -> pull state. Lists appear when they are synced for the first time. */
  lists: z.record(z.string(), gtasksListStateSchema),
  /** Local writes (task id -> entry) not yet pushed to Google Tasks. */
  pending: z.record(z.string(), pendingGtasksPushSchema),
  /** Google task id -> hash of the Google-visible fields last pushed/pulled (echo suppression). */
  hashes: z.record(z.string(), z.string()),
  /**
   * Local task id -> where its copy is (list + task id) as THIS device last saw it. The task
   * document carries the same link for other devices; this map tells a list change (desired list
   * in the document) from the actual location, so the copy is moved instead of duplicated.
   */
  links: z.record(z.string(), gtasksLinkSchema).default({}),
});
export type GtasksSyncState = z.infer<typeof gtasksSyncStateSchema>;

export function defaultGtasksSyncState(): GtasksSyncState {
  return { v: 1, enabled: false, listId: null, listName: null, lastSyncAt: null, lastError: null, lists: {}, pending: {}, hashes: {}, links: {} };
}

export const GTASKS_STATE_NAME = USER_STORAGE.gtasksTasks;
