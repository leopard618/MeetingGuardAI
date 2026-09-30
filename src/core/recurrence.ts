/**
 * Recurring meetings (pure; owner: architect/core). No React Native, Expo or Firebase imports.
 *
 * Model (v1, deliberately small - no external rrule dependency):
 * - A recurring meeting is ONE stored document (the "master"): its own `startAt`/`date`/`time` is
 *   the first occurrence, plus a `recurrence` rule (`recurrenceRuleSchema` in aiContract.ts, so the
 *   AI contract and storage share one definition). Occurrences are NEVER stored; they are expanded
 *   on demand by `expandOccurrences`.
 * - Exceptions live ON the master in `recurrenceOverrides`, keyed by the occurrence's
 *   `localDateKey` (the ORIGINAL occurrence date "YYYY-MM-DD" in the meeting's timezone):
 *   `{ status: 'cancelled' }` removes one occurrence; `{ status: 'modified', startAt?,
 *   durationMinutes?, title? }` changes one occurrence. Anything else ("this and following",
 *   per-occurrence participants/notes, ...) is NOT in v1.
 * - Edit scopes: 'occurrence' (writes an override) or 'series' (edits the master). There is no
 *   series split in v1.
 * - All wall-clock math runs in the MEETING's timezone via core/time helpers: an occurrence keeps
 *   its wall-clock time across DST changes (a 09:00 meeting stays at 09:00; its UTC instant moves).
 *
 * Rule semantics:
 * - daily:   every `interval` days from the first occurrence.
 * - weekly:  `byWeekday` (default: the first occurrence's weekday) inside every `interval`-th week;
 *   weeks start on Monday and are anchored on the week of the first occurrence. Dates before the
 *   meeting's own date are skipped.
 * - monthly: day `byMonthDay` (default: the first occurrence's day of month) every `interval`
 *   months. Months without that day (31st in April, 29th in a non-leap February) are SKIPPED and
 *   do not consume `count`.
 * - `until` is an INCLUSIVE UTC instant compared against the ORIGINAL (pre-override) occurrence
 *   start. `count` counts generated occurrences including the first (cancelled overrides still
 *   consume it). At most one of `until` / `count` is set; both null = endless.
 */
import { z } from 'zod';

import {
  LOCAL_DATE_KEY_PATTERN,
  MEETING_ID_PATTERN,
  RECURRENCE_WEEKDAYS,
  durationMinutesSchema,
  localDateKeySchema,
  recurrenceRuleSchema,
  type RecurrenceFreq,
  type RecurrenceRule,
  type RecurrenceWeekday,
} from './aiContract';
import { AppError } from './errors';
import { addDaysToLocalDate, addMinutesIso, isLocalDate, zonedDateTimeToUtcIso } from './time';

export {
  RECURRENCE_FREQS,
  RECURRENCE_WEEKDAYS,
  LOCAL_DATE_KEY_PATTERN,
  localDateKeySchema,
  recurrenceRuleSchema,
} from './aiContract';
export type { RecurrenceFreq, RecurrenceRule, RecurrenceWeekday } from './aiContract';

/** The stored meeting field is exactly the shared rule (single definition; see aiContract.ts). */
export type MeetingRecurrence = RecurrenceRule;
export const meetingRecurrenceSchema = recurrenceRuleSchema;

// ---------------------------------------------------------------------------------------------
// Overrides ("this occurrence only" edits, stored on the master meeting)
// ---------------------------------------------------------------------------------------------

export const RECURRENCE_OVERRIDE_STATUSES = ['cancelled', 'modified'] as const;
export type RecurrenceOverrideStatus = (typeof RECURRENCE_OVERRIDE_STATUSES)[number];

/**
 * One occurrence exception. For 'cancelled' the patch fields are ignored (store them as null).
 * For 'modified', null patch fields keep the master's value. v1 patch surface: start instant,
 * duration and title only.
 */
export interface RecurrenceOverride {
  status: RecurrenceOverrideStatus;
  /** New start instant (UTC ISO) of this occurrence, or null (keep the original). */
  startAt: string | null;
  durationMinutes: number | null;
  title: string | null;
}

const overrideUtcIsoSchema = z.iso.datetime();

export const recurrenceOverrideSchema = z.object({
  status: z.enum(RECURRENCE_OVERRIDE_STATUSES),
  startAt: overrideUtcIsoSchema.nullable(),
  durationMinutes: durationMinutesSchema.nullable(),
  title: z.string().min(1).max(200).nullable(),
});

