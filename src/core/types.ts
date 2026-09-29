/**
 * Domain model (types + zod schemas + pure builders). Imports only zod and other pure core
 * modules; no React Native, Firebase or Expo code.
 *
 * Storage conventions (Firestore and the AsyncStorage cache use the same JSON shape):
 * - Every instant is an ISO-8601 UTC string from `toISOString()` (never a Firestore Timestamp).
 * - Optional values are stored as `null` (never `undefined`, never missing) so a patch can clear
 *   them with `null` and old documents parse with defaults.
 * - Meeting `date`/`time` are DERIVED from `startAt` + `timezone` (wall clock in the meeting's
 *   zone); writers must go through `buildMeeting` / `applyMeetingPatch` so they never drift.
 * - Documents never contain Google tokens; plan/entitlement/usage live in server-owned documents.
 */
import { z } from 'zod';

import {
  alertTimesSchema,
  conferenceDetailsSchema,
  durationMinutesSchema,
  emailSchema,
  isoDateTimeSchema,
  languageSchema,
  meetingIdSchema,
  meetingLocationSchema,
  planSchema,
  timeZoneSchema,
  type ConferenceDetails,
  type Language,
  type MeetingLocation,
  type Plan,
} from './aiContract';
import { AppError } from './errors';
import { isValidTimeZone, toDate, toLocalDateTime, type DateInput } from './time';

export {
  CONFERENCE_PROVIDERS,
  LANGUAGES,
  LOCATION_TYPES,
  PLANS,
  PLAN_DAILY_AI_LIMITS,
  alertTimesSchema,
  conferenceDetailsSchema,
  languageSchema,
  meetingIdSchema,
  meetingLocationSchema,
  planSchema,
  timeZoneSchema,
} from './aiContract';
export type { ConferenceDetails, ConferenceProvider, Language, LocationType, MeetingLocation, Plan } from './aiContract';

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const ALERT_INTENSITIES = ['max', 'medium', 'light'] as const;
export type AlertIntensity = (typeof ALERT_INTENSITIES)[number];

export const ALERT_SOUND_TYPES = ['voice_and_sound', 'voice_only', 'sound_only'] as const;
export type AlertSoundType = (typeof ALERT_SOUND_TYPES)[number];

/** Brief: ChatGPT -> ai_chat, WhatsApp -> whatsapp, Manual -> manual; imports: google, device. */
export const MEETING_SOURCES = ['manual', 'ai_chat', 'whatsapp', 'google', 'device'] as const;
export type MeetingSource = (typeof MEETING_SOURCES)[number];

