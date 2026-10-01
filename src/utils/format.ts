/**
 * Locale-aware date/time formatting (owner: i18n-nav). Layer L1.
 *
 * - date-fns v4 with the enUS / es locales; the language defaults to the current UI language.
 * - Time zone: `options.timeZone` (e.g. the meeting's zone) or the device zone. Wall-clock parts
 *   come from core/time (Intl), so the JS runtime zone never leaks into the output.
 * - Clock: `options.use24Hour` (Preferences.use24HourClock) when set, else the device setting
 *   (expo-localization uses24hourClock), else the language default (en 12 h, es 24 h).
 * - A "YYYY-MM-DD" string is treated as a calendar date (never shifted through UTC), which is
 *   what all-day meetings need.
 * - Invalid input throws AppError('invalid_input') (from core/time).
 */
import { formatDistanceStrict, format as formatWithPattern, type Locale } from 'date-fns';
import { enUS, es } from 'date-fns/locale';

import type { DateValue, FormatApi, FormatOptions } from '../core/contracts';
import { AppError } from '../core/errors';
import { addDaysToLocalDate, getDeviceTimeZone, getZonedParts, isLocalDate, isValidTimeZone, toDate } from '../core/time';
import type { Language, Meeting } from '../core/types';
import { deviceUses24HourClock, isSupportedLanguage } from '../i18n/detect';
import { getLanguage, t } from '../i18n/i18n';

const DATE_FNS_LOCALES: Readonly<Record<Language, Locale>> = { en: enUS, es };

/** Clock used when neither the preference nor the device says (Spanish-speaking regions use 24 h). */
const DEFAULT_24_HOUR: Readonly<Record<Language, boolean>> = { en: false, es: true };

/** 12-hour pattern per language: "3:00 PM" / "3:00 p.m.". */
const TWELVE_HOUR_PATTERN: Readonly<Record<Language, string>> = { en: 'h:mm a', es: 'h:mm aaaa' };

const DATE_STYLE_PATTERNS = { short: 'P', medium: 'PP', long: 'PPP', full: 'PPPP' } as const;
export type DateStyle = keyof typeof DATE_STYLE_PATTERNS;

/** Compact day label: "Mon, Oct 5" / "lun, 5 oct" (+ year when it is not the current year). */
const DAY_LABEL_PATTERNS: Readonly<Record<Language, { sameYear: string; otherYear: string }>> = {
  en: { sameYear: 'EEE, MMM d', otherYear: 'EEE, MMM d, yyyy' },
  es: { sameYear: 'EEE, d MMM', otherYear: 'EEE, d MMM yyyy' },
};

const RANGE_SEPARATOR = ' - ';
const PART_SEPARATOR = ' · ';
const MINUTES_PER_DAY = 1440;

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

interface Resolved {
  language: Language;
  locale: Locale;
  timeZone: string;
  use24Hour: boolean;
}

function resolveLanguage(language: Language | undefined): Language {
  return language !== undefined && isSupportedLanguage(language) ? language : getLanguage();
}