/** Map localDateKey -> override. Keys that are not local dates make the map invalid. */
export const recurrenceOverridesSchema = z.record(localDateKeySchema, recurrenceOverrideSchema).refine(
  (map) => Object.keys(map).length <= MAX_RECURRENCE_OVERRIDES,
  { message: 'too many recurrence overrides' },
);
export type RecurrenceOverrides = Record<string, RecurrenceOverride>;

export const MAX_RECURRENCE_OVERRIDES = 200;

export const CANCELLED_OVERRIDE: Readonly<RecurrenceOverride> = Object.freeze({
  status: 'cancelled',
  startAt: null,
  durationMinutes: null,
  title: null,
} satisfies RecurrenceOverride);

/** Pure helper: the overrides map with one entry set (or removed with `null`). */
export function withRecurrenceOverride(
  overrides: RecurrenceOverrides | null,
  localDateKey: string,
  override: RecurrenceOverride | null,
): RecurrenceOverrides | null {
  if (!LOCAL_DATE_KEY_PATTERN.test(localDateKey)) {
    throw new AppError('invalid_input', `Invalid occurrence date key: ${localDateKey}`);
  }
  const next: RecurrenceOverrides = { ...(overrides ?? {}) };
  if (override === null) {
    delete next[localDateKey];
  } else {
    const parsed = recurrenceOverrideSchema.safeParse(override);
    if (!parsed.success) throw new AppError('invalid_input', 'Invalid recurrence override', { cause: parsed.error });
    next[localDateKey] = parsed.data;
  }
  return Object.keys(next).length === 0 ? null : next;
}

// ---------------------------------------------------------------------------------------------
// Occurrence ids
// ---------------------------------------------------------------------------------------------

/**
 * `"{meetingId}:{localDateKey}"`. Meeting ids never contain ':' (MEETING_ID_PATTERN), so the id
 * splits unambiguously. This id is NOT a document id (occurrences are never stored); it names an
 * occurrence in UI state, navigation params and the alert plan.
 */
export function occurrenceIdFor(meetingId: string, localDateKey: string): string {
  if (!MEETING_ID_PATTERN.test(meetingId)) {
    throw new AppError('invalid_input', `Invalid meeting id: ${meetingId}`);
  }
  if (!LOCAL_DATE_KEY_PATTERN.test(localDateKey)) {
    throw new AppError('invalid_input', `Invalid occurrence date key: ${localDateKey}`);
  }
  return `${meetingId}:${localDateKey}`;
}

export function parseOccurrenceId(occurrenceId: string): { meetingId: string; localDateKey: string } | null {
  const separator = occurrenceId.lastIndexOf(':');
  if (separator <= 0) return null;
  const meetingId = occurrenceId.slice(0, separator);
  const localDateKey = occurrenceId.slice(separator + 1);
  if (!MEETING_ID_PATTERN.test(meetingId) || !LOCAL_DATE_KEY_PATTERN.test(localDateKey)) return null;
  return { meetingId, localDateKey };
}

// ---------------------------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------------------------

/** What the expander needs from a meeting (a full Meeting satisfies this). */
export interface RecurringMeetingLike {
  id: string;
  title: string;
  /** First-occurrence local date "YYYY-MM-DD" in `timezone` (Meeting.date). */
  date: string;
  /** First-occurrence local time "HH:mm" in `timezone` (Meeting.time). */
  time: string;
  timezone: string;
  durationMinutes: number;
  allDay: boolean;
  recurrence: MeetingRecurrence | null;
  recurrenceOverrides: RecurrenceOverrides | null;
}

export interface MeetingOccurrence {
  /** occurrenceIdFor(meetingId, localDateKey). */
  occurrenceId: string;
  meetingId: string;
  /** ORIGINAL occurrence date in the meeting's timezone; the override key. */
  localDateKey: string;
  /** Effective start (UTC ISO), override applied. */
  startAt: string;
  /** Effective end (UTC ISO). */
  endAt: string;
  /** Effective duration, override applied. */
  durationMinutes: number;
  /** Effective title, override applied. */
  title: string;
  /** True when a 'modified' override applies to this occurrence. */
  overridden: boolean;
}

export interface ExpandOptions {
  /** Hard cap on returned occurrences (default 500). */
  max?: number;
}

export const DEFAULT_EXPANSION_MAX = 500;
/** Safety cap on candidate dates walked per expansion (endless daily series, far windows). */
export const MAX_EXPANSION_ITERATIONS = 5000;

const WEEKDAY_INDEX: Readonly<Record<RecurrenceWeekday, number>> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

/** Monday-based weekday index (MO=0 .. SU=6) of a local date (pure calendar arithmetic). */
export function weekdayIndexOfLocalDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Date.UTC getUTCDay: 0 = Sunday.
  const sundayBased = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (sundayBased + 6) % 7;
}

