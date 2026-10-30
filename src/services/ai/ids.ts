/**
 * Local ids and idempotency keys for the assistant (pure; unit-tested).
 *
 * - Chat message ids and client action ids only need to be unique on this device.
 * - The idempotency key of an action combines its (client-unique) id with a hash of its whole
 *   content, so a re-used server id ("act_1" in two responses) can never be mistaken for an
 *   action that already ran, while a double tap on the same card always maps to the same key.
 * - Meetings created by the assistant get a deterministic id derived from that key, so a retried
 *   create (after a crash or a lost storage write) returns the same meeting instead of a duplicate
 *   (MeetingRepository.create with WriteOptions.id is idempotent).
 */
import { MEETING_ID_PATTERN, type AiAction } from '../../core/aiContract';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `<prefix><time base36><random base36>`; matches MEETING_ID_PATTERN when the prefix does. */
export function createLocalId(prefix: string, randomLength = 8): string {
  let random = '';
  for (let i = 0; i < randomLength; i += 1) {
    random += BASE36[Math.floor(Math.random() * BASE36.length)];
  }
  return `${prefix}${Date.now().toString(36)}${random}`;
}

/** JSON with object keys sorted recursively (undefined members dropped, like JSON.stringify). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${members.join(',')}}`;
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 14-character base36 content hash (two independent 32-bit FNV-1a passes). Not cryptographic. */
export function contentHash(value: unknown): string {
  const text = stableStringify(value);
  const first = fnv1a32(text, 0x811c9dc5).toString(36).padStart(7, '0');
  const second = fnv1a32(text, 0x9747b28c).toString(36).padStart(7, '0');
  return `${first}${second}`;
}

/** Idempotency key of an action: `<action.id>#<content hash>`. */
export function actionIdempotencyKey(action: AiAction): string {
  return `${action.id}#${contentHash(action)}`;
}

/**
 * Deterministic task id for a create_task action: a retry after a crash between the create and
 * its idempotency record finds the task instead of creating a second one. Same derivation as the
 * meeting id (tasks live in their own collection, so the two never collide).
 */
export function aiTaskIdForAction(action: AiAction): string {
  return aiMeetingIdForAction(action);
}

/** Deterministic meeting id for a create_meeting action (always matches MEETING_ID_PATTERN). */
export function aiMeetingIdForAction(action: AiAction): string {
  const safeId = action.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48);
  const id = `ai_${safeId}_${contentHash(action)}`;
  if (!MEETING_ID_PATTERN.test(id)) {
    // Unreachable with the sanitizing above; kept as a guard for future edits.
    throw new RangeError('Derived meeting id does not match MEETING_ID_PATTERN');
  }
  return id;
}
