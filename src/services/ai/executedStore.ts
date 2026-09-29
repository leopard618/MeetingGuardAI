/**
 * Idempotency records of executed assistant actions (mg:{uid}:assistant.executed).
 *
 * - The in-memory copy is updated synchronously before the write, so a double tap within the
 *   same app run is always recognized even if the storage write fails.
 * - Writes are serialized per user; the record keeps the newest MAX_DONE_RECORDS entries.
 * - A corrupt record is discarded (logged); it only affects duplicate detection for old actions.
 * - The data layer deletes the key on sign-out (it wipes every mg:{uid}:* key).
 */
import { z } from 'zod';

import { AI_ACTION_TYPES } from '../../core/aiContract';
import { APP_ERROR_CODES } from '../../core/errors';
import { USER_STORAGE, userStorageKey } from '../../core/identifiers';
import { createLogger } from '../../core/logger';

import type { AiDoneResult, ExecutedStore } from './types';

const log = createLogger('ai.executed');

export const MAX_DONE_RECORDS = 200;
const MAX_PROGRESS_RECORDS = 50;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const doneResultSchema = z.object({
  status: z.literal('done'),
  actionId: z.string(),
  type: z.enum(AI_ACTION_TYPES),
  meetingIds: z.array(z.string()),
  duplicate: z.boolean(),
  delivery: z.enum(['google_invite', 'mail_composer', 'system_share']).optional(),
  meetLinkCreated: z.boolean().optional(),
  skippedMeetingIds: z.array(z.string()).optional(),
  meetLinkError: z.enum(APP_ERROR_CODES).nullable().optional(),
  recipients: z.array(z.string()).optional(),
});

const recordSchema = z.object({
  v: z.literal(1),
  done: z.record(z.string(), z.object({ at: z.string(), result: doneResultSchema })),
  progress: z.record(z.string(), z.object({ at: z.string(), meetingIds: z.array(z.string()) })),
});
type ExecutedRecord = z.infer<typeof recordSchema>;

function emptyRecord(): ExecutedRecord {
  return { v: 1, done: {}, progress: {} };
}

function newest<T extends { at: string }>(entries: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(entries);
  if (keys.length <= max) return entries;
  const kept = keys.sort((a, b) => (entries[b]?.at ?? '').localeCompare(entries[a]?.at ?? '')).slice(0, max);
  const result: Record<string, T> = {};
  for (const key of kept) {
    const entry = entries[key];
    if (entry) result[key] = entry;
  }
  return result;
}

export function createExecutedStore(storage: KeyValueStorage, now: () => Date = () => new Date()): ExecutedStore {
  const cache = new Map<string, ExecutedRecord>();
  const loading = new Map<string, Promise<ExecutedRecord>>();
  const writes = new Map<string, Promise<void>>();

  async function load(uid: string): Promise<ExecutedRecord> {
    const cached = cache.get(uid);
    if (cached) return cached;
    const pending = loading.get(uid);
    if (pending) return pending;
    const promise = (async () => {
      let record = emptyRecord();
      try {
        const raw = await storage.getItem(userStorageKey(uid, USER_STORAGE.assistantExecuted));
        if (raw) {
          const parsed = recordSchema.safeParse(JSON.parse(raw));
          if (parsed.success) record = parsed.data;
          else log.warn('discarding an invalid executed-actions record');
        }
      } catch (error) {
        log.warn('could not read executed actions', error);
      }
      // A write made while loading wins over the stored copy.
      const current = cache.get(uid) ?? record;
      cache.set(uid, current);
      return current;
    })();
    loading.set(uid, promise);
    try {
      return await promise;
    } finally {
      loading.delete(uid);
    }
  }

  function persist(uid: string, record: ExecutedRecord): Promise<void> {
    const previous = writes.get(uid) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          await storage.setItem(userStorageKey(uid, USER_STORAGE.assistantExecuted), JSON.stringify(record));
        } catch (error) {
          log.error('could not persist executed actions', error);
        }
      });
    writes.set(uid, next);
    return next;
  }

  return {
    async getDone(uid, key) {
      const record = await load(uid);
      return (record.done[key]?.result as AiDoneResult | undefined) ?? null;
    },
    async markDone(uid, key, result) {
      const record = await load(uid);
      const at = now().toISOString();
      const { [key]: _finished, ...progress } = record.progress;
      const next: ExecutedRecord = {
        v: 1,
        done: newest({ ...record.done, [key]: { at, result: { ...result, duplicate: false } } }, MAX_DONE_RECORDS),
        progress,
      };
      cache.set(uid, next);
      await persist(uid, next);
    },
    async getProgress(uid, key) {
      const record = await load(uid);
      return [...(record.progress[key]?.meetingIds ?? [])];
    },
    async markProgress(uid, key, meetingId) {
      const record = await load(uid);
      const existing = record.progress[key]?.meetingIds ?? [];
      if (existing.includes(meetingId)) return;
      const next: ExecutedRecord = {
        ...record,
        progress: newest(
          { ...record.progress, [key]: { at: now().toISOString(), meetingIds: [...existing, meetingId] } },
          MAX_PROGRESS_RECORDS,
        ),
      };
      cache.set(uid, next);
      await persist(uid, next);
    },
  };
}