/** Weekday code (MO..SU) of a local date. */
export function weekdayOfLocalDate(date: string): RecurrenceWeekday {
  return RECURRENCE_WEEKDAYS[weekdayIndexOfLocalDate(date)] as RecurrenceWeekday;
}

export function isRecurringMeeting(meeting: { recurrence: MeetingRecurrence | null }): boolean {
  return meeting.recurrence !== null;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function localDateFor(year: number, month1: number, day: number): string {
  const mm = String(month1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${mm}-${dd}`;
}

/** Whole days from `a` to `b` (both "YYYY-MM-DD"), pure calendar arithmetic. */
function daysBetweenLocalDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * ORIGINAL local dates of the series, in order, starting at the meeting's own date. The generator
 * is endless for endless rules; callers stop it (count/until/window/caps).
 */
function* candidateDates(anchorDate: string, rule: MeetingRecurrence): Generator<string> {
  if (rule.freq === 'daily') {
    let date = anchorDate;
    for (;;) {
      yield date;
      date = addDaysToLocalDate(date, rule.interval);
    }
  }
  if (rule.freq === 'weekly') {
    const selected = new Set<number>(
      (rule.byWeekday && rule.byWeekday.length > 0 ? rule.byWeekday : [weekdayOfLocalDate(anchorDate)]).map(
        (code) => WEEKDAY_INDEX[code],
      ),
    );
    // Monday of the anchor's week.
    const weekStart = addDaysToLocalDate(anchorDate, -weekdayIndexOfLocalDate(anchorDate));
    for (let week = 0; ; week += 1) {
      const start = addDaysToLocalDate(weekStart, week * rule.interval * 7);
      for (let offset = 0; offset < 7; offset += 1) {
        if (!selected.has(offset)) continue;
        const date = addDaysToLocalDate(start, offset);
        if (daysBetweenLocalDates(anchorDate, date) < 0) continue; // before the first occurrence
        yield date;
      }
    }
  }
  if (rule.freq === 'monthly') {
    const [anchorYear, anchorMonth, anchorDay] = anchorDate.split('-').map(Number) as [number, number, number];
    const day = rule.byMonthDay ?? anchorDay;
    const startMonth = anchorYear * 12 + (anchorMonth - 1);
    for (let step = 0; ; step += 1) {
      const total = startMonth + step * rule.interval;
      const year = Math.floor(total / 12);
      const month1 = (total % 12) + 1;
      if (day > daysInMonth(year, month1)) continue; // month has no such day: skip, no count consumed
      const date = localDateFor(year, month1, day);
      if (daysBetweenLocalDates(anchorDate, date) < 0) continue;
      yield date;
    }
  }
}

/**
 * Expands a recurring meeting into occurrence instances that overlap [windowStart, windowEnd)
 * (UTC ISO instants; an occurrence overlaps when `endAt > windowStart && startAt < windowEnd`,
 * using the EFFECTIVE, post-override times). Cancelled occurrences are omitted. The result is
 * sorted by effective `startAt`.
 *
 * DST: each occurrence's instant is derived from its local wall-clock date+time in the meeting's
 * timezone (zonedDateTimeToUtcIso), so the wall-clock time is preserved across DST transitions and
 * is independent of the device's zone. All-day meetings expand at local midnight ("00:00").
 *
 * Throws AppError('invalid_input') for a meeting without a recurrence rule or invalid bounds.
 */
export function expandOccurrences(
  meeting: RecurringMeetingLike,
  windowStart: string,
  windowEnd: string,
  options: ExpandOptions = {},
): MeetingOccurrence[] {
  const rule = meeting.recurrence;
  if (rule === null) throw new AppError('invalid_input', 'expandOccurrences needs a recurring meeting');
  const checkedRule = meetingRecurrenceSchema.safeParse(rule);
  if (!checkedRule.success) throw new AppError('invalid_input', 'Invalid recurrence rule', { cause: checkedRule.error });
  if (!isLocalDate(meeting.date)) throw new AppError('invalid_input', `Invalid meeting date: ${meeting.date}`);
  const windowStartMs = Date.parse(windowStart);
  const windowEndMs = Date.parse(windowEnd);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs < windowStartMs) {
    throw new AppError('invalid_input', 'Invalid expansion window');
  }
  const max = Math.max(1, Math.floor(options.max ?? DEFAULT_EXPANSION_MAX));
  const untilMs = rule.until !== null ? Date.parse(rule.until) : null;
  const time = meeting.allDay ? '00:00' : meeting.time;
  const overrides = meeting.recurrenceOverrides ?? {};

  const out: MeetingOccurrence[] = [];
  let generated = 0;
  let iterations = 0;
  for (const localDateKey of candidateDates(meeting.date, checkedRule.data)) {
    iterations += 1;
    if (iterations > MAX_EXPANSION_ITERATIONS) break;

    const originalStartAt = zonedDateTimeToUtcIso(localDateKey, time, meeting.timezone);
    const originalStartMs = Date.parse(originalStartAt);
    if (untilMs !== null && originalStartMs > untilMs) break;
    generated += 1;
    if (rule.count !== null && generated > rule.count) break;

    const override = overrides[localDateKey];
    if (override?.status === 'cancelled') continue;
    const overridden = override?.status === 'modified';
    const startAt = overridden && override.startAt !== null ? new Date(Date.parse(override.startAt)).toISOString() : originalStartAt;
    const durationMinutes = (overridden ? override.durationMinutes : null) ?? meeting.durationMinutes;
    const startMs = Date.parse(startAt);
    const endMs = startMs + durationMinutes * 60_000;

    // Original dates are monotonically increasing; without time-modified overrides we can stop as
    // soon as the ORIGINAL start leaves the window (an override may move an occurrence into it).
    if (originalStartMs >= windowEndMs && !overridden) {
      if (Object.keys(overrides).length === 0) break;
      if (originalStartMs - windowEndMs > OVERRIDE_LOOKAHEAD_MS) break;
      continue;
    }
    if (endMs <= windowStartMs || startMs >= windowEndMs) continue;

    out.push({
      occurrenceId: occurrenceIdFor(meeting.id, localDateKey),
      meetingId: meeting.id,
      localDateKey,
      startAt,
      endAt: addMinutesIso(startAt, durationMinutes),
      durationMinutes,
      title: (overridden ? override.title : null) ?? meeting.title,
      overridden,
    });
    if (out.length >= max) break;
  }
  return out.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
}

/** How far past the window we keep looking for overrides that moved an occurrence backwards. */
export const OVERRIDE_LOOKAHEAD_MS = 62 * 86_400_000;

/**
 * When the series ends: `until` as stored, the last occurrence's ORIGINAL start for `count`
 * rules, or null for an endless series.
 */
export function recurrenceEndsAt(meeting: RecurringMeetingLike): string | null {
  const rule = meeting.recurrence;
  if (rule === null) return null;
  if (rule.until !== null) return rule.until;
  if (rule.count === null) return null;
  const time = meeting.allDay ? '00:00' : meeting.time;
  let generated = 0;
  let iterations = 0;
  let last: string | null = null;
  for (const date of candidateDates(meeting.date, rule)) {
    iterations += 1;
    if (iterations > MAX_EXPANSION_ITERATIONS) break;
    generated += 1;
    if (generated > rule.count) break;
    last = zonedDateTimeToUtcIso(date, time, meeting.timezone);
  }
  return last;
}

// ---------------------------------------------------------------------------------------------
// Edit scopes
// ---------------------------------------------------------------------------------------------

/** How an update/delete applies to a recurring meeting. v1 has no "this and following". */
export const RECURRENCE_EDIT_SCOPES = ['occurrence', 'series'] as const;
export type RecurrenceEditScope = (typeof RECURRENCE_EDIT_SCOPES)[number];

const RRULE_FREQ: Readonly<Record<RecurrenceFreq, string>> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
};

// ---------------------------------------------------------------------------------------------
// Google Calendar RRULE mapping (writer + parser for the v1 subset)
// ---------------------------------------------------------------------------------------------

/**
 * Google `event.recurrence` lines for the rule + cancelled overrides:
 * - "RRULE:FREQ=...;INTERVAL=...[;BYDAY=...|;BYMONTHDAY=...][;UNTIL=...Z|;COUNT=n]"
 * - one "EXDATE;TZID=<meeting timezone>:<yyyymmddThhmmss>" line per cancelled occurrence.
 * Time-modified overrides are NOT pushed in v1 (kept local; see docs/ARCHITECTURE.md §16).
 */
export function toGoogleRecurrence(meeting: RecurringMeetingLike): string[] {
  const rule = meeting.recurrence;
  if (rule === null) throw new AppError('invalid_input', 'toGoogleRecurrence needs a recurring meeting');
  const parts = [`FREQ=${RRULE_FREQ[rule.freq]}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'weekly' && rule.byWeekday !== null && rule.byWeekday.length > 0) {
    parts.push(`BYDAY=${rule.byWeekday.join(',')}`);
  }
  if (rule.freq === 'monthly' && rule.byMonthDay !== null) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  if (rule.until !== null) {
    parts.push(`UNTIL=${rule.until.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
  } else if (rule.count !== null) {
    parts.push(`COUNT=${rule.count}`);
  }
  const lines = [`RRULE:${parts.join(';')}`];
  const time = (meeting.allDay ? '00:00' : meeting.time).replace(':', '');
  const cancelled = Object.entries(meeting.recurrenceOverrides ?? {})
    .filter(([, override]) => override.status === 'cancelled')
    .map(([key]) => key.replace(/-/g, ''))
    .sort();
  for (const date of cancelled) {
    lines.push(`EXDATE;TZID=${meeting.timezone}:${date}T${time}00`);
  }
  return lines;
}

export interface ParsedGoogleRecurrence {
  rule: MeetingRecurrence;
  /** localDateKeys of EXDATEs (cancelled occurrences). */
  cancelledDateKeys: string[];
}

const WEEKDAY_CODES: ReadonlySet<string> = new Set(RECURRENCE_WEEKDAYS);

/**
 * Parses Google `event.recurrence` lines into the v1 subset. Returns null when the rule uses
 * anything outside it (yearly, BYSETPOS, WKST!=MO with BYDAY, RDATE, multiple RRULEs, ...):
 * such series keep importing as single instances (`singleEvents=true`), exactly as before.
 */
export function parseGoogleRecurrence(lines: readonly string[]): ParsedGoogleRecurrence | null {
  let rule: MeetingRecurrence | null = null;
  const cancelledDateKeys: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.toUpperCase().startsWith('RRULE:')) {
      if (rule !== null) return null; // multiple RRULEs: out of scope
      rule = parseRRule(line.slice('RRULE:'.length));
      if (rule === null) return null;
    } else if (/^EXDATE/i.test(line)) {
      const colon = line.indexOf(':');
      if (colon === -1) return null;
      for (const value of line.slice(colon + 1).split(',')) {
        const match = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/.exec(value.trim());
        if (!match) return null;
        cancelledDateKeys.push(`${match[1]}-${match[2]}-${match[3]}`);
      }
    } else if (/^RDATE/i.test(line)) {
      return null; // extra dates: out of scope
    }
  }
  if (rule === null) return null;
  return { rule, cancelledDateKeys };
}

function parseRRule(body: string): MeetingRecurrence | null {
  let freq: RecurrenceFreq | null = null;
  let interval = 1;
  let byWeekday: RecurrenceWeekday[] | null = null;
  let byMonthDay: number | null = null;
  let until: string | null = null;
  let count: number | null = null;
  for (const part of body.split(';')) {
    if (part.length === 0) continue;
    const [key = '', value = ''] = part.split('=', 2);
    switch (key.toUpperCase()) {
      case 'FREQ': {
        const upper = value.toUpperCase();
        if (upper === 'DAILY') freq = 'daily';
        else if (upper === 'WEEKLY') freq = 'weekly';
        else if (upper === 'MONTHLY') freq = 'monthly';
        else return null;
        break;
      }
      case 'INTERVAL': {
        interval = Number(value);
        if (!Number.isInteger(interval) || interval < 1) return null;
        break;
      }
      case 'BYDAY': {
        const codes = value.toUpperCase().split(',');
        if (!codes.every((code) => WEEKDAY_CODES.has(code))) return null; // "2MO" etc.: out of scope
        byWeekday = codes as RecurrenceWeekday[];
        break;
      }
      case 'BYMONTHDAY': {
        byMonthDay = Number(value);
        if (!Number.isInteger(byMonthDay) || byMonthDay < 1 || byMonthDay > 31) return null;
        break;
      }
      case 'UNTIL': {
        const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
        if (!match) return null;
        const [, y, m, d, hh = '23', mm = '59', ss = '59'] = match;
        until = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))).toISOString();
        break;
      }
      case 'COUNT': {
        count = Number(value);
        if (!Number.isInteger(count) || count < 1) return null;
        break;
      }
      case 'WKST': {
        if (value.toUpperCase() !== 'MO') return null;
        break;
      }
      default:
        return null; // BYSETPOS, BYMONTH, ...: out of scope
    }
  }
  if (freq === null) return null;
  if (until !== null && count !== null) return null;
  if (byWeekday !== null && freq !== 'weekly') return null;
  if (byMonthDay !== null && freq !== 'monthly') return null;
  const candidate: MeetingRecurrence = { freq, interval, byWeekday, byMonthDay, until, count };
  const checked = meetingRecurrenceSchema.safeParse(candidate);
  return checked.success ? checked.data : null;
}
