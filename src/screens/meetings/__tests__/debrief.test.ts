import { canDebrief } from '../debrief';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const base = { durationMinutes: 60, status: 'scheduled' as const, recurrence: null };

describe('canDebrief', () => {
  it('is true once start + duration is in the past', () => {
    expect(canDebrief({ ...base, startAt: '2026-11-02T10:00:00.000Z' }, NOW)).toBe(true);
    expect(canDebrief({ ...base, startAt: '2026-11-02T11:00:00.000Z' }, NOW)).toBe(true);
    expect(canDebrief({ ...base, startAt: '2026-11-02T11:30:00.000Z' }, NOW)).toBe(false);
    expect(canDebrief({ ...base, startAt: '2026-11-03T09:00:00.000Z' }, NOW)).toBe(false);
  });

  it('never for a cancelled meeting or an unreadable start', () => {
    expect(canDebrief({ ...base, startAt: '2026-11-01T10:00:00.000Z', status: 'cancelled' }, NOW)).toBe(false);
    expect(canDebrief({ ...base, startAt: 'nope' }, NOW)).toBe(false);
  });

  it('a series can be debriefed once its first occurrence has started', () => {
    const weekly = { freq: 'weekly' as const, interval: 1, byWeekday: ['MO' as const], byMonthDay: null, until: null, count: null };
    expect(canDebrief({ ...base, recurrence: weekly, startAt: '2026-10-05T15:00:00.000Z' }, NOW)).toBe(true);
    expect(canDebrief({ ...base, recurrence: weekly, startAt: '2026-11-09T15:00:00.000Z' }, NOW)).toBe(false);
  });
});
