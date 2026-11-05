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
import {
  meetingRecurrenceSchema,
  recurrenceOverridesSchema,
  type MeetingRecurrence,
  type RecurrenceOverrides,
} from './recurrence';
import { isValidTimeZone, toDate, toLocalDateTime, type DateInput } from './time';

export {
  CONFERENCE_PROVIDERS,
  LANGUAGES,
  LOCATION_TYPES,
  PLANS,
  PLAN_AI_LIMITS,
  alertTimesSchema,
  conferenceDetailsSchema,
  languageSchema,
  meetingIdSchema,
  meetingLocationSchema,
  planSchema,
  timeZoneSchema,
} from './aiContract';
export type { ConferenceDetails, ConferenceProvider, Language, LocationType, MeetingLocation, Plan } from './aiContract';
export {
  CANCELLED_OVERRIDE,
  RECURRENCE_EDIT_SCOPES,
  RECURRENCE_FREQS,
  RECURRENCE_WEEKDAYS,
  meetingRecurrenceSchema,
  recurrenceOverrideSchema,
  recurrenceOverridesSchema,
  withRecurrenceOverride,
} from './recurrence';
export type {
  MeetingRecurrence,
  RecurrenceEditScope,
  RecurrenceFreq,
  RecurrenceOverride,
  RecurrenceOverrides,
  RecurrenceWeekday,
} from './recurrence';

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const ALERT_INTENSITIES = ['max', 'medium', 'light'] as const;
export type AlertIntensity = (typeof ALERT_INTENSITIES)[number];

export const ALERT_SOUND_TYPES = ['voice_and_sound', 'voice_only', 'sound_only'] as const;
export type AlertSoundType = (typeof ALERT_SOUND_TYPES)[number];

/** Brief: ChatGPT -> ai_chat, WhatsApp -> whatsapp, Manual -> manual; imports: google, device, outlook. */
export const MEETING_SOURCES = ['manual', 'ai_chat', 'whatsapp', 'google', 'device', 'outlook'] as const;
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

/**
 * Who wrote the entitlement: 'revenuecat' = the RevenueCat webhook (functions/src/revenuecat,
 * §20), 'admin' = an admin callable (functions/src/admin, §21). Both write via the Admin SDK;
 * the client only ever reads. The store-specific values predate RevenueCat and stay parseable.
 */
export const ENTITLEMENT_SOURCES = ['default', 'google_play', 'app_store', 'stripe', 'manual', 'revenuecat', 'admin'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const DEFAULT_MEETING_DURATION_MINUTES = 60;
export const DEFAULT_ALERT_TIMES: readonly number[] = [15, 5, 0];
export const DEFAULT_SNOOZE_MINUTES = 5;
/** When the daily briefing fires once the user turns it on (device-local wall clock). */
export const DEFAULT_BRIEFING_TIME = '08:00';

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
  /** Microsoft Graph event id (Outlook sync; see docs/v1/ARCHITECTURE.md §17). */
  outlookEventId: string | null;
  outlookCalendarId: string | null;
  /** Graph `changeKey` of the last pulled/pushed version. */
  outlookChangeKey: string | null;
  /** Graph `lastModifiedDateTime` of the last pulled/pushed version (conflict resolution). */
  outlookUpdatedAt: string | null;
  /**
   * Zoom's numeric meeting id as a string (zoomCreateMeeting wrote conference.url for it; see
   * docs/v1/ARCHITECTURE.md §24). Written server-side via the Admin SDK; stored sparsely like the
   * outlook keys.
   */
  zoomMeetingId: string | null;
}

