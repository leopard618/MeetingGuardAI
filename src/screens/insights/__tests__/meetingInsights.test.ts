import { displayWindowAround, displayWindowForDays, expandMeetingsForDisplay } from '../../meetings/occurrences';
import { makeMeeting } from '../__fixtures__/meetings';
import {
  computeDashboardSummary,
  computePeriodInsights,
  findBackToBack,
  findOverlaps,
  hasPlace,
  meetingDates,
  meetingJoinLink,
  monthRange,
  periodRange,
  weekRange,
  weekStartForLanguage,
  type InsightContext,
} from '../meetingInsights';

// Wednesday 30 September 2026, 10:00 UTC.
const NOW = new Date('2026-09-30T10:00:00.000Z');
const UTC_SUNDAY: InsightContext = { now: NOW, timeZone: 'UTC', weekStartsOn: 0 };
const UTC_MONDAY: InsightContext = { now: NOW, timeZone: 'UTC', weekStartsOn: 1 };

describe('ranges', () => {
  it('builds the calendar week for Sunday and Monday starts', () => {
    expect(weekRange(UTC_SUNDAY)).toMatchObject({ from: '2026-09-27', to: '2026-10-03' });
    expect(weekRange(UTC_MONDAY)).toMatchObject({ from: '2026-09-28', to: '2026-10-04' });
    expect(weekRange(UTC_MONDAY).days).toHaveLength(7);
  });

  it('builds the calendar month (30, 31 and February lengths)', () => {
    expect(monthRange(UTC_MONDAY)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange({ ...UTC_MONDAY, now: new Date('2026-10-15T12:00:00Z') }).days).toHaveLength(31);
    expect(monthRange({ ...UTC_MONDAY, now: new Date('2028-02-10T12:00:00Z') }).to).toBe('2028-02-29');
  });

  it('uses the device zone for "today" (late evening in New York is still the same day there)', () => {
    const context: InsightContext = { now: new Date('2026-10-01T02:00:00Z'), timeZone: 'America/New_York', weekStartsOn: 0 };
    expect(weekRange(context).days).toContain('2026-09-30');
    const evening = makeMeeting({ id: 'late', startAt: '2026-10-01T01:00:00.000Z' });
    expect(meetingDates(evening, 'America/New_York')).toEqual(['2026-09-30']);
    expect(meetingDates(evening, 'UTC')).toEqual(['2026-10-01']);
  });

  it('keeps all-day meetings on their own dates (multi-day included)', () => {
    const offsite = makeMeeting({ id: 'offsite', startAt: '2026-09-29T04:00:00.000Z', allDay: true, date: '2026-09-29', durationMinutes: 2880 });
    expect(meetingDates(offsite, 'Asia/Tokyo')).toEqual(['2026-09-29', '2026-09-30']);
  });

  it('picks the week start from the language', () => {
    expect(weekStartForLanguage('en')).toBe(0);
    expect(weekStartForLanguage('es')).toBe(1);
  });
});

describe('places and links', () => {
  it('only accepts real http(s) links', () => {
    expect(meetingJoinLink(makeMeeting({ id: 'a', startAt: NOW.toISOString(), conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: null } }))).toBe(
      'https://zoom.us/j/1',
    );
    expect(meetingJoinLink(makeMeeting({ id: 'b', startAt: NOW.toISOString(), conference: { provider: 'google_meet', url: null, password: null } }))).toBeNull();
    expect(
      meetingJoinLink(makeMeeting({ id: 'c', startAt: NOW.toISOString(), location: { type: 'virtual', address: null, virtualUrl: 'javascript:alert(1)' } })),
    ).toBeNull();
  });

  it('counts an address or a link as a place', () => {
    expect(hasPlace(makeMeeting({ id: 'a', startAt: NOW.toISOString(), location: { type: 'physical', address: 'Room 4', virtualUrl: null } }))).toBe(true);
    expect(hasPlace(makeMeeting({ id: 'b', startAt: NOW.toISOString(), location: { type: 'physical', address: '  ', virtualUrl: null } }))).toBe(false);
    expect(hasPlace(makeMeeting({ id: 'c', startAt: NOW.toISOString() }))).toBe(false);
  });
});

