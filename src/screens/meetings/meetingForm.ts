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

/** Only what the form changed (empty object = nothing to save). */
export function draftToPatch(meeting: Meeting, draft: MeetingFormDraft): MeetingPatch {
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
