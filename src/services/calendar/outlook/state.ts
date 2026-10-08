/**
 * Outlook sync state persisted per user in AsyncStorage (mg:{uid}:calendar.outlook, wiped on
 * sign-out by the data layer). NEVER contains tokens: the refresh token lives in expo-secure-store
 * (src/services/auth/microsoftTokens.ts) and access tokens stay in memory.
 */
import { z } from 'zod';

import { APP_ERROR_CODES } from '../../../core/errors';
import { USER_STORAGE } from '../../../core/identifiers';

const errorCodeSchema = z.enum(APP_ERROR_CODES);

export const pendingOutlookPushSchema = z.object({
  /** Informational: the flush re-reads the meeting (tombstones included) and does what it needs. */
  op: z.enum(['upsert', 'delete']),
  /** Enqueue order + identity (a newer change for the same meeting replaces the entry). */
  queuedAt: z.string(),
  attempts: z.number().int().min(0),
  lastError: errorCodeSchema.nullable(),
});
export type PendingOutlookPush = z.infer<typeof pendingOutlookPushSchema>;

export const outlookSyncStateSchema = z.object({
  v: z.literal(1),
  /** @odata.deltaLink of the last completed pull (null => next pull is a full one). */
  deltaLink: z.string().nullable(),
  /** Signed-in Microsoft account (shown in the calendar settings; not a secret). */
  accountEmail: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastFullSyncAt: z.string().nullable(),
  lastError: errorCodeSchema.nullable(),
  /** Local writes (meeting id -> entry) not yet pushed to Outlook. */
  pending: z.record(z.string(), pendingOutlookPushSchema),
  /** Graph event id -> hash of the Outlook-visible fields last pushed/pulled (echo suppression). */
  hashes: z.record(z.string(), z.string()),
});
export type OutlookSyncState = z.infer<typeof outlookSyncStateSchema>;

export function defaultOutlookSyncState(): OutlookSyncState {
  return {
    v: 1,
    deltaLink: null,
    accountEmail: null,
    lastSyncAt: null,
    lastFullSyncAt: null,
    lastError: null,
    pending: {},
    hashes: {},
  };
}

export const OUTLOOK_STATE_NAME = USER_STORAGE.outlookCalendar;
