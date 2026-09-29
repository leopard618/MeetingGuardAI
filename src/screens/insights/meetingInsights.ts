/**
 * PURE meeting insights (no React, no i18n, no services): everything the dashboard summary and the
 * insights screen show is computed here from the user's meetings, on the device.
 *
 * Conventions:
 * - Only "countable" meetings take part: not deleted and status 'scheduled' (cancelled meetings
 *   never count as load or conflicts).
 * - Days are local calendar dates ("YYYY-MM-DD") in the given time zone (the device zone in the
 *   UI). A timed meeting belongs to the date it starts on; an all-day meeting to its own `date`
 *   (and the following days of a multi-day event), never shifted through UTC.
 * - All-day meetings are counted as meetings but add no meeting time and never overlap or run
 *   back-to-back (they are usually reminders, holidays or out-of-office blocks).
 * - Weeks start on `weekStartsOn` (0 Sunday, 1 Monday).
 */
import { addDaysToLocalDate, isLocalDate, toLocalDateTime } from '../../core/time';
import { MEETING_SOURCES, type Meeting, type MeetingSource } from '../../core/types';

/** A meeting that starts at most this many minutes after another one ends is "back-to-back". */
export const BACK_TO_BACK_GAP_MINUTES = 5;

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

export type WeekStart = 0 | 1;
export type InsightPeriod = 'week' | 'month';

export interface InsightContext {
  now: Date;
  /** IANA zone the days are computed in (the device zone in the UI). */
  timeZone: string;
  weekStartsOn: WeekStart;
}

export interface DateRange {
  /** First local date (inclusive). */
  from: string;
  /** Last local date (inclusive). */
  to: string;
  /** Every local date of the range, in order. */
  days: string[];
}

export interface MeetingPair {
  first: Meeting;
  second: Meeting;
}

// ---------------------------------------------------------------------------------------------
// Meeting helpers
// ---------------------------------------------------------------------------------------------

/** Not deleted and not cancelled. */
export function isCountable(meeting: Meeting): boolean {
  return meeting.deletedAt === null && meeting.status === 'scheduled';
}

export function startMs(meeting: Pick<Meeting, 'startAt'>): number {
  return Date.parse(meeting.startAt);
}

export function endMs(meeting: Pick<Meeting, 'startAt' | 'durationMinutes'>): number {
  return startMs(meeting) + meeting.durationMinutes * MS_PER_MINUTE;
}

function hasValidStart(meeting: Meeting): boolean {
  return Number.isFinite(startMs(meeting));
}

/** Timed (not all-day), countable meetings with a valid start, sorted by start then end. */
function timedSorted(meetings: readonly Meeting[]): Meeting[] {
  return meetings
    .filter((meeting) => isCountable(meeting) && !meeting.allDay && hasValidStart(meeting))
    .sort((a, b) => startMs(a) - startMs(b) || endMs(a) - endMs(b));
}

/** http(s) join link typed or synced for the meeting (never made up), else null. */
export function meetingJoinLink(meeting: Pick<Meeting, 'conference' | 'location'>): string | null {
  const candidates = [meeting.conference?.url, meeting.location?.virtualUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\/\S+$/i.test(candidate.trim())) return candidate.trim();
  }
  return null;
}

/** true when the meeting says where it happens: a join link or an address. */
export function hasPlace(meeting: Pick<Meeting, 'conference' | 'location'>): boolean {
  if (meetingJoinLink(meeting) !== null) return true;
  const address = meeting.location?.address;
  return typeof address === 'string' && address.trim().length > 0;
}

/**
 * Local dates the meeting occupies in `timeZone`: the start date for a timed meeting, its own
 * date(s) for an all-day meeting. Empty for unusable values.
 */
export function meetingDates(meeting: Meeting, timeZone: string): string[] {
  if (meeting.allDay) {
    if (!isLocalDate(meeting.date)) return [];
    const days = Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY));
    return Array.from({ length: days }, (_, index) => addDaysToLocalDate(meeting.date, index));
  }
  if (!hasValidStart(meeting)) return [];
  try {
    return [toLocalDateTime(meeting.startAt, timeZone).date];
  } catch {
    return [];
  }
}

/** Day of the week of a local date (0 Sunday ... 6 Saturday). */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// ---------------------------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------------------------

export function todayOf(context: Pick<InsightContext, 'now' | 'timeZone'>): string {
  return toLocalDateTime(context.now, context.timeZone).date;
}

function rangeOf(from: string, length: number): DateRange {
  const days = Array.from({ length }, (_, index) => addDaysToLocalDate(from, index));
  return { from, to: days[days.length - 1] ?? from, days };
}

/** The calendar week containing `now` (7 days starting on `weekStartsOn`). */
export function weekRange(context: InsightContext): DateRange {
  const today = todayOf(context);
  const offset = (weekdayOf(today) - context.weekStartsOn + 7) % 7;
  return rangeOf(addDaysToLocalDate(today, -offset), 7);
}

