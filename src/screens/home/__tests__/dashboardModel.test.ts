/**
 * Pure helpers of the redesigned dashboard: the week chart bars, weekday initials, the elapsed
 * share of the meeting happening now, participant initials, and the kit's ring / bar maths.
 */
import { barHeight, MIN_FRACTION } from '../../../components/ui/MiniBars';
import { orbitRings } from '../../../components/ui/OrbitRings';
import type { Meeting } from '../../../core/types';
import type { DayLoad } from '../../insights/meetingInsights';
import { elapsedFraction, participantInitial, weekBars, weekdayInitial } from '../homeModel';

function day(date: string, minutes: number, count = minutes > 0 ? 1 : 0): DayLoad {
  return { key: date, date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), count, minutes };
}

describe('weekdayInitial', () => {
  it('gives the narrow weekday in the UI language and upper case', () => {
    expect(weekdayInitial('2026-11-01', 'en-US')).toBe('S');
    expect(weekdayInitial('2026-11-02', 'en-US')).toBe('M');
    expect(weekdayInitial('2026-11-01', 'es-ES')).toBe('D');
  });
});

describe('weekBars', () => {
  it('scales to the busiest day and highlights today', () => {
    const days = [day('2026-11-01', 0), day('2026-11-02', 60), day('2026-11-03', 120)];
    const bars = weekBars(days, '2026-11-02', 'en-US');
    expect(bars.map((bar) => bar.fraction)).toEqual([0, 0.5, 1]);
    expect(bars.map((bar) => bar.highlighted)).toEqual([false, true, false]);
    expect(bars.map((bar) => bar.label)).toEqual(['S', 'M', 'T']);
  });
});

describe('barHeight', () => {
  it('clamps to 0..1 and keeps a stub for empty days', () => {
    expect(barHeight(1, 64)).toBe(64);
    expect(barHeight(0.5, 64)).toBe(32);
    expect(barHeight(0, 64)).toBe(Math.round(MIN_FRACTION * 64));
    expect(barHeight(4, 64)).toBe(64);
    expect(barHeight(Number.NaN, 64)).toBe(Math.round(MIN_FRACTION * 64));
  });
});

describe('orbitRings', () => {
  it('grows the diameter outward and fades the alpha', () => {
    const rings = orbitRings(200, 4, 0.3);
    expect(rings.map((ring) => ring.diameter)).toEqual([50, 100, 150, 200]);
    expect(rings[0]!.alpha).toBeGreaterThan(rings[3]!.alpha);
    expect(rings[3]!.alpha).toBeGreaterThan(0);
  });
});

describe('elapsedFraction', () => {
  const meeting = { startAt: '2026-11-01T10:00:00.000Z', durationMinutes: 60 } as Meeting;
  it('is the elapsed share inside the meeting and null outside it', () => {
    expect(elapsedFraction(meeting, new Date('2026-11-01T10:30:00.000Z'))).toBeCloseTo(0.5);
    expect(elapsedFraction(meeting, new Date('2026-11-01T09:59:00.000Z'))).toBeNull();
    expect(elapsedFraction(meeting, new Date('2026-11-01T11:01:00.000Z'))).toBeNull();
    expect(elapsedFraction({ ...meeting, durationMinutes: 0 }, new Date('2026-11-01T10:00:00.000Z'))).toBeNull();
  });
});

describe('participantInitial', () => {
  it('prefers the name, then the email, upper case', () => {
    expect(participantInitial({ name: 'ana lopez', email: 'x@example.com' })).toBe('A');
    expect(participantInitial({ name: null, email: 'zoe@example.com' })).toBe('Z');
    expect(participantInitial({ name: '  ', email: '' })).toBe('?');
  });
});