export const MEETING_STATUSES = ['scheduled', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Mirrors Google Calendar attendee.responseStatus (needsAction -> needs_action). */
export const PARTICIPANT_STATUSES = ['needs_action', 'accepted', 'declined', 'tentative'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const NOTE_CATEGORIES = ['general', 'work', 'ideas', 'personal'] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export const ENTITLEMENT_STATUSES = ['active', 'grace_period', 'expired', 'revoked'] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const ENTITLEMENT_SOURCES = ['default', 'google_play', 'app_store', 'stripe', 'manual'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const DEFAULT_MEETING_DURATION_MINUTES = 60;
export const DEFAULT_ALERT_TIMES: readonly number[] = [15, 5, 0];
export const DEFAULT_SNOOZE_MINUTES = 5;

// ---------------------------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------------------------

export const alertIntensitySchema = z.enum(ALERT_INTENSITIES);
export const alertSoundTypeSchema = z.enum(ALERT_SOUND_TYPES);
export const meetingSourceSchema = z.enum(MEETING_SOURCES);
export const meetingStatusSchema = z.enum(MEETING_STATUSES);
export const participantStatusSchema = z.enum(PARTICIPANT_STATUSES);
export const noteCategorySchema = z.enum(NOTE_CATEGORIES);
export const entitlementStatusSchema = z.enum(ENTITLEMENT_STATUSES);
export const entitlementSourceSchema = z.enum(ENTITLEMENT_SOURCES);

/** Canonical stored instant: UTC with "Z" (as produced by toISOString()). */
export const utcIsoSchema = z.iso.datetime();
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const confidenceSchema = z.number().int().min(0).max(100);

// ---------------------------------------------------------------------------------------------
// Meeting
// ---------------------------------------------------------------------------------------------

export interface Participant {
  email: string;
  name: string | null;
  status: ParticipantStatus | null;
}

export const participantSchema = z.object({
  email: emailSchema,
  name: z.string().max(200).nullable(),
  status: participantStatusSchema.nullable(),
});

export interface ParticipantInput {
  email: string;
  name?: string | null;
  status?: ParticipantStatus | null;
}

export const participantInputSchema = z.object({
  email: emailSchema,
  name: z.string().max(200).nullable().optional(),
  status: participantStatusSchema.nullable().optional(),
});

/** Links to the same meeting in external calendars (never tokens). */
export interface ExternalRefs {
  googleEventId: string | null;
  googleCalendarId: string | null;
  googleEtag: string | null;
  /** Google `event.updated` of the last pulled/pushed version (conflict resolution). */
  googleUpdatedAt: string | null;
  deviceEventId: string | null;
  deviceCalendarId: string | null;
}

export const externalRefsSchema = z.object({
  googleEventId: z.string().min(1).max(1024).nullable(),
  googleCalendarId: z.string().min(1).max(1024).nullable(),
  googleEtag: z.string().max(256).nullable(),
  googleUpdatedAt: utcIsoSchema.nullable(),
  deviceEventId: z.string().min(1).max(512).nullable(),
  deviceCalendarId: z.string().min(1).max(512).nullable(),
});

export const EMPTY_EXTERNAL_REFS: Readonly<ExternalRefs> = Object.freeze({
  googleEventId: null,
  googleCalendarId: null,
  googleEtag: null,
  googleUpdatedAt: null,
  deviceEventId: null,
  deviceCalendarId: null,
});

export interface Meeting {
  id: string;
  userId: string;
  title: string;
  /** '' when empty. */
  description: string;
  /** Start instant, UTC ISO ("...Z"). For all-day meetings: local midnight of `timezone`. */
  startAt: string;
  /** Default 60. All-day: 1440 x days. */
  durationMinutes: number;
  /** IANA zone the meeting was scheduled in (user's zone at creation / calendar event zone). */
  timezone: string;
  allDay: boolean;
  /** DERIVED local date "YYYY-MM-DD" of startAt in `timezone` (legacy screens / queries). */
  date: string;
  /** DERIVED local time "HH:mm" of startAt in `timezone`. */
  time: string;
  location: MeetingLocation | null;
  conference: ConferenceDetails | null;
  participants: Participant[];
  source: MeetingSource;
  /** AI confidence 0-100 (null for manual/imported). */
  confidence: number | null;
  language: Language;
  preparationTips: string[];
  /** Minutes-before alert offsets; null = Preferences.defaultAlertTimes. */
  customAlertTimes: number[] | null;
  /** Per-meeting override of Preferences.alertIntensity. */
  alertIntensity: AlertIntensity | null;
  notes: string | null;
  /** `cancelled` = still visible, marked cancelled, no alerts. */
  status: MeetingStatus;
  external: ExternalRefs;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete tombstone (hidden everywhere, kept for sync). */
  deletedAt: string | null;
}

export const meetingSchema = z.object({
  id: meetingIdSchema,
  userId: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  description: z.string().max(4000),
  startAt: utcIsoSchema,
  durationMinutes: durationMinutesSchema,
  timezone: timeZoneSchema,
  allDay: z.boolean(),
  date: localDateSchema,
  time: localTimeSchema,
  location: meetingLocationSchema.nullable(),
  conference: conferenceDetailsSchema.nullable(),
  participants: z.array(participantSchema).max(100),
  source: meetingSourceSchema,
  confidence: confidenceSchema.nullable(),
  language: languageSchema,
  preparationTips: z.array(z.string().min(1).max(300)).max(20),
  customAlertTimes: alertTimesSchema.nullable(),
  alertIntensity: alertIntensitySchema.nullable(),
  notes: z.string().max(10_000).nullable(),
  status: meetingStatusSchema,
  external: externalRefsSchema,
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
  deletedAt: utcIsoSchema.nullable(),
});

/** Firestore document users/{uid}/meetings/{id}: the Meeting without `id` (the doc id). */
export type MeetingDoc = Omit<Meeting, 'id'>;

/** Payload to create a meeting. Omitted fields get defaults in `buildMeeting`. */
export interface MeetingCreateInput {
  title: string;
  /** ISO-8601 with Z or offset; normalized to UTC. Use zonedDateTimeToUtcIso() for date+time input. */
  startAt: string;
  source: MeetingSource;
  description?: string;
  /** Default 60. */
  durationMinutes?: number;
  /** Default: Preferences.timezone (device zone). */
  timezone?: string;
  allDay?: boolean;
  location?: MeetingLocation | null;
  conference?: ConferenceDetails | null;
  participants?: ParticipantInput[];
  confidence?: number | null;
  /** Default: current UI language. */
  language?: Language;
  preparationTips?: string[];
  customAlertTimes?: number[] | null;
  alertIntensity?: AlertIntensity | null;
  notes?: string | null;
  status?: MeetingStatus;
  external?: Partial<ExternalRefs>;
}

export const meetingCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startAt: isoDateTimeSchema,
  source: meetingSourceSchema,
  description: z.string().max(4000).optional(),
  durationMinutes: durationMinutesSchema.optional(),
  timezone: timeZoneSchema.optional(),
  allDay: z.boolean().optional(),
  location: meetingLocationSchema.nullable().optional(),
  conference: conferenceDetailsSchema.nullable().optional(),
  participants: z.array(participantInputSchema).max(100).optional(),
  confidence: confidenceSchema.nullable().optional(),
  language: languageSchema.optional(),
  preparationTips: z.array(z.string().max(300)).max(20).optional(),
  customAlertTimes: alertTimesSchema.nullable().optional(),
  alertIntensity: alertIntensitySchema.nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  status: meetingStatusSchema.optional(),
  external: externalRefsSchema.partial().optional(),
});

/**
 * Patch for an existing meeting: absent key = unchanged, `null` = clear (nullable fields only).
 * `external` is shallow-merged into the current refs. `source`, `userId`, timestamps are immutable.
 */
export type MeetingPatch = Partial<Omit<MeetingCreateInput, 'source'>>;

export const meetingPatchSchema = meetingCreateInputSchema.omit({ source: true }).partial();

export interface MeetingBuildContext {
  id: string;
  userId: string;
  now: DateInput;
  /** Used when input.timezone is absent (Preferences.timezone). */
  defaultTimezone: string;
  /** Used when input.language is absent (current UI language). */
  defaultLanguage: Language;
}

function zodToAppError(error: z.ZodError, what: string): AppError {
  return new AppError('invalid_input', `Invalid ${what}`, {
    cause: error,
    details: { issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) },
  });
}

function requireTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new AppError('invalid_input', `Unknown time zone: ${timeZone}`);
  }
  return timeZone;
}

function normalizeParticipants(list: readonly ParticipantInput[] | undefined): Participant[] {
  const byEmail = new Map<string, Participant>();
  for (const item of list ?? []) {
    const email = item.email.trim().toLowerCase();
    if (!byEmail.has(email)) {
      const name = item.name?.trim();
      byEmail.set(email, { email, name: name ? name : null, status: item.status ?? null });
    }
  }
  return [...byEmail.values()];
}

/** Dedupes and sorts alert offsets (largest first). */
export function normalizeAlertTimes(times: readonly number[]): number[] {
  return [...new Set(times)].sort((a, b) => b - a);
}

function normalizeTips(tips: readonly string[] | undefined): string[] {
  return (tips ?? []).map((tip) => tip.trim()).filter((tip) => tip.length > 0);
}

/** Builds a complete, validated Meeting from a create payload. Throws AppError('invalid_input'). */
export function buildMeeting(input: MeetingCreateInput, ctx: MeetingBuildContext): Meeting {
  const parsed = meetingCreateInputSchema.safeParse(input);
  if (!parsed.success) throw zodToAppError(parsed.error, 'meeting input');
  const value = parsed.data;
  const nowIso = toDate(ctx.now).toISOString();
  const timezone = requireTimeZone(value.timezone ?? ctx.defaultTimezone);
  const startAt = toDate(value.startAt).toISOString();
  const local = toLocalDateTime(startAt, timezone);

  const meeting: Meeting = {
    id: ctx.id,
    userId: ctx.userId,
    title: value.title,
    description: value.description ?? '',
    startAt,
    durationMinutes: value.durationMinutes ?? DEFAULT_MEETING_DURATION_MINUTES,
    timezone,
    allDay: value.allDay ?? false,
    date: local.date,
    time: local.time,
    location: value.location ?? null,
    conference: value.conference ?? null,
    participants: normalizeParticipants(value.participants),
    source: value.source,
    confidence: value.confidence ?? null,
    language: value.language ?? ctx.defaultLanguage,
    preparationTips: normalizeTips(value.preparationTips),
    customAlertTimes: value.customAlertTimes ? normalizeAlertTimes(value.customAlertTimes) : null,
    alertIntensity: value.alertIntensity ?? null,
    notes: value.notes ?? null,
    status: value.status ?? 'scheduled',
    external: { ...EMPTY_EXTERNAL_REFS, ...(value.external ?? {}) },
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };
  const checked = meetingSchema.safeParse(meeting);
  if (!checked.success) throw zodToAppError(checked.error, 'meeting');
  return checked.data;
}