describe('conflicts', () => {
  const a = makeMeeting({ id: 'a', startAt: '2026-09-30T09:00:00.000Z', durationMinutes: 60 });
  const b = makeMeeting({ id: 'b', startAt: '2026-09-30T09:30:00.000Z', durationMinutes: 60 });
  const c = makeMeeting({ id: 'c', startAt: '2026-09-30T10:33:00.000Z', durationMinutes: 30 });
  const d = makeMeeting({ id: 'd', startAt: '2026-09-30T12:00:00.000Z', durationMinutes: 30 });

  it('finds overlapping pairs and ignores cancelled, deleted and all-day meetings', () => {
    const cancelled = makeMeeting({ id: 'x', startAt: '2026-09-30T09:15:00.000Z', status: 'cancelled' });
    const deleted = makeMeeting({ id: 'y', startAt: '2026-09-30T09:15:00.000Z', deletedAt: '2026-09-29T00:00:00.000Z' });
    const allDay = makeMeeting({ id: 'z', startAt: '2026-09-30T00:00:00.000Z', allDay: true, durationMinutes: 1440 });
    const pairs = findOverlaps([d, c, b, a, cancelled, deleted, allDay]);
    expect(pairs.map((pair) => [pair.first.id, pair.second.id])).toEqual([['a', 'b']]);
  });

  it('does not treat touching meetings as overlapping', () => {
    const e = makeMeeting({ id: 'e', startAt: '2026-09-30T13:00:00.000Z', durationMinutes: 30 });
    const f = makeMeeting({ id: 'f', startAt: '2026-09-30T13:30:00.000Z', durationMinutes: 30 });
    expect(findOverlaps([e, f])).toEqual([]);
    expect(findBackToBack([e, f]).map((pair) => [pair.first.id, pair.second.id])).toEqual([['e', 'f']]);
  });

  it('finds back-to-back meetings within the gap (3 minutes after b ends) but not overlaps or long breaks', () => {
    expect(findBackToBack([a, b, c, d]).map((pair) => [pair.first.id, pair.second.id])).toEqual([['b', 'c']]);
    expect(findBackToBack([a, b, c, d], 2)).toEqual([]);
  });
});

describe('computeDashboardSummary', () => {
  it('counts today and this week, with issues only for meetings that have not ended', () => {
    const meetings = [
      // Earlier today (ended), overlapping each other: counted, but not an upcoming issue.
      makeMeeting({ id: 'm1', startAt: '2026-09-30T07:00:00.000Z', durationMinutes: 60 }),
      makeMeeting({ id: 'm2', startAt: '2026-09-30T07:30:00.000Z', durationMinutes: 60 }),
      // Later today: overlap + missing place.
      makeMeeting({ id: 'm3', startAt: '2026-09-30T14:00:00.000Z', durationMinutes: 60, preparationTips: ['Read the brief'] }),
      makeMeeting({
        id: 'm4',
        startAt: '2026-09-30T14:30:00.000Z',
        durationMinutes: 30,
        conference: { provider: 'zoom', url: 'https://zoom.us/j/9', password: null },
      }),
      // Friday: back-to-back after m6.
      makeMeeting({ id: 'm6', startAt: '2026-10-02T09:00:00.000Z', durationMinutes: 60, location: { type: 'physical', address: 'HQ', virtualUrl: null } }),
      makeMeeting({ id: 'm7', startAt: '2026-10-02T10:00:00.000Z', durationMinutes: 45, location: { type: 'physical', address: 'HQ', virtualUrl: null } }),
      // Next week and cancelled: not counted.
      makeMeeting({ id: 'm8', startAt: '2026-10-05T09:00:00.000Z' }),
      makeMeeting({ id: 'm9', startAt: '2026-09-30T16:00:00.000Z', status: 'cancelled' }),
      // All-day today: a meeting, no minutes.
      makeMeeting({ id: 'm10', startAt: '2026-09-30T00:00:00.000Z', allDay: true, durationMinutes: 1440 }),
    ];
    expect(computeDashboardSummary(meetings, UTC_SUNDAY)).toEqual({
      today: { count: 5, minutes: 60 + 60 + 60 + 30 },
      week: { count: 7, minutes: 60 + 60 + 60 + 30 + 60 + 45 },
      upcoming: { overlaps: 1, backToBack: 1, missingPlace: 1, withTips: 1 },
    });
  });

  it('is empty for no meetings', () => {
    expect(computeDashboardSummary([], UTC_SUNDAY)).toEqual({
      today: { count: 0, minutes: 0 },
      week: { count: 0, minutes: 0 },
      upcoming: { overlaps: 0, backToBack: 0, missingPlace: 0, withTips: 0 },
    });
  });
});

