/**
 * M11 deadlines read by code (functions/src/commitments/due.ts; docs/v2/M11-DESIGN.md section 2.4
 * check 6 and section 15 finding 6): absolute, year-less, numeric and EN/ES relative dates counted
 * from the meeting's local date, clock times only from clock forms, the bounds, the reference day,
 * and the DST weeks. All text is synthetic.
 */
import {
  DUE_BOUNDS,
  isOverdue,
  readClockTimes,
  referenceDayOf,
  resolveDue,
  weekdayOf,
  withinDueBounds,
} from '../../src/commitments/due';

// 2026-10-15 is a Thursday, 2026-10-16 a Friday, 2026-11-12 a Thursday.
const THU = '2026-10-15';
const FRI = '2026-10-16';

function dates(quote: string, reference: string = THU): string[] {
  return resolveDue(quote, reference, 'en').dates;
}

describe('resolveDue: absolute dates', () => {
  it('reads every date with a year that datesIn reads, in EN and ES', () => {
    expect(resolveDue('due 2026-11-21', THU)).toEqual({ kind: 'absolute', dates: ['2026-11-21'] });
    expect(dates('by Nov 21, 2026')).toEqual(['2026-11-21']);
    expect(dates('el 21 de noviembre de 2026')).toEqual(['2026-11-21']);
    expect(dates('between 2026-11-20 and 2026-11-21')).toEqual(['2026-11-20', '2026-11-21']);
  });

  it('reads a month and day without a year as the first one on or after the reference day minus 1, across New Year', () => {
    expect(resolveDue('by Nov 21', THU)).toEqual({ kind: 'month_day', dates: ['2026-11-21'] });
    expect(dates('21 de noviembre')).toEqual(['2026-11-21']);
    expect(dates('November 21st')).toEqual(['2026-11-21']);
    // Read on Dec 30: Jan 5 is next year's; Dec 29 (the day before) is still this year's.
    expect(dates('by Jan 5', '2026-12-30')).toEqual(['2027-01-05']);
    expect(dates('Dec 29', '2026-12-30')).toEqual(['2026-12-29']);
    expect(dates('Dec 28', '2026-12-30')).toEqual(['2027-12-28']);
  });

  it('keeps a numeric date only when both readings agree or only one is a date; "10/11" is ambiguous', () => {
    expect(resolveDue('by 10/11', THU)).toEqual({ kind: 'ambiguous', dates: [] });
    expect(resolveDue('10/11/2026', THU)).toEqual({ kind: 'ambiguous', dates: [] });
    expect(resolveDue('by 11/11', THU)).toEqual({ kind: 'numeric', dates: ['2026-11-11'] });
    expect(dates('el 25/11')).toEqual(['2026-11-25']);
    expect(dates('11/12/26')).toEqual([]);
    expect(dates('12.12.2026')).toEqual(['2026-12-12']);
  });
});