function resolve(options: FormatOptions = {}): Resolved {
  const language = resolveLanguage(options.language);
  const timeZone = options.timeZone ?? getDeviceTimeZone();
  if (!isValidTimeZone(timeZone)) {
    throw new AppError('invalid_input', `Invalid time zone: ${timeZone}`);
  }
  return {
    language,
    locale: DATE_FNS_LOCALES[language],
    timeZone,
    use24Hour: uses24HourClock({ preference: options.use24Hour, language }),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local noon of a calendar day (noon never falls into a DST gap), for date-fns name formatting. */
function noonOf(day: CalendarDay): Date {
  return new Date(day.year, day.month - 1, day.day, 12, 0, 0, 0);
}

function parseLocalDate(value: string): CalendarDay {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function calendarDayOf(value: DateValue, timeZone: string): CalendarDay {
  if (typeof value === 'string' && isLocalDate(value)) return parseLocalDate(value);
  const parts = getZonedParts(toDate(value), timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dayNumber(day: CalendarDay): number {
  return Date.UTC(day.year, day.month - 1, day.day) / 86_400_000;
}

function sameDay(a: CalendarDay, b: CalendarDay): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function formatClock(hour: number, minute: number, resolved: Resolved, withPeriod = true): string {
  if (resolved.use24Hour) return `${pad2(hour)}:${pad2(minute)}`;
  // 2000-01-01 has no DST transition in any zone, so the wall time is represented exactly.
  const pattern = withPeriod ? TWELVE_HOUR_PATTERN[resolved.language] : 'h:mm';
  return formatWithPattern(new Date(2000, 0, 1, hour, minute, 0, 0), pattern, { locale: resolved.locale });
}

function dayLabel(day: CalendarDay, resolved: Resolved, now: Date): string {
  const currentYear = getZonedParts(now, resolved.timeZone).year;
  const patterns = DAY_LABEL_PATTERNS[resolved.language];
  const pattern = day.year === currentYear ? patterns.sameYear : patterns.otherYear;
  return formatWithPattern(noonOf(day), pattern, { locale: resolved.locale });
}

/**
 * 12 h / 24 h clock: explicit preference, else the device setting, else the language default.
 * (`language` is an optional extension of the contract signature.)
 */
export function uses24HourClock(options: { preference?: boolean | null; language?: Language } = {}): boolean {
  if (typeof options.preference === 'boolean') return options.preference;
  const device = deviceUses24HourClock();
  if (device !== null) return device;
  return DEFAULT_24_HOUR[resolveLanguage(options.language)];
}

/** "10/05/2026" (short), "Oct 5, 2026" (medium), "October 5th, 2026" (long), "Monday, October 5th, 2026" (full). */
export function formatDate(value: DateValue, style: DateStyle = 'medium', options?: FormatOptions): string {
  const resolved = resolve(options);
  return formatWithPattern(noonOf(calendarDayOf(value, resolved.timeZone)), DATE_STYLE_PATTERNS[style], {
    locale: resolved.locale,
  });
}

/** "3:00 PM" / "3:00 p.m." / "15:00". */
export function formatTime(value: DateValue, options?: FormatOptions): string {
  const resolved = resolve(options);
  const parts = getZonedParts(toDate(value), resolved.timeZone);
  return formatClock(parts.hour, parts.minute, resolved);
}

/** "Oct 5, 2026, 3:00 PM" / "5 oct 2026, 15:00". */
export function formatDateTime(value: DateValue, options?: FormatOptions): string {
  return `${formatDate(value, 'medium', options)}, ${formatTime(value, options)}`;
}

/**
 * Relative to `now`: "now" / "in 5 minutes" / "3 hours ago" / "tomorrow" / "yesterday" /
 * "in 3 days", then the medium date beyond a week. Spanish: "ahora", "en 5 minutos",
 * "hace 3 horas", "mañana", "ayer", "en 3 días".
 */
export function formatRelative(value: DateValue, options: FormatOptions & { now?: Date } = {}): string {
  const resolved = resolve(options);
  const now = options.now ?? new Date();
  const target = toDate(value);
  const lng = resolved.language;
  const absMinutes = Math.abs(target.getTime() - now.getTime()) / 60_000;

  if (absMinutes < 1) return t('common:format.now', { lng });
  if (absMinutes < 60) {
    return formatDistanceStrict(target, now, { addSuffix: true, unit: 'minute', locale: resolved.locale });
  }

  const dayDiff = dayNumber(calendarDayOf(target, resolved.timeZone)) - dayNumber(calendarDayOf(now, resolved.timeZone));
  if (dayDiff === 0 || absMinutes < 6 * 60) {
    return formatDistanceStrict(target, now, { addSuffix: true, unit: 'hour', locale: resolved.locale });
  }
  if (dayDiff === 1) return t('common:format.tomorrow', { lng });
  if (dayDiff === -1) return t('common:format.yesterday', { lng });
  if (Math.abs(dayDiff) < 7) {
    const sameTimeThatDay = new Date(now.getTime() + dayDiff * 86_400_000);
    return formatDistanceStrict(sameTimeThatDay, now, { addSuffix: true, unit: 'day', locale: resolved.locale });
  }
  return formatDate(target, 'medium', options);
}

/** 45 => "45 min", 60 => "1 h", 90 => "1 h 30 min", 2880 => "2 days" / "2 días". */
export function formatDuration(minutes: number, options?: FormatOptions): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new AppError('invalid_input', 'Invalid duration');
  }
  const total = Math.round(minutes);
  if (total >= MINUTES_PER_DAY && total % MINUTES_PER_DAY === 0) {
    return t('common:format.days', { count: total / MINUTES_PER_DAY, lng: resolveLanguage(options?.language) });
  }
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/**
 * "Mon, Oct 5 · 3:00 - 4:00 PM", "lun, 5 oct · 15:00 - 16:00", "Mon, Oct 5 · All day",
 * "Mon, Oct 5, 11:00 PM - Tue, Oct 6, 1:00 AM" (crosses midnight). All-day meetings use their own
 * calendar `date` (never shifted by zone).
 */
export function formatMeetingTimeRange(
  meeting: Pick<Meeting, 'startAt' | 'durationMinutes' | 'allDay' | 'date'>,
  options: FormatOptions & { now?: Date } = {},
): string {
  const resolved = resolve(options);
  const now = options.now ?? new Date();

  if (meeting.allDay) {
    if (!isLocalDate(meeting.date)) throw new AppError('invalid_input', 'Invalid all-day meeting date');
    const days = Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY));
    const first = parseLocalDate(meeting.date);
    const last = parseLocalDate(addDaysToLocalDate(meeting.date, days - 1));
    const label =
      days === 1
        ? dayLabel(first, resolved, now)
        : `${dayLabel(first, resolved, now)}${RANGE_SEPARATOR}${dayLabel(last, resolved, now)}`;
    return `${label}${PART_SEPARATOR}${t('common:format.allDay', { lng: resolved.language })}`;
  }

  const start = toDate(meeting.startAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  const startParts = getZonedParts(start, resolved.timeZone);
  const endParts = getZonedParts(end, resolved.timeZone);
  const startDay: CalendarDay = { year: startParts.year, month: startParts.month, day: startParts.day };
  const endDay: CalendarDay = { year: endParts.year, month: endParts.month, day: endParts.day };

  if (!sameDay(startDay, endDay)) {
    return (
      `${dayLabel(startDay, resolved, now)}, ${formatClock(startParts.hour, startParts.minute, resolved)}` +
      `${RANGE_SEPARATOR}${dayLabel(endDay, resolved, now)}, ${formatClock(endParts.hour, endParts.minute, resolved)}`
    );
  }

  const samePeriod = !resolved.use24Hour && startParts.hour < 12 === endParts.hour < 12;
  const startText = formatClock(startParts.hour, startParts.minute, resolved, !samePeriod);
  const endText = formatClock(endParts.hour, endParts.minute, resolved);
  return `${dayLabel(startDay, resolved, now)}${PART_SEPARATOR}${startText}${RANGE_SEPARATOR}${endText}`;
}

// Compile-time check that the implementation matches the public contract.
export const FORMAT_API: FormatApi = {
  formatDate,
  formatTime,
  formatDateTime,
  formatRelative,
  formatDuration,
  formatMeetingTimeRange,
  uses24HourClock,
};
