/**
 * Mapping between stored documents (Firestore / AsyncStorage JSON) and domain objects. Pure.
 *
 * Reads are lenient and validated (zod via the core parsers); writes are strict: every document
 * written comes from a core builder, is re-validated, and must not contain `undefined`.
 * Documents in the pre-rebuild Firestore shape (snake_case, date/time strings, Timestamps,
 * "Manual"/"ChatGPT" sources, users/{uid}.preferences) are converted here.
 */
import { fromLegacyMeetingInput, fromLegacyPreferencesPatch } from './legacyInput';
import { AppError } from '../../core/errors';
import {
  buildMeeting,
  meetingSchema,
  noteSchema,
  parseMeetingDoc,
  parseNoteDoc,
  preferencesSchema,
  toMeetingDoc,
  userProfileSchema,
  type AuthUser,
  type Language,
  type Meeting,
  type MeetingDoc,
  type Note,
  type Preferences,
  type PreferencesPatch,
  type UserProfile,
} from '../../core/types';
import { findUndefinedPath, firstValidIso } from './util';

/** Stand-in instant for legacy documents without any timestamp (older than any real write). */
export const LEGACY_EPOCH = '2000-01-01T00:00:00.000Z';

export interface ReadContext {
  uid: string;
  /** Zone legacy date/time strings are interpreted in (the device zone). */
  timeZone: string;
  language: Language;
}

function assertWritable(value: unknown, what: string): void {
  const path = findUndefinedPath(value);
  if (path !== null) throw new AppError('invalid_input', `${what} contains undefined at ${path}`);
}

function canonicalIso(value: string): string {
  return new Date(value).toISOString();
}

/** Meeting -> Firestore/cache document (validated, no undefined, canonical instants). */
export function meetingToDoc(meeting: Meeting): MeetingDoc {
  const checked = meetingSchema.safeParse(meeting);
  if (!checked.success) throw new AppError('invalid_input', `Invalid meeting ${meeting.id}`, { cause: checked.error });
  const doc = toMeetingDoc(checked.data);
  assertWritable(doc, 'meeting');
  return doc;
}

export function noteToDoc(note: Note): Omit<Note, 'id'> {
  const checked = noteSchema.safeParse(note);
  if (!checked.success) throw new AppError('invalid_input', `Invalid note ${note.id}`, { cause: checked.error });
  const { id: _id, ...doc } = checked.data;
  assertWritable(doc, 'note');
  return doc;
}

export function preferencesToDoc(preferences: Preferences): Preferences {
  const checked = preferencesSchema.safeParse(preferences);
  if (!checked.success) throw new AppError('invalid_input', 'Invalid preferences', { cause: checked.error });
  assertWritable(checked.data, 'preferences');
  return checked.data;
}

function withCanonicalInstants(meeting: Meeting): Meeting {
  return {
    ...meeting,
    startAt: canonicalIso(meeting.startAt),
    createdAt: canonicalIso(meeting.createdAt),
    updatedAt: canonicalIso(meeting.updatedAt),
    deletedAt: meeting.deletedAt === null ? null : canonicalIso(meeting.deletedAt),
  };
}

/** Cached meeting document -> Meeting (null if invalid). */
export function readCachedMeeting(id: string, raw: unknown): Meeting | null {
  const parsed = parseMeetingDoc(id, raw);
  return parsed ? withCanonicalInstants(parsed) : null;
}

export type RemoteMeetingRead =
  /** Document in the current shape. */
  | { kind: 'current'; meeting: Meeting }
  /** Pre-rebuild shape converted in memory; the caller rewrites it (outbox "migrate"). */
  | { kind: 'legacy'; meeting: Meeting }
  | { kind: 'invalid' };

function isLegacyMeetingShape(raw: unknown): raw is Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return false;
  const record = raw as Record<string, unknown>;
  if (typeof record.startAt === 'string') return false;
  return typeof record.title === 'string' && ('date' in record || 'time' in record || 'startTime' in record);
}

