import { getCalendars } from 'expo-localization';

import { i18n } from '../../i18n';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMeetingTimeRange,
  formatRelative,
  formatTime,
  uses24HourClock,
} from '../format';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: null }]),
}));

const mockedGetCalendars = getCalendars as jest.Mock;

// 2026-10-05 15:00 in Madrid (UTC+2 in October) = 13:00Z; Monday.
const MADRID_3PM = '2026-10-05T13:00:00.000Z';
const MADRID = 'Europe/Madrid';
const NOW = new Date('2026-10-05T12:55:00.000Z');

beforeEach(async () => {
  mockedGetCalendars.mockReturnValue([{ timeZone: 'UTC', uses24hourClock: null }]);
  await i18n.changeLanguage('en');
});

describe('uses24HourClock', () => {
  it('prefers the explicit preference', () => {
    mockedGetCalendars.mockReturnValue([{ timeZone: 'UTC', uses24hourClock: false }]);
    expect(uses24HourClock({ preference: true })).toBe(true);
    expect(uses24HourClock({ preference: false, language: 'es' })).toBe(false);
  });

  it('then the device setting', () => {
    mockedGetCalendars.mockReturnValue([{ timeZone: 'UTC', uses24hourClock: true }]);
    expect(uses24HourClock({ preference: null, language: 'en' })).toBe(true);
  });

  it('then the language default (en 12 h, es 24 h)', () => {
    expect(uses24HourClock({ language: 'en' })).toBe(false);
    expect(uses24HourClock({ language: 'es' })).toBe(true);
  });

  it('uses the current UI language when none is given', async () => {
    await i18n.changeLanguage('es');
    expect(uses24HourClock()).toBe(true);
  });
});

