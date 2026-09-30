/**
 * Deterministic document ids (pure).
 *
 * - Calendar imports get an id derived from the provider event, so importing the same event twice
 *   (retries, two devices, background + foreground) targets the same document instead of creating
 *   duplicates. Combined with the outbox "create" mode (create only if absent), a second importer
 *   never overwrites a meeting another device already created and the user edited.
 * - v1.0.9 local records become "legacy_<oldId>" so the migration is idempotent.
 */
import { MEETING_ID_PATTERN } from '../../core/aiContract';
import type { CalendarProvider } from '../../core/contracts';
import { AppError } from '../../core/errors';
import { stableHash } from './util';

const SAFE_ID_BODY = /^[A-Za-z0-9_-]+$/;
const MAX_ID_LENGTH = 128;

function buildId(prefix: string, body: string, hashInput: string): string {
  if (body.length > 0 && SAFE_ID_BODY.test(body) && prefix.length + body.length <= MAX_ID_LENGTH) {
    return `${prefix}${body}`;
  }
  return `${prefix}h${stableHash(hashInput)}`;
}

/**
 * Meeting id for an event imported from a calendar provider.
 * Google: "g_<eventId>" (event ids are unique in the primary calendar and never contain ':').
 * Device: "d_<calendarId>_<eventId>" or a hash when the ids contain other characters (iOS ids do).
 * Outlook: "o_<eventId>" or a hash (Graph ids are long/base64ish, so the hash path is the norm).
 */
export function externalMeetingId(provider: CalendarProvider, calendarId: string, externalId: string): string {
  if (externalId.length === 0) throw new AppError('invalid_input', 'External event id is empty');
  if (provider === 'google') {
    return buildId('g_', externalId, `google|${externalId}`);
  }
  if (provider === 'outlook') {
    return buildId('o_', externalId, `outlook|${externalId}`);
  }
  return buildId('d_', `${calendarId}_${externalId}`, `device|${calendarId}|${externalId}`);
}

/** Id of a meeting/note migrated from the v1.0.9 local database; null when there is no old id. */
export function legacyRecordId(oldId: unknown): string | null {
  let raw: string;
  if (typeof oldId === 'string') raw = oldId.trim();
  else if (typeof oldId === 'number' && Number.isFinite(oldId)) raw = String(oldId);
  else return null;
  if (raw.length === 0) return null;
  return buildId('legacy_', raw, `legacy|${raw}`);
}

export function isValidDocumentId(id: unknown): id is string {
  return typeof id === 'string' && MEETING_ID_PATTERN.test(id);
}

/** Firebase uids are alphanumeric; anything with ':' or '/' would break storage keys and paths. */
export function assertValidUid(uid: unknown): asserts uid is string {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new AppError('invalid_input', 'Invalid user id');
  }
}
