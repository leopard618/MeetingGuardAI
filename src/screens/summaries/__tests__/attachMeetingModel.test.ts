/**
 * The "Choose a meeting" sheet's pure model (M10 section 9): the start day, that day's meetings
 * with series expanded locally (the occurrence's ORIGINAL date goes to attach), cancelled meetings
 * offered with a mark, deleted ones left out, and the current-meeting mark of 'move' mode.
 */
import type { RecurrenceRule } from '../../../core/aiContract';
import { CANCELLED_OVERRIDE } from '../../../core/recurrence';
import { buildMeeting, type Meeting } from '../../../core/types';
import {
  attachRequestFor,
  attachRowKey,
  attachStartDay,
  isCancelledMeeting,
  isCurrentMeeting,
  meetingsOnDay,
} from '../attachMeetingModel';

const NOW = '2026-11-01T00:00:00.000Z';
const ZONE = 'America/Mexico_City';

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}, id = 'm1'): Meeting {
  return buildMeeting(
    {
      title: 'Urpayroll weekly sync',
      startAt: '2026-11-12T20:00:00.000Z', // Thursday 14:00 in Mexico City
      durationMinutes: 60,
      timezone: ZONE,
      source: 'manual',
      ...overrides,
    },
    { id, userId: 'u1', now: NOW, defaultTimezone: ZONE, defaultLanguage: 'en' },
  );
}

function weekly(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null, ...overrides };
}

describe('attachStartDay', () => {
  it('opens on the date written in the summary', () => {
    expect(attachStartDay({ summaryDate: '2026-10-16', receivedAt: '2026-11-12T10:00:00.000Z' }, ZONE, new Date(NOW))).toBe('2026-10-16');
  });

  it('opens on the local day the summary arrived when it has no date', () => {
    // 03:00 UTC on the 12th is still the 11th in Mexico City.
    expect(attachStartDay({ summaryDate: null, receivedAt: '2026-11-12T03:00:00.000Z' }, ZONE, new Date(NOW))).toBe('2026-11-11');
    expect(attachStartDay({ summaryDate: null, receivedAt: '2026-11-12T03:00:00.000Z' }, 'UTC', new Date(NOW))).toBe('2026-11-12');
  });

  it('falls back to today for an unreadable arrival time or summary date', () => {
    expect(attachStartDay({ summaryDate: null, receivedAt: 'not a date' }, 'UTC', new Date('2026-11-12T10:00:00.000Z'))).toBe('2026-11-12');
    expect(attachStartDay({ summaryDate: '2026-02-30', receivedAt: 'not a date' }, 'UTC', new Date('2026-11-12T10:00:00.000Z'))).toBe('2026-11-12');
  });
});

