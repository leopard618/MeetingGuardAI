/**
 * Per-user AsyncStorage cache (offline reads, fast start, headless access).
 *
 * Keys (all under the per-user prefix `mg:{uid}:`, wiped together on sign-out):
 *   mg:{uid}:meetings:{id}   MeetingDoc JSON, one key per meeting (tombstones included). One key
 *                            per document keeps every value small (Android's SQLite cursor window
 *                            limits a single value to ~2 MB) and makes a write O(1).
 *   mg:{uid}:notes:{id}      Note JSON (without id)
 *   mg:{uid}:tasks:{id}      Task JSON (without id)
 *   mg:{uid}:preferences     { v, known, preferences }
 *   mg:{uid}:entitlement     Entitlement JSON
 *   mg:{uid}:profile         UserProfile JSON
 *   mg:{uid}:outbox          { seq, entries } (outbox.ts)
 *   mg:{uid}:migration       legacy migration marker (migration.ts)
 *   mg:{uid}:attachments     device-local attachment metadata (attachments.ts)
 */
import { AppError, toAppError } from '../../core/errors';
import { USER_STORAGE, userStorageKey, userStoragePrefix } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import {
  mergePreferences,
  parseEntitlementDoc,
  userProfileSchema,
  type Entitlement,
  type Meeting,
  type Note,
  type Preferences,
  type Task,
  type UserProfile,
} from '../../core/types';
import { readCachedMeeting, readRemoteNote, readRemoteTask } from './mapping';
import { EMPTY_OUTBOX, parseOutbox, type OutboxState } from './outbox';

const log = createLogger('data.cache');

/** The AsyncStorage subset the data layer uses (structurally satisfied by AsyncStorage 2.x). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: readonly (readonly [string, string])[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export const CACHE_VERSION = 1;

export const cacheKeys = {
  meetingPrefix: (uid: string): string => `${userStorageKey(uid, USER_STORAGE.meetings)}:`,
  meeting: (uid: string, id: string): string => `${userStorageKey(uid, USER_STORAGE.meetings)}:${id}`,
  notePrefix: (uid: string): string => `${userStorageKey(uid, USER_STORAGE.notes)}:`,
  note: (uid: string, id: string): string => `${userStorageKey(uid, USER_STORAGE.notes)}:${id}`,
  taskPrefix: (uid: string): string => `${userStorageKey(uid, USER_STORAGE.tasks)}:`,
  task: (uid: string, id: string): string => `${userStorageKey(uid, USER_STORAGE.tasks)}:${id}`,
  preferences: (uid: string): string => userStorageKey(uid, USER_STORAGE.preferences),
  entitlement: (uid: string): string => userStorageKey(uid, USER_STORAGE.entitlement),
  profile: (uid: string): string => userStorageKey(uid, USER_STORAGE.profile),
  outbox: (uid: string): string => userStorageKey(uid, USER_STORAGE.outbox),
  migration: (uid: string): string => userStorageKey(uid, USER_STORAGE.migration),
  attachments: (uid: string): string => userStorageKey(uid, USER_STORAGE.attachments),
} as const;

export interface CachedPreferences {
  preferences: Preferences;
  /** true once the server state was seen (or created) on this device. */
  known: boolean;
}

export interface UserCache {
  meetings: Map<string, Meeting>;
  notes: Map<string, Note>;
  tasks: Map<string, Task>;
  preferences: CachedPreferences | null;
  entitlement: Entitlement | null;
  profile: UserProfile | null;
  outbox: OutboxState;
  /** Keys whose content could not be parsed (removed by the loader). */
  corruptKeys: string[];
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  return JSON.parse(raw) as unknown;
}

