/**
 * Pure time-zone helpers (Intl only, no native modules; safe in headless tasks and tests).
 *
 * Domain conventions:
 * - Instants are ISO-8601 UTC strings from `Date#toISOString()` ("2026-10-05T14:30:00.000Z"), so
 *   lexicographic order == chronological order (Firestore range queries on `startAt` rely on it).
 * - Wall-clock values are a local date "YYYY-MM-DD" + time "HH:mm" in an IANA zone.
 * - All-day meetings start at local midnight of `timezone`; never shift their date through UTC.
 *
 * The device zone comes from `getDeviceTimeZone()`. The i18n module registers expo-localization
 * as provider at startup (`setDeviceTimeZoneProvider`); the fallback is Intl, then "UTC".
 */
import { AppError } from './errors';

export type DateInput = Date | string | number;

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

export interface LocalDateTime {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:mm" (24 h) */
  time: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const WEEKDAYS: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
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
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Parses a Date / ISO string / epoch ms. Throws AppError('invalid_input') for invalid input. */
export function toDate(value: DateInput): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('invalid_input', 'Invalid date value');
  }
  return date;
}

/** Normalizes any valid date input to the canonical UTC ISO string. */
export function toUtcIso(value: DateInput): string {
  return toDate(value).toISOString();
}

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

let deviceTimeZoneProvider: (() => string | null | undefined) | null = null;

/** Registers the device time-zone source (i18n registers expo-localization's getCalendars()). */
export function setDeviceTimeZoneProvider(provider: (() => string | null | undefined) | null): void {
  deviceTimeZoneProvider = provider;
}

/** Current device IANA zone ("UTC" if nothing reliable is available). */
export function getDeviceTimeZone(): string {
  try {
    const fromProvider = deviceTimeZoneProvider?.();
    if (fromProvider && isValidTimeZone(fromProvider)) return fromProvider;
  } catch {
    // Fall through to Intl.
  }
  try {
    const fromIntl = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (fromIntl && isValidTimeZone(fromIntl)) return fromIntl;
  } catch {
    // Fall through.
  }
  return 'UTC';
}

/** Wall-clock parts of an instant in `timeZone`. */
export function getZonedParts(instant: DateInput, timeZone: string): ZonedParts {
  const date = toDate(instant);
  if (!isValidTimeZone(timeZone)) {
    throw new AppError('invalid_input', `Invalid time zone: ${timeZone}`);
  }
  const values: Record<string, string> = {};
  for (const part of getFormatter(timeZone).formatToParts(date)) {
    values[part.type] = part.value;
  }
  const hour = Number(values.hour);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    // Some engines print midnight as "24" even with h23.
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday ?? ''] ?? new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))).getUTCDay(),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Madrid in summer: +120). */
export function getTimeZoneOffsetMinutes(instant: DateInput, timeZone: string): number {
  const date = toDate(instant);
  const wholeSecondMs = Math.floor(date.getTime() / 1000) * 1000;
  const p = getZonedParts(wholeSecondMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - wholeSecondMs) / 60_000);
}

/** Local "YYYY-MM-DD" + "HH:mm" of an instant in `timeZone`. */
export function toLocalDateTime(instant: DateInput, timeZone: string): LocalDateTime {
  const p = getZonedParts(instant, timeZone);
  return {
    date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return probe.getUTCFullYear() === Number(y) && probe.getUTCMonth() === Number(m) - 1 && probe.getUTCDate() === Number(d);
}

export function isLocalTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/**
 * Converts a wall-clock date/time in `timeZone` to a UTC ISO instant.
 * - Non-existent local times (DST spring-forward gap) resolve to the first valid time after it.
 * - Ambiguous local times (DST fall-back overlap) resolve to one of the two valid instants.
 */
export function zonedDateTimeToUtcIso(date: string, time: string, timeZone: string): string {
  if (!isLocalDate(date)) throw new AppError('invalid_input', `Invalid local date: ${date}`);
  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) throw new AppError('invalid_input', `Invalid local time: ${time}`);
  if (!isValidTimeZone(timeZone)) throw new AppError('invalid_input', `Invalid time zone: ${timeZone}`);

  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  const ss = Number(timeMatch[3] ?? '0');
  const wallMs = Date.UTC(y, m - 1, d, hh, mm, ss);

  const offset1 = getTimeZoneOffsetMinutes(wallMs, timeZone);
  const utc1 = wallMs - offset1 * 60_000;
  const offset2 = getTimeZoneOffsetMinutes(utc1, timeZone);
  if (offset1 === offset2) return new Date(utc1).toISOString();

  const utc2 = wallMs - offset2 * 60_000;
  const offset3 = getTimeZoneOffsetMinutes(utc2, timeZone);
  if (offset3 === offset2) return new Date(utc2).toISOString();

  // Gap: the wall time does not exist; take the later candidate (shifted forward by the gap).
  return new Date(Math.max(utc1, utc2)).toISOString();
}

/** Adds whole days to a local date string (pure calendar arithmetic). */
export function addDaysToLocalDate(date: string, days: number): string {
  if (!isLocalDate(date)) throw new AppError('invalid_input', `Invalid local date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Today's local date in `timeZone`. */
export function todayInZone(timeZone: string, now: DateInput = new Date()): string {
  return toLocalDateTime(now, timeZone).date;
}

/** UTC range [from, to) covering the local day `date` in `timeZone` (DST days are 23/25 h). */
export function dayRangeUtc(date: string, timeZone: string): { from: string; to: string } {
  return {
    from: zonedDateTimeToUtcIso(date, '00:00', timeZone),
    to: zonedDateTimeToUtcIso(addDaysToLocalDate(date, 1), '00:00', timeZone),
  };
}

export function addMinutesIso(instant: DateInput, minutes: number): string {
  return new Date(toDate(instant).getTime() + minutes * 60_000).toISOString();
}

/** End instant of a meeting-like value. */
export function endIso(value: { startAt: string; durationMinutes: number }): string {
  return addMinutesIso(value.startAt, value.durationMinutes);
}

/** Whole minutes from `from` to `to` (negative if `to` is earlier). */
export function minutesBetween(from: DateInput, to: DateInput): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 60_000);
}