/** Applies a patch (recomputes date/time, merges external refs, bumps updatedAt). Pure. */
export function applyMeetingPatch(meeting: Meeting, patch: MeetingPatch, now: DateInput): Meeting {
  const parsed = meetingPatchSchema.safeParse(patch);
  if (!parsed.success) throw zodToAppError(parsed.error, 'meeting patch');
  const value = parsed.data;

  const timezone = value.timezone !== undefined ? requireTimeZone(value.timezone) : meeting.timezone;
  const startAt = value.startAt !== undefined ? toDate(value.startAt).toISOString() : meeting.startAt;
  const local = toLocalDateTime(startAt, timezone);

  const next: Meeting = {
    ...meeting,
    title: value.title ?? meeting.title,
    description: value.description ?? meeting.description,
    startAt,
    durationMinutes: value.durationMinutes ?? meeting.durationMinutes,
    timezone,
    allDay: value.allDay ?? meeting.allDay,
    date: local.date,
    time: local.time,
    location: value.location !== undefined ? value.location : meeting.location,
    conference: value.conference !== undefined ? value.conference : meeting.conference,
    participants: value.participants !== undefined ? normalizeParticipants(value.participants) : meeting.participants,
    confidence: value.confidence !== undefined ? value.confidence : meeting.confidence,
    language: value.language ?? meeting.language,
    preparationTips: value.preparationTips !== undefined ? normalizeTips(value.preparationTips) : meeting.preparationTips,
    customAlertTimes:
      value.customAlertTimes !== undefined
        ? value.customAlertTimes === null
          ? null
          : normalizeAlertTimes(value.customAlertTimes)
        : meeting.customAlertTimes,
    alertIntensity: value.alertIntensity !== undefined ? value.alertIntensity : meeting.alertIntensity,
    notes: value.notes !== undefined ? value.notes : meeting.notes,
    status: value.status ?? meeting.status,
    external: { ...meeting.external, ...(value.external ?? {}) },
    updatedAt: toDate(now).toISOString(),
  };
  const checked = meetingSchema.safeParse(next);
  if (!checked.success) throw zodToAppError(checked.error, 'meeting');
  return checked.data;
}

/** Marks a meeting deleted (tombstone). Pure. */
export function tombstoneMeeting(meeting: Meeting, now: DateInput): Meeting {
  const nowIso = toDate(now).toISOString();
  return { ...meeting, deletedAt: nowIso, updatedAt: nowIso };
}

/** Firestore/cache document shape for a meeting (drops `id`). */
export function toMeetingDoc(meeting: Meeting): MeetingDoc {
  const { id: _id, ...doc } = meeting;
  return doc;
}