describe('resolveDue: relative phrases from the reference day', () => {
  it('today, tonight and end of day are the reference day; tomorrow is the next one', () => {
    for (const quote of ['today', 'tonight', 'by end of day', 'EOD', 'hoy', 'esta noche']) expect(dates(quote)).toEqual([THU]);
    expect(dates('tomorrow')).toEqual([FRI]);
    expect(dates('the day after tomorrow')).toEqual(['2026-10-17']);
    expect(dates('pasado mañana')).toEqual(['2026-10-17']);
  });

  it('"mañana" is tomorrow, but never "por la mañana", "esta mañana" or "las mañanas"', () => {
    expect(resolveDue('mañana', THU, 'es').dates).toEqual([FRI]);
    expect(resolveDue('para mañana', THU, 'es').dates).toEqual([FRI]);
    expect(resolveDue('mañana por la mañana', THU, 'es').dates).toEqual([FRI]);
    expect(resolveDue('por la mañana', THU, 'es')).toEqual({ kind: 'none', dates: [] });
    expect(resolveDue('esta mañana', THU, 'es').dates).toEqual([]);
    expect(resolveDue('todas las mañanas', THU, 'es').dates).toEqual([]);
  });

  it('"by Friday" is the first Friday AFTER the reference day, from a Thursday and from a Friday', () => {
    expect(dates('by Friday', THU)).toEqual([FRI]);
    expect(dates('by Friday', FRI)).toEqual(['2026-10-23']);
    expect(dates('el viernes', THU)).toEqual([FRI]);
    expect(dates('by Fri', THU)).toEqual([FRI]);
    expect(dates('on Monday', THU)).toEqual(['2026-10-19']);
    expect(dates('antes del miércoles', THU)).toEqual(['2026-10-21']);
  });

  it('"next Friday" may be that one or the one after', () => {
    expect(dates('next Friday', THU)).toEqual([FRI, '2026-10-23']);
    expect(dates('el próximo viernes', THU)).toEqual([FRI, '2026-10-23']);
    expect(dates('el viernes que viene', THU)).toEqual([FRI, '2026-10-23']);
  });

  it('this week and end of week are its Friday; the weekend its Friday to Sunday; next week its Monday or Friday', () => {
    expect(dates('this week')).toEqual([FRI]);
    expect(dates('by end of the week')).toEqual([FRI]);
    expect(dates('esta semana')).toEqual([FRI]);
    expect(dates('a fin de la semana')).toEqual([FRI]);
    expect(dates('el fin de semana')).toEqual([FRI, '2026-10-17', '2026-10-18']);
    expect(dates('next week')).toEqual(['2026-10-19', '2026-10-23']);
    expect(dates('la próxima semana')).toEqual(['2026-10-19', '2026-10-23']);
  });

  it('end of month, also in February and in a leap year', () => {
    expect(dates('by end of month')).toEqual(['2026-10-31']);
    expect(dates('fin de mes', '2027-02-10')).toEqual(['2027-02-28']);
    expect(dates('end of the month', '2028-02-10')).toEqual(['2028-02-29']);
  });

  it('in N days or weeks, digits or words, EN and ES', () => {
    expect(dates('in 3 weeks')).toEqual(['2026-11-05']);
    expect(dates('in two days')).toEqual(['2026-10-17']);
    expect(dates('within a week')).toEqual(['2026-10-22']);
    expect(dates('en 10 días')).toEqual(['2026-10-25']);
    expect(dates('dentro de dos semanas')).toEqual(['2026-10-29']);
    // Business days need a calendar nobody gave: unread.
    expect(dates('in 3 business days')).toEqual([]);
  });

  it('prefers the most specific kind: a written date wins over the weekday next to it', () => {
    expect(resolveDue('Friday, Nov 21', THU)).toEqual({ kind: 'month_day', dates: ['2026-11-21'] });
    expect(resolveDue('Friday 2026-11-20', THU)).toEqual({ kind: 'absolute', dates: ['2026-11-20'] });
  });

  it('reads nothing it does not know, and nothing from an empty, oversized or unanchored quote', () => {
    for (const quote of ['soon', 'ASAP', 'when possible', 'next month', 'pronto', '', '   ']) expect(resolveDue(quote, THU)).toEqual({ kind: 'none', dates: [] });
    expect(resolveDue('tomorrow '.repeat(40), THU)).toEqual({ kind: 'none', dates: [] });
    expect(resolveDue('tomorrow', 'not-a-day')).toEqual({ kind: 'none', dates: [] });
    expect(resolveDue(null, THU)).toEqual({ kind: 'none', dates: [] });
  });

  it('counts the weekdays right in the DST weeks (calendar dates, no clock involved)', () => {
    // US clocks change on Sun 2026-03-08 and Sun 2026-11-01; Europe on Sun 2026-03-29 and 2026-10-25.
    expect(weekdayOf('2026-03-08')).toBe(0);
    expect(dates('by Monday', '2026-03-07')).toEqual(['2026-03-09']);
    expect(dates('next week', '2026-10-24')).toEqual(['2026-10-26', '2026-10-30']);
    expect(dates('tomorrow', '2026-10-31')).toEqual(['2026-11-01']);
    expect(dates('by Friday', '2026-03-26')).toEqual(['2026-03-27']);
  });
});