export const externalRefsSchema = z.object({
  googleEventId: z.string().min(1).max(1024).nullable(),
  googleCalendarId: z.string().min(1).max(1024).nullable(),
  googleEtag: z.string().max(256).nullable(),
  googleUpdatedAt: utcIsoSchema.nullable(),
  deviceEventId: z.string().min(1).max(512).nullable(),
  deviceCalendarId: z.string().min(1).max(512).nullable(),
  outlookEventId: z.string().min(1).max(512).nullable(),
  outlookCalendarId: z.string().min(1).max(512).nullable(),
  outlookChangeKey: z.string().max(256).nullable(),
  outlookUpdatedAt: utcIsoSchema.nullable(),
  zoomMeetingId: z.string().min(1).max(64).nullable(),
});

export const EMPTY_EXTERNAL_REFS: Readonly<ExternalRefs> = Object.freeze({
  googleEventId: null,
  googleCalendarId: null,
  googleEtag: null,
  googleUpdatedAt: null,
  deviceEventId: null,
  deviceCalendarId: null,
  outlookEventId: null,
  outlookCalendarId: null,
  outlookChangeKey: null,
  outlookUpdatedAt: null,
  zoomMeetingId: null,
});

/**
 * Fields added after the v1.1 rules deploy. They are serialized SPARSELY: `toMeetingDoc` leaves
 * them out when null, so documents written by this app version keep passing the LIVE Firestore
 * rules until the updated rules (which allow the keys) are deployed, and unchanged meetings keep
 * their exact stored shape. `parseMeetingDoc` fills nulls back in.
 */
export const SPARSE_MEETING_KEYS = ['recurrence', 'recurrenceOverrides', 'seriesId'] as const;
export const SPARSE_EXTERNAL_KEYS = [
  'outlookEventId',
  'outlookCalendarId',
  'outlookChangeKey',
  'outlookUpdatedAt',
  'zoomMeetingId',
] as const;

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
  /** DERIVED local date "YYYY-MM-DD" of startAt in `timezone` (all-day meetings, queries). */
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
  /**
   * Repeat rule (null = one-off). The meeting itself is the series master and first occurrence;
   * occurrences are expanded, never stored (src/core/recurrence.ts, ARCHITECTURE §16).
   */
  recurrence: MeetingRecurrence | null;
  /** Per-occurrence exceptions keyed by the ORIGINAL occurrence date in `timezone`; null = none. */
  recurrenceOverrides: RecurrenceOverrides | null;
  /** Stable series identity (= the master's id in v1); null for one-off meetings. */
  seriesId: string | null;
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
  recurrence: meetingRecurrenceSchema.nullable(),
  recurrenceOverrides: recurrenceOverridesSchema.nullable(),
  seriesId: meetingIdSchema.nullable(),
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
  deletedAt: utcIsoSchema.nullable(),
});

type SparseMeetingKey = (typeof SPARSE_MEETING_KEYS)[number];
type SparseExternalKey = (typeof SPARSE_EXTERNAL_KEYS)[number];

/** ExternalRefs as stored: the Outlook keys are left out while null (SPARSE_EXTERNAL_KEYS). */
export type ExternalRefsDoc = Omit<ExternalRefs, SparseExternalKey> & Partial<Pick<ExternalRefs, SparseExternalKey>>;

/**
 * Firestore document users/{uid}/meetings/{id}: the Meeting without `id` (the doc id).
 * The post-v1.1 fields (SPARSE_MEETING_KEYS / SPARSE_EXTERNAL_KEYS) are left out while null.
 */
export type MeetingDoc = Omit<Meeting, 'id' | 'external' | SparseMeetingKey> &
  Partial<Pick<Meeting, SparseMeetingKey>> & { external: ExternalRefsDoc };

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
  /** Repeat rule; null/absent = one-off. */
  recurrence?: MeetingRecurrence | null;
  /** Only meaningful with `recurrence` (calendar imports carry cancelled occurrences here). */
  recurrenceOverrides?: RecurrenceOverrides | null;
  /** Default: the meeting's own id when `recurrence` is set. Create-only (not patchable). */
  seriesId?: string | null;
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
  recurrence: meetingRecurrenceSchema.nullable().optional(),
  recurrenceOverrides: recurrenceOverridesSchema.nullable().optional(),
  seriesId: meetingIdSchema.nullable().optional(),
});