const meetingDocReadSchema = meetingSchema.omit({ id: true, date: true, time: true }).extend({
  description: z.string().max(4000).default(''),
  durationMinutes: durationMinutesSchema.default(DEFAULT_MEETING_DURATION_MINUTES),
  allDay: z.boolean().default(false),
  date: localDateSchema.optional(),
  time: localTimeSchema.optional(),
  location: meetingLocationSchema.nullable().default(null),
  conference: conferenceDetailsSchema.nullable().default(null),
  participants: z.array(participantSchema).max(100).default([]),
  confidence: confidenceSchema.nullable().default(null),
  language: languageSchema.default('en'),
  preparationTips: z.array(z.string().min(1).max(300)).max(20).default([]),
  customAlertTimes: alertTimesSchema.nullable().default(null),
  alertIntensity: alertIntensitySchema.nullable().default(null),
  notes: z.string().max(10_000).nullable().default(null),
  status: meetingStatusSchema.default('scheduled'),
  external: externalRefsSchema
    .partial()
    .default({})
    .transform((refs): ExternalRefs => ({ ...EMPTY_EXTERNAL_REFS, ...refs })),
  deletedAt: utcIsoSchema.nullable().default(null),
});

/**
 * Parses a stored meeting document (Firestore or cache). Missing optional fields get defaults;
 * returns null for documents that are not valid meetings (callers log the id and skip it).
 * date/time are re-derived from startAt + timezone.
 */
export function parseMeetingDoc(id: string, raw: unknown): Meeting | null {
  if (!meetingIdSchema.safeParse(id).success) return null;
  const parsed = meetingDocReadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const doc = parsed.data;
  let date = doc.date;
  let time = doc.time;
  if (isValidTimeZone(doc.timezone)) {
    const local = toLocalDateTime(doc.startAt, doc.timezone);
    date = local.date;
    time = local.time;
  }
  if (date === undefined || time === undefined) {
    const local = toLocalDateTime(doc.startAt, 'UTC');
    date = date ?? local.date;
    time = time ?? local.time;
  }
  return { ...doc, id, date, time };
}

/** Meetings that are visible (not tombstoned). */
export function isActiveMeeting(meeting: Meeting): boolean {
  return meeting.deletedAt === null;
}

// ---------------------------------------------------------------------------------------------
// Preferences (users/{uid}/settings/preferences)
// ---------------------------------------------------------------------------------------------

export interface Preferences {
  language: Language;
  timezone: string;
  alertEnabled: boolean;
  alertIntensity: AlertIntensity;
  alertSoundType: AlertSoundType;
  /** 0..1 */
  alertVolume: number;
  vibrationEnabled: boolean;
  /** Minutes-before offsets used when a meeting has no customAlertTimes. */
  defaultAlertTimes: number[];
  snoozeMinutes: number;
  /** Post-meeting follow-up notification (end + 5 min) opening the assistant. */
  followUpEnabled: boolean;
  /** null = locale default (expo-localization uses24hourClock). */
  use24HourClock: boolean | null;
  onboardingCompleted: boolean;
  googleCalendarSyncEnabled: boolean;
  /** Device calendar ids to import from (device-specific; unknown ids are ignored). */
  deviceCalendarImportIds: string[];
  /** Device calendar that receives exported MeetingGuard meetings (null = no export). */
  deviceCalendarExportId: string | null;
  updatedAt: string | null;
}

export const preferencesSchema = z.object({
  language: languageSchema,
  timezone: timeZoneSchema,
  alertEnabled: z.boolean(),
  alertIntensity: alertIntensitySchema,
  alertSoundType: alertSoundTypeSchema,
  alertVolume: z.number().min(0).max(1),
  vibrationEnabled: z.boolean(),
  defaultAlertTimes: alertTimesSchema,
  snoozeMinutes: z.number().int().min(1).max(60),
  followUpEnabled: z.boolean(),
  use24HourClock: z.boolean().nullable(),
  onboardingCompleted: z.boolean(),
  googleCalendarSyncEnabled: z.boolean(),
  deviceCalendarImportIds: z.array(z.string().min(1).max(512)).max(50),
  deviceCalendarExportId: z.string().min(1).max(512).nullable(),
  updatedAt: utcIsoSchema.nullable(),
});

