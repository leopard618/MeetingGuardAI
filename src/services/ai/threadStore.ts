/**
 * Per-user persistence of the assistant thread (mg:{uid}:assistant.thread, AsyncStorage).
 *
 * - Stored JSON is validated on load; invalid messages/actions are dropped individually and a
 *   corrupt document starts a fresh thread (logged, never fatal).
 * - Previews are not stored (recomputed from the meeting cache); AppErrors in results are stored
 *   as { code, message } and revived as AppError.
 * - The data layer wipes the key on sign-out together with every other mg:{uid}:* key.
 */
import { z } from 'zod';

import { AI_ACTION_TYPES, aiActionSchema, assistantUsageSchema } from '../../core/aiContract';
import type { ActionResult, ProposedActionState } from '../../core/contracts';
import { APP_ERROR_CODES, AppError } from '../../core/errors';
import { USER_STORAGE, userStorageKey } from '../../core/identifiers';
import { createLogger } from '../../core/logger';

import { createEmptyThread, reviveThread } from './conversation';
import { doneResultSchema, type KeyValueStorage } from './executedStore';
import type { ChatMessage, ThreadState } from './types';

const log = createLogger('ai.thread');

const STORAGE_VERSION = 1;

const storedMessageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
  actionIds: z.array(z.string()),
  suggestions: z.array(z.string()),
  delivery: z.enum(['sending', 'failed']).optional(),
  followUpMeetingId: z.string().nullable().optional(),
});

const storedFailedSchema = z.object({
  status: z.literal('failed'),
  actionId: z.string(),
  type: z.enum(AI_ACTION_TYPES),
  error: z.object({ code: z.enum(APP_ERROR_CODES), message: z.string() }),
});

const storedActionSchema = z.object({
  action: aiActionSchema,
  status: z.enum(['proposed', 'executing', 'done', 'failed', 'rejected']),
  result: z.union([doneResultSchema, storedFailedSchema]).nullable(),
});

const storedThreadSchema = z.object({
  v: z.literal(STORAGE_VERSION),
  messages: z.array(z.unknown()),
  actions: z.record(z.string(), z.unknown()),
  usage: assistantUsageSchema.nullable().catch(null),
  followUpsRequested: z.array(z.string()).catch([]),
});

type StoredAction = z.infer<typeof storedActionSchema>;

function serializeResult(result: ActionResult | null): StoredAction['result'] {
  if (!result) return null;
  if (result.status === 'done') return result;
  return {
    status: 'failed',
    actionId: result.actionId,
    type: result.type,
    error: { code: result.error.code, message: result.error.message },
  };
}

function reviveResult(result: StoredAction['result']): ActionResult | null {
  if (!result) return null;
  if (result.status === 'done') return result;
  return { ...result, error: new AppError(result.error.code, result.error.message) };
}

export function serializeThread(thread: ThreadState): string {
  const actions: Record<string, StoredAction> = {};
  for (const [id, state] of Object.entries(thread.actions)) {
    actions[id] = { action: state.action, status: state.status, result: serializeResult(state.result) };
  }
  return JSON.stringify({
    v: STORAGE_VERSION,
    messages: thread.messages,
    actions,
    usage: thread.usage,
    followUpsRequested: thread.followUpsRequested,
  });
}

/** Parses stored JSON; returns an empty thread for missing/corrupt data. */
export function deserializeThread(raw: string | null): ThreadState {
  if (!raw) return createEmptyThread();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    log.warn('discarding an unreadable assistant thread');
    return createEmptyThread();
  }
  const parsed = storedThreadSchema.safeParse(json);
  if (!parsed.success) {
    log.warn('discarding an assistant thread with an unknown format');
    return createEmptyThread();
  }

  const messages: ChatMessage[] = [];
  let dropped = 0;
  for (const item of parsed.data.messages) {
    const message = storedMessageSchema.safeParse(item);
    if (message.success) messages.push(message.data);
    else dropped += 1;
  }
  const actions: Record<string, ProposedActionState> = {};
  for (const [id, item] of Object.entries(parsed.data.actions)) {
    const action = storedActionSchema.safeParse(item);
    if (action.success && action.data.action.id === id) {
      actions[id] = { action: action.data.action, status: action.data.status, preview: null, result: reviveResult(action.data.result) };
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) log.warn('dropped invalid entries from the assistant thread', { dropped });
  // Messages may only reference actions that survived.
  const cleaned = messages.map((m) => ({ ...m, actionIds: m.actionIds.filter((id) => id in actions) }));
  return reviveThread({
    messages: cleaned,
    actions,
    usage: parsed.data.usage,
    followUpsRequested: parsed.data.followUpsRequested,
  });
}

export interface ThreadStore {
  load(uid: string): Promise<ThreadState>;
  save(uid: string, thread: ThreadState): Promise<void>;
  clear(uid: string): Promise<void>;
}

export function createThreadStore(storage: KeyValueStorage): ThreadStore {
  const key = (uid: string): string => userStorageKey(uid, USER_STORAGE.assistantThread);
  return {
    async load(uid) {
      return deserializeThread(await storage.getItem(key(uid)));
    },
    async save(uid, thread) {
      await storage.setItem(key(uid), serializeThread(thread));
    },
    async clear(uid) {
      await storage.removeItem(key(uid));
    },
  };
}