/**
 * Patch for an existing meeting: absent key = unchanged, `null` = clear (nullable fields only).
 * `external` is shallow-merged into the current refs. `source`, `userId`, `seriesId` and the
 * timestamps are immutable. Clearing `recurrence` also clears `recurrenceOverrides`.
 */
export type MeetingPatch = Partial<Omit<MeetingCreateInput, 'source' | 'seriesId'>>;

export const meetingPatchSchema = meetingCreateInputSchema.omit({ source: true, seriesId: true }).partial();

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
    recurrence: value.recurrence ?? null,
    // Overrides without a rule are meaningless; drop them instead of storing dead data.
    recurrenceOverrides: (value.recurrence ?? null) !== null ? (value.recurrenceOverrides ?? null) : null,
    seriesId: value.seriesId ?? ((value.recurrence ?? null) !== null ? ctx.id : null),
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
    recurrence: value.recurrence !== undefined ? value.recurrence : meeting.recurrence,
    recurrenceOverrides:
      value.recurrenceOverrides !== undefined ? value.recurrenceOverrides : meeting.recurrenceOverrides,
    updatedAt: toDate(now).toISOString(),
  };
  if (next.recurrence === null) {
    next.recurrenceOverrides = null;
  } else if (meeting.recurrence === null && next.seriesId === null) {
    // A one-off upgraded to a series gets its series identity now.
    next.seriesId = meeting.id;
  }
  const checked = meetingSchema.safeParse(next);
  if (!checked.success) throw zodToAppError(checked.error, 'meeting');
  return checked.data;
}

/** Title stored in tombstones (the rules require a non-empty title; the real one is dropped). */
export const TOMBSTONE_TITLE = 'Deleted meeting';

/** How long tombstones are kept before they are hard-deleted (every device has synced them). */
export const TOMBSTONE_RETENTION_DAYS = 60;

/**
 * The meeting without its content: only what sync needs stays (ids, source, status, time slot,
 * external refs, timestamps). Title, description, notes, participants (third-party emails),
 * conference link/password, location, tips and alert settings are dropped. Pure.
 */
export function scrubMeetingContent(meeting: Meeting): Meeting {
  return {
    ...meeting,
    title: TOMBSTONE_TITLE,
    description: '',
    location: null,
    conference: null,
    participants: [],
    preparationTips: [],
    customAlertTimes: null,
    alertIntensity: null,
    notes: null,
    confidence: null,
    // The rule itself is not needed for sync (deletes go by event id) and overrides may carry
    // per-occurrence titles; seriesId (an id) is kept.
    recurrence: null,
    recurrenceOverrides: null,
  };
}

/** True for a tombstone that still carries content (written before tombstones were scrubbed). */
export function tombstoneHasContent(meeting: Meeting): boolean {
  if (meeting.deletedAt === null) return false;
  return !deepEqualShallowMeeting(meeting, scrubMeetingContent(meeting));
}

function deepEqualShallowMeeting(a: Meeting, b: Meeting): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.location === b.location &&
    a.conference === b.conference &&
    a.participants.length === b.participants.length &&
    a.preparationTips.length === b.preparationTips.length &&
    a.customAlertTimes === b.customAlertTimes &&
    a.alertIntensity === b.alertIntensity &&
    a.notes === b.notes &&
    a.confidence === b.confidence &&
    a.recurrence === b.recurrence &&
    a.recurrenceOverrides === b.recurrenceOverrides
  );
}

/**
 * Marks a meeting deleted (tombstone) and scrubs its content: a user who deletes a meeting
 * because it held sensitive data (a meeting password, third-party emails) must not keep it on
 * the server and on every device. Pure.
 */
