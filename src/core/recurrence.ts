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
 *   durationMinutes?, title? }` changes one occurrence. Per-occurrence participants/notes are
 *   NOT in the model.
 * - Edit scopes: 'occurrence' (writes an override), 'series' (edits the master) or 'following'
 *   ("this and the following": splits the series via `splitRecurrenceAt`, §16).
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
import { addDaysToLocalDate, addMinutesIso, isLocalDate, toLocalDateTime, zonedDateTimeToUtcIso } from './time';

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
/**
 * `fromDate`: a local date the caller is not interested in anything before. Daily and weekly rules
 * then start iterating close to it instead of walking every occurrence since the anchor (a daily
 * meeting created a year ago otherwise costs hundreds of zone conversions per expansion). Only
 * used when the rule has no `count`: a counted rule must number its occurrences from the anchor.
 */
function* candidateDates(anchorDate: string, rule: MeetingRecurrence, fromDate: string | null = null): Generator<string> {
  const skipTo = rule.count === null && fromDate !== null && daysBetweenLocalDates(anchorDate, fromDate) > 0 ? fromDate : null;
  if (rule.freq === 'daily') {
    let date = anchorDate;
    if (skipTo !== null) {
      // Land on the last occurrence at or before fromDate, so the window's first day is covered.
      const steps = Math.floor((daysBetweenLocalDates(anchorDate, skipTo) - 1) / rule.interval);
      if (steps > 0) date = addDaysToLocalDate(anchorDate, steps * rule.interval);
    }
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
    let firstWeek = 0;
    if (skipTo !== null) {
      // Whole interval-weeks that end before fromDate's week can be skipped outright.
      const weeks = Math.floor((daysBetweenLocalDates(weekStart, skipTo) - 7) / (7 * rule.interval));
      if (weeks > 0) firstWeek = weeks;
    }
    for (let week = firstWeek; ; week += 1) {
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
  // Occurrences before the window are never returned (an override cannot move one forward by
  // more than OVERRIDE_LOOKAHEAD_MS, and the generator lands one step before fromDate anyway).
  const fromDate = toLocalDateTime(new Date(windowStartMs - OVERRIDE_LOOKAHEAD_MS).toISOString(), meeting.timezone).date;
  for (const localDateKey of candidateDates(meeting.date, checkedRule.data, fromDate)) {
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

/**
 * How an update/delete applies to a recurring meeting. v2 of the recurrence model adds
 * 'following' ("this and the following occurrences"): the series is SPLIT at the target
 * occurrence's ORIGINAL local date (splitRecurrenceAt below; repository ops
 * editFollowing / deleteFollowing in MeetingRecurrenceOps, docs/v1/ARCHITECTURE.md §16).
 */
export const RECURRENCE_EDIT_SCOPES = ['occurrence', 'series', 'following'] as const;
export type RecurrenceEditScope = (typeof RECURRENCE_EDIT_SCOPES)[number];

// ---------------------------------------------------------------------------------------------
// Series split ("this and following"; scope v2)
// ---------------------------------------------------------------------------------------------

/** What splitting a series at an occurrence produces (pure data; no ids are chosen here). */
export interface SeriesSplit {
  /**
   * Rule for the TRUNCATED master: `until` = 1 second before the split occurrence's ORIGINAL
   * start (inclusive-until semantics keep every earlier occurrence and drop the split one and
   * everything after it). A `count` rule is converted to `until`; `count` is always null.
   */
  masterRule: MeetingRecurrence;
  /** Overrides that stay on the master (keys BEFORE fromDateKey), or null when none remain. */
  masterOverrides: RecurrenceOverrides | null;
  /**
   * ORIGINAL start (UTC ISO) of the split occurrence = the tail master's `startAt` (its
   * date/time derive from it in the meeting's timezone). A 'modified' override on the split
   * date stays an override on the tail (`tailOverrides`), never the tail's own start.
   */
  tailStartAt: string;
  /**
   * Rule for the NEW tail series: same freq/interval/byWeekday/byMonthDay. An `until` rule
   * keeps its `until`; a `count` rule keeps the REMAINING count (occurrences generated before
   * the split - cancelled ones included, they consume count - are subtracted); an endless rule
   * stays endless.
   */
  tailRule: MeetingRecurrence;
  /** Overrides that move to the tail (keys AT or AFTER fromDateKey), or null when none. */
  tailOverrides: RecurrenceOverrides | null;
}

/**
 * Splits a recurring meeting's series at `fromDateKey` (an ORIGINAL occurrence local date in the
 * meeting's timezone).
 *
 * - Returns `'series_edit'` when `fromDateKey` is the FIRST original occurrence of the series:
 *   "this and following" from the first occurrence is the whole series, so callers apply a plain
 *   series update / delete instead of splitting.
 * - Returns a `SeriesSplit` otherwise. The caller (repository op) writes the truncated master
 *   (rule + overrides replaced) and, for an edit, creates the tail as a NEW meeting (new id, new
 *   seriesId = the new id, `startAt` = `tailStartAt`, every other content field copied from the
 *   master, then the patch applied); for a delete it only truncates the master.
 * - Throws AppError('invalid_input') when the meeting is not recurring or `fromDateKey` is not an
 *   ORIGINAL occurrence date of the series (off-pattern date, past the rule's until/count end,
 *   malformed). Cancelled occurrences ARE valid split points (their date is part of the series).
 */
export function splitRecurrenceAt(meeting: RecurringMeetingLike, fromDateKey: string): SeriesSplit | 'series_edit' {
  const rule = meeting.recurrence;
  if (rule === null) throw new AppError('invalid_input', 'splitRecurrenceAt needs a recurring meeting');
  const checkedRule = meetingRecurrenceSchema.safeParse(rule);
  if (!checkedRule.success) throw new AppError('invalid_input', 'Invalid recurrence rule', { cause: checkedRule.error });
  if (!LOCAL_DATE_KEY_PATTERN.test(fromDateKey) || !isLocalDate(fromDateKey)) {
    throw new AppError('invalid_input', `Invalid occurrence date key: ${fromDateKey}`);
  }
  if (!isLocalDate(meeting.date)) throw new AppError('invalid_input', `Invalid meeting date: ${meeting.date}`);

  const time = meeting.allDay ? '00:00' : meeting.time;
  const untilMs = checkedRule.data.until !== null ? Date.parse(checkedRule.data.until) : null;

  // Walk the ORIGINAL dates (override-independent; cancelled occurrences consume count exactly
  // like expansion) until the split date, counting how many occurrences come before it.
  let generatedBefore = 0;
  let first: string | null = null;
  let found = false;
  let iterations = 0;
  for (const date of candidateDates(meeting.date, checkedRule.data)) {
    iterations += 1;
    if (iterations > MAX_EXPANSION_ITERATIONS) break;
    if (daysBetweenLocalDates(fromDateKey, date) > 0) break; // walked past the split date: not an occurrence
    const originalStartMs = Date.parse(zonedDateTimeToUtcIso(date, time, meeting.timezone));
    if (untilMs !== null && originalStartMs > untilMs) break;
    if (checkedRule.data.count !== null && generatedBefore + 1 > checkedRule.data.count) break;
    if (first === null) first = date;
    if (date === fromDateKey) {
      found = true;
      break;
    }
    generatedBefore += 1;
  }
  if (!found) {
    throw new AppError('invalid_input', `Not an occurrence of this series: ${fromDateKey}`, {
      details: { meetingId: meeting.id, fromDateKey },
    });
  }
  if (first === fromDateKey) return 'series_edit';

  const tailStartAt = zonedDateTimeToUtcIso(fromDateKey, time, meeting.timezone);
  const masterUntil = new Date(Date.parse(tailStartAt) - 1000).toISOString();

  const masterOverrides: RecurrenceOverrides = {};
  const tailOverrides: RecurrenceOverrides = {};
  for (const [key, override] of Object.entries(meeting.recurrenceOverrides ?? {})) {
    if (daysBetweenLocalDates(fromDateKey, key) >= 0) tailOverrides[key] = override;
    else masterOverrides[key] = override;
  }

  return {
    masterRule: { ...checkedRule.data, until: masterUntil, count: null },
    masterOverrides: Object.keys(masterOverrides).length > 0 ? masterOverrides : null,
    tailStartAt,
    tailRule: {
      ...checkedRule.data,
      until: checkedRule.data.until,
      count: checkedRule.data.count !== null ? checkedRule.data.count - generatedBefore : null,
    },
    tailOverrides: Object.keys(tailOverrides).length > 0 ? tailOverrides : null,
  };
}

/**
 * Re-anchors a rule after the meeting's anchor moved to a different local date (a "this and
 * following" edit whose patch changes the date, §16). Form-created weekly rules always carry
 * `byWeekday = [anchor weekday]`, so keeping the old day would make `expandOccurrences` skip
 * the moved anchor entirely: the occurrence the user just placed would not exist anywhere.
 *
 * - weekly: when `byWeekday` contained the OLD anchor's weekday, that day is swapped for the
 *   NEW anchor's weekday (drop-and-add, kept in MO..SU order; a single-day rule becomes
 *   `[new weekday]`). A rule that never contained the old anchor day (an imported off-pattern
 *   rule) is left alone.
 * - monthly: a `byMonthDay` equal to the OLD anchor's day of month follows the new anchor's day.
 * - daily rules and unchanged dates come back as-is (the same object, so callers can compare
 *   by identity).
 */
export function reconcileRecurrenceAnchor(
  rule: MeetingRecurrence,
  oldDateKey: string,
  newDateKey: string,
): MeetingRecurrence {
  if (oldDateKey === newDateKey) return rule;
  if (!isLocalDate(oldDateKey) || !isLocalDate(newDateKey)) {
    throw new AppError('invalid_input', `Invalid anchor date: ${oldDateKey} -> ${newDateKey}`);
  }
  if (rule.freq === 'weekly' && rule.byWeekday !== null && rule.byWeekday.length > 0) {
    const oldDay = weekdayOfLocalDate(oldDateKey);
    const newDay = weekdayOfLocalDate(newDateKey);
    if (oldDay === newDay || !rule.byWeekday.includes(oldDay)) return rule;
    const days = new Set<RecurrenceWeekday>(rule.byWeekday);
    days.delete(oldDay);
    days.add(newDay);
    return { ...rule, byWeekday: RECURRENCE_WEEKDAYS.filter((day) => days.has(day)) };
  }
  if (rule.freq === 'monthly' && rule.byMonthDay !== null) {
    const oldDay = Number(oldDateKey.slice(8, 10));
    const newDay = Number(newDateKey.slice(8, 10));
    if (rule.byMonthDay !== oldDay || oldDay === newDay) return rule;
    return { ...rule, byMonthDay: newDay };
  }
  return rule;
}

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
 * - "RRULE:FREQ=...;INTERVAL=...[;BYDAY=...|;BYMONTHDAY=...][;UNTIL=...|;COUNT=n]"
 * - one EXDATE line per cancelled occurrence: `EXDATE;TZID=<meeting timezone>:<yyyymmddThhmmss>`
 *   for timed series, `EXDATE;VALUE=DATE:<yyyymmdd>` for all-day series. An OFF-PATTERN anchor
 *   date (weekly rule without the anchor weekday, monthly rule with a different day) gets an
 *   EXDATE too: Google renders DTSTART as an instance, the local expander does not.
 * All-day series use DATE values for UNTIL and EXDATE (RFC 5545 requires the DTSTART value type
 * and Google rejects date-times on an all-day event); the UNTIL date is the instant's local date
 * in the meeting's timezone, which keeps the inclusive-day semantics (original starts are local
 * midnights). Time-modified overrides are NOT pushed in v1 (docs/v1/ARCHITECTURE.md §16).
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
    parts.push(
      meeting.allDay
        ? `UNTIL=${toLocalDateTime(rule.until, meeting.timezone).date.replace(/-/g, '')}`
        : `UNTIL=${rule.until.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    );
  } else if (rule.count !== null) {
    parts.push(`COUNT=${rule.count}`);
  }
  const lines = [`RRULE:${parts.join(';')}`];
  const time = meeting.allDay ? null : meeting.time.replace(':', '');
  const excluded = new Set(
    Object.entries(meeting.recurrenceOverrides ?? {})
      .filter(([, override]) => override.status === 'cancelled')
      .map(([key]) => key),
  );
  // Google always renders DTSTART as an instance, even when it does not match the rule (BYDAY
  // without the anchor weekday, BYMONTHDAY different from the anchor day), while
  // expandOccurrences skips an off-pattern anchor - so it is excluded explicitly, or Google
  // would show one extra event that does not exist locally.
  const offPatternAnchor =
    (rule.freq === 'weekly' &&
      rule.byWeekday !== null &&
      rule.byWeekday.length > 0 &&
      !rule.byWeekday.includes(weekdayOfLocalDate(meeting.date))) ||
    (rule.freq === 'monthly' && rule.byMonthDay !== null && Number(meeting.date.slice(8, 10)) !== rule.byMonthDay);
  if (offPatternAnchor) excluded.add(meeting.date);
  for (const date of [...excluded].sort()) {
    const compact = date.replace(/-/g, '');
    lines.push(
      time === null
        ? `EXDATE;VALUE=DATE:${compact}`
        : `EXDATE;TZID=${meeting.timezone}:${compact}T${time}00`,
    );
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
