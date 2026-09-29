/**
 * PURE model of the calendar screen (unit-tested; pure calendar arithmetic on "YYYY-MM-DD" keys,
 * so neither the JS runtime zone nor DST can shift a day).
 *
 * - Month grid: always 6 weeks (42 cells, stable height), starting on the locale's first weekday
 *   (Sunday in English, Monday in Spanish).
 * - Day index: every local day a meeting touches in the user's zone (a timed meeting that runs
 *   past midnight, or a multi-day all-day event, marks each of its days). All-day meetings use
 *   their own dates, never shifted through UTC.
 * - Dots: one per source category present on the day (MeetingGuard, Google Calendar, device).
 */
import { format, type Locale } from 'date-fns';
import { enUS, es } from 'date-fns/locale';

import { addDaysToLocalDate, isLocalDate, toLocalDateTime } from '../../core/time';
import type { Language, Meeting } from '../../core/types';
import { compareWithinDay, meetingEndMs, sourceCategory, type SourceCategory } from '../meetings/list/meetingListModel';

export interface MonthRef {
  year: number;
  /** 1-12 */
  month: number;
}

export interface GridDay {
  /** "YYYY-MM-DD" */
  key: string;
  day: number;
  /** false for the leading / trailing days of the neighbouring months. */
  inMonth: boolean;
}

export const GRID_DAYS = 42;
/** Safety cap for the days one meeting can mark (a bad import must not flood the index). */
export const MAX_MEETING_DAYS = 62;
const MINUTES_PER_DAY = 1440;
const DOT_ORDER: readonly SourceCategory[] = ['meetingguard', 'google', 'device'];

const LOCALES: Readonly<Record<Language, Locale>> = { en: enUS, es };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function dayKeyOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function parseKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

/** Weekday of a local date, 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function monthOf(key: string): MonthRef {
  const { year, month } = parseKey(key);
  return { year, month };
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.month === b.month;
}

export function daysInMonth(ref: MonthRef): number {
  return new Date(Date.UTC(ref.year, ref.month, 0)).getUTCDate();
}

/** Locale's first day of the week (0 = Sunday). */
export function weekStartsOn(language: Language): number {
  return LOCALES[language].options?.weekStartsOn ?? 0;
}

/** 42 cells covering `ref`, starting on `firstWeekday`. */
export function buildMonthGrid(ref: MonthRef, firstWeekday: number): GridDay[] {
  const first = dayKeyOf(ref.year, ref.month, 1);
  const leading = (weekdayOf(first) - firstWeekday + 7) % 7;
  const start = addDaysToLocalDate(first, -leading);
  return Array.from({ length: GRID_DAYS }, (_, index) => {
    const key = addDaysToLocalDate(start, index);
    const parts = parseKey(key);
    return { key, day: parts.day, inMonth: parts.year === ref.year && parts.month === ref.month };
  });
}

/** The local days a meeting touches in `timeZone` (first day first). */
export function meetingDayKeys(meeting: Pick<Meeting, 'startAt' | 'durationMinutes' | 'allDay' | 'date'>, timeZone: string): string[] {
  if (meeting.allDay && isLocalDate(meeting.date)) {
    const days = Math.min(MAX_MEETING_DAYS, Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY)));
    return Array.from({ length: days }, (_, index) => addDaysToLocalDate(meeting.date, index));
  }
  const first = toLocalDateTime(meeting.startAt, timeZone).date;
  const endMs = meetingEndMs(meeting);
  // The last minute of the meeting decides its last day (a meeting ending at midnight does not
  // mark the next day).
  const lastInstant = Math.max(Date.parse(meeting.startAt), endMs - 60_000);
  const last = toLocalDateTime(lastInstant, timeZone).date;
  const keys = [first];
  let current = first;
  while (current < last && keys.length < MAX_MEETING_DAYS) {
    current = addDaysToLocalDate(current, 1);
    keys.push(current);
  }
  return keys;
}

/** Meetings per local day, each day's list in agenda order (all-day first, then by start). */
export function indexMeetingsByDay(meetings: readonly Meeting[], timeZone: string): Map<string, Meeting[]> {
  const index = new Map<string, Meeting[]>();
  for (const meeting of meetings) {
    for (const key of meetingDayKeys(meeting, timeZone)) {
      const list = index.get(key);
      if (list) list.push(meeting);
      else index.set(key, [meeting]);
    }
  }
  for (const list of index.values()) list.sort(compareWithinDay);
  return index;
}

/** Source categories present on a day, in a fixed order (one dot each). */
export function dayDots(meetings: readonly Meeting[] | undefined): SourceCategory[] {
  if (!meetings || meetings.length === 0) return [];
  const present = new Set(meetings.map((meeting) => sourceCategory(meeting.source)));
  return DOT_ORDER.filter((category) => present.has(category));
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

/** "October 2026" / "Octubre 2026". */
export function monthTitle(ref: MonthRef, language: Language): string {
  return capitalize(format(new Date(ref.year, ref.month - 1, 1, 12), 'LLLL yyyy', { locale: LOCALES[language] }));
}

/** Weekday column labels in grid order: short ("Mo" / "Lu") and full ("Monday" / "lunes"). */
export function weekdayLabels(firstWeekday: number, language: Language): { short: string; full: string }[] {
  // 2026-01-04 is a Sunday; local noon never falls into a DST gap.
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = (firstWeekday + index) % 7;
    const date = new Date(2026, 0, 4 + weekday, 12);
    return {
      short: capitalize(format(date, 'EEEEEE', { locale: LOCALES[language] })),
      full: format(date, 'EEEE', { locale: LOCALES[language] }),
    };
  });
}
