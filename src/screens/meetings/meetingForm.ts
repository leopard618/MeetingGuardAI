/**
 * PURE model of the manual meeting form (create + edit; unit-tested). The screen edits a draft of
 * plain strings; this module validates it and turns it into a MeetingCreateInput / MeetingPatch.
 *
 * - Date and time are wall-clock values in the meeting's time zone (new meetings: the device zone;
 *   edited meetings keep theirs), converted with zonedDateTimeToUtcIso (DST-safe).
 * - Conference links are ONLY what the user typed (never generated). Google Meet without a link is
 *   saved as { provider: 'google_meet', url: null }: the Google Calendar push then creates a real
 *   Meet link (conferenceData.createRequest).
 * - Alerts: "use my defaults" (customAlertTimes null) or custom minutes-before offsets, plus an
 *   optional intensity override (alertIntensity null = the preference).
 */
import {
  AI_LIMITS,
  RECURRENCE_WEEKDAYS,
  emailSchema,
  httpUrlSchema,
  recurrenceRuleSchema,
  type ConferenceProvider,
  type LocationType,
  type RecurrenceRule,
  type RecurrenceWeekday,
} from '../../core/aiContract';
import {
  conferenceCapability,
  teamsLinkOnCreateOnly,
  type ConferenceCalendarState,
  type ConferencePushTarget,
} from '../../core/conference';
import { weekdayOfLocalDate } from '../../core/recurrence';
import { isLocalDate, isLocalTime, isValidTimeZone, toLocalDateTime, zonedDateTimeToUtcIso } from '../../core/time';
import {
  DEFAULT_MEETING_DURATION_MINUTES,
  normalizeAlertTimes,
  type AlertIntensity,
  type ConferenceDetails,
  type Meeting,
  type MeetingCreateInput,
  type MeetingLocation,
  type MeetingPatch,
  type MeetingSource,
  type ParticipantInput,
} from '../../core/types';

export const LOCATION_CHOICES = ['none', 'physical', 'virtual', 'hybrid'] as const;
export type LocationChoice = (typeof LOCATION_CHOICES)[number];

export const CONFERENCE_CHOICES = ['none', 'google_meet', 'zoom', 'teams', 'other'] as const;
export type ConferenceChoice = (typeof CONFERENCE_CHOICES)[number];

export const INTENSITY_CHOICES = ['default', 'max', 'medium', 'light'] as const;
export type IntensityChoice = (typeof INTENSITY_CHOICES)[number];

export const DURATION_OPTIONS: readonly number[] = [15, 30, 45, 60, 90, 120];

export const REPEAT_CHOICES = ['none', 'daily', 'weekly', 'monthly'] as const;
export type RepeatChoice = (typeof REPEAT_CHOICES)[number];

export const REPEAT_END_CHOICES = ['never', 'onDate', 'afterCount'] as const;
export type RepeatEndChoice = (typeof REPEAT_END_CHOICES)[number];

export const MAX_REPEAT_INTERVAL = AI_LIMITS.maxRecurrenceInterval;
export const MAX_REPEAT_COUNT = AI_LIMITS.maxRecurrenceCount;

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
const MAX_NOTES = 10_000;
const MAX_ADDRESS = 500;
const MAX_PASSWORD = 100;
const MAX_TIPS = 20;
const MAX_TIP_CHARS = 300;
const MAX_PARTICIPANTS = 100;
const MINUTES_PER_DAY = 1440;

export interface ParticipantDraft {
  email: string;
  name: string;
}