describe('computePeriodInsights', () => {
  const meetings = [
    makeMeeting({ id: 'mon', startAt: '2026-09-28T09:00:00.000Z', durationMinutes: 30, source: 'google' }),
    makeMeeting({ id: 'tue1', startAt: '2026-09-29T09:00:00.000Z', durationMinutes: 60, source: 'ai_chat' }),
    makeMeeting({ id: 'tue2', startAt: '2026-09-29T09:30:00.000Z', durationMinutes: 90, source: 'google' }),
    makeMeeting({ id: 'wed', startAt: '2026-09-30T15:00:00.000Z', durationMinutes: 60, preparationTips: ['Agenda'] }),
    makeMeeting({ id: 'holiday', startAt: '2026-10-01T00:00:00.000Z', allDay: true, durationMinutes: 1440, source: 'device' }),
    makeMeeting({ id: 'lastMonth', startAt: '2026-08-31T09:00:00.000Z' }),
    makeMeeting({ id: 'tue3', startAt: '2026-09-22T09:00:00.000Z', durationMinutes: 120 }),
  ];

  it('computes the week: load per date, busiest day, average, sources and conflicts', () => {
    const insights = computePeriodInsights(meetings, 'week', UTC_MONDAY);
    expect(insights.range).toMatchObject({ from: '2026-09-28', to: '2026-10-04' });
    expect(insights.count).toBe(5);
    expect(insights.allDayCount).toBe(1);
    expect(insights.totalMinutes).toBe(240);
    expect(insights.averageMinutes).toBe(60);
    expect(insights.days.map((day) => [day.date, day.count, day.minutes])).toEqual([
      ['2026-09-28', 1, 30],
      ['2026-09-29', 2, 150],
      ['2026-09-30', 1, 60],
      ['2026-10-01', 1, 0],
      ['2026-10-02', 0, 0],
      ['2026-10-03', 0, 0],
      ['2026-10-04', 0, 0],
    ]);
    expect(insights.days[0]?.weekday).toBe(1);
    expect(insights.busiestDay).toEqual({ date: '2026-09-29', count: 2, minutes: 150 });
    expect(insights.sources).toEqual([
      { source: 'google', count: 2 },
      { source: 'manual', count: 1 },
      { source: 'ai_chat', count: 1 },
      { source: 'device', count: 1 },
    ]);
    expect(insights.overlaps.map((pair) => [pair.first.id, pair.second.id])).toEqual([['tue1', 'tue2']]);
    // Past meetings are not "needs attention"; only "wed" (upcoming, no place) is.
    expect(insights.missingPlace.map((meeting) => meeting.id)).toEqual(['wed']);
    expect(insights.withTips.map((meeting) => meeting.id)).toEqual(['wed']);
  });

  it('computes the month by weekday (totals), starting on the week start', () => {
    const insights = computePeriodInsights(meetings, 'month', UTC_SUNDAY);
    expect(insights.range).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(insights.count).toBe(5);
    expect(insights.days.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const tuesday = insights.days.find((day) => day.weekday === 2);
    expect(tuesday).toMatchObject({ date: null, count: 3, minutes: 270 });
    expect(insights.busiestDay).toEqual({ date: '2026-09-29', count: 2, minutes: 150 });
  });

  it('reports nothing for an empty period', () => {
    const insights = computePeriodInsights([], 'week', UTC_MONDAY);
    expect(insights).toMatchObject({ count: 0, totalMinutes: 0, averageMinutes: null, busiestDay: null, sources: [], overlaps: [] });
  });
});

describe('recurring meetings through the display expansion (screen wiring)', () => {
  // Mirrors what DashboardScreen / AIInsightsScreen do: expand masters to occurrence rows first,
  // then feed the SAME rows to the summary / insight models, so counts match the timeline.
  const WEEKLY = { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null } as const;

  it('the dashboard summary counts every occurrence of the week, not just the stored master', () => {
    // Anchored weeks earlier on a Wednesday: the master's own startAt is far in the past, but
    // NOW (Wednesday 2026-09-30) falls on an occurrence.
    const series = makeMeeting({ id: 'standup', startAt: '2026-09-02T14:00:00.000Z', recurrence: WEEKLY });
    const window = displayWindowAround(NOW, 'UTC', 7, 370);
    const expanded = expandMeetingsForDisplay([series], window);

    const raw = computeDashboardSummary([series], UTC_MONDAY);
    expect(raw.today.count).toBe(0); // the master alone misses today's occurrence

    const summary = computeDashboardSummary(expanded, UTC_MONDAY);
    expect(summary.today).toEqual({ count: 1, minutes: 60 });
    expect(summary.week).toEqual({ count: 1, minutes: 60 });
  });

  it('period insights count occurrences, chart their load and detect occurrence-level overlaps', () => {
    const series = makeMeeting({ id: 'standup', startAt: '2026-09-02T14:00:00.000Z', recurrence: WEEKLY });
    // One-off that overlaps THIS week's occurrence (Wed 2026-09-30 14:00-15:00).
    const clash = makeMeeting({ id: 'clash', startAt: '2026-09-30T14:30:00.000Z' });
    const range = periodRange('week', UTC_MONDAY);
    const expanded = expandMeetingsForDisplay([series, clash], displayWindowForDays(range.from, range.to, 'UTC'));

    const insights = computePeriodInsights(expanded, 'week', UTC_MONDAY);
    expect(insights.count).toBe(2);
    expect(insights.days.find((day) => day.date === '2026-09-30')).toMatchObject({ count: 2, minutes: 120 });
    expect(insights.overlaps.map((pair) => [pair.first.id, pair.second.id])).toEqual([['standup', 'clash']]);

    const monthRange2 = periodRange('month', UTC_MONDAY);
    const monthly = computePeriodInsights(
      expandMeetingsForDisplay([series], displayWindowForDays(monthRange2.from, monthRange2.to, 'UTC')),
      'month',
      UTC_MONDAY,
    );
    // September 2026 has five Wednesdays with an occurrence from the 2nd on.
    expect(monthly.count).toBe(5);
  });
});
