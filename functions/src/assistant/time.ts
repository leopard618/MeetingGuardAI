/**
 * Time-zone helpers for the assistant (Intl only).
 *
 * The model never computes UTC offsets: it returns a local date ("YYYY-MM-DD") and a 24 h time
 * ("HH:mm"), and the server turns them into an ISO-8601 instant with the zone's offset
 * ("2026-10-05T09:00:00-05:00"), handling DST gaps (shift forward) and overlaps (earlier instant).
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAY_INDEX: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, '0');
}

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" that exists in the calendar (rejects 2026-02-30). */
export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1970 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** "HH:mm", 24 h. */
export function isValidLocalTime(value: string): boolean {
  return LOCAL_TIME_PATTERN.test(value);
}

/** Wall-clock parts of `instant` in `timeZone`. */
export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    values[part.type] = part.value;
  }
  const hour = Number(values.hour);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAY_INDEX[values.weekday ?? ''] ?? 0,
  };
}

/** UTC offset of `timeZone` at `instant`, in minutes (Madrid in summer: +120). */
export function getOffsetMinutes(instant: Date, timeZone: string): number {
  const wholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
  const p = getZonedParts(new Date(wholeSecond), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - wholeSecond) / MINUTE_MS);
}

export function toLocalDate(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function toLocalTime(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Weekday (0 = Sunday) of a local calendar date. */
export function weekdayOfLocalDate(date: string): number {
  const match = LOCAL_DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`Invalid local date: ${date}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

export function addDaysToLocalDate(date: string, days: number): string {
  const match = LOCAL_DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`Invalid local date: ${date}`);
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * DAY_MS);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Instant of a wall-clock date + time in `timeZone`.
 * - Overlap (clocks go back): the EARLIER instant.
 * - Gap (clocks go forward): the time is shifted forward by the gap (02:30 -> 03:30).
 */
export function zonedDateTimeToInstant(date: string, time: string, timeZone: string): Date {
  const dateMatch = LOCAL_DATE_PATTERN.exec(date);
  const timeMatch = LOCAL_TIME_PATTERN.exec(time);
  if (!dateMatch || !isValidLocalDate(date)) throw new RangeError(`Invalid local date: ${date}`);
  if (!timeMatch) throw new RangeError(`Invalid local time: ${time}`);
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Invalid time zone: ${timeZone}`);

  const naive = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  const offsetBefore = getOffsetMinutes(new Date(naive - 12 * 60 * MINUTE_MS), timeZone);
  const offsetAfter = getOffsetMinutes(new Date(naive + 12 * 60 * MINUTE_MS), timeZone);
  const matches = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => naive - offset * MINUTE_MS)
    .filter((candidate) => {
      const local = new Date(candidate);
      return toLocalDate(local, timeZone) === date && toLocalTime(local, timeZone) === time;
    })
    .sort((a, b) => a - b);
  const first = matches[0];
  if (first !== undefined) return new Date(first);
  // Gap: interpret with the offset in force before the transition, which lands after it.
  return new Date(naive - offsetBefore * MINUTE_MS);
}

/** "2026-10-05T09:00:00-05:00" (offset of `timeZone` at that instant; "+00:00" for UTC). */
export function formatIsoWithOffset(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  const offset = getOffsetMinutes(instant, timeZone);
  const sign = offset < 0 ? '-' : '+';
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

/** Parses an ISO string; null when invalid. */
export function parseInstant(value: string): Date | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}
