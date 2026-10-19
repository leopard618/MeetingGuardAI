/**
 * computeAlertPlan for RECURRING meetings (docs/v1/ARCHITECTURE.md §16) + occurrenceEffective.
 * One-off behaviour is covered by plan.test.ts and must not change.
 */
import type { Meeting, MeetingRecurrence, RecurrenceOverrides } from '../../../core/types';
import { computeAlertPlan, occurrenceEffective } from '../plan';
import { makeMeeting, makePrefs, NOW } from '../__fixtures__/alertFixtures';

const DAILY: MeetingRecurrence = { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };

/** Daily 14:00 UTC series anchored the day after NOW (2026-10-06). */
function dailySeries(overrides: Partial<Meeting> = {}, rule: Partial<MeetingRecurrence> = {}): Meeting {
  return makeMeeting('rec1', '2026-10-06T14:00:00.000Z', { recurrence: { ...DAILY, ...rule } }, overrides);
}

function withOverrides(meeting: Meeting, recurrenceOverrides: RecurrenceOverrides): Meeting {
  return { ...meeting, recurrenceOverrides };
}

describe('computeAlertPlan with recurring meetings', () => {
  it('emits 4-part occurrence ids with localDateKey for every occurrence in the horizon', () => {
    const meeting = dailySeries({}, { count: 3 });
    const plan = computeAlertPlan([meeting], makePrefs({ defaultAlertTimes: [15, 0], followUpEnabled: false }), NOW);

    expect(plan.items.map((item) => item.identifier)).toEqual([
      'mg:rec1:2026-10-06:15',
      'mg:rec1:2026-10-06:0',
      'mg:rec1:2026-10-07:15',
      'mg:rec1:2026-10-07:0',
      'mg:rec1:2026-10-08:15',
      'mg:rec1:2026-10-08:0',
    ]);
    expect(plan.items.every((item) => item.meetingId === 'rec1')).toBe(true);
    expect(plan.items.map((item) => item.localDateKey)).toEqual([
      '2026-10-06',
      '2026-10-06',
      '2026-10-07',
      '2026-10-07',
      '2026-10-08',
      '2026-10-08',
    ]);
    expect(plan.items[0]?.fireAt).toBe('2026-10-06T13:45:00.000Z');
    expect(plan.items[1]?.fireAt).toBe('2026-10-06T14:00:00.000Z');
    // The master's own 3-part ids never appear for a recurring meeting.
    expect(plan.items.some((item) => item.identifier === 'mg:rec1:15')).toBe(false);
    // Ended series inside the horizon: nothing beyond it.
    expect(plan.truncated).toBe(false);
  });

  it('emits one follow-up per occurrence with the occurrence id', () => {
    const meeting = dailySeries({}, { count: 2 });
    const plan = computeAlertPlan([meeting], makePrefs({ defaultAlertTimes: [] }), NOW);
    expect(plan.items.map((item) => item.identifier)).toEqual([
      'mg:rec1:2026-10-06:followup',
      'mg:rec1:2026-10-07:followup',
    ]);
    // end (15:00) + 5 min.
    expect(plan.items[0]?.fireAt).toBe('2026-10-06T15:05:00.000Z');
  });

  it('omits cancelled occurrences and honours modified ones at their EFFECTIVE time', () => {
    const meeting = withOverrides(dailySeries({}, { count: 3 }), {
      '2026-10-06': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
      '2026-10-07': { status: 'modified', startAt: '2026-10-07T16:30:00.000Z', durationMinutes: null, title: null },
    });
    const plan = computeAlertPlan([meeting], makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }), NOW);
    expect(plan.items.map((item) => [item.identifier, item.fireAt])).toEqual([
      ['mg:rec1:2026-10-07:0', '2026-10-07T16:30:00.000Z'], // moved, keyed by the ORIGINAL date
      ['mg:rec1:2026-10-08:0', '2026-10-08T14:00:00.000Z'],
    ]);
  });

  it('an endless series marks the plan truncated (reconcile again before the window runs out)', () => {
    const plan = computeAlertPlan([dailySeries()], makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }), NOW);
    expect(plan.truncated).toBe(true);
    expect(plan.refillBefore).not.toBeNull();
  });

  it('keeps the wall-clock time across a DST change (Europe/Madrid, Oct 2026)', () => {
    // 09:00 Madrid daily. DST ends Sun 2026-10-25: UTC start moves from 07:00 to 08:00.
    const meeting = makeMeeting(
      'dst1',
      '2026-10-20T07:00:00.000Z',
      { timezone: 'Europe/Madrid', recurrence: { ...DAILY, count: 8 } },
    );
    const now = new Date('2026-10-19T12:00:00.000Z');
    const plan = computeAlertPlan([meeting], makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }), now);
    const byKey = new Map(plan.items.map((item) => [item.localDateKey, item.fireAt]));
    expect(byKey.get('2026-10-24')).toBe('2026-10-24T07:00:00.000Z'); // CEST
    expect(byKey.get('2026-10-25')).toBe('2026-10-25T08:00:00.000Z'); // CET, still 09:00 local
    expect(byKey.get('2026-10-26')).toBe('2026-10-26T08:00:00.000Z');
  });

  it('weekly byWeekday series only alerts on the selected weekdays', () => {
    const meeting = makeMeeting('wk1', '2026-10-05T14:00:00.000Z', {
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO', 'FR'], byMonthDay: null, until: null, count: null },
    });
    const plan = computeAlertPlan([meeting], makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }), NOW, {
      horizonDays: 7,
    });
    // Mon 10-05 (today, 14:00 still ahead) and Fri 10-09; Mon 10-12 14:00 is past now + 7 d.
    expect(plan.items.map((item) => item.localDateKey)).toEqual(['2026-10-05', '2026-10-09']);
  });

  it('a pending snooze suppresses the matching occurrence alert only', () => {
    const meeting = dailySeries({}, { count: 2 });
    const plan = computeAlertPlan([meeting], makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }), NOW, {
      suppress: [{ meetingId: 'rec1', fireAt: '2026-10-06T14:00:00.000Z' }],
    });
    expect(plan.items.map((item) => item.identifier)).toEqual(['mg:rec1:2026-10-07:0']);
  });

  it('an all-day recurring meeting never alerts (eligibility unchanged)', () => {
    const meeting = makeMeeting('ad1', '2026-10-06T00:00:00.000Z', { allDay: true, recurrence: { ...DAILY, count: 5 } });
    expect(computeAlertPlan([meeting], makePrefs(), NOW).items).toEqual([]);
  });

  it('recurring alerts respect the budget together with one-offs (alerts first, earliest first)', () => {
    const series = dailySeries({}, { count: 10 });
    const single = makeMeeting('one1', '2026-10-06T13:00:00.000Z');
    const plan = computeAlertPlan([series, single], makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }), NOW, {
      budget: 4,
    });
    // 11 alerts > budget 4: one slot reserved for the refill reminder, earliest 3 kept.
    expect(plan.items.map((item) => item.identifier)).toEqual([
      'mg:one1:0',
      'mg:rec1:2026-10-06:0',
      'mg:rec1:2026-10-07:0',
    ]);
    expect(plan.refillReminderAt).not.toBeNull();
  });

  it('an occurrence that just ended still gets its follow-up (lookback window)', () => {
    // Occurrence 2026-10-05 14:00-15:00; now = 15:02 => follow-up at 15:05 is still pending.
    const meeting = makeMeeting('fb1', '2026-10-05T14:00:00.000Z', { recurrence: { ...DAILY, count: 2 } });
    const now = new Date('2026-10-05T15:02:00.000Z');
    const plan = computeAlertPlan([meeting], makePrefs({ defaultAlertTimes: [] }), now);
    expect(plan.items.map((item) => item.identifier)).toEqual([
      'mg:fb1:2026-10-05:followup',
      'mg:fb1:2026-10-06:followup',
    ]);
    expect(plan.items[0]?.fireAt).toBe('2026-10-05T15:05:00.000Z');
  });

  it('a large alert offset reaches occurrences past the horizon (window extends by the offset)', () => {
    // 2 days offset, horizon 14 days: the day-15 occurrence's alert fires on day 13.
    const meeting = dailySeries({}, { count: 30 });
    const plan = computeAlertPlan(
      [meeting],
      makePrefs({ defaultAlertTimes: [2 * 24 * 60], followUpEnabled: false }),
      NOW,
      { budget: 1000 },
    );
    const keys = plan.items.map((item) => item.localDateKey);
    expect(keys).toContain('2026-10-20'); // starts day 15 (> horizon), alert on day 13
    expect(plan.truncated).toBe(true);
  });

  it('falls back to the one-off path when the stored rule is invalid (never drops the meeting)', () => {
    const broken = {
      ...dailySeries(),
      recurrence: { freq: 'daily', interval: 0, byWeekday: null, byMonthDay: null, until: null, count: null },
    } as unknown as Meeting;
    const plan = computeAlertPlan([broken], makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }), NOW);
    expect(plan.items.map((item) => item.identifier)).toEqual(['mg:rec1:0']);
    expect(plan.items[0]?.localDateKey).toBeUndefined();
  });
});