export type PreferencesPatch = Partial<Omit<Preferences, 'updatedAt'>>;
export const preferencesPatchSchema = preferencesSchema.omit({ updatedAt: true }).partial();
export type PreferenceKey = keyof Omit<Preferences, 'updatedAt'>;

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  language: 'en',
  timezone: 'UTC',
  alertEnabled: true,
  alertIntensity: 'max',
  alertSoundType: 'voice_and_sound',
  alertVolume: 0.8,
  vibrationEnabled: true,
  defaultAlertTimes: [...DEFAULT_ALERT_TIMES],
  snoozeMinutes: DEFAULT_SNOOZE_MINUTES,
  followUpEnabled: true,
  use24HourClock: null,
  onboardingCompleted: false,
  googleCalendarSyncEnabled: false,
  deviceCalendarImportIds: [],
  deviceCalendarExportId: null,
  updatedAt: null,
} satisfies Preferences);

/** Defaults for a new user on this device (language/timezone from the device). */
export function createDefaultPreferences(overrides: Partial<Pick<Preferences, 'language' | 'timezone'>> = {}): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    defaultAlertTimes: [...DEFAULT_PREFERENCES.defaultAlertTimes],
    deviceCalendarImportIds: [],
    ...overrides,
  };
}

/**
 * Merges a stored preferences document over defaults FIELD BY FIELD: an invalid or missing field
 * falls back to its default without resetting the others.
 */
export function mergePreferences(stored: unknown, defaults: Preferences = createDefaultPreferences()): Preferences {
  const result: Preferences = { ...defaults };
  if (typeof stored !== 'object' || stored === null) return result;
  const record = stored as Record<string, unknown>;
  const shape = preferencesSchema.shape;
  (Object.keys(shape) as (keyof Preferences)[]).forEach((key) => {
    if (!(key in record)) return;
    const parsed = shape[key].safeParse(record[key]);
    if (parsed.success) {
      (result as unknown as Record<string, unknown>)[key] = parsed.data;
    }
  });
  result.defaultAlertTimes = normalizeAlertTimes(result.defaultAlertTimes);
  return result;
}

/** Validates and applies a patch; returns the new preferences and the keys that changed. */
export function applyPreferencesPatch(
  prefs: Preferences,
  patch: PreferencesPatch,
  now: DateInput,
): { preferences: Preferences; changedKeys: PreferenceKey[] } {
  const parsed = preferencesPatchSchema.safeParse(patch);
  if (!parsed.success) throw zodToAppError(parsed.error, 'preferences patch');
  const next: Preferences = { ...prefs, ...parsed.data, updatedAt: toDate(now).toISOString() };
  next.defaultAlertTimes = normalizeAlertTimes(next.defaultAlertTimes);
  const changedKeys = (Object.keys(parsed.data) as PreferenceKey[]).filter(
    (key) => JSON.stringify(prefs[key]) !== JSON.stringify(next[key]),
  );
  return { preferences: next, changedKeys };
}

// ---------------------------------------------------------------------------------------------
// User profile (users/{uid}) - NO plan / subscription / role fields (server-owned elsewhere)
// ---------------------------------------------------------------------------------------------

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  /** Set once the v1.0.9 local data migration ran for this user on some device. */
  legacyMigratedAt: string | null;
}

export const userProfileSchema = z.object({
  uid: z.string().min(1).max(128),
  email: z.string().max(254).nullable(),
  displayName: z.string().max(200).nullable(),
  photoURL: z.string().max(2048).nullable(),
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
  lastLoginAt: utcIsoSchema.nullable(),
  legacyMigratedAt: utcIsoSchema.nullable(),
});

/** Keys clients must never write to users/{uid} (Firestore rules reject them). */
export const SERVER_OWNED_PROFILE_KEYS = [
  'plan',
  'subscription',
  'subscriptionStatus',
  'subscription_status',
  'role',
  'roles',
  'admin',
  'isAdmin',
  'enabled',
  'disabled',
  'entitlement',
  'entitlements',
  'usage',
] as const;

// ---------------------------------------------------------------------------------------------
// Entitlement (entitlements/{uid}) - server-owned, read-only on the client
// ---------------------------------------------------------------------------------------------

