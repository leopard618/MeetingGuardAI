import type { RecurrenceRule } from '../../../core/aiContract';
import { buildMeeting, type Meeting } from '../../../core/types';
import { i18n } from '../../../i18n';
import { createFormatters } from '../../shared/useFormatters';
import type { DisplayMeeting } from '../occurrences';
import {
  RUNNING_LATE_DELAYS,
  buildRunningLateMessage,
  canRunLate,
  endNowWrite,
  isRunningNow,
  newTimeText,
  participantNames,
  resolveRunningLateMeeting,
  runningLateMove,
  runningLateNewStart,
  shareOutcome,
} from '../runningLate';

// createFormatters lives next to the hooks; the data layer (Firebase) is never touched here.
jest.mock('../../../services/data', () => ({}));
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

const CREATED = '2026-10-01T00:00:00.000Z';

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}, id = 'm1'): Meeting {
  return buildMeeting(
    { title: 'Budget review', startAt: '2026-10-06T15:00:00.000Z', durationMinutes: 60, timezone: 'UTC', source: 'manual', ...overrides },
    { id, userId: 'u1', now: CREATED, defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

function weekly(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null, ...overrides };
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options) as string;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('canRunLate / isRunningNow', () => {
  it('is true for a timed, active meeting until it ends', () => {
    const m = meeting();
    expect(canRunLate(m, new Date('2026-10-06T14:00:00.000Z'))).toBe(true);
    expect(canRunLate(m, new Date('2026-10-06T15:30:00.000Z'))).toBe(true);
    expect(canRunLate(m, new Date('2026-10-06T16:00:00.000Z'))).toBe(false);
    expect(canRunLate(meeting({ status: 'cancelled' }), new Date('2026-10-06T14:00:00.000Z'))).toBe(false);
    expect(canRunLate(meeting({ allDay: true, durationMinutes: 1440 }), new Date('2026-10-06T14:00:00.000Z'))).toBe(false);
  });

  it('isRunningNow needs the start to have passed', () => {
    const m = meeting();
    expect(isRunningNow(m, new Date('2026-10-06T14:59:00.000Z'))).toBe(false);
    expect(isRunningNow(m, new Date('2026-10-06T15:00:00.000Z'))).toBe(true);
    expect(isRunningNow(m, new Date('2026-10-06T16:00:00.000Z'))).toBe(false);
  });
});

describe('resolveRunningLateMeeting', () => {
  it('returns a live one-off meeting as it is and null once it is over or deleted', () => {
    const m = meeting();
    expect(resolveRunningLateMeeting(m, null, new Date('2026-10-06T14:00:00.000Z'))).toBe(m);
    expect(resolveRunningLateMeeting(m, m.startAt, new Date('2026-10-06T14:00:00.000Z'))).toBe(m);
    expect(resolveRunningLateMeeting(m, null, new Date('2026-10-06T17:00:00.000Z'))).toBeNull();
    expect(resolveRunningLateMeeting({ ...m, deletedAt: '2026-10-06T10:00:00.000Z' }, null, new Date('2026-10-06T14:00:00.000Z'))).toBeNull();
  });

  it('picks the occurrence an alert or a dashboard row names, else the next live one', () => {
    const series = meeting({ recurrence: weekly() }, 'series');
    const now = new Date('2026-10-10T12:00:00.000Z');
    // The alert of the October 13 occurrence (one week after the first).
    const named = resolveRunningLateMeeting(series, '2026-10-13T15:00:00.000Z', now);
    expect(named?.occurrence?.localDateKey).toBe('2026-10-13');
    expect(named?.startAt).toBe('2026-10-13T15:00:00.000Z');
    // No start in hand (details screen): the next live occurrence.
    const next = resolveRunningLateMeeting(series, null, now);
    expect(next?.occurrence?.localDateKey).toBe('2026-10-13');
    // A start that no longer matches (the occurrence was edited meanwhile) falls back the same way.
    expect(resolveRunningLateMeeting(series, '2026-10-13T15:30:00.000Z', now)?.occurrence?.localDateKey).toBe('2026-10-13');
    // While an occurrence runs it is the one in hand.
    expect(resolveRunningLateMeeting(series, null, new Date('2026-10-13T15:20:00.000Z'))?.occurrence?.localDateKey).toBe('2026-10-13');
    expect(resolveRunningLateMeeting(series, null, new Date('2026-10-13T16:00:00.000Z'))?.occurrence?.localDateKey).toBe('2026-10-20');
  });
});

describe('runningLateNewStart', () => {
  it('adds the delay to the scheduled start before the meeting, and to now (next whole minute) once it started', () => {
    const start = '2026-10-06T15:00:00.000Z';
    expect(runningLateNewStart(start, 10, new Date('2026-10-06T14:50:00.000Z'))).toBe('2026-10-06T15:10:00.000Z');
    expect(runningLateNewStart(start, 5, new Date('2026-10-06T15:03:20.000Z'))).toBe('2026-10-06T15:09:00.000Z');
    expect(runningLateNewStart(start, 30, new Date('2026-10-06T15:00:00.000Z'))).toBe('2026-10-06T15:30:00.000Z');
  });

  it('offers 5, 10, 15 and 30 minutes', () => {
    expect([...RUNNING_LATE_DELAYS]).toEqual([5, 10, 15, 30]);
  });
});

describe('message and time text', () => {
  const fmt = createFormatters({ language: 'en', use24Hour: false });
  const now = new Date('2026-10-06T14:50:00.000Z');

  it('names the meeting, the delay and the new time in the UI language', () => {
    expect(buildRunningLateMessage(t, fmt, meeting(), 10, '2026-10-06T15:10:00.000Z', now)).toBe(
      'Hi, I\'m running about 10 minutes late for "Budget review". Let\'s start at 3:10 PM. Sorry for the delay.',
    );
  });

  it('shows only the clock on the same day and the date too on another day', () => {
    expect(newTimeText(fmt, '2026-10-06T15:10:00.000Z', now, 'UTC')).toBe('3:10 PM');
    expect(newTimeText(fmt, '2026-10-07T00:05:00.000Z', now, 'UTC')).toContain('12:05 AM');
    expect(newTimeText(fmt, '2026-10-07T00:05:00.000Z', now, 'UTC')).not.toBe('12:05 AM');
  });

  it('speaks Spanish when the UI does', async () => {
    await i18n.changeLanguage('es');
    const es = createFormatters({ language: 'es', use24Hour: true });
    expect(buildRunningLateMessage(t, es, meeting(), 15, '2026-10-06T15:15:00.000Z', now)).toBe(
      'Hola, voy unos 15 minutos tarde a "Budget review". Perdón por el retraso. ¿Empezamos a las 15:15?',
    );
    await i18n.changeLanguage('en');
  });
});

describe('shareOutcome', () => {
  it('never claims delivery: confirmed only when iOS reports completion, handed over elsewhere', () => {
    expect(shareOutcome('shared', 'ios')).toBe('confirmed');
    expect(shareOutcome('dismissed', 'ios')).toBe('dismissed');
    expect(shareOutcome('shared', 'android')).toBe('handed_over');
    expect(shareOutcome('dismissed', 'android')).toBe('dismissed');
  });
});

describe('scoped writes', () => {
  it('moves a one-off meeting and only the occurrence of a series, keeping the length', () => {
    expect(runningLateMove(meeting(), '2026-10-06T15:10:00.000Z')).toEqual({ scope: 'meeting', meetingId: 'm1', patch: { startAt: '2026-10-06T15:10:00.000Z' } });
    const row: DisplayMeeting = {
      ...meeting({ recurrence: weekly() }, 'series'),
      startAt: '2026-10-13T15:00:00.000Z',
      occurrence: { occurrenceId: 'series:2026-10-13', localDateKey: '2026-10-13', overridden: false },
    };
    expect(runningLateMove(row, '2026-10-13T15:10:00.000Z')).toEqual({
      scope: 'occurrence',
      meetingId: 'series',
      localDateKey: '2026-10-13',
      patch: { startAt: '2026-10-13T15:10:00.000Z' },
    });
  });

  it('endNowWrite shortens a running meeting to the elapsed whole minutes and does nothing otherwise', () => {
    const m = meeting();
    expect(endNowWrite(m, new Date('2026-10-06T15:20:30.000Z'))).toEqual({ scope: 'meeting', meetingId: 'm1', patch: { durationMinutes: 21 } });
    expect(endNowWrite(m, new Date('2026-10-06T15:00:10.000Z'))).toEqual({ scope: 'meeting', meetingId: 'm1', patch: { durationMinutes: 1 } });
    expect(endNowWrite(m, new Date('2026-10-06T14:50:00.000Z'))).toBeNull();
    expect(endNowWrite(m, new Date('2026-10-06T16:30:00.000Z'))).toBeNull();
  });
});

it('participantNames prefers names and falls back to the address', () => {
  expect(participantNames(meeting({ participants: [{ email: 'ana@example.com', name: 'Ana' }, { email: 'bob@example.com', name: null }] }))).toEqual([
    'Ana',
    'bob@example.com',
  ]);
});
