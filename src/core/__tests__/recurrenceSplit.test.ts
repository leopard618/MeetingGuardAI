/**
 * splitRecurrenceAt ("this and following", §16): master truncation (count -> until conversion),
 * remaining-rule computation, override partitioning and the edge cases.
 */
import { AppError } from '../errors';
import { CANCELLED_OVERRIDE, splitRecurrenceAt, type RecurringMeetingLike } from '../recurrence';

function weeklyMeeting(overrides: Partial<RecurringMeetingLike> = {}): RecurringMeetingLike {
  return {
    id: 'm1',
    title: 'Weekly sync',
    date: '2026-01-05', // a Monday
    time: '09:00',
    timezone: 'UTC',
    durationMinutes: 30,
    allDay: false,
    recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: 10 },
    recurrenceOverrides: null,
    ...overrides,
  };
}

describe('splitRecurrenceAt', () => {
  it('truncates a count rule to until and gives the tail the remaining count', () => {
    // Occurrences: Jan 5, 12, 19, 26, Feb 2, ... (10 total). Split at the 4th (Jan 26).
    const split = splitRecurrenceAt(weeklyMeeting(), '2026-01-26');
    expect(split).not.toBe('series_edit');
    if (split === 'series_edit') throw new Error('unreachable');
    expect(split.tailStartAt).toBe('2026-01-26T09:00:00.000Z');
    // Master until = 1 s before the split occurrence's original start; count cleared.
    expect(split.masterRule.until).toBe('2026-01-26T08:59:59.000Z');
    expect(split.masterRule.count).toBeNull();
    // 3 occurrences happened before the split -> 7 remain.
    expect(split.tailRule.count).toBe(7);
    expect(split.tailRule.until).toBeNull();
    expect(split.tailRule.freq).toBe('weekly');
    expect(split.tailRule.byWeekday).toEqual(['MO']);
    expect(split.masterOverrides).toBeNull();
    expect(split.tailOverrides).toBeNull();
  });

  it('keeps an until rule on the tail unchanged', () => {
    const meeting = weeklyMeeting({
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: '2026-03-30T09:00:00.000Z', count: null },
    });
    const split = splitRecurrenceAt(meeting, '2026-02-02');
    if (split === 'series_edit') throw new Error('unreachable');
    expect(split.masterRule.until).toBe('2026-02-02T08:59:59.000Z');
    expect(split.tailRule.until).toBe('2026-03-30T09:00:00.000Z');
    expect(split.tailRule.count).toBeNull();
  });

  it('keeps an endless rule endless on both sides except the master until', () => {
    const meeting = weeklyMeeting({
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null },
    });
    const split = splitRecurrenceAt(meeting, '2026-01-19');
    if (split === 'series_edit') throw new Error('unreachable');
    expect(split.masterRule.until).toBe('2026-01-19T08:59:59.000Z');
    expect(split.tailRule.until).toBeNull();
    expect(split.tailRule.count).toBeNull();
  });

  it('moves overrides at/after the split date to the tail and keeps earlier ones', () => {
    const modified = { status: 'modified' as const, startAt: '2026-01-12T10:00:00.000Z', durationMinutes: null, title: null };
    const meeting = weeklyMeeting({
      recurrenceOverrides: {
        '2026-01-12': modified,
        '2026-01-26': { ...CANCELLED_OVERRIDE },
        '2026-02-09': { ...CANCELLED_OVERRIDE },
      },
    });
    const split = splitRecurrenceAt(meeting, '2026-01-26');
    if (split === 'series_edit') throw new Error('unreachable');
    expect(Object.keys(split.masterOverrides ?? {})).toEqual(['2026-01-12']);
    expect(Object.keys(split.tailOverrides ?? {}).sort()).toEqual(['2026-01-26', '2026-02-09']);
  });

  it('counts cancelled occurrences before the split (they consume count)', () => {
    const meeting = weeklyMeeting({
      recurrenceOverrides: { '2026-01-12': { ...CANCELLED_OVERRIDE } },
    });
    const split = splitRecurrenceAt(meeting, '2026-01-26');
    if (split === 'series_edit') throw new Error('unreachable');
    // Jan 5, 12 (cancelled), 19 all consume count -> 10 - 3 = 7 remain.
    expect(split.tailRule.count).toBe(7);
  });

  it('returns series_edit for the first occurrence', () => {
    expect(splitRecurrenceAt(weeklyMeeting(), '2026-01-05')).toBe('series_edit');
  });

  it('rejects dates the series never generates and dates past its end', () => {
    // Wednesday: off-pattern for a MO rule.
    expect(() => splitRecurrenceAt(weeklyMeeting(), '2026-01-07')).toThrow(AppError);
    // The 11th Monday: past count 10.
    expect(() => splitRecurrenceAt(weeklyMeeting(), '2026-03-16')).toThrow(AppError);
    // Before the series starts.
    expect(() => splitRecurrenceAt(weeklyMeeting(), '2025-12-29')).toThrow(AppError);
    // Malformed key.
    expect(() => splitRecurrenceAt(weeklyMeeting(), '2026-13-40')).toThrow(AppError);
  });

  it('rejects a non-recurring meeting', () => {
    expect(() => splitRecurrenceAt(weeklyMeeting({ recurrence: null }), '2026-01-26')).toThrow(AppError);
  });

  it('derives instants in the meeting timezone (DST-safe)', () => {
    // Europe/Madrid: Mar 30 2026 is after the DST change (UTC+2); Jan Mondays are UTC+1.
    const meeting = weeklyMeeting({ timezone: 'Europe/Madrid' });
    const split = splitRecurrenceAt(meeting, '2026-01-26');
    if (split === 'series_edit') throw new Error('unreachable');
    expect(split.tailStartAt).toBe('2026-01-26T08:00:00.000Z'); // 09:00 CET
  });
});
