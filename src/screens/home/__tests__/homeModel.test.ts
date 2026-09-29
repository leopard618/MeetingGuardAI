import type { InsightContext } from '../../insights/meetingInsights';
import { makeMeeting } from '../../insights/__fixtures__/meetings';
import {
  buildTodayTimeline,
  countdownDisplay,
  countdownTickMs,
  countdownTo,
  dayPeriodOf,
  findNowAndNext,
  firstNameOf,
  formatCountdownClock,
} from '../homeModel';

const NOW = new Date('2026-09-30T10:00:00.000Z');
const CONTEXT: InsightContext = { now: NOW, timeZone: 'UTC', weekStartsOn: 0 };

describe('greeting helpers', () => {
  it('maps hours to parts of the day', () => {
    expect([4, 5, 11, 12, 17, 18, 23].map(dayPeriodOf)).toEqual([
      'evening',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
  });

  it('uses the first name and never an email address', () => {
    expect(firstNameOf('Ana María López')).toBe('Ana');
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf('ana@example.com')).toBeNull();
  });
});

describe('findNowAndNext', () => {
  it('returns the meeting in progress and the next timed, scheduled meeting', () => {
    const meetings = [
      makeMeeting({ id: 'past', startAt: '2026-09-30T08:00:00.000Z' }),
      makeMeeting({ id: 'current', startAt: '2026-09-30T09:30:00.000Z' }),
      makeMeeting({ id: 'allDay', startAt: '2026-09-30T00:00:00.000Z', allDay: true, durationMinutes: 1440 }),
      makeMeeting({ id: 'cancelled', startAt: '2026-09-30T10:15:00.000Z', status: 'cancelled' }),
      makeMeeting({ id: 'later', startAt: '2026-10-01T09:00:00.000Z' }),
      makeMeeting({ id: 'next', startAt: '2026-09-30T11:00:00.000Z' }),
    ];
    const result = findNowAndNext(meetings, NOW);
    expect(result.current?.id).toBe('current');
    expect(result.next?.id).toBe('next');
  });

  it('returns nulls without meetings', () => {
    expect(findNowAndNext([], NOW)).toEqual({ current: null, next: null });
  });
});

describe('countdown', () => {
  const nowMs = NOW.getTime();

  it('splits the time left and formats a clock', () => {
    expect(countdownTo(nowMs + 3_723_000, nowMs)).toEqual({ totalSeconds: 3723, hours: 1, minutes: 2, seconds: 3 });
    expect(formatCountdownClock(countdownTo(nowMs + 3_723_000, nowMs))).toBe('1:02:03');
    expect(formatCountdownClock(countdownTo(nowMs + 245_000, nowMs))).toBe('4:05');
    expect(countdownTo(nowMs - 1000, nowMs).totalSeconds).toBe(0);
  });

  it('picks a display for each distance', () => {
    expect(countdownDisplay(nowMs + 245_000, nowMs)).toEqual({ kind: 'clock', text: '4:05' });
    expect(countdownDisplay(nowMs + 2 * 3_600_000 + 30_000, nowMs)).toEqual({ kind: 'duration', minutes: 121 });
    expect(countdownDisplay(nowMs + 30 * 3_600_000, nowMs)).toEqual({ kind: 'relative' });
    expect(countdownDisplay(nowMs, nowMs)).toEqual({ kind: 'now' });
  });

  it('ticks every second only in the last hour', () => {
    expect(countdownTickMs(nowMs + 10 * 60_000, nowMs)).toBe(1000);
    expect(countdownTickMs(nowMs + 2 * 3_600_000, nowMs)).toBe(30_000);
    expect(countdownTickMs(null, nowMs)).toBe(30_000);
  });
});

describe('buildTodayTimeline', () => {
  it('orders today with states, overlaps and back-to-back links', () => {
    const meetings = [
      makeMeeting({ id: 'standup', startAt: '2026-09-30T08:00:00.000Z', durationMinutes: 15 }),
      makeMeeting({ id: 'review', startAt: '2026-09-30T09:30:00.000Z', durationMinutes: 60 }),
      makeMeeting({ id: 'sync', startAt: '2026-09-30T10:05:00.000Z', durationMinutes: 30 }),
      makeMeeting({ id: 'lunch', startAt: '2026-09-30T10:37:00.000Z', durationMinutes: 30 }),
      makeMeeting({ id: 'dropped', startAt: '2026-09-30T13:00:00.000Z', status: 'cancelled' }),
      makeMeeting({ id: 'holiday', startAt: '2026-09-30T00:00:00.000Z', allDay: true, durationMinutes: 1440 }),
      makeMeeting({ id: 'tomorrow', startAt: '2026-10-01T09:00:00.000Z' }),
    ];
    const timeline = buildTodayTimeline(meetings, CONTEXT);
    expect(timeline.map((item) => [item.meeting.id, item.state])).toEqual([
      ['holiday', 'now'],
      ['standup', 'past'],
      ['review', 'now'],
      ['sync', 'upcoming'],
      ['lunch', 'upcoming'],
      ['dropped', 'upcoming'],
    ]);
    const byId = new Map(timeline.map((item) => [item.meeting.id, item]));
    expect(byId.get('review')?.overlapsWith.map((meeting) => meeting.id)).toEqual(['sync']);
    expect(byId.get('sync')?.overlapsWith.map((meeting) => meeting.id)).toEqual(['review']);
    // "lunch" starts 2 minutes after "sync" ends; "sync" itself overlaps "review" (not back-to-back).
    expect(byId.get('lunch')?.followsRightAfter?.id).toBe('sync');
    expect(byId.get('sync')?.followsRightAfter).toBeNull();
    expect(byId.get('dropped')?.overlapsWith).toEqual([]);
  });
});