/** The calendar month containing `now`. */
export function monthRange(context: InsightContext): DateRange {
  const today = todayOf(context);
  const first = `${today.slice(0, 8)}01`;
  let length = 28;
  while (length < 31 && addDaysToLocalDate(first, length).slice(0, 7) === first.slice(0, 7)) length += 1;
  return rangeOf(first, length);
}

export function periodRange(period: InsightPeriod, context: InsightContext): DateRange {
  return period === 'week' ? weekRange(context) : monthRange(context);
}

/** Countable meetings that occupy at least one of `days`, sorted by start (all-day first on ties). */
export function meetingsOnDays(meetings: readonly Meeting[], days: readonly string[], timeZone: string): Meeting[] {
  const wanted = new Set(days);
  return meetings
    .filter((meeting) => isCountable(meeting) && meetingDates(meeting, timeZone).some((date) => wanted.has(date)))
    .sort((a, b) => startMs(a) - startMs(b) || Number(b.allDay) - Number(a.allDay));
}

// ---------------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------------

/** Pairs of timed meetings whose times overlap (the second starts before the first ends). */
export function findOverlaps(meetings: readonly Meeting[]): MeetingPair[] {
  const sorted = timedSorted(meetings);
  const pairs: MeetingPair[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const first = sorted[i]!;
    const firstEnd = endMs(first);
    for (let j = i + 1; j < sorted.length; j += 1) {
      const second = sorted[j]!;
      if (startMs(second) >= firstEnd) break;
      pairs.push({ first, second });
    }
  }
  return pairs;
}

/**
 * Meetings that start 0..`gapMinutes` minutes after an earlier meeting ends (no break in
 * between), each paired with the meeting it follows. Overlapping meetings are reported by
 * findOverlaps, never here.
 */
export function findBackToBack(meetings: readonly Meeting[], gapMinutes: number = BACK_TO_BACK_GAP_MINUTES): MeetingPair[] {
  const sorted = timedSorted(meetings);
  const pairs: MeetingPair[] = [];
  for (const second of sorted) {
    const secondStart = startMs(second);
    let previous: Meeting | null = null;
    for (const first of sorted) {
      if (first === second) continue;
      const firstEnd = endMs(first);
      if (startMs(first) >= secondStart) break;
      const gap = secondStart - firstEnd;
      if (gap >= 0 && gap <= gapMinutes * MS_PER_MINUTE && (previous === null || firstEnd >= endMs(previous))) {
        previous = first;
      }
    }
    if (previous !== null) pairs.push({ first: previous, second });
  }
  return pairs;
}

function sumMinutes(meetings: readonly Meeting[]): number {
  return meetings.reduce((total, meeting) => total + (meeting.allDay ? 0 : meeting.durationMinutes), 0);
}

function hasNotEnded(meeting: Meeting, nowMs: number): boolean {
  if (meeting.allDay) return true;
  return endMs(meeting) > nowMs;
}

// ---------------------------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------------------------

export interface LoadSummary {
  count: number;
  /** Meeting time of the timed meetings (all-day meetings add none). */
  minutes: number;
}

export interface UpcomingIssues {
  /** Overlapping pairs among the meetings of the week that have not ended. */
  overlaps: number;
  /** Meetings (not ended) that start right after another one. */
  backToBack: number;
  /** Timed meetings (not ended) without a join link or an address. */
  missingPlace: number;
  /** Meetings (not ended) that come with preparation tips. */
  withTips: number;
}

export interface DashboardSummary {
  today: LoadSummary;
  week: LoadSummary;
  /** The rest of this week (meetings that have not ended yet). */
  upcoming: UpcomingIssues;
}

export function upcomingIssues(meetings: readonly Meeting[], nowMs: number): UpcomingIssues {
  const open = meetings.filter((meeting) => isCountable(meeting) && hasNotEnded(meeting, nowMs));
  return {
    overlaps: findOverlaps(open).length,
    backToBack: findBackToBack(open).length,
    missingPlace: open.filter((meeting) => !meeting.allDay && !hasPlace(meeting)).length,
    withTips: open.filter((meeting) => meeting.preparationTips.length > 0).length,
  };
}

export function computeDashboardSummary(meetings: readonly Meeting[], context: InsightContext): DashboardSummary {
  const today = todayOf(context);
  const week = weekRange(context);
  const todays = meetingsOnDays(meetings, [today], context.timeZone);
  const weeks = meetingsOnDays(meetings, week.days, context.timeZone);
  return {
    today: { count: todays.length, minutes: sumMinutes(todays) },
    week: { count: weeks.length, minutes: sumMinutes(weeks) },
    upcoming: upcomingIssues(weeks, context.now.getTime()),
  };
}

// ---------------------------------------------------------------------------------------------
// Period insights (insights screen)
// ---------------------------------------------------------------------------------------------

