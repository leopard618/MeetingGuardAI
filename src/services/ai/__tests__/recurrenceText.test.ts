import type { RecurrenceRule } from '../../../core/aiContract';
import { createTranslator } from '../__fixtures__/aiTestKit';
import { recurrenceScopeText, recurrenceSummary, untilLocalDate } from '../recurrenceText';

const formatDate = (localDate: string): string => localDate;

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null, ...overrides };
}

describe('untilLocalDate', () => {
  it('shows the inclusive until instant as its local calendar day in the meeting zone', () => {
    // 23:59 on Dec 31 in Madrid, stored as UTC: still "Dec 31" for the user.
    expect(untilLocalDate('2026-12-31T22:59:00.000Z', 'Europe/Madrid')).toBe('2026-12-31');
    expect(untilLocalDate('2026-12-31T22:59:00.000Z', 'UTC')).toBe('2026-12-31');
    // Unknown zone: falls back without throwing.
    expect(untilLocalDate('2026-12-31T22:59:00.000Z', 'Not/AZone')).toBe('2026-12-31');
  });
});

describe('recurrenceSummary (EN)', () => {
  const t = createTranslator('en');

  it('reads a null rule as "does not repeat"', () => {
    expect(recurrenceSummary(t, null, { formatDate })).toBe('Does not repeat');
  });

  it('describes daily, weekly and monthly rules with intervals', () => {
    expect(recurrenceSummary(t, rule({ freq: 'daily' }), { formatDate })).toBe('Repeats daily');
    expect(recurrenceSummary(t, rule({ freq: 'daily', interval: 3 }), { formatDate })).toBe('Repeats every 3 days');
    expect(recurrenceSummary(t, rule({ byWeekday: ['MO', 'WE'] }), { formatDate })).toBe('Repeats weekly on Monday, Wednesday');
    expect(recurrenceSummary(t, rule({ freq: 'monthly', byMonthDay: 15 }), { formatDate })).toBe('Repeats monthly on day 15');
  });

  it('fills the weekly weekday and the monthly day from the anchor date', () => {
    // 2026-10-05 is a Monday.
    expect(recurrenceSummary(t, rule(), { formatDate, anchorDate: '2026-10-05' })).toBe('Repeats weekly on Monday');
    expect(recurrenceSummary(t, rule({ freq: 'monthly' }), { formatDate, anchorDate: '2026-10-05' })).toBe('Repeats monthly on day 5');
    // Without an anchor nothing is guessed.
    expect(recurrenceSummary(t, rule(), { formatDate })).toBe('Repeats weekly');
  });

  it('appends the end: an until day (meeting zone) or a total count', () => {
    expect(
      recurrenceSummary(t, rule({ byWeekday: ['MO'], until: '2026-12-31T22:59:00.000Z' }), {
        formatDate,
        timezone: 'Europe/Madrid',
      }),
    ).toBe('Repeats weekly on Monday, until 2026-12-31');
    expect(recurrenceSummary(t, rule({ count: 10 }), { formatDate, anchorDate: '2026-10-05' })).toBe(
      'Repeats weekly on Monday, 10 times in total',
    );
    expect(recurrenceSummary(t, rule({ count: 1 }), { formatDate, anchorDate: '2026-10-05' })).toBe(
      'Repeats weekly on Monday, 1 time in total',
    );
  });
});

describe('recurrenceSummary (ES)', () => {
  const t = createTranslator('es');

  it('reads naturally in Spanish', () => {
    expect(recurrenceSummary(t, null, { formatDate })).toBe('No se repite');
    expect(recurrenceSummary(t, rule({ byWeekday: ['MO'] }), { formatDate })).toBe('Se repite cada semana los lunes');
    expect(recurrenceSummary(t, rule({ freq: 'daily', interval: 2 }), { formatDate })).toBe('Se repite cada 2 días');
    expect(recurrenceSummary(t, rule({ freq: 'monthly', byMonthDay: 1, count: 6 }), { formatDate })).toBe(
      'Se repite cada mes el día 1, 6 veces en total',
    );
  });
});

describe('recurrenceScopeText', () => {
  const t = createTranslator('en');

  it('names the occurrence date for occurrence-scoped actions', () => {
    expect(
      recurrenceScopeText(t, { scope: 'occurrence', occurrenceDate: '2026-10-05', targetRecurring: true, formatDate }),
    ).toBe('Only the occurrence on 2026-10-05');
  });

  it('says "whole series" for series scope, and for recurring targets without a scope', () => {
    expect(recurrenceScopeText(t, { scope: 'series', occurrenceDate: null, targetRecurring: true, formatDate })).toBe(
      'The whole repeating series',
    );
    expect(recurrenceScopeText(t, { scope: undefined, occurrenceDate: null, targetRecurring: true, formatDate })).toBe(
      'The whole repeating series',
    );
  });

  it('adds nothing for one-off meetings', () => {
    expect(recurrenceScopeText(t, { scope: undefined, occurrenceDate: null, targetRecurring: false, formatDate })).toBeNull();
    // An occurrence scope without a usable date never invents one.
    expect(recurrenceScopeText(t, { scope: 'occurrence', occurrenceDate: 'garbage', targetRecurring: true, formatDate })).toBeNull();
  });
});