describe('readClockTimes', () => {
  it('reads 24 h, am/pm and "15h20" clock forms only', () => {
    expect(readClockTimes('by 15:20')).toEqual(['15:20']);
    expect(readClockTimes('by 3:20 PM')).toEqual(['15:20']);
    expect(readClockTimes('at 5 pm')).toEqual(['17:00']);
    expect(readClockTimes('at 5pm')).toEqual(['17:00']);
    expect(readClockTimes('11 a.m.')).toEqual(['11:00']);
    expect(readClockTimes('12 am')).toEqual(['00:00']);
    expect(readClockTimes('12 pm')).toEqual(['12:00']);
    expect(readClockTimes('a las 15h20')).toEqual(['15:20']);
    expect(readClockTimes('between 9:00 and 17:00')).toEqual(['09:00', '17:00']);
  });

  it('never reads a bare number, a date or a contradictory "15:20 pm" as a time', () => {
    expect(readClockTimes('by 5')).toEqual([]);
    expect(readClockTimes('a las 3')).toEqual([]);
    expect(readClockTimes('2026-11-21')).toEqual([]);
    expect(readClockTimes('10/11')).toEqual([]);
    expect(readClockTimes('15:20 pm')).toEqual([]);
    expect(readClockTimes(null)).toEqual([]);
  });
});

describe('bounds, overdue and the reference day', () => {
  it('keeps a date from the reference day minus 1 to plus 400 days', () => {
    expect(DUE_BOUNDS).toEqual({ daysBefore: 1, daysAfter: 400 });
    expect(withinDueBounds('2026-10-14', THU)).toBe(true);
    expect(withinDueBounds('2026-10-13', THU)).toBe(false);
    expect(withinDueBounds('2027-11-19', THU)).toBe(true);
    expect(withinDueBounds('2027-11-20', THU)).toBe(false);
    expect(withinDueBounds('nonsense', THU)).toBe(false);
  });

  it('a date is overdue once it is before today in the zone', () => {
    // 2026-11-13 03:00Z is still Nov 12 in Mexico City.
    const now = new Date('2026-11-13T03:00:00.000Z');
    expect(isOverdue('2026-11-12', 'America/Mexico_City', now)).toBe(false);
    expect(isOverdue('2026-11-12', 'UTC', now)).toBe(true);
    expect(isOverdue('2026-11-11', null, now)).toBe(true);
  });

  it('counts from the meeting in its own zone: a 21:30 Mexico City meeting is that local day, not the UTC one', () => {
    const reference = referenceDayOf({
      meetingSnapshot: { startAt: '2026-10-16T03:30:00.000Z', timezone: 'America/Mexico_City' },
      summaryDate: '2026-10-16',
      anchorAt: '2026-10-16T05:00:00.000Z',
      receivedAt: '2026-10-16T05:01:00.000Z',
      preferencesTimeZone: 'Europe/Madrid',
    });
    expect(reference).toEqual({ day: '2026-10-15', zone: 'America/Mexico_City', instant: '2026-10-16T03:30:00.000Z', source: 'meeting' });
  });

  it('then the summary date at noon in the preferences zone, then the anchor, then the receipt', () => {
    const base = { meetingSnapshot: null, summaryDate: null, anchorAt: null, receivedAt: '2026-10-16T05:01:00.000Z', preferencesTimeZone: 'America/Mexico_City' };
    expect(referenceDayOf({ ...base, summaryDate: '2026-10-14' })).toEqual({
      day: '2026-10-14',
      zone: 'America/Mexico_City',
      instant: '2026-10-14T18:00:00.000Z',
      source: 'summary_date',
    });
    expect(referenceDayOf({ ...base, anchorAt: '2026-10-16T04:00:00.000Z' })).toMatchObject({ day: '2026-10-15', source: 'anchor' });
    expect(referenceDayOf(base)).toMatchObject({ day: '2026-10-15', source: 'received' });
    expect(referenceDayOf({ ...base, preferencesTimeZone: null })).toMatchObject({ day: '2026-10-16', zone: 'UTC', source: 'received' });
    // A meeting zone Intl does not know falls back to the preferences zone.
    expect(referenceDayOf({ ...base, meetingSnapshot: { startAt: '2026-10-16T03:30:00.000Z', timezone: 'Mars/Olympus' } })).toMatchObject({
      day: '2026-10-15',
      zone: 'America/Mexico_City',
      source: 'meeting',
    });
  });
});