export interface MeetingFormDraft {
  title: string;
  description: string;
  /** "YYYY-MM-DD" in `timezone`. */
  date: string;
  /** "HH:mm" in `timezone` (ignored for all-day meetings). */
  time: string;
  allDay: boolean;
  durationMinutes: number;
  timezone: string;
  locationType: LocationChoice;
  address: string;
  /** Kept as it was (not edited here): a non-conference join URL of an imported meeting. */
  virtualUrl: string | null;
  conferenceProvider: ConferenceChoice;
  /** Only what the user typed (or the stored real link). */
  conferenceUrl: string;
  conferencePassword: string;
  participants: ParticipantDraft[];
  /** One tip per line. */
  tipsText: string;
  /** false = the default reminder times of the preferences. */
  customAlerts: boolean;
  alertTimes: number[];
  alertIntensity: IntensityChoice;
  notes: string;
  /** Recurrence (§16). 'none' = a one-off meeting; the other repeat fields are then ignored. */
  repeat: RepeatChoice;
  /** Free-text "every N" (validated 1..99). */
  repeatInterval: string;
  /** Weekly only. Empty = the meeting's own weekday. */
  repeatWeekdays: RecurrenceWeekday[];
  repeatEnd: RepeatEndChoice;
  /** "YYYY-MM-DD" (inclusive last day, meeting zone) when repeatEnd is 'onDate'. */
  repeatUntilDate: string;
  /** Total occurrences (validated 1..730) when repeatEnd is 'afterCount'. */
  repeatCount: string;
}

export type MeetingFormField =
  | 'title'
  | 'date'
  | 'time'
  | 'duration'
  | 'description'
  | 'address'
  | 'conferenceUrl'
  | 'conferencePassword'
  | 'participants'
  | 'tips'
  | 'alertTimes'
  | 'notes'
  | 'timezone'
  | 'repeatInterval'
  | 'repeatUntil'
  | 'repeatCount';

/** Field -> i18n key of the problem ("meetings:form.errors.<key>"). */
export type MeetingFormErrors = Partial<Record<MeetingFormField, string>>;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Start time of a new meeting on a chosen day other than today. */
export const DEFAULT_DAY_START_TIME = '09:00';

/**
 * Next full hour after `now`, in `timeZone`. With `date` (a day picked in the calendar, "YYYY-MM-DD"
 * in `timeZone`): today keeps the next full hour, any other day starts at DEFAULT_DAY_START_TIME.
 */
export function newMeetingDraft(options: {
  now: Date;
  timeZone: string;
  defaultAlertTimes?: readonly number[];
  date?: string;
}): MeetingFormDraft {
  const next = new Date(Math.ceil((options.now.getTime() + 60_000) / 3_600_000) * 3_600_000);
  const local = toLocalDateTime(next, options.timeZone);
  const today = toLocalDateTime(options.now, options.timeZone).date;
  const picked = options.date;
  const pickedDay = picked !== undefined && isLocalDate(picked) && picked !== today && picked !== local.date ? picked : null;
  return {
    title: '',
    description: '',
    date: pickedDay ?? local.date,
    time: pickedDay !== null ? DEFAULT_DAY_START_TIME : local.time,
    allDay: false,
    durationMinutes: DEFAULT_MEETING_DURATION_MINUTES,
    timezone: options.timeZone,
    locationType: 'none',
    address: '',
    virtualUrl: null,
    conferenceProvider: 'none',
    conferenceUrl: '',
    conferencePassword: '',
    participants: [],
    tipsText: '',
    customAlerts: false,
    alertTimes: [...(options.defaultAlertTimes ?? [])],
    alertIntensity: 'default',
    notes: '',
    repeat: 'none',
    repeatInterval: '1',
    repeatWeekdays: [],
    repeatEnd: 'never',
    repeatUntilDate: '',
    repeatCount: '',
  };
}

