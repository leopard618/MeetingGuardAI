/**
 * Locale-aware date/time formatting bound to the live UI language and the user's clock preference
 * (Preferences.use24HourClock), for screens. Formatting never throws into the
 * UI: an unusable value renders as an empty string (and is logged once per call site by callers
 * that care).
 */
import { useMemo } from 'react';

import type { DateValue, FormatOptions } from '../../core/contracts';
import type { Meeting } from '../../core/types';
import { useLanguage } from '../../i18n';
import { usePreferences } from '../../services/data';
import { formatDate, formatDateTime, formatDuration, formatMeetingTimeRange, formatTime, type DateStyle } from '../../utils/format';

export interface Formatters {
  options: FormatOptions;
  date(value: DateValue, style?: DateStyle, timeZone?: string): string;
  time(value: DateValue, timeZone?: string): string;
  dateTime(value: DateValue, timeZone?: string): string;
  duration(minutes: number): string;
  meetingRange(meeting: Pick<Meeting, 'startAt' | 'durationMinutes' | 'allDay' | 'date'>, timeZone?: string): string;
}

function safe(run: () => string): string {
  try {
    return run();
  } catch {
    return '';
  }
}

export function createFormatters(options: FormatOptions): Formatters {
  const withZone = (timeZone?: string): FormatOptions => (timeZone ? { ...options, timeZone } : options);
  const meetingRange: Formatters['meetingRange'] = (meeting, timeZone) =>
    safe(() => formatMeetingTimeRange(meeting, withZone(timeZone)));
  return {
    options,
    date: (value, style = 'medium', timeZone) => safe(() => formatDate(value, style, withZone(timeZone))),
    time: (value, timeZone) => safe(() => formatTime(value, withZone(timeZone))),
    dateTime: (value, timeZone) => safe(() => formatDateTime(value, withZone(timeZone))),
    duration: (minutes) => safe(() => formatDuration(minutes, options)),
    meetingRange,
  };
}

/** Formatters for the live language and the user's 12 h / 24 h preference. */
export function useFormatters(): Formatters {
  const { language } = useLanguage();
  const { preferences } = usePreferences();
  const use24Hour = preferences.use24HourClock;
  return useMemo(() => createFormatters({ language, use24Hour }), [language, use24Hour]);
}