describe('occurrenceEffective', () => {
  const meeting = withOverrides(dailySeries(), {
    '2026-10-07': { status: 'modified', startAt: '2026-10-07T16:30:00.000Z', durationMinutes: 30, title: 'Moved' },
    '2026-10-08': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
    '2026-10-09': { status: 'modified', startAt: null, durationMinutes: null, title: 'Renamed only' },
  });

  it('returns the master values for an untouched occurrence', () => {
    expect(occurrenceEffective(meeting, '2026-10-06')).toEqual({
      localDateKey: '2026-10-06',
      startAt: '2026-10-06T14:00:00.000Z',
      durationMinutes: 60,
      title: 'Meeting rec1',
      overridden: false,
    });
  });

  it('applies modified overrides field by field (null keeps the original)', () => {
    expect(occurrenceEffective(meeting, '2026-10-07')).toEqual({
      localDateKey: '2026-10-07',
      startAt: '2026-10-07T16:30:00.000Z',
      durationMinutes: 30,
      title: 'Moved',
      overridden: true,
    });
    expect(occurrenceEffective(meeting, '2026-10-09')).toMatchObject({
      startAt: '2026-10-09T14:00:00.000Z',
      durationMinutes: 60,
      title: 'Renamed only',
    });
  });

  it('returns null for cancelled occurrences, bad keys and non-recurring meetings', () => {
    expect(occurrenceEffective(meeting, '2026-10-08')).toBeNull();
    expect(occurrenceEffective(meeting, 'garbage')).toBeNull();
    expect(occurrenceEffective(makeMeeting('one', '2026-10-06T14:00:00.000Z'), '2026-10-06')).toBeNull();
  });

  it('derives the start from the meeting wall clock in its own zone (DST-safe)', () => {
    const madrid = makeMeeting('mz', '2026-10-20T07:00:00.000Z', { timezone: 'Europe/Madrid', recurrence: { ...DAILY } });
    expect(occurrenceEffective(madrid, '2026-10-26')?.startAt).toBe('2026-10-26T08:00:00.000Z'); // 09:00 CET
  });
});