export function tombstoneMeeting(meeting: Meeting, now: DateInput): Meeting {
  const nowIso = toDate(now).toISOString();
  return { ...scrubMeetingContent(meeting), deletedAt: nowIso, updatedAt: nowIso };
}

/**
 * Firestore/cache document shape for a meeting (drops `id`). Post-v1.1 fields are left out while
 * null (SPARSE_MEETING_KEYS / SPARSE_EXTERNAL_KEYS): see their doc comment.
 */
export function toMeetingDoc(meeting: Meeting): MeetingDoc {
  const { id: _id, ...doc } = meeting;
  const sparse: MeetingDoc = { ...doc, external: { ...doc.external } };
  for (const key of SPARSE_MEETING_KEYS) {
    if (sparse[key] === null) delete sparse[key];
  }
  for (const key of SPARSE_EXTERNAL_KEYS) {
    if (sparse.external[key] === null) delete sparse.external[key];
  }
  return sparse;
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
  recurrence: meetingRecurrenceSchema.nullable().default(null),
  recurrenceOverrides: recurrenceOverridesSchema.nullable().default(null),
  seriesId: meetingIdSchema.nullable().default(null),
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
  // Overrides without a rule (a rule cleared by an older client) are dead data: drop them.
  const recurrenceOverrides = doc.recurrence !== null ? doc.recurrenceOverrides : null;
  return { ...doc, id, date, time, recurrenceOverrides };
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
  /**
   * Intensity for meetings imported from a phone, Google or Outlook calendar (birthdays,
   * holidays, invitations) when the meeting has no override of its own; null = the same as
   * alertIntensity. All-day events never ring regardless. Client feedback, Oct 28 2026.
   */
  importedAlertIntensity: AlertIntensity | null;
  alertSoundType: AlertSoundType;
  /** 0..1 */
  alertVolume: number;
  vibrationEnabled: boolean;
  /** Minutes-before offsets used when a meeting has no customAlertTimes. */
  defaultAlertTimes: number[];
  snoozeMinutes: number;
  /** Post-meeting follow-up notification (end + 5 min) opening the assistant. */
  followUpEnabled: boolean;
  /** Optional once-a-day agenda notification (V2 Stage 1, week 4). Off until the user asks. */
  briefingEnabled: boolean;
  /** Local time of day "HH:mm" the briefing fires at, in the DEVICE zone. */
  briefingTime: string;
  /** Permanent silent notification showing that alerts are armed and the next meeting. */
  statusNotificationEnabled: boolean;
  /**
   * When the daily briefing fires, take over the screen like a meeting alarm instead of a quiet
   * notification (V2 week 5). Android only: iOS and devices without the full-screen alarm module,
   * or without the full-screen permission, always get the notification. Off until the user asks.
   */
  briefingFullScreen: boolean;
  /** null = locale default (expo-localization uses24hourClock). */
  use24HourClock: boolean | null;
  onboardingCompleted: boolean;
  googleCalendarSyncEnabled: boolean;
  /** Device calendar ids to import from (device-specific; unknown ids are ignored). */
  deviceCalendarImportIds: string[];
  /** Device calendar that receives exported Meeting Guard meetings (null = no export). */
  deviceCalendarExportId: string | null;
  /**
   * Microsoft To Do list that receives new tasks (M7). The name is cached so the task confirm
   * card can show "List: Work" without a network call; null = not chosen (To Do sync stays off).
   */
  todoListId: string | null;
  todoListName: string | null;
  /** Google Tasks list that receives new tasks (M8); same convention as the To Do pair. */
  gtasksListId: string | null;
  gtasksListName: string | null;
  updatedAt: string | null;
}