describe('meetingsOnDay', () => {
  it('lists that day\'s one-off meetings, all-day first and then by start, and nothing from other days', () => {
    const late = meeting({ title: 'Marketing review', startAt: '2026-11-12T22:00:00.000Z' }, 'late');
    const early = meeting({ title: 'Standup', startAt: '2026-11-12T15:00:00.000Z' }, 'early');
    const allDay = meeting({ title: 'Offsite', startAt: '2026-11-12T06:00:00.000Z', allDay: true, durationMinutes: 1440 }, 'allday');
    const otherDay = meeting({ title: 'Friday call', startAt: '2026-11-13T16:00:00.000Z' }, 'friday');
    const day = meetingsOnDay([late, otherDay, early, allDay], '2026-11-12', ZONE);
    expect(day.map((entry) => entry.id)).toEqual(['allday', 'early', 'late']);
  });

  it('leaves out deleted meetings and offers a cancelled one, marked (the server accepts it)', () => {
    const cancelled = meeting({ status: 'cancelled', startAt: '2026-11-12T16:00:00.000Z' }, 'cancelled');
    const deleted = { ...meeting({}, 'deleted'), deletedAt: '2026-11-10T00:00:00.000Z' };
    const kept = meeting({}, 'kept');
    const day = meetingsOnDay([cancelled, deleted, kept], '2026-11-12', ZONE);
    expect(day.map((entry) => entry.id).sort()).toEqual(['cancelled', 'kept']);
    expect(day.map((entry) => [entry.id, isCancelledMeeting(entry)]).sort()).toEqual([
      ['cancelled', true],
      ['kept', false],
    ]);
  });

  it('expands a weekly series to that day\'s occurrence with its original date and the master id', () => {
    const series = meeting({ startAt: '2026-10-15T20:00:00.000Z', recurrence: weekly() }, 'series');
    const day = meetingsOnDay([series], '2026-11-12', ZONE);
    expect(day).toHaveLength(1);
    expect(day[0]?.id).toBe('series');
    expect(day[0]?.occurrence?.localDateKey).toBe('2026-11-12');
    expect(attachRowKey(day[0]!)).toBe('series:2026-11-12');
    expect(attachRequestFor('s1', day[0]!)).toEqual({ summaryId: 's1', meetingId: 'series', occurrenceDate: '2026-11-12' });
    // Not on the days in between.
    expect(meetingsOnDay([series], '2026-11-11', ZONE)).toEqual([]);
  });

  it('leaves out a cancelled occurrence and shows a moved one on its new day with its original date', () => {
    const series = meeting(
      {
        startAt: '2026-10-15T20:00:00.000Z',
        recurrence: weekly(),
        recurrenceOverrides: {
          '2026-11-05': { ...CANCELLED_OVERRIDE },
          // The Nov 19 occurrence was moved to Friday Nov 20, 10:00 local, with a new title.
          '2026-11-19': { status: 'modified', startAt: '2026-11-20T16:00:00.000Z', durationMinutes: null, title: 'Moved sync' },
        },
      },
      'series',
    );
    expect(meetingsOnDay([series], '2026-11-05', ZONE)).toEqual([]);
    expect(meetingsOnDay([series], '2026-11-19', ZONE)).toEqual([]);
    const moved = meetingsOnDay([series], '2026-11-20', ZONE);
    expect(moved.map((entry) => [entry.title, entry.occurrence?.localDateKey])).toEqual([['Moved sync', '2026-11-19']]);
    expect(attachRequestFor('s1', moved[0]!).occurrenceDate).toBe('2026-11-19');
  });

  it('passes a one-off with a null occurrence date', () => {
    const oneOff = meeting({}, 'single');
    const [entry] = meetingsOnDay([oneOff], '2026-11-12', ZONE);
    expect(attachRequestFor('s1', entry!)).toEqual({ summaryId: 's1', meetingId: 'single', occurrenceDate: null });
  });

  it('answers nothing for an invalid day', () => {
    expect(meetingsOnDay([meeting()], '2026-13-01', ZONE)).toEqual([]);
  });
});

describe('isCurrentMeeting', () => {
  it('marks a one-off by id and a series occurrence only with its date', () => {
    const oneOff = meeting({}, 'single');
    const [single] = meetingsOnDay([oneOff], '2026-11-12', ZONE);
    expect(isCurrentMeeting({ currentMeetingId: 'single' }, single!)).toBe(true);
    expect(isCurrentMeeting({ currentMeetingId: 'other' }, single!)).toBe(false);
    expect(isCurrentMeeting({ currentMeetingId: null }, single!)).toBe(false);

    const series = meeting({ startAt: '2026-10-15T20:00:00.000Z', recurrence: weekly() }, 'series');
    const [occurrence] = meetingsOnDay([series], '2026-11-12', ZONE);
    expect(isCurrentMeeting({ currentMeetingId: 'series' }, occurrence!)).toBe(false);
    expect(isCurrentMeeting({ currentMeetingId: 'series', currentOccurrenceDate: '2026-11-05' }, occurrence!)).toBe(false);
    expect(isCurrentMeeting({ currentMeetingId: 'series', currentOccurrenceDate: '2026-11-12' }, occurrence!)).toBe(true);
  });
});
