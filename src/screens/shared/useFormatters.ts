/**
 * Locale-aware date/time formatting bound to the live UI language and the user's clock preference
 * (Preferences.use24HourClock), for screens (TS and legacy JS). Formatting never throws into the
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
  /**
   * Legacy meeting views (toLegacyMeetingView: startTime / duration / allDay / date) and the
   * ad-hoc objects older screens build ({ date 'YYYY-MM-DD', time 'HH:mm' }).
   */
  legacyMeetingWhen(view: unknown): string;
}

function safe(run: () => string): string {
  try {
    return run();
  } catch {
    return '';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
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
    legacyMeetingWhen(view) {
      const record = asRecord(view);
      const startAt = typeof record.startTime === 'string' ? record.startTime : null;
      const duration = typeof record.duration === 'number' && record.duration > 0 ? record.duration : 60;
      const allDay = record.allDay === true;
      const date = typeof record.date === 'string' ? record.date : '';
      if (startAt !== null) {
        const text = meetingRange({ startAt, durationMinutes: duration, allDay, date });
        if (text) return text;
      }
      // Ad-hoc objects: local date + time of the device.
      const time = typeof record.time === 'string' ? record.time : '';
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!match) return '';
      const [hour, minute] = /^\d{1,2}:\d{2}/.test(time) ? time.split(':').map((part) => Number.parseInt(part, 10)) : [0, 0];
      const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour ?? 0, minute ?? 0);
      return time ? safe(() => formatDateTime(local, options)) : safe(() => formatDate(date, 'medium', options));
    },
  };
}

/** Formatters for the live language and the user's 12 h / 24 h preference. */
export function useFormatters(): Formatters {
  const { language } = useLanguage();
  const { preferences } = usePreferences();
  const use24Hour = preferences.use24HourClock;
  return useMemo(() => createFormatters({ language, use24Hour }), [language, use24Hour]);
}