export const preferencesSchema = z.object({
  language: languageSchema,
  timezone: timeZoneSchema,
  alertEnabled: z.boolean(),
  alertIntensity: alertIntensitySchema,
  importedAlertIntensity: alertIntensitySchema.nullable(),
  alertSoundType: alertSoundTypeSchema,
  alertVolume: z.number().min(0).max(1),
  vibrationEnabled: z.boolean(),
  defaultAlertTimes: alertTimesSchema,
  snoozeMinutes: z.number().int().min(1).max(60),
  followUpEnabled: z.boolean(),
  briefingEnabled: z.boolean(),
  briefingTime: localTimeSchema,
  statusNotificationEnabled: z.boolean(),
  briefingFullScreen: z.boolean(),
  use24HourClock: z.boolean().nullable(),
  onboardingCompleted: z.boolean(),
  googleCalendarSyncEnabled: z.boolean(),
  deviceCalendarImportIds: z.array(z.string().min(1).max(512)).max(50),
  deviceCalendarExportId: z.string().min(1).max(512).nullable(),
  todoListId: z.string().min(1).max(512).nullable(),
  todoListName: z.string().min(1).max(256).nullable(),
  gtasksListId: z.string().min(1).max(512).nullable(),
  gtasksListName: z.string().min(1).max(256).nullable(),
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
  importedAlertIntensity: null,
  alertSoundType: 'voice_and_sound',
  alertVolume: 0.8,
  vibrationEnabled: true,
  defaultAlertTimes: [...DEFAULT_ALERT_TIMES],
  snoozeMinutes: DEFAULT_SNOOZE_MINUTES,
  followUpEnabled: true,
  briefingEnabled: false,
  briefingTime: DEFAULT_BRIEFING_TIME,
  statusNotificationEnabled: false,
  briefingFullScreen: false,
  use24HourClock: null,
  onboardingCompleted: false,
  googleCalendarSyncEnabled: false,
  deviceCalendarImportIds: [],
  deviceCalendarExportId: null,
  todoListId: null,
  todoListName: null,
  gtasksListId: null,
  gtasksListName: null,
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
// Tasks (users/{uid}/tasks/{id}) - hard delete (V2 Stage 1; Microsoft To Do sync in Stage 2, M7)
// ---------------------------------------------------------------------------------------------

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);

/**
 * Where a task came from. 'todo' = imported from Microsoft To Do, 'gtasks' = imported from Google
 * Tasks (neither is ever created here).
 */
export const TASK_SOURCES = ['manual', 'ai_chat', 'whatsapp', 'todo', 'gtasks'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];
export const taskSourceSchema = z.enum(TASK_SOURCES);

/**
 * Links to the copies of a task in Microsoft To Do (M7) and Google Tasks (M8). `todoListId` /
 * `gtasksListId` are set as soon as the user (or the default list) chose where the task goes;
 * `todoTaskId` / `gtasksTaskId` only once the task exists there. `todoUpdatedAt` is Graph's
 * lastModifiedDateTime and `gtasksUpdatedAt` the Google Tasks `updated` time of the copy we last
 * saw (conflict resolution).
 */
export interface TaskExternalRefs {
  todoListId: string | null;
  todoTaskId: string | null;
  todoUpdatedAt: string | null;
  gtasksListId: string | null;
  gtasksTaskId: string | null;
  gtasksUpdatedAt: string | null;
}

export const taskExternalRefsSchema = z.object({
  todoListId: z.string().min(1).max(512).nullable(),
  todoTaskId: z.string().min(1).max(512).nullable(),
  todoUpdatedAt: utcIsoSchema.nullable(),
  gtasksListId: z.string().min(1).max(512).nullable(),
  gtasksTaskId: z.string().min(1).max(512).nullable(),
  gtasksUpdatedAt: utcIsoSchema.nullable(),
});

export const EMPTY_TASK_EXTERNAL_REFS: Readonly<TaskExternalRefs> = Object.freeze({
  todoListId: null,
  todoTaskId: null,
  todoUpdatedAt: null,
  gtasksListId: null,
  gtasksTaskId: null,
  gtasksUpdatedAt: null,
});

/** True once the task has a copy in Microsoft To Do. */
export function isTodoLinked(task: Pick<Task, 'external'>): boolean {
  return task.external.todoTaskId !== null;
}

/** True once the task has a copy in Google Tasks. */
export function isGtasksLinked(task: Pick<Task, 'external'>): boolean {
  return task.external.gtasksTaskId !== null;
}

export const TASK_LIMITS = {
  maxTitleChars: 200,
  maxDescriptionChars: 4000,
  maxPeople: 20,
  /** Same bound as meeting alert offsets: 0 = at the due time, max one week before. */
  maxReminderMinutes: 10_080,
} as const;

/** Someone a task involves; a name is enough ("call the landlord"), the email is optional. */
export interface TaskPerson {
  name: string;
  email: string | null;
}

export const taskPersonSchema = z.object({
  name: z.string().min(1).max(200),
  email: emailSchema.nullable(),
});

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  /** Local day the task is due ("YYYY-MM-DD" in `timezone`), or null for no due date. */
  dueDate: string | null;
  /** Local time on dueDate ("HH:mm"), or null when only the day matters. Never set without dueDate. */
  dueTime: string | null;
  /** IANA zone anchoring dueDate/dueTime (and the reminder instant derived from them). */
  timezone: string;
  /** Minutes before the due time to remind (0 = at the due time), or null for no reminder. Needs dueTime. */
  reminderMinutesBefore: number | null;
  status: TaskStatus;
  /** Optional link to a meeting ("prepare the proposal" before the kickoff). */
  meetingId: string | null;
  people: TaskPerson[];
  /** Set exactly while status is 'done'. */
  completedAt: string | null;
  source: TaskSource;
  external: TaskExternalRefs;
  createdAt: string;
  updatedAt: string;
}