/** Converts a pre-rebuild meeting record (Firestore or v1.0.9 local) into a Meeting with `id`. */
export function convertLegacyMeeting(id: string, raw: Record<string, unknown>, ctx: ReadContext): Meeting {
  const { input } = fromLegacyMeetingInput(raw, { timeZone: ctx.timeZone, language: ctx.language });
  const createdAt = firstValidIso(raw.created_date, raw.createdAt, raw.created_at) ?? LEGACY_EPOCH;
  const updatedAt = firstValidIso(raw.updated_date, raw.updatedAt, raw.updated_at) ?? createdAt;
  const built = buildMeeting(input, {
    id,
    userId: ctx.uid,
    now: updatedAt,
    defaultTimezone: ctx.timeZone,
    defaultLanguage: ctx.language,
  });
  const meeting: Meeting = { ...built, createdAt };
  const checked = meetingSchema.safeParse(meeting);
  if (!checked.success) throw new AppError('invalid_input', `Invalid legacy meeting ${id}`, { cause: checked.error });
  return checked.data;
}

/** Firestore meeting document -> Meeting. The path (users/{uid}) is authoritative for userId. */
export function readRemoteMeeting(id: string, raw: unknown, ctx: ReadContext): RemoteMeetingRead {
  const parsed = parseMeetingDoc(id, raw);
  if (parsed) {
    const meeting = withCanonicalInstants(parsed);
    return { kind: 'current', meeting: meeting.userId === ctx.uid ? meeting : { ...meeting, userId: ctx.uid } };
  }
  if (!isLegacyMeetingShape(raw)) return { kind: 'invalid' };
  try {
    return { kind: 'legacy', meeting: convertLegacyMeeting(id, raw, ctx) };
  } catch {
    return { kind: 'invalid' };
  }
}

export function readRemoteNote(id: string, raw: unknown): Note | null {
  return parseNoteDoc(id, raw);
}

/** Legacy users/{uid}.preferences map (snake_case) -> PreferencesPatch; null when absent. */
export function legacyPreferencesFromProfile(rawProfile: unknown): PreferencesPatch | null {
  if (typeof rawProfile !== 'object' || rawProfile === null) return null;
  const legacy = (rawProfile as Record<string, unknown>).preferences;
  if (typeof legacy !== 'object' || legacy === null) return null;
  const patch = fromLegacyPreferencesPatch(legacy);
  return Object.keys(patch).length > 0 ? patch : null;
}

function limitedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/** users/{uid} (current or legacy shape) -> UserProfile; null when absent or unusable. */
export function readRemoteProfile(uid: string, raw: unknown): UserProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const createdAt = firstValidIso(record.createdAt, record.created_at, record.created_date);
  const profile: UserProfile = {
    uid,
    email: limitedString(record.email, 254),
    displayName: limitedString(record.displayName, 200) ?? limitedString(record.name, 200),
    photoURL: limitedString(record.photoURL, 2048) ?? limitedString(record.picture, 2048),
    createdAt: createdAt ?? LEGACY_EPOCH,
    updatedAt: firstValidIso(record.updatedAt, record.updated_at) ?? createdAt ?? LEGACY_EPOCH,
    lastLoginAt: firstValidIso(record.lastLoginAt),
    legacyMigratedAt: firstValidIso(record.legacyMigratedAt),
  };
  const parsed = userProfileSchema.safeParse(profile);
  return parsed.success ? parsed.data : null;
}

/** Identity fields written by ensureProfile (never plan/role/subscription keys). */
export interface ProfileIdentityPatch {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  updatedAt: string;
  lastLoginAt: string;
}

export function profileIdentityPatch(user: AuthUser, nowIso: string): ProfileIdentityPatch {
  return {
    uid: user.uid,
    email: limitedString(user.email, 254),
    displayName: limitedString(user.displayName, 200),
    photoURL: limitedString(user.photoURL, 2048),
    updatedAt: nowIso,
    lastLoginAt: nowIso,
  };
}

/** Profile fields a client may write (Firestore rules reject SERVER_OWNED_PROFILE_KEYS). */
export const PROFILE_WRITABLE_KEYS = [
  'uid',
  'email',
  'displayName',
  'photoURL',
  'createdAt',
  'updatedAt',
  'lastLoginAt',
  'legacyMigratedAt',
] as const;

export function pickProfileWritable(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_WRITABLE_KEYS) {
    if (key in data && data[key] !== undefined) out[key] = data[key];
  }
  return out;
}
