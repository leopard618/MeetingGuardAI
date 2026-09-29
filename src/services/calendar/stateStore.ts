/**
 * Per-user calendar sync state in AsyncStorage (mg:{uid}:calendar.google / mg:{uid}:calendar.device).
 * The data layer deletes every mg:{uid}:* key on sign-out, so nothing here outlives the session.
 * Never contains tokens. Reads are lenient: an unreadable document falls back to defaults.
 */
import { z } from 'zod';

import { APP_ERROR_CODES, AppError } from '../../core/errors';
import { userStorageKey, USER_STORAGE, type UserStorageName } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { createMutex } from './shared';

const log = createLogger('calendar');

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface StateStore<T> {
  load(): Promise<T>;
  /** Serialized read-modify-write. Skipped (returns the computed value) if the session changed. */
  update(mutate: (state: T) => T): Promise<T>;
  clear(): Promise<void>;
}

const errorCodeSchema = z.enum(APP_ERROR_CODES);

// ---------------------------------------------------------------------------------------------
// Google state
// ---------------------------------------------------------------------------------------------

export const pendingGooglePushSchema = z.object({
  /** Informational: the flush re-reads the meeting (tombstones included) and does what it needs. */
  op: z.enum(['upsert', 'delete']),
  /** Enqueue order + identity (a newer change for the same meeting replaces the entry). */
  queuedAt: z.string(),
  attempts: z.number().int().min(0),
  lastError: errorCodeSchema.nullable(),
});
export type PendingGooglePush = z.infer<typeof pendingGooglePushSchema>;

export const googleSyncStateSchema = z.object({
  v: z.literal(1),
  syncToken: z.string().nullable(),
  calendarTimeZone: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastFullSyncAt: z.string().nullable(),
  lastError: errorCodeSchema.nullable(),
  /** Local writes (meeting id -> entry) not yet pushed to Google. */
  pending: z.record(z.string(), pendingGooglePushSchema),
  /** Google event id -> hash of the Google-visible fields last pushed/pulled (echo suppression). */
  hashes: z.record(z.string(), z.string()),
});
export type GoogleSyncState = z.infer<typeof googleSyncStateSchema>;

export function defaultGoogleSyncState(): GoogleSyncState {
  return {
    v: 1,
    syncToken: null,
    calendarTimeZone: null,
    lastSyncAt: null,
    lastFullSyncAt: null,
    lastError: null,
    pending: {},
    hashes: {},
  };
}

// ---------------------------------------------------------------------------------------------
// Device state
// ---------------------------------------------------------------------------------------------

export const deviceSyncStateSchema = z.object({
  v: z.literal(1),
  lastSyncAt: z.string().nullable(),
  lastError: errorCodeSchema.nullable(),
  /** Scoped device event id -> hash of the imported fields (skip unchanged imports). */
  importHashes: z.record(z.string(), z.string()),
  /** Meeting id -> hash of the exported fields (skip unchanged exports). */
  exportHashes: z.record(z.string(), z.string()),
});
export type DeviceSyncState = z.infer<typeof deviceSyncStateSchema>;

export function defaultDeviceSyncState(): DeviceSyncState {
  return { v: 1, lastSyncAt: null, lastError: null, importHashes: {}, exportHashes: {} };
}

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

export interface StateStoreOptions<T> {
  kv: KeyValueStore;
  name: UserStorageName;
  /** Active data-session uid (null = no session). */
  getUid: () => string | null;
  schema: z.ZodType<T>;
  defaults: () => T;
}

export function createUserStateStore<T>(options: StateStoreOptions<T>): StateStore<T> {
  const mutex = createMutex();

  function requireUid(): string {
    const uid = options.getUid();
    if (!uid) throw new AppError('unauthenticated', 'No active data session');
    return uid;
  }

  async function read(uid: string): Promise<T> {
    const raw = await options.kv.getItem(userStorageKey(uid, options.name));
    if (raw === null) return options.defaults();
    try {
      const parsed = options.schema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      log.warn(`Discarding unreadable calendar state (${options.name})`);
    } catch {
      log.warn(`Discarding corrupt calendar state (${options.name})`);
    }
    return options.defaults();
  }

  return {
    async load() {
      return read(requireUid());
    },
    update(mutate) {
      return mutex.run(async () => {
        const uid = requireUid();
        const next = mutate(await read(uid));
        // The session may have ended while we were working (sign-out wipes mg:{uid}:*): never
        // resurrect the previous user's keys.
        if (options.getUid() === uid) {
          await options.kv.setItem(userStorageKey(uid, options.name), JSON.stringify(next));
        }
        return next;
      });
    },
    clear() {
      return mutex.run(async () => {
        const uid = options.getUid();
        if (uid) await options.kv.removeItem(userStorageKey(uid, options.name));
      });
    },
  };
}

export const GOOGLE_STATE_NAME = USER_STORAGE.googleCalendar;
export const DEVICE_STATE_NAME = USER_STORAGE.deviceCalendar;