describe('formatTime', () => {
  it('formats in the requested zone with a 12 or 24 hour clock', () => {
    expect(formatTime(MADRID_3PM, { timeZone: MADRID, language: 'en' })).toBe('3:00 PM');
    expect(formatTime(MADRID_3PM, { timeZone: MADRID, language: 'es' })).toBe('15:00');
    expect(formatTime(MADRID_3PM, { timeZone: MADRID, language: 'es', use24Hour: false })).toBe('3:00 p.m.');
    expect(formatTime(MADRID_3PM, { timeZone: MADRID, language: 'en', use24Hour: true })).toBe('15:00');
    expect(formatTime(MADRID_3PM, { timeZone: 'America/New_York', language: 'en' })).toBe('9:00 AM');
  });

  it('handles midnight', () => {
    expect(formatTime('2026-10-05T22:00:00.000Z', { timeZone: MADRID, language: 'en' })).toBe('12:00 AM');
    expect(formatTime('2026-10-05T22:00:00.000Z', { timeZone: MADRID, language: 'es' })).toBe('00:00');
  });

  it('rejects invalid input', () => {
    expect(() => formatTime('not a date', { timeZone: MADRID })).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    expect(() => formatTime(MADRID_3PM, { timeZone: 'Mars/Olympus' })).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
});

describe('formatDate', () => {
  it('formats the four styles per locale', () => {
    const options = { timeZone: MADRID } as const;
    expect(formatDate(MADRID_3PM, 'short', { ...options, language: 'en' })).toBe('10/05/2026');
    expect(formatDate(MADRID_3PM, 'medium', { ...options, language: 'en' })).toBe('Oct 5, 2026');
    expect(formatDate(MADRID_3PM, 'long', { ...options, language: 'en' })).toBe('October 5th, 2026');
    expect(formatDate(MADRID_3PM, 'full', { ...options, language: 'en' })).toBe('Monday, October 5th, 2026');
    expect(formatDate(MADRID_3PM, 'short', { ...options, language: 'es' })).toBe('05/10/2026');
    expect(formatDate(MADRID_3PM, 'medium', { ...options, language: 'es' })).toBe('5 oct 2026');
    expect(formatDate(MADRID_3PM, 'full', { ...options, language: 'es' })).toBe('lunes, 5 de octubre de 2026');
  });

  it('uses the calendar day of the requested zone', () => {
    // 23:30Z on Oct 5 is already Oct 6 in Madrid and still Oct 5 in New York.
    expect(formatDate('2026-10-05T23:30:00.000Z', 'medium', { timeZone: MADRID, language: 'en' })).toBe('Oct 6, 2026');
    expect(formatDate('2026-10-05T23:30:00.000Z', 'medium', { timeZone: 'America/New_York', language: 'en' })).toBe(
      'Oct 5, 2026',
    );
  });

  it('never shifts a plain calendar date through UTC', () => {
    expect(formatDate('2026-10-05', 'medium', { timeZone: 'Pacific/Honolulu', language: 'en' })).toBe('Oct 5, 2026');
  });
});

describe('formatDateTime', () => {
  it('combines date and time', () => {
    expect(formatDateTime(MADRID_3PM, { timeZone: MADRID, language: 'en' })).toBe('Oct 5, 2026, 3:00 PM');
    expect(formatDateTime(MADRID_3PM, { timeZone: MADRID, language: 'es' })).toBe('5 oct 2026, 15:00');
  });
});

describe('formatRelative', () => {
  const base = { timeZone: MADRID, now: NOW } as const;

  it('says now for less than a minute', () => {
    expect(formatRelative(NOW, { ...base, language: 'en' })).toBe('now');
    expect(formatRelative(NOW, { ...base, language: 'es' })).toBe('ahora');
  });

  it('uses minutes and hours in both directions', () => {
    expect(formatRelative(MADRID_3PM, { ...base, language: 'en' })).toBe('in 5 minutes');
    expect(formatRelative(MADRID_3PM, { ...base, language: 'es' })).toBe('en 5 minutos');
    expect(formatRelative('2026-10-05T12:50:00.000Z', { ...base, language: 'en' })).toBe('5 minutes ago');
    expect(formatRelative('2026-10-05T12:50:00.000Z', { ...base, language: 'es' })).toBe('hace 5 minutos');
    expect(formatRelative('2026-10-05T15:55:00.000Z', { ...base, language: 'en' })).toBe('in 3 hours');
  });

  it('uses tomorrow / yesterday and days for other calendar days', () => {
    expect(formatRelative('2026-10-06T09:00:00.000Z', { ...base, language: 'en' })).toBe('tomorrow');
    expect(formatRelative('2026-10-06T09:00:00.000Z', { ...base, language: 'es' })).toBe('mañana');
    expect(formatRelative('2026-10-04T06:00:00.000Z', { ...base, language: 'es' })).toBe('ayer');
    expect(formatRelative('2026-10-08T09:00:00.000Z', { ...base, language: 'en' })).toBe('in 3 days');
    expect(formatRelative('2026-10-02T09:00:00.000Z', { ...base, language: 'es' })).toBe('hace 3 días');
  });

  it('keeps hours across midnight when close', () => {
    // 23:00 Madrid now, 01:00 Madrid next day.
    const lateNow = new Date('2026-10-05T21:00:00.000Z');
    expect(formatRelative('2026-10-05T23:00:00.000Z', { timeZone: MADRID, now: lateNow, language: 'en' })).toBe('in 2 hours');
  });

  it('falls back to the date beyond a week', () => {
    expect(formatRelative('2026-10-20T09:00:00.000Z', { ...base, language: 'en' })).toBe('Oct 20, 2026');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [89.6, '1 h 30 min'],
  ])('%p minutes -> %p', (minutes, expected) => {
    expect(formatDuration(minutes, { language: 'en' })).toBe(expected);
  });

  it('uses days for whole-day durations', () => {
    expect(formatDuration(1440, { language: 'en' })).toBe('1 day');
    expect(formatDuration(2880, { language: 'es' })).toBe('2 días');
  });

  it('rejects negative or non-finite values', () => {
    expect(() => formatDuration(-5)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    expect(() => formatDuration(Number.NaN)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
});

describe('formatMeetingTimeRange', () => {
  const now = new Date('2026-09-28T10:00:00.000Z');

  it('compacts same-period ranges on a 12-hour clock', () => {
    const meeting = { startAt: MADRID_3PM, durationMinutes: 60, allDay: false, date: '2026-10-05' };
    expect(formatMeetingTimeRange(meeting, { timeZone: MADRID, language: 'en', now })).toBe('Mon, Oct 5 · 3:00 – 4:00 PM');
    expect(formatMeetingTimeRange(meeting, { timeZone: MADRID, language: 'es', now })).toBe('lun, 5 oct · 15:00 – 16:00');
  });

  it('keeps both periods when the range crosses noon', () => {
    const meeting = { startAt: '2026-10-05T09:30:00.000Z', durationMinutes: 90, allDay: false, date: '2026-10-05' };
    expect(formatMeetingTimeRange(meeting, { timeZone: MADRID, language: 'en', now })).toBe(
      'Mon, Oct 5 · 11:30 AM – 1:00 PM',
    );
  });

  it('shows both days when the meeting crosses midnight', () => {
    const meeting = { startAt: '2026-10-05T21:00:00.000Z', durationMinutes: 120, allDay: false, date: '2026-10-05' };
    expect(formatMeetingTimeRange(meeting, { timeZone: MADRID, language: 'en', now })).toBe(
      'Mon, Oct 5, 11:00 PM – Tue, Oct 6, 1:00 AM',
    );
  });

  it('handles all-day meetings with their own calendar date', () => {
    const single = { startAt: '2026-10-04T22:00:00.000Z', durationMinutes: 1440, allDay: true, date: '2026-10-05' };
    expect(formatMeetingTimeRange(single, { timeZone: 'America/New_York', language: 'en', now })).toBe(
      'Mon, Oct 5 · All day',
    );
    const multi = { ...single, durationMinutes: 2880 };
    expect(formatMeetingTimeRange(multi, { timeZone: MADRID, language: 'es', now })).toBe(
      'lun, 5 oct – mar, 6 oct · Todo el día',
    );
  });

  it('adds the year when it is not the current one', () => {
    const meeting = { startAt: '2027-01-12T09:00:00.000Z', durationMinutes: 30, allDay: false, date: '2027-01-12' };
    expect(formatMeetingTimeRange(meeting, { timeZone: 'UTC', language: 'en', now })).toBe(
      'Tue, Jan 12, 2027 · 9:00 – 9:30 AM',
    );
  });
});