export function draftFromMeeting(meeting: Meeting, options: { fallbackTimeZone: string; defaultAlertTimes?: readonly number[] }): MeetingFormDraft {
  const timezone = isValidTimeZone(meeting.timezone) ? meeting.timezone : options.fallbackTimeZone;
  const local = meeting.allDay ? { date: meeting.date, time: '09:00' } : toLocalDateTime(meeting.startAt, timezone);
  const rule = meeting.recurrence;
  return {
    title: meeting.title,
    description: meeting.description,
    date: local.date,
    time: local.time,
    allDay: meeting.allDay,
    durationMinutes: meeting.durationMinutes,
    timezone,
    locationType: meeting.location ? meeting.location.type : 'none',
    address: meeting.location?.address ?? '',
    virtualUrl: meeting.location?.virtualUrl ?? null,
    conferenceProvider: meeting.conference ? meeting.conference.provider : 'none',
    conferenceUrl: meeting.conference?.url ?? '',
    conferencePassword: meeting.conference?.password ?? '',
    participants: meeting.participants.map((participant) => ({ email: participant.email, name: participant.name ?? '' })),
    tipsText: meeting.preparationTips.join('\n'),
    customAlerts: meeting.customAlertTimes !== null,
    alertTimes: [...(meeting.customAlertTimes ?? options.defaultAlertTimes ?? [])],
    alertIntensity: meeting.alertIntensity ?? 'default',
    notes: meeting.notes ?? '',
    repeat: rule === null ? 'none' : rule.freq,
    repeatInterval: String(rule?.interval ?? 1),
    repeatWeekdays: rule?.byWeekday ? [...rule.byWeekday] : [],
    repeatEnd: rule === null || (rule.until === null && rule.count === null) ? 'never' : rule.until !== null ? 'onDate' : 'afterCount',
    // The stored `until` is an inclusive instant; the form edits its local calendar day.
    repeatUntilDate: rule?.until != null ? toLocalDateTime(rule.until, timezone).date : '',
    repeatCount: rule?.count != null ? String(rule.count) : '',
  };
}

/** "https://" is added to a typed link without a scheme; null when the text is not an http(s) URL. */
export function normalizeTypedUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return httpUrlSchema.safeParse(withScheme).success ? withScheme : null;
}