const taskShapeSchema = z.object({
  id: meetingIdSchema,
  userId: z.string().min(1).max(128),
  title: z.string().min(1).max(TASK_LIMITS.maxTitleChars),
  description: z.string().max(TASK_LIMITS.maxDescriptionChars),
  dueDate: localDateSchema.nullable(),
  dueTime: localTimeSchema.nullable(),
  timezone: timeZoneSchema,
  reminderMinutesBefore: z.number().int().min(0).max(TASK_LIMITS.maxReminderMinutes).nullable(),
  status: taskStatusSchema,
  meetingId: meetingIdSchema.nullable(),
  people: z.array(taskPersonSchema).max(TASK_LIMITS.maxPeople),
  completedAt: utcIsoSchema.nullable(),
  source: taskSourceSchema,
  external: taskExternalRefsSchema,
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
});

export const taskSchema = taskShapeSchema
  .refine((t) => t.dueTime === null || t.dueDate !== null, { message: 'dueTime needs a dueDate', path: ['dueTime'] })
  .refine((t) => t.reminderMinutesBefore === null || t.dueTime !== null, {
    message: 'a reminder needs a due time',
    path: ['reminderMinutesBefore'],
  })
  .refine((t) => (t.status === 'done') === (t.completedAt !== null), {
    message: 'completedAt is set exactly for done tasks',
    path: ['completedAt'],
  });

export interface TaskInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  /** Defaults to the builder context's zone (device zone). */
  timezone?: string;
  reminderMinutesBefore?: number | null;
  meetingId?: string | null;
  people?: TaskPerson[];
  /** Microsoft To Do list the task should go to (null = the default list, or none when To Do is off). */
  todoListId?: string | null;
  /** Google Tasks list the task should go to (null = the default list, or none when the sync is off). */
  gtasksListId?: string | null;
}

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(TASK_LIMITS.maxTitleChars),
  description: z.string().max(TASK_LIMITS.maxDescriptionChars).optional(),
  dueDate: localDateSchema.nullable().optional(),
  dueTime: localTimeSchema.nullable().optional(),
  timezone: timeZoneSchema.optional(),
  reminderMinutesBefore: z.number().int().min(0).max(TASK_LIMITS.maxReminderMinutes).nullable().optional(),
  meetingId: meetingIdSchema.nullable().optional(),
  people: z.array(taskPersonSchema).max(TASK_LIMITS.maxPeople).optional(),
  todoListId: z.string().min(1).max(512).nullable().optional(),
  gtasksListId: z.string().min(1).max(512).nullable().optional(),
});