export interface Entitlement {
  plan: Plan;
  status: EntitlementStatus;
  expiresAt: string | null;
  source: EntitlementSource;
  updatedAt: string | null;
}

export const entitlementSchema = z.object({
  plan: planSchema,
  status: entitlementStatusSchema,
  expiresAt: utcIsoSchema.nullable(),
  source: entitlementSourceSchema,
  updatedAt: utcIsoSchema.nullable(),
});

export const DEFAULT_ENTITLEMENT: Readonly<Entitlement> = Object.freeze({
  plan: 'free',
  status: 'active',
  expiresAt: null,
  source: 'default',
  updatedAt: null,
} satisfies Entitlement);

/** Missing document => free. Invalid document => null (caller logs and treats as free). */
export function parseEntitlementDoc(raw: unknown): Entitlement | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_ENTITLEMENT };
  const parsed = entitlementSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Plan in effect now (expired/revoked or past expiresAt => free). */
export function effectivePlan(entitlement: Entitlement, now: DateInput = new Date()): Plan {
  if (entitlement.status === 'expired' || entitlement.status === 'revoked') return 'free';
  if (entitlement.expiresAt !== null && toDate(entitlement.expiresAt).getTime() <= toDate(now).getTime()) {
    return 'free';
  }
  return entitlement.plan;
}

// ---------------------------------------------------------------------------------------------
// Notes (users/{uid}/notes/{id}) - hard delete
// ---------------------------------------------------------------------------------------------

export interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  category: NoteCategory;
  /** Optional link to a meeting. */
  meetingId: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export const noteSchema = z.object({
  id: meetingIdSchema,
  userId: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  content: z.string().max(20_000),
  category: noteCategorySchema,
  meetingId: meetingIdSchema.nullable(),
  pinned: z.boolean(),
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
});

export interface NoteInput {
  title: string;
  content?: string;
  category?: NoteCategory;
  meetingId?: string | null;
  pinned?: boolean;
}

export const noteInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(20_000).optional(),
  category: noteCategorySchema.optional(),
  meetingId: meetingIdSchema.nullable().optional(),
  pinned: z.boolean().optional(),
});

export type NotePatch = Partial<NoteInput>;
export const notePatchSchema = noteInputSchema.partial();

export function buildNote(input: NoteInput, ctx: { id: string; userId: string; now: DateInput }): Note {
  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) throw zodToAppError(parsed.error, 'note input');
  const nowIso = toDate(ctx.now).toISOString();
  const note: Note = {
    id: ctx.id,
    userId: ctx.userId,
    title: parsed.data.title,
    content: parsed.data.content ?? '',
    category: parsed.data.category ?? 'general',
    meetingId: parsed.data.meetingId ?? null,
    pinned: parsed.data.pinned ?? false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const checked = noteSchema.safeParse(note);
  if (!checked.success) throw zodToAppError(checked.error, 'note');
  return checked.data;
}

export function applyNotePatch(note: Note, patch: NotePatch, now: DateInput): Note {
  const parsed = notePatchSchema.safeParse(patch);
  if (!parsed.success) throw zodToAppError(parsed.error, 'note patch');
  const v = parsed.data;
  return {
    ...note,
    title: v.title ?? note.title,
    content: v.content ?? note.content,
    category: v.category ?? note.category,
    meetingId: v.meetingId !== undefined ? v.meetingId : note.meetingId,
    pinned: v.pinned ?? note.pinned,
    updatedAt: toDate(now).toISOString(),
  };
}

const noteDocReadSchema = noteSchema.omit({ id: true }).extend({
  content: z.string().max(20_000).default(''),
  category: noteCategorySchema.default('general'),
  meetingId: meetingIdSchema.nullable().default(null),
  pinned: z.boolean().default(false),
});

export function parseNoteDoc(id: string, raw: unknown): Note | null {
  if (!meetingIdSchema.safeParse(id).success) return null;
  const parsed = noteDocReadSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, id } : null;
}

// ---------------------------------------------------------------------------------------------
// Auth user (from Firebase Auth; not stored as-is)
// ---------------------------------------------------------------------------------------------

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  /** Firebase providerData ids, e.g. ["google.com"]. */
  providerIds: string[];
}