export function parseTips(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function participantRows(draft: MeetingFormDraft): ParticipantDraft[] {
  return draft.participants.filter((row) => row.email.trim() !== '' || row.name.trim() !== '');
}

// ---------------------------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------------------------

/** Parsed "repeat every N" (null when it is not a whole number in 1..99). */
export function parsedRepeatInterval(draft: Pick<MeetingFormDraft, 'repeatInterval'>): number | null {
  const value = Number(draft.repeatInterval.trim());
  return Number.isInteger(value) && value >= 1 && value <= MAX_REPEAT_INTERVAL ? value : null;
}

/** Parsed "after N times" (null when it is not a whole number in 1..730). */
export function parsedRepeatCount(draft: Pick<MeetingFormDraft, 'repeatCount'>): number | null {
  const value = Number(draft.repeatCount.trim());
  return Number.isInteger(value) && value >= 1 && value <= MAX_REPEAT_COUNT ? value : null;
}

/** Weekday chips in MO..SU order; toggling the last selected day leaves the meeting's own weekday. */
export function toggleRepeatWeekday(selected: readonly RecurrenceWeekday[], code: RecurrenceWeekday): RecurrenceWeekday[] {
  const next = selected.includes(code) ? selected.filter((day) => day !== code) : [...selected, code];
  return RECURRENCE_WEEKDAYS.filter((day) => next.includes(day));
}

/** The day of month a monthly rule fires on (an imported byMonthDay wins over the meeting's day). */
export function monthlyRepeatDay(draft: Pick<MeetingFormDraft, 'date'>, existing: RecurrenceRule | null): number {
  if (existing !== null && existing.freq === 'monthly' && existing.byMonthDay !== null) return existing.byMonthDay;
  return isLocalDate(draft.date) ? Number(draft.date.slice(8, 10)) : 1;
}

/**
 * The draft's recurrence rule (null for 'none'). `existing` (the edited meeting's stored rule)
 * keeps values the form does not edit: an imported `byMonthDay`, and the exact `until` instant
 * when its local day is unchanged (so re-saving an untouched form never produces a patch).
 * Invalid repeat inputs fall back to safe values; validateMeetingDraft reports them.
 */
export function recurrenceRuleOf(draft: MeetingFormDraft, existing: RecurrenceRule | null = null): RecurrenceRule | null {
  if (draft.repeat === 'none') return null;
  const freq = draft.repeat;
  let until: string | null = null;
  let count: number | null = null;
  if (draft.repeatEnd === 'onDate' && isLocalDate(draft.repeatUntilDate) && isValidTimeZone(draft.timezone)) {
    const sameDay = existing?.until != null && toLocalDateTime(existing.until, draft.timezone).date === draft.repeatUntilDate;
    until = sameDay && existing !== null && existing.until !== null
      ? existing.until
      : zonedDateTimeToUtcIso(draft.repeatUntilDate, '23:59', draft.timezone);
  } else if (draft.repeatEnd === 'afterCount') {
    count = parsedRepeatCount(draft) ?? 1;
  }
  const rule: RecurrenceRule = {
    freq,
    interval: parsedRepeatInterval(draft) ?? 1,
    byWeekday: freq === 'weekly' && draft.repeatWeekdays.length > 0 ? [...draft.repeatWeekdays] : null,
    byMonthDay: freq === 'monthly' && existing !== null && existing.freq === 'monthly' ? existing.byMonthDay : null,
    until,
    count,
  };
  const checked = recurrenceRuleSchema.safeParse(rule);
  return checked.success ? checked.data : rule;
}

/** Preselects the meeting's own weekday when the user switches a draft to weekly. */
export function defaultRepeatWeekdays(draft: Pick<MeetingFormDraft, 'date'>): RecurrenceWeekday[] {
  return isLocalDate(draft.date) ? [weekdayOfLocalDate(draft.date)] : [];
}

export function validateMeetingDraft(draft: MeetingFormDraft): MeetingFormErrors {
  const errors: MeetingFormErrors = {};
  const title = draft.title.trim();
  if (title === '') errors.title = 'titleRequired';
  else if (title.length > MAX_TITLE) errors.title = 'tooLong';
  if (!isValidTimeZone(draft.timezone)) errors.timezone = 'invalidTimeZone';
  if (!isLocalDate(draft.date)) errors.date = 'invalidDate';
  if (!draft.allDay && !isLocalTime(draft.time)) errors.time = 'invalidTime';
  if (!Number.isInteger(draft.durationMinutes) || draft.durationMinutes < 1 || draft.durationMinutes > AI_LIMITS.maxDurationMinutes) {
    errors.duration = 'invalidDuration';
  }
  if (draft.description.length > MAX_DESCRIPTION) errors.description = 'tooLong';
  if (draft.notes.length > MAX_NOTES) errors.notes = 'tooLong';
  if ((draft.locationType === 'physical' || draft.locationType === 'hybrid') && draft.address.trim().length > MAX_ADDRESS) {
    errors.address = 'tooLong';
  }
  if (draft.conferenceProvider !== 'none') {
    if (draft.conferenceUrl.trim() !== '' && normalizeTypedUrl(draft.conferenceUrl) === null) errors.conferenceUrl = 'invalidUrl';
    if (draft.conferencePassword.trim().length > MAX_PASSWORD) errors.conferencePassword = 'tooLong';
  }
  const rows = participantRows(draft);
  if (rows.length > MAX_PARTICIPANTS) errors.participants = 'tooMany';
  else if (rows.some((row) => !emailSchema.safeParse(row.email.trim().toLowerCase()).success)) {
    errors.participants = 'invalidEmail';
  }
  const tips = parseTips(draft.tipsText);
  if (tips.length > MAX_TIPS || tips.some((tip) => tip.length > MAX_TIP_CHARS)) errors.tips = 'tooManyTips';
  if (draft.customAlerts && draft.alertTimes.length === 0) errors.alertTimes = 'alertTimesRequired';
  if (draft.repeat !== 'none') {
    if (parsedRepeatInterval(draft) === null) errors.repeatInterval = 'invalidRepeatInterval';
    if (draft.repeatEnd === 'onDate' && (!isLocalDate(draft.repeatUntilDate) || draft.repeatUntilDate < draft.date)) {
      errors.repeatUntil = 'invalidRepeatUntil';
    }
    if (draft.repeatEnd === 'afterCount' && parsedRepeatCount(draft) === null) errors.repeatCount = 'invalidRepeatCount';
  }
  return errors;
}

export function isDraftValid(draft: MeetingFormDraft): boolean {
  return Object.keys(validateMeetingDraft(draft)).length === 0;
}

/** true when any field differs from the draft the form started with (unsaved changes). */
export function isMeetingDraftDirty(draft: MeetingFormDraft, original: MeetingFormDraft): boolean {
  return (Object.keys(original) as (keyof MeetingFormDraft)[]).some(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(original[key]),
  );
}

// ---------------------------------------------------------------------------------------------
// Draft -> domain
// ---------------------------------------------------------------------------------------------

export function startAtOf(draft: MeetingFormDraft): string {
  return zonedDateTimeToUtcIso(draft.date, draft.allDay ? '00:00' : draft.time, draft.timezone);
}

function durationOf(draft: MeetingFormDraft): number {
  if (!draft.allDay) return draft.durationMinutes;
  // All-day meetings last whole days.
  return Math.max(1, Math.round(draft.durationMinutes / MINUTES_PER_DAY)) * MINUTES_PER_DAY;
}

export function locationOf(draft: MeetingFormDraft): MeetingLocation | null {
  if (draft.locationType === 'none') return null;
  const address = draft.address.trim();
  const type: LocationType = draft.locationType;
  return {
    type,
    address: type === 'virtual' || address === '' ? null : address,
    virtualUrl: type === 'physical' ? null : draft.virtualUrl,
  };
}

export function conferenceOf(draft: MeetingFormDraft): ConferenceDetails | null {
  if (draft.conferenceProvider === 'none') return null;
  const provider: ConferenceProvider = draft.conferenceProvider;
  const password = draft.conferencePassword.trim();
  return {
    provider,
    // Never generated: a typed (or stored) link, or null (Google Meet: created by Google Calendar).
    url: normalizeTypedUrl(draft.conferenceUrl),
    password: password === '' ? null : password,
  };
}

function participantsOf(draft: MeetingFormDraft, existing: readonly Meeting['participants'][number][] = []): ParticipantInput[] {
  const statusByEmail = new Map(existing.map((participant) => [participant.email.toLowerCase(), participant.status]));
  return participantRows(draft).map((row) => {
    const email = row.email.trim().toLowerCase();
    const name = row.name.trim();
    return { email, name: name === '' ? null : name, status: statusByEmail.get(email) ?? null };
  });
}

function alertTimesOf(draft: MeetingFormDraft): number[] | null {
  return draft.customAlerts ? normalizeAlertTimes(draft.alertTimes) : null;
}

function intensityOf(draft: MeetingFormDraft): AlertIntensity | null {
  return draft.alertIntensity === 'default' ? null : draft.alertIntensity;
}

export function draftToCreateInput(draft: MeetingFormDraft): MeetingCreateInput {
  const notes = draft.notes.trim();
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    startAt: startAtOf(draft),
    durationMinutes: durationOf(draft),
    timezone: draft.timezone,
    allDay: draft.allDay,
    location: locationOf(draft),
    conference: conferenceOf(draft),
    participants: participantsOf(draft),
    source: 'manual',
    confidence: 100,
    preparationTips: parseTips(draft.tipsText),
    customAlertTimes: alertTimesOf(draft),
    alertIntensity: intensityOf(draft),
    notes: notes === '' ? null : notes,
    recurrence: recurrenceRuleOf(draft),
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Only what the form changed (empty object = nothing to save).
 *
 * `original` is the draft the form STARTED with (the snapshot the user edited). The live
 * `meeting` can move while the form is open - most importantly the app itself races the form:
 * a google_meet/teams meeting saved without a link gets its provider-created url written back
 * by the calendar push seconds later. When the user never touched the link field
 * (`draft.conferenceUrl` equals the original's), the live url is kept instead of being diffed
 * away - otherwise saving an unrelated edit would wipe the fresh Meet link (and a Teams link
 * is created on insert ONLY, §17/§22, so it would be lost for good).
 */
export function draftToPatch(meeting: Meeting, draft: MeetingFormDraft, original?: MeetingFormDraft): MeetingPatch {
  const patch: MeetingPatch = {};
  const title = draft.title.trim();
  if (title !== meeting.title) patch.title = title;
  const description = draft.description.trim();
  if (description !== meeting.description) patch.description = description;
  const startAt = startAtOf(draft);
  if (Date.parse(startAt) !== Date.parse(meeting.startAt)) patch.startAt = startAt;
  if (draft.timezone !== meeting.timezone) patch.timezone = draft.timezone;
  if (draft.allDay !== meeting.allDay) patch.allDay = draft.allDay;
  const duration = durationOf(draft);
  if (duration !== meeting.durationMinutes) patch.durationMinutes = duration;
  const location = locationOf(draft);
  if (!same(location, meeting.location)) patch.location = location;
  const conference = conferenceOf(draft);
  if (
    conference !== null &&
    meeting.conference !== null &&
    conference.provider === meeting.conference.provider &&
    original !== undefined &&
    draft.conferenceUrl.trim() === original.conferenceUrl.trim()
  ) {
    // The link field was never edited: the LIVE url (e.g. a Meet/Teams link the sync wrote back
    // while the form was open) is the truth, not the stale snapshot the draft was seeded from.
    conference.url = meeting.conference.url;
    // Same for an untouched passcode: zoomCreateMeeting writes url AND password server-side
    // (§24), so a draft seeded before the link arrived would otherwise silently erase the
    // fresh passcode on the next save.
    if (draft.conferencePassword.trim() === original.conferencePassword.trim()) {
      conference.password = meeting.conference.password;
    }
  }
  if (!same(conference, meeting.conference)) patch.conference = conference;
  const participants = participantsOf(draft, meeting.participants);
  const current = meeting.participants.map((participant) => ({ email: participant.email, name: participant.name, status: participant.status }));
  if (!same(participants, current)) patch.participants = participants;
  const tips = parseTips(draft.tipsText);
  if (!same(tips, meeting.preparationTips)) patch.preparationTips = tips;
  const alertTimes = alertTimesOf(draft);
  if (!same(alertTimes, meeting.customAlertTimes)) patch.customAlertTimes = alertTimes;
  const intensity = intensityOf(draft);
  if (intensity !== meeting.alertIntensity) patch.alertIntensity = intensity;
  const notes = draft.notes.trim();
  const nextNotes = notes === '' ? null : notes;
  if (nextNotes !== meeting.notes) patch.notes = nextNotes;
  const recurrence = recurrenceRuleOf(draft, meeting.recurrence);
  if (!same(recurrence, meeting.recurrence)) patch.recurrence = recurrence;
  return patch;
}

// ---------------------------------------------------------------------------------------------
// Video call (§22): what the form and the details card say about an EMPTY conference url is
// DERIVED at render time from conferenceCapability + the live calendar status - never stored.
// ---------------------------------------------------------------------------------------------

/** "meetings:form.*" leaf of the helper text below the provider chips. */
export type ConferenceFormHintKey =
  | 'pasteLinkHint'
  | 'meetWillBeCreated'
  | 'meetNeedsCalendar'
  | 'teamsWillBeCreated'
  | 'teamsNeedsOutlook'
  | 'zoomWillBeCreated';

/** The §22 push target of the meeting being edited (a new meeting is a one-off 'manual' one). */
function draftPushTarget(draft: Pick<MeetingFormDraft, 'repeat'>, source: MeetingSource): ConferencePushTarget {
  return { source, recurring: draft.repeat !== 'none' };
}

/** The edited meeting's external refs (only what §22 needs); null/absent for a new meeting. */
export type ConferenceExternalRefs = Pick<Meeting['external'], 'outlookEventId'>;

/**
 * The helper below the video-call chips, per §22's table. null = no hint: no video call is
 * selected, or a link is already typed (a pasted url always wins over the auto modes).
 * `source` is the EDITED meeting's source ('manual' for a new one): an auto mode the sync can
 * never reach (imported meeting, or Teams + recurrence, §17) falls back to the paste hint.
 * `external` is the EDITED meeting's refs: a meeting already pushed to Outlook can never get an
 * auto Teams link (create-only, §17), so `auto_outlook` degrades to the paste hint instead of
 * promising a link that will not appear.
 */
export function conferenceFormHint(
  draft: Pick<MeetingFormDraft, 'conferenceProvider' | 'conferenceUrl' | 'repeat'>,
  calendar: ConferenceCalendarState,
  source: MeetingSource = 'manual',
  external?: ConferenceExternalRefs | null,
): ConferenceFormHintKey | null {
  if (draft.conferenceProvider === 'none' || draft.conferenceUrl.trim() !== '') return null;
  const { mode, autoState } = conferenceCapability(draft.conferenceProvider, calendar, draftPushTarget(draft, source));
  switch (mode) {
    case 'none':
      return null;
    case 'paste':
      return 'pasteLinkHint';
    case 'auto_google':
      return autoState === 'ready' ? 'meetWillBeCreated' : 'meetNeedsCalendar';
    case 'auto_outlook':
      if (external != null && teamsLinkOnCreateOnly(external)) return 'pasteLinkHint';
      return autoState === 'ready' ? 'teamsWillBeCreated' : 'teamsNeedsOutlook';
    case 'auto_zoom':
      // not_configured: paste is the real behavior; conferenceFormNote adds the muted "why".
      return autoState === 'ready' ? 'zoomWillBeCreated' : 'pasteLinkHint';
  }
}

/** "meetings:form.*" leaf of the muted secondary note under the hint (§24). */
export type ConferenceFormNoteKey = 'zoomNotConfigured';

/**
 * Muted secondary line under the form hint: shown when Zoom is selected with an empty link and
 * the SERVER SAID the integration is not set up (calendar.zoom = { configured: false }). While
 * the status is unknown (calendar.zoom absent) nothing extra is shown. A pasted link wins.
 */
export function conferenceFormNote(
  draft: Pick<MeetingFormDraft, 'conferenceProvider' | 'conferenceUrl'>,
  calendar: ConferenceCalendarState,
): ConferenceFormNoteKey | null {
  if (draft.conferenceProvider !== 'zoom' || draft.conferenceUrl.trim() !== '') return null;
  return calendar.zoom?.configured === false ? 'zoomNotConfigured' : null;
}

/** Which calendar a "connect" CTA under the hint should open (null = no CTA). */
export function conferenceConnectTarget(hint: ConferenceFormHintKey | null): 'google' | 'outlook' | null {
  if (hint === 'meetNeedsCalendar') return 'google';
  if (hint === 'teamsNeedsOutlook') return 'outlook';
  return null;
}

/**
 * The link input label: "optional" exactly for the two auto modes (the provider creates a real
 * link on sync, but pasting one still works), the plain label everywhere else - including the
 * combinations the sync can never reach (they degrade to paste, so the link is not "optional"),
 * and Teams on a meeting already pushed to Outlook (create-only, §17: no link will come).
 */
export function conferenceLinkLabel(
  draft: Pick<MeetingFormDraft, 'conferenceProvider' | 'repeat'>,
  calendar: ConferenceCalendarState,
  source: MeetingSource = 'manual',
  external?: ConferenceExternalRefs | null,
): 'link' | 'linkOptional' {
  const { mode, autoState } = conferenceCapability(draft.conferenceProvider, calendar, draftPushTarget(draft, source));
  if (mode === 'auto_outlook' && external != null && teamsLinkOnCreateOnly(external)) return 'link';
  // auto_zoom is only "optional" while the server will really create the link (§24).
  if (mode === 'auto_zoom') return autoState === 'ready' ? 'linkOptional' : 'link';
  return mode === 'auto_google' || mode === 'auto_outlook' ? 'linkOptional' : 'link';
}

/**
 * The passcode input only makes sense next to a real link: it appears once a link is typed (or
 * kept visible while a stored passcode exists, so it can still be cleared).
 */
export function showConferencePassword(
  draft: Pick<MeetingFormDraft, 'conferenceProvider' | 'conferenceUrl' | 'conferencePassword'>,
): boolean {
  if (draft.conferenceProvider === 'none') return false;
  return draft.conferenceUrl.trim() !== '' || draft.conferencePassword.trim() !== '';
}

/** "meetings:details.*" leaf of the no-link explanation on the details card. */
export type ConferenceCardInfoKey =
  | 'meetPending'
  | 'meetNeedsCalendar'
  | 'teamsPending'
  | 'teamsNeedsOutlook'
  | 'teamsLinkTooLate'
  | 'zoomPending'
  | 'noLink';

export type ConferenceCardState =
  /** No conference and no join link: the details screen hides the section. */
  | { kind: 'hidden' }
  /** A real link exists (pasted or provider-created): show it with the Join button. */
  | { kind: 'join'; url: string }
  /** No link yet: what to say, and which calendar a connect CTA should open (null = none). */
  | { kind: 'info'; key: ConferenceCardInfoKey; connect: 'google' | 'outlook' | null };

function isHttpUrl(value: string | null): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * The details-screen conference card, per §22's table. A valid url (the conference's, or the
 * imported `location.virtualUrl`) always wins; otherwise the copy mirrors conferenceFormHint,
 * in "already saved" wording, plus the create-only special case: a meeting already pushed to
 * Outlook (`external.outlookEventId` set) without a url never gets a Teams link (§17), so the
 * card says it is too late instead of promising one "on the next sync". Combinations the sync
 * can never reach (imported meeting, Teams + recurrence) show the plain no-link copy instead
 * of a promise or a connect CTA that would not help.
 */
export function conferenceCardState(
  meeting: Pick<Meeting, 'conference' | 'location' | 'external' | 'source' | 'recurrence'>,
  calendar: ConferenceCalendarState,
): ConferenceCardState {
  const url = meeting.conference?.url ?? meeting.location?.virtualUrl ?? null;
  if (isHttpUrl(url)) return { kind: 'join', url };
  if (meeting.conference === null) return { kind: 'hidden' };
  const { mode, autoState } = conferenceCapability(meeting.conference.provider, calendar, {
    source: meeting.source,
    recurring: meeting.recurrence !== null,
  });
  switch (mode) {
    case 'auto_google':
      return autoState === 'ready'
        ? { kind: 'info', key: 'meetPending', connect: null }
        : { kind: 'info', key: 'meetNeedsCalendar', connect: 'google' };
    case 'auto_outlook':
      // Create-only comes FIRST: a meeting already pushed to Outlook never gets an auto link
      // (§17), connected or not - a "Connect Outlook" CTA would promise a link that cannot come.
      if (teamsLinkOnCreateOnly(meeting.external)) return { kind: 'info', key: 'teamsLinkTooLate', connect: null };
      if (autoState !== 'ready') return { kind: 'info', key: 'teamsNeedsOutlook', connect: 'outlook' };
      return { kind: 'info', key: 'teamsPending', connect: null };
    case 'auto_zoom':
      // ready: the link is coming (the screen swaps to details.zoomCreateFailed + Retry when
      // zoomService.linkFailure(meeting.id) reports a failure this session, §24).
      // not_configured: paste is the only way, same copy as every other paste provider.
      return autoState === 'ready'
        ? { kind: 'info', key: 'zoomPending', connect: null }
        : { kind: 'info', key: 'noLink', connect: null };
    default:
      return { kind: 'info', key: 'noLink', connect: null };
  }
}

/** Local wall-clock Date for the pickers (they work in the device zone). */
export function pickerDateOf(draft: Pick<MeetingFormDraft, 'date' | 'time'>): Date {
  const [year, month, day] = draft.date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = (isLocalTime(draft.time) ? draft.time : '09:00').split(':').map(Number) as [number, number];
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function dateFromPicker(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function timeFromPicker(value: Date): string {
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}