/**
 * Patch semantics: undefined = keep, null = clear. Completing goes through `status`. `external`
 * is for the task sync engines only (link write-backs); `todoListId` / `gtasksListId` move the
 * task to another list (the engine re-creates it there; neither API moves tasks between lists).
 */
export type TaskPatch = Partial<TaskInput> & { status?: TaskStatus; external?: Partial<TaskExternalRefs> };
export const taskPatchSchema = taskInputSchema
  .partial()
  .extend({ status: taskStatusSchema.optional(), external: taskExternalRefsSchema.partial().optional() });

/**
 * Due fields are normalized instead of rejected (clearing the date also clears the time and the
 * reminder; clearing the time clears the reminder), so UI and assistant edits cannot produce a
 * contradictory task.
 */
function normalizeDue(task: Pick<Task, 'dueDate' | 'dueTime' | 'reminderMinutesBefore'>): Pick<Task, 'dueDate' | 'dueTime' | 'reminderMinutesBefore'> {
  const dueDate = task.dueDate;
  const dueTime = dueDate === null ? null : task.dueTime;
  const reminderMinutesBefore = dueTime === null ? null : task.reminderMinutesBefore;
  return { dueDate, dueTime, reminderMinutesBefore };
}

export function buildTask(
  input: TaskInput,
  ctx: { id: string; userId: string; timezone: string; now: DateInput; source?: TaskSource },
): Task {
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) throw zodToAppError(parsed.error, 'task input');
  const v = parsed.data;
  const timezone = v.timezone ?? ctx.timezone;
  if (!isValidTimeZone(timezone)) throw new AppError('invalid_input', `Unknown time zone "${timezone}"`);
  const nowIso = toDate(ctx.now).toISOString();
  const task: Task = {
    id: ctx.id,
    userId: ctx.userId,
    title: v.title,
    description: v.description ?? '',
    timezone,
    ...normalizeDue({
      dueDate: v.dueDate ?? null,
      dueTime: v.dueTime ?? null,
      reminderMinutesBefore: v.reminderMinutesBefore ?? null,
    }),
    status: 'open',
    meetingId: v.meetingId ?? null,
    people: v.people ?? [],
    completedAt: null,
    source: ctx.source ?? 'manual',
    external: { ...EMPTY_TASK_EXTERNAL_REFS, todoListId: v.todoListId ?? null, gtasksListId: v.gtasksListId ?? null },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const checked = taskSchema.safeParse(task);
  if (!checked.success) throw zodToAppError(checked.error, 'task');
  return checked.data;
}

export function applyTaskPatch(task: Task, patch: TaskPatch, now: DateInput): Task {
  const parsed = taskPatchSchema.safeParse(patch);
  if (!parsed.success) throw zodToAppError(parsed.error, 'task patch');
  const v = parsed.data;
  const timezone = v.timezone ?? task.timezone;
  if (!isValidTimeZone(timezone)) throw new AppError('invalid_input', `Unknown time zone "${timezone}"`);
  const nowIso = toDate(now).toISOString();
  const status = v.status ?? task.status;
  const next: Task = {
    ...task,
    title: v.title ?? task.title,
    description: v.description ?? task.description,
    timezone,
    ...normalizeDue({
      dueDate: v.dueDate !== undefined ? v.dueDate : task.dueDate,
      dueTime: v.dueTime !== undefined ? v.dueTime : task.dueTime,
      reminderMinutesBefore: v.reminderMinutesBefore !== undefined ? v.reminderMinutesBefore : task.reminderMinutesBefore,
    }),
    status,
    meetingId: v.meetingId !== undefined ? v.meetingId : task.meetingId,
    people: v.people ?? task.people,
    completedAt: status === 'done' ? (task.status === 'done' ? task.completedAt : nowIso) : null,
    external: {
      ...task.external,
      ...(v.external ?? {}),
      ...(v.todoListId !== undefined ? { todoListId: v.todoListId } : {}),
      ...(v.gtasksListId !== undefined ? { gtasksListId: v.gtasksListId } : {}),
    },
    updatedAt: nowIso,
  };
  const checked = taskSchema.safeParse(next);
  if (!checked.success) throw zodToAppError(checked.error, 'task');
  return checked.data;
}