/** Reads the whole per-user cache. Throws AppError when storage itself fails (never returns a fake empty cache). */
export async function loadUserCache(storage: KeyValueStorage, uid: string, defaults: Preferences): Promise<UserCache> {
  let allKeys: readonly string[];
  try {
    allKeys = await storage.getAllKeys();
  } catch (error) {
    throw toAppError(error);
  }
  const meetingPrefix = cacheKeys.meetingPrefix(uid);
  const notePrefix = cacheKeys.notePrefix(uid);
  const taskPrefix = cacheKeys.taskPrefix(uid);
  const docKeys = allKeys.filter((key) => key.startsWith(meetingPrefix) || key.startsWith(notePrefix) || key.startsWith(taskPrefix));
  const singleKeys = [cacheKeys.preferences(uid), cacheKeys.entitlement(uid), cacheKeys.profile(uid)];

  let pairs: readonly (readonly [string, string | null])[];
  try {
    pairs = await storage.multiGet([...docKeys, ...singleKeys]);
  } catch (error) {
    throw toAppError(error);
  }
  // The outbox is one row that can outgrow what the storage can return (hundreds of queued
  // imports); read on its own so an unreadable row costs the queue, never the whole session.
  const outboxKey = cacheKeys.outbox(uid);
  try {
    const [outboxPair] = await storage.multiGet([outboxKey]);
    if (outboxPair) pairs = [...pairs, outboxPair];
  } catch (error) {
    log.error('outbox unreadable; starting with an empty queue', toAppError(error));
  }

  const cache: UserCache = {
    meetings: new Map(),
    notes: new Map(),
    tasks: new Map(),
    preferences: null,
    entitlement: null,
    profile: null,
    outbox: { ...EMPTY_OUTBOX, entries: [] },
    corruptKeys: [],
  };

  for (const [key, raw] of pairs) {
    if (raw === null) continue;
    let value: unknown;
    try {
      value = parseJson(raw);
    } catch {
      cache.corruptKeys.push(key);
      continue;
    }
    if (key.startsWith(meetingPrefix)) {
      const id = key.slice(meetingPrefix.length);
      const meeting = readCachedMeeting(id, value);
      if (meeting) cache.meetings.set(id, meeting);
      else cache.corruptKeys.push(key);
    } else if (key.startsWith(notePrefix)) {
      const id = key.slice(notePrefix.length);
      const note = readRemoteNote(id, value);
      if (note) cache.notes.set(id, note);
      else cache.corruptKeys.push(key);
    } else if (key.startsWith(taskPrefix)) {
      const id = key.slice(taskPrefix.length);
      const task = readRemoteTask(id, value);
      if (task) cache.tasks.set(id, task);
      else cache.corruptKeys.push(key);
    } else if (key === cacheKeys.preferences(uid)) {
      const record = (value ?? {}) as { preferences?: unknown; known?: unknown };
      cache.preferences = { preferences: mergePreferences(record.preferences, defaults), known: record.known === true };
    } else if (key === cacheKeys.entitlement(uid)) {
      cache.entitlement = parseEntitlementDoc(value);
    } else if (key === cacheKeys.profile(uid)) {
      const parsed = userProfileSchema.safeParse(value);
      cache.profile = parsed.success ? parsed.data : null;
    } else if (key === cacheKeys.outbox(uid)) {
      const { state, dropped } = parseOutbox(value);
      cache.outbox = state;
      if (dropped > 0) log.error(`dropped ${dropped} invalid outbox entries`);
    }
  }

  if (cache.corruptKeys.length > 0) {
    log.warn(`removing ${cache.corruptKeys.length} unreadable cache entries`);
    try {
      await storage.multiRemove(cache.corruptKeys);
    } catch (error) {
      log.warn('could not remove unreadable cache entries', toAppError(error).code);
    }
  }
  return cache;
}

/** Deletes every `mg:{uid}:*` key. */
export async function wipeUserCache(storage: KeyValueStorage, uid: string): Promise<number> {
  const prefix = userStoragePrefix(uid);
  const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length > 0) await storage.multiRemove(keys);
  return keys.length;
}

/** Headless read of cached meetings for `uid` (no session needed). */
export async function readCachedMeetings(storage: KeyValueStorage, uid: string): Promise<Meeting[]> {
  try {
    const prefix = cacheKeys.meetingPrefix(uid);
    const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(prefix));
    if (keys.length === 0) return [];
    const pairs = await storage.multiGet(keys);
    const meetings: Meeting[] = [];
    for (const [key, raw] of pairs) {
      if (raw === null) continue;
      try {
        const meeting = readCachedMeeting(key.slice(prefix.length), JSON.parse(raw) as unknown);
        if (meeting) meetings.push(meeting);
      } catch {
        // An unreadable entry is skipped here; the next session load removes it.
      }
    }
    return meetings;
  } catch (error) {
    throw toAppError(error);
  }
}

/** Headless read of cached preferences (null when nothing is cached for this uid). */
export async function readCachedPreferences(storage: KeyValueStorage, uid: string, defaults: Preferences): Promise<Preferences | null> {
  let raw: string | null;
  try {
    raw = await storage.getItem(cacheKeys.preferences(uid));
  } catch (error) {
    throw toAppError(error);
  }
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw) as { preferences?: unknown };
    return mergePreferences(record.preferences, defaults);
  } catch (error) {
    throw new AppError('unknown', 'Cached preferences are unreadable', { cause: error });
  }
}