export interface DayLoad {
  /** Stable key: the date (week) or "weekday-<n>" (month). */
  key: string;
  /** The local date (week view) or null (month view: all dates of that weekday together). */
  date: string | null;
  /** 0 Sunday ... 6 Saturday. */
  weekday: number;
  count: number;
  minutes: number;
}

export interface BusiestDay {
  date: string;
  count: number;
  minutes: number;
}

export interface SourceCount {
  source: MeetingSource;
  count: number;
}

export interface PeriodInsights {
  period: InsightPeriod;
  range: DateRange;
  /** Countable meetings in the period (timed + all-day). */
  count: number;
  allDayCount: number;
  totalMinutes: number;
  /** Mean length of the timed meetings, rounded; null without timed meetings. */
  averageMinutes: number | null;
  /** Week: one entry per date. Month: one entry per weekday (totals of the month). Starts on weekStartsOn. */
  days: DayLoad[];
  /** Date with the most meeting time (then the most meetings, then the earliest). */
  busiestDay: BusiestDay | null;
  /** By source, most frequent first; sources without meetings are left out. */
  sources: SourceCount[];
  overlaps: MeetingPair[];
  backToBack: MeetingPair[];
  /** Timed meetings of the period that have not ended and have no link or address. */
  missingPlace: Meeting[];
  /** Meetings of the period that have not ended and come with preparation tips. */
  withTips: Meeting[];
}

function loadByDate(meetings: readonly Meeting[], days: readonly string[], timeZone: string): Map<string, LoadSummary> {
  const byDate = new Map<string, LoadSummary>(days.map((date) => [date, { count: 0, minutes: 0 }]));
  for (const meeting of meetings) {
    const dates = meetingDates(meeting, timeZone);
    for (const date of dates) {
      const entry = byDate.get(date);
      if (!entry) continue;
      entry.count += 1;
      // A timed meeting occupies one date; all-day meetings add no meeting time.
      if (!meeting.allDay) entry.minutes += meeting.durationMinutes;
    }
  }
  return byDate;
}

export function computePeriodInsights(meetings: readonly Meeting[], period: InsightPeriod, context: InsightContext): PeriodInsights {
  const range = periodRange(period, context);
  const inPeriod = meetingsOnDays(meetings, range.days, context.timeZone);
  const timed = inPeriod.filter((meeting) => !meeting.allDay);
  const totalMinutes = sumMinutes(timed);
  const byDate = loadByDate(inPeriod, range.days, context.timeZone);

  let days: DayLoad[];
  if (period === 'week') {
    days = range.days.map((date) => {
      const load = byDate.get(date) ?? { count: 0, minutes: 0 };
      return { key: date, date, weekday: weekdayOf(date), ...load };
    });
  } else {
    days = Array.from({ length: 7 }, (_, index) => {
      const weekday = (context.weekStartsOn + index) % 7;
      return { key: `weekday-${weekday}`, date: null, weekday, count: 0, minutes: 0 };
    });
    for (const [date, load] of byDate) {
      const entry = days.find((day) => day.weekday === weekdayOf(date));
      if (entry) {
        entry.count += load.count;
        entry.minutes += load.minutes;
      }
    }
  }

  let busiestDay: BusiestDay | null = null;
  for (const date of range.days) {
    const load = byDate.get(date);
    if (!load || load.count === 0) continue;
    if (
      busiestDay === null ||
      load.minutes > busiestDay.minutes ||
      (load.minutes === busiestDay.minutes && load.count > busiestDay.count)
    ) {
      busiestDay = { date, ...load };
    }
  }

  const sources = MEETING_SOURCES.map((source) => ({
    source,
    count: inPeriod.filter((meeting) => meeting.source === source).length,
  }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  const nowMs = context.now.getTime();
  const open = inPeriod.filter((meeting) => hasNotEnded(meeting, nowMs));

  return {
    period,
    range,
    count: inPeriod.length,
    allDayCount: inPeriod.length - timed.length,
    totalMinutes,
    averageMinutes: timed.length > 0 ? Math.round(totalMinutes / timed.length) : null,
    days,
    busiestDay,
    sources,
    overlaps: findOverlaps(inPeriod),
    backToBack: findBackToBack(inPeriod),
    missingPlace: open.filter((meeting) => !meeting.allDay && !hasPlace(meeting)),
    withTips: open.filter((meeting) => meeting.preparationTips.length > 0),
  };
}

/** Bar length as a fraction of the longest day (by minutes; by count when there are no minutes). */
export function barFraction(day: DayLoad, days: readonly DayLoad[]): number {
  const maxMinutes = Math.max(0, ...days.map((entry) => entry.minutes));
  if (maxMinutes > 0) return day.minutes / maxMinutes;
  const maxCount = Math.max(0, ...days.map((entry) => entry.count));
  return maxCount > 0 ? day.count / maxCount : 0;
}

/** Week start for a UI language: Sunday for English (US), Monday for Spanish. */
export function weekStartForLanguage(language: string): WeekStart {
  return language === 'es' ? 1 : 0;
}