const taskDocReadSchema = taskShapeSchema.omit({ id: true }).extend({
  description: z.string().max(TASK_LIMITS.maxDescriptionChars).default(''),
  dueDate: localDateSchema.nullable().default(null),
  dueTime: localTimeSchema.nullable().default(null),
  timezone: timeZoneSchema.default('UTC'),
  reminderMinutesBefore: z.number().int().min(0).max(TASK_LIMITS.maxReminderMinutes).nullable().default(null),
  status: taskStatusSchema.default('open'),
  meetingId: meetingIdSchema.nullable().default(null),
  people: z.array(taskPersonSchema).max(TASK_LIMITS.maxPeople).default([]),
  completedAt: utcIsoSchema.nullable().default(null),
  source: taskSourceSchema.default('manual'),
  // Every key a later build adds to the external refs MUST be optional here: the M7 build wrote
  // the three To Do keys only, and a reader that required the Google Tasks keys hid every one of
  // those tasks while the server kept counting them (November 2, 2026). Same pattern as the
  // meeting reader above.
  external: taskExternalRefsSchema
    .partial()
    .default({})
    .transform((refs): TaskExternalRefs => fillTaskExternalRefs(refs)),
});

/** Missing or undefined external keys become null (older documents never wrote them). */
export function fillTaskExternalRefs(refs: Partial<TaskExternalRefs>): TaskExternalRefs {
  const filled: TaskExternalRefs = { ...EMPTY_TASK_EXTERNAL_REFS };
  for (const key of Object.keys(EMPTY_TASK_EXTERNAL_REFS) as (keyof TaskExternalRefs)[]) {
    const value = refs[key];
    if (value !== undefined) filled[key] = value;
  }
  return filled;
}

/** Reads leniently and repairs cross-field drift (rules enforce the invariants on write). */
export function parseTaskDoc(id: string, raw: unknown): Task | null {
  if (!meetingIdSchema.safeParse(id).success) return null;
  const parsed = taskDocReadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;
  const task: Task = {
    ...data,
    id,
    ...normalizeDue(data),
    completedAt: data.status === 'done' ? (data.completedAt ?? data.updatedAt) : null,
  };
  return taskSchema.safeParse(task).success ? task : null;
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

/** Sources whose meetings come from another calendar (never created in Meeting Guard). */
export const IMPORTED_MEETING_SOURCES: ReadonlySet<MeetingSource> = new Set<MeetingSource>(['google', 'device', 'outlook']);

export function isImportedMeeting(meeting: Pick<Meeting, 'source'>): boolean {
  return IMPORTED_MEETING_SOURCES.has(meeting.source);
}

/**
 * The intensity a meeting rings at: its own override, else the imported-events default for a
 * meeting from another calendar, else the general preference.
 */
export function effectiveAlertIntensity(
  meeting: Pick<Meeting, 'source' | 'alertIntensity'>,
  preferences: Pick<Preferences, 'alertIntensity' | 'importedAlertIntensity'>,
): AlertIntensity {
  if (meeting.alertIntensity !== null) return meeting.alertIntensity;
  if (isImportedMeeting(meeting) && preferences.importedAlertIntensity !== null) return preferences.importedAlertIntensity;
  return preferences.alertIntensity;
}
