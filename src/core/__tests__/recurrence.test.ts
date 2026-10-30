import { AppError } from '../errors';
import {
  CANCELLED_OVERRIDE,
  DEFAULT_EXPANSION_MAX,
  expandOccurrences,
  isRecurringMeeting,
  meetingRecurrenceSchema,
  occurrenceIdFor,
  parseGoogleRecurrence,
  parseOccurrenceId,
  reconcileRecurrenceAnchor,
  recurrenceEndsAt,
  recurrenceOverridesSchema,
  toGoogleRecurrence,
  weekdayOfLocalDate,
  withRecurrenceOverride,
  type MeetingRecurrence,
  type RecurringMeetingLike,
} from '../recurrence';
import { buildMeeting, parseMeetingDoc, toMeetingDoc, applyMeetingPatch, tombstoneMeeting } from '../types';

const RULE_DEFAULTS: MeetingRecurrence = {
  freq: 'weekly',
  interval: 1,
  byWeekday: null,
  byMonthDay: null,
  until: null,
  count: null,
};

function rule(overrides: Partial<MeetingRecurrence>): MeetingRecurrence {
  return { ...RULE_DEFAULTS, ...overrides };
}

function series(overrides: Partial<RecurringMeetingLike>): RecurringMeetingLike {
  return {
    id: 'm1',
    title: 'Standup',
    date: '2026-01-05', // a Monday
    time: '09:00',
    timezone: 'America/New_York',
    durationMinutes: 30,
    allDay: false,
    recurrence: rule({ freq: 'daily' }),
    recurrenceOverrides: null,
    ...overrides,
  };
}

const JAN = '2026-01-01T00:00:00.000Z';
const FAR = '2027-06-01T00:00:00.000Z';

describe('meetingRecurrenceSchema', () => {
  it('accepts the v1 subset and rejects cross-field misuse', () => {
    expect(meetingRecurrenceSchema.safeParse(rule({ freq: 'daily', interval: 2 })).success).toBe(true);
    expect(meetingRecurrenceSchema.safeParse(rule({ byWeekday: ['MO', 'FR'] })).success).toBe(true);
    expect(meetingRecurrenceSchema.safeParse(rule({ freq: 'monthly', byMonthDay: 31 })).success).toBe(true);
    // byWeekday only with weekly, byMonthDay only with monthly, until xor count.
    expect(meetingRecurrenceSchema.safeParse(rule({ freq: 'daily', byWeekday: ['MO'] })).success).toBe(false);
    expect(meetingRecurrenceSchema.safeParse(rule({ freq: 'weekly', byMonthDay: 5 })).success).toBe(false);
    expect(meetingRecurrenceSchema.safeParse(rule({ until: JAN, count: 3 })).success).toBe(false);
    expect(meetingRecurrenceSchema.safeParse(rule({ interval: 0 })).success).toBe(false);
    expect(meetingRecurrenceSchema.safeParse(rule({ count: 0 })).success).toBe(false);
  });
});

describe('occurrence ids and overrides', () => {
  it('round-trips occurrence ids', () => {
    expect(occurrenceIdFor('m1', '2026-01-05')).toBe('m1:2026-01-05');
    expect(parseOccurrenceId('m1:2026-01-05')).toEqual({ meetingId: 'm1', localDateKey: '2026-01-05' });
    expect(parseOccurrenceId('m1')).toBeNull();
    expect(parseOccurrenceId('m1:not-a-date')).toBeNull();
    expect(() => occurrenceIdFor('bad:id', '2026-01-05')).toThrow(AppError);
  });

  it('withRecurrenceOverride sets, replaces and removes entries', () => {
    const one = withRecurrenceOverride(null, '2026-01-06', CANCELLED_OVERRIDE);
    expect(one).toEqual({ '2026-01-06': CANCELLED_OVERRIDE });
    const two = withRecurrenceOverride(one, '2026-01-07', {
      status: 'modified',
      startAt: '2026-01-07T15:00:00.000Z',
      durationMinutes: null,
      title: null,
    });
    expect(Object.keys(two ?? {})).toHaveLength(2);
    expect(withRecurrenceOverride(one, '2026-01-06', null)).toBeNull();
    expect(() => withRecurrenceOverride(null, 'nope', CANCELLED_OVERRIDE)).toThrow(AppError);
  });

  it('recurrenceOverridesSchema rejects bad keys', () => {
    expect(recurrenceOverridesSchema.safeParse({ '2026-01-06': CANCELLED_OVERRIDE }).success).toBe(true);
    expect(recurrenceOverridesSchema.safeParse({ nope: CANCELLED_OVERRIDE }).success).toBe(false);
  });
});

describe('expandOccurrences: daily', () => {
  it('expands with interval and preserves wall-clock time across spring-forward DST', () => {
    // US DST starts 2026-03-08. EST is UTC-5, EDT is UTC-4.
    const meeting = series({ date: '2026-03-06', recurrence: rule({ freq: 'daily', interval: 1 }) });
    const out = expandOccurrences(meeting, '2026-03-06T00:00:00.000Z', '2026-03-10T00:00:00.000Z');
    expect(out.map((o) => o.startAt)).toEqual([
      '2026-03-06T14:00:00.000Z', // 09:00 EST
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z', // 09:00 EDT: instant moves, wall clock stays
      '2026-03-09T13:00:00.000Z',
    ]);
    expect(out[0]).toMatchObject({
      occurrenceId: 'm1:2026-03-06',
      meetingId: 'm1',
      localDateKey: '2026-03-06',
      endAt: '2026-03-06T14:30:00.000Z',
      durationMinutes: 30,
      title: 'Standup',
      overridden: false,
    });
  });

  it('preserves wall-clock time across fall-back DST (Europe/Madrid)', () => {
    // Madrid leaves DST on 2026-10-25 (CEST UTC+2 -> CET UTC+1).
    const meeting = series({
      date: '2026-10-24',
      time: '10:00',
      timezone: 'Europe/Madrid',
      recurrence: rule({ freq: 'daily' }),
    });
    const out = expandOccurrences(meeting, '2026-10-24T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
    expect(out.map((o) => o.startAt)).toEqual([
      '2026-10-24T08:00:00.000Z', // 10:00 CEST
      '2026-10-25T09:00:00.000Z', // 10:00 CET
      '2026-10-26T09:00:00.000Z',
    ]);
  });

  it('resolves a start time inside the spring-forward gap to the first valid instant', () => {
    // 02:30 does not exist on 2026-03-08 in New York; it resolves forward (03:30 EDT).
    const meeting = series({ date: '2026-03-07', time: '02:30', recurrence: rule({ freq: 'daily' }) });
    const out = expandOccurrences(meeting, '2026-03-07T00:00:00.000Z', '2026-03-09T00:00:00.000Z');
    expect(out.map((o) => o.startAt)).toEqual(['2026-03-07T07:30:00.000Z', '2026-03-08T07:30:00.000Z']);
  });

  it('is independent of the device timezone (rule runs in the meeting zone)', () => {
    const meeting = series({ date: '2026-01-05', time: '23:30', timezone: 'Pacific/Auckland', recurrence: rule({ freq: 'daily' }) });
    const out = expandOccurrences(meeting, '2026-01-05T00:00:00.000Z', '2026-01-07T00:00:00.000Z');
    // 23:30 NZDT (UTC+13) = 10:30Z same day.
    expect(out.map((o) => o.startAt)).toEqual(['2026-01-05T10:30:00.000Z', '2026-01-06T10:30:00.000Z']);
  });

  it('honors interval > 1 and the window bounds', () => {
    const meeting = series({ recurrence: rule({ freq: 'daily', interval: 3 }) });
    const out = expandOccurrences(meeting, '2026-01-06T00:00:00.000Z', '2026-01-15T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-08', '2026-01-11', '2026-01-14']);
  });

  it('includes an occurrence that overlaps the window start', () => {
    const meeting = series({ durationMinutes: 120, recurrence: rule({ freq: 'daily' }) });
    // 2026-01-05 09:00-11:00 EST = 14:00-16:00Z; window starts mid-meeting.
    const out = expandOccurrences(meeting, '2026-01-05T15:00:00.000Z', '2026-01-06T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-05']);
  });
});

describe('expandOccurrences: windows far from the anchor', () => {
  const rule = { freq: 'daily' as const, interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };

  it('a daily series anchored two years ago yields the window dates (without walking every day since)', () => {
    const meeting = series({ date: '2024-01-01', recurrence: rule });
    const out = expandOccurrences(meeting, '2026-03-06T00:00:00.000Z', '2026-03-10T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('an every-third-day series keeps its phase from the anchor', () => {
    // 2024-01-01 to 2026-03-06 is 795 days, a multiple of 3: March 6 is an occurrence, March 9 the next.
    const meeting = series({ date: '2024-01-01', recurrence: { ...rule, interval: 3 } });
    const out = expandOccurrences(meeting, '2026-03-06T00:00:00.000Z', '2026-03-10T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-03-06', '2026-03-09']);
  });

  it('a counted rule still numbers its occurrences from the anchor', () => {
    const meeting = series({ date: '2024-01-01', recurrence: { ...rule, count: 3 } });
    expect(expandOccurrences(meeting, '2026-03-06T00:00:00.000Z', '2026-03-10T00:00:00.000Z')).toEqual([]);
  });

  it('a weekly series anchored two years ago keeps its weekday', () => {
    // 2024-01-01 was a Monday; so are 2026-03-02 and 2026-03-09.
    const meeting = series({ date: '2024-01-01', recurrence: { ...rule, freq: 'weekly' as const } });
    const out = expandOccurrences(meeting, '2026-03-02T00:00:00.000Z', '2026-03-16T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-03-02', '2026-03-09']);
  });
});

describe('expandOccurrences: weekly', () => {
  it('defaults byWeekday to the first occurrence weekday', () => {
    const meeting = series({ recurrence: rule({ freq: 'weekly' }) });
    const out = expandOccurrences(meeting, JAN, '2026-01-31T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
    expect(weekdayOfLocalDate('2026-01-05')).toBe('MO');
  });

  it('expands multiple BYDAY values in order and skips days before the anchor', () => {
    // Anchor Wednesday 2026-01-07 with MO+WE+FR: the Mon 2026-01-05 of the anchor week is skipped.
    const meeting = series({ date: '2026-01-07', recurrence: rule({ freq: 'weekly', byWeekday: ['MO', 'WE', 'FR'] }) });
    const out = expandOccurrences(meeting, JAN, '2026-01-17T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16']);
  });

  it('applies interval to whole weeks (biweekly)', () => {
    const meeting = series({ recurrence: rule({ freq: 'weekly', interval: 2, byWeekday: ['MO', 'TU'] }) });
    const out = expandOccurrences(meeting, JAN, '2026-02-05T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-05', '2026-01-06', '2026-01-19', '2026-01-20', '2026-02-02', '2026-02-03']);
  });

  it('keeps the wall-clock across the DST week', () => {
    const meeting = series({ date: '2026-03-02', recurrence: rule({ freq: 'weekly' }) });
    const out = expandOccurrences(meeting, '2026-03-01T00:00:00.000Z', '2026-03-17T00:00:00.000Z');
    expect(out.map((o) => o.startAt)).toEqual([
      '2026-03-02T14:00:00.000Z', // EST
      '2026-03-09T13:00:00.000Z', // EDT
      '2026-03-16T13:00:00.000Z',
    ]);
  });
});

describe('expandOccurrences: monthly', () => {
  it('skips months without the day (31st) without consuming count', () => {
    const meeting = series({
      date: '2026-01-31',
      recurrence: rule({ freq: 'monthly', byMonthDay: 31, count: 4 }),
    });
    const out = expandOccurrences(meeting, JAN, FAR);
    // Feb, Apr, Jun have no 31st (Apr/Jun) or Feb 31 does not exist: Jan, Mar, May, Jul.
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  });

  it('skips non-leap February for day 29', () => {
    const meeting = series({
      date: '2027-01-29',
      recurrence: rule({ freq: 'monthly', byMonthDay: 29, count: 3 }),
    });
    const out = expandOccurrences(meeting, '2027-01-01T00:00:00.000Z', '2027-12-31T00:00:00.000Z');
    // 2027 is not a leap year: Feb is skipped.
    expect(out.map((o) => o.localDateKey)).toEqual(['2027-01-29', '2027-03-29', '2027-04-29']);
  });

  it('defaults byMonthDay to the anchor day and applies interval', () => {
    const meeting = series({ date: '2026-01-15', recurrence: rule({ freq: 'monthly', interval: 2 }) });
    const out = expandOccurrences(meeting, JAN, '2026-08-01T00:00:00.000Z');
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-15', '2026-03-15', '2026-05-15', '2026-07-15']);
  });
});

describe('expandOccurrences: until / count / caps', () => {
  it('stops at the inclusive until instant (original starts)', () => {
    const until = '2026-01-19T14:00:00.000Z'; // exactly the third Monday's 09:00 EST
    const meeting = series({ recurrence: rule({ freq: 'weekly', until }) });
    const out = expandOccurrences(meeting, JAN, FAR);
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
  });

  it('stops after count occurrences, cancelled ones still consuming it', () => {
    const meeting = series({
      recurrence: rule({ freq: 'daily', count: 3 }),
      recurrenceOverrides: { '2026-01-06': { ...CANCELLED_OVERRIDE } },
    });
    const out = expandOccurrences(meeting, JAN, FAR);
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-05', '2026-01-07']);
  });

  it('caps the result at options.max', () => {
    const meeting = series({ recurrence: rule({ freq: 'daily' }) });
    const out = expandOccurrences(meeting, JAN, FAR, { max: 5 });
    expect(out).toHaveLength(5);
    expect(DEFAULT_EXPANSION_MAX).toBe(500);
  });

  it('terminates on an endless series with a far window (iteration guard)', () => {
    const meeting = series({ recurrence: rule({ freq: 'daily' }) });
    const out = expandOccurrences(meeting, '2039-01-01T00:00:00.000Z', '2039-01-08T00:00:00.000Z');
    expect(out).toHaveLength(7);
  });

  it('rejects non-recurring meetings and invalid windows', () => {
    expect(() => expandOccurrences(series({ recurrence: null }), JAN, FAR)).toThrow(AppError);
    expect(() => expandOccurrences(series({}), FAR, JAN)).toThrow(AppError);
  });
});

describe('expandOccurrences: overrides', () => {
  it('applies modified overrides (time, duration, title) and sorts by effective start', () => {
    const meeting = series({
      recurrence: rule({ freq: 'daily', count: 3 }),
      recurrenceOverrides: {
        '2026-01-06': {
          status: 'modified',
          startAt: '2026-01-05T08:00:00.000Z', // moved BEFORE the first occurrence
          durationMinutes: 60,
          title: 'Moved standup',
        },
      },
    });
    const out = expandOccurrences(meeting, JAN, FAR);
    expect(out.map((o) => o.localDateKey)).toEqual(['2026-01-06', '2026-01-05', '2026-01-07']);
    expect(out[0]).toMatchObject({
      startAt: '2026-01-05T08:00:00.000Z',
      endAt: '2026-01-05T09:00:00.000Z',
      durationMinutes: 60,
      title: 'Moved standup',
      overridden: true,
    });
  });

  it('finds an occurrence moved INTO the window from outside it', () => {
    const meeting = series({
      recurrence: rule({ freq: 'weekly' }),
      recurrenceOverrides: {
        '2026-02-02': { status: 'modified', startAt: '2026-01-08T14:00:00.000Z', durationMinutes: null, title: null },
      },
    });
    const out = expandOccurrences(meeting, '2026-01-08T00:00:00.000Z', '2026-01-09T00:00:00.000Z');
    expect(out.map((o) => o.occurrenceId)).toEqual(['m1:2026-02-02']);
  });

  it('expands all-day series at local midnight', () => {
    const meeting = series({ allDay: true, time: '13:00', recurrence: rule({ freq: 'daily', count: 2 }) });
    const out = expandOccurrences(meeting, JAN, FAR);
    expect(out.map((o) => o.startAt)).toEqual(['2026-01-05T05:00:00.000Z', '2026-01-06T05:00:00.000Z']); // midnight EST
  });
});

describe('recurrenceEndsAt', () => {
  it('returns until, the last counted original start, or null', () => {
    expect(recurrenceEndsAt(series({ recurrence: rule({ until: JAN }) }))).toBe(JAN);
    expect(recurrenceEndsAt(series({ recurrence: rule({ freq: 'daily', count: 3 }) }))).toBe('2026-01-07T14:00:00.000Z');
    expect(recurrenceEndsAt(series({ recurrence: rule({}) }))).toBeNull();
    expect(recurrenceEndsAt(series({ recurrence: null }))).toBeNull();
    expect(isRecurringMeeting(series({}))).toBe(true);
    expect(isRecurringMeeting(series({ recurrence: null }))).toBe(false);
  });
});

describe('reconcileRecurrenceAnchor', () => {
  it('swaps the old anchor weekday for the new one (form rules carry byWeekday = [anchor day])', () => {
    // 2026-10-13 is a Tuesday, 2026-10-14 a Wednesday.
    expect(reconcileRecurrenceAnchor(rule({ byWeekday: ['TU'] }), '2026-10-13', '2026-10-14')).toEqual(
      rule({ byWeekday: ['WE'] }),
    );
    // Drop-and-add on a multi-day rule, kept in MO..SU order.
    expect(reconcileRecurrenceAnchor(rule({ byWeekday: ['TU', 'FR'] }), '2026-10-13', '2026-10-14')).toEqual(
      rule({ byWeekday: ['WE', 'FR'] }),
    );
    // New day already selected: the old one is still dropped (drop-and-add, no duplicate).
    expect(reconcileRecurrenceAnchor(rule({ byWeekday: ['TU', 'WE'] }), '2026-10-13', '2026-10-14')).toEqual(
      rule({ byWeekday: ['WE'] }),
    );
  });

  it('leaves rules alone when nothing needs re-anchoring (same object back)', () => {
    const sameDay = rule({ byWeekday: ['TU'] });
    expect(reconcileRecurrenceAnchor(sameDay, '2026-10-13', '2026-10-13')).toBe(sameDay);
    // Same weekday one week later.
    expect(reconcileRecurrenceAnchor(sameDay, '2026-10-13', '2026-10-20')).toBe(sameDay);
    // Imported off-pattern anchor (old day never selected): untouched.
    const offPattern = rule({ byWeekday: ['FR'] });
    expect(reconcileRecurrenceAnchor(offPattern, '2026-10-13', '2026-10-14')).toBe(offPattern);
    // No byWeekday: the anchor's own weekday is implicit, nothing stored to fix.
    const implicit = rule({});
    expect(reconcileRecurrenceAnchor(implicit, '2026-10-13', '2026-10-14')).toBe(implicit);
    const daily = rule({ freq: 'daily' });
    expect(reconcileRecurrenceAnchor(daily, '2026-10-13', '2026-10-14')).toBe(daily);
  });

  it('follows the new day of month for anchored monthly rules', () => {
    expect(reconcileRecurrenceAnchor(rule({ freq: 'monthly', byMonthDay: 13 }), '2026-10-13', '2026-10-20')).toEqual(
      rule({ freq: 'monthly', byMonthDay: 20 }),
    );
    // A byMonthDay that never matched the anchor (imported) is untouched.
    const imported = rule({ freq: 'monthly', byMonthDay: 28 });
    expect(reconcileRecurrenceAnchor(imported, '2026-10-13', '2026-10-20')).toBe(imported);
  });

  it('rejects malformed anchor dates', () => {
    expect(() => reconcileRecurrenceAnchor(rule({}), 'nope', '2026-10-14')).toThrow(AppError);
  });
});

describe('Google RRULE mapping', () => {
  it('writes RRULE + EXDATE lines for the rule and cancelled overrides', () => {
    const meeting = series({
      timezone: 'Europe/Madrid',
      time: '10:30',
      recurrence: rule({ freq: 'weekly', interval: 2, byWeekday: ['MO', 'WE'], count: 10 }),
      recurrenceOverrides: {
        '2026-01-19': { ...CANCELLED_OVERRIDE },
        '2026-01-07': { status: 'modified', startAt: null, durationMinutes: 45, title: null }, // NOT exported
      },
    });
    expect(toGoogleRecurrence(meeting)).toEqual([
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10',
      'EXDATE;TZID=Europe/Madrid:20260119T103000',
    ]);
  });

  it('writes UNTIL in basic UTC format', () => {
    const meeting = series({ recurrence: rule({ until: '2026-06-30T13:00:00.000Z' }) });
    expect(toGoogleRecurrence(meeting)[0]).toBe('RRULE:FREQ=WEEKLY;UNTIL=20260630T130000Z');
  });

  it('writes DATE values (UNTIL + EXDATE) for all-day series, in the meeting timezone', () => {
    // 2026-07-01T03:00Z is still 2026-06-30 in New York: the local date keeps UNTIL inclusive.
    const meeting = series({
      allDay: true,
      recurrence: rule({ freq: 'daily', until: '2026-07-01T03:00:00.000Z' }),
      recurrenceOverrides: { '2026-01-19': { ...CANCELLED_OVERRIDE } },
    });
    expect(toGoogleRecurrence(meeting)).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20260630',
      'EXDATE;VALUE=DATE:20260119',
    ]);
    // The parser accepts its own all-day output (UNTIL becomes the inclusive end of day in UTC).
    const parsed = parseGoogleRecurrence(toGoogleRecurrence(meeting));
    expect(parsed?.rule.until).toBe('2026-06-30T23:59:59.000Z');
    expect(parsed?.cancelledDateKeys).toEqual(['2026-01-19']);
  });

  it('excludes an off-pattern anchor date so Google does not render DTSTART as an extra event', () => {
    // The series() anchor 2026-01-05 is a Monday; a Wednesday-only rule never generates it
    // locally, but Google would still show DTSTART - so the writer adds an EXDATE for it.
    const weekly = series({ recurrence: rule({ freq: 'weekly', byWeekday: ['WE'] }) });
    expect(toGoogleRecurrence(weekly)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=WE',
      'EXDATE;TZID=America/New_York:20260105T090000',
    ]);
    const monthly = series({ recurrence: rule({ freq: 'monthly', byMonthDay: 31 }) });
    expect(toGoogleRecurrence(monthly)[1]).toBe('EXDATE;TZID=America/New_York:20260105T090000');
    // An on-pattern anchor adds nothing.
    const onPattern = series({ recurrence: rule({ freq: 'weekly', byWeekday: ['MO', 'WE'] }) });
    expect(toGoogleRecurrence(onPattern)).toHaveLength(1);
  });

  it('parses its own output (round trip)', () => {
    const original = rule({ freq: 'weekly', interval: 2, byWeekday: ['MO', 'WE'], count: 10 });
    const meeting = series({ recurrence: original, recurrenceOverrides: { '2026-01-19': { ...CANCELLED_OVERRIDE } } });
    const parsed = parseGoogleRecurrence(toGoogleRecurrence(meeting));
    expect(parsed).not.toBeNull();
    expect(parsed?.rule).toEqual(original);
    expect(parsed?.cancelledDateKeys).toEqual(['2026-01-19']);
  });

  it('parses plain Google lines and rejects anything outside the subset', () => {
    expect(parseGoogleRecurrence(['RRULE:FREQ=DAILY'])).toEqual({
      rule: rule({ freq: 'daily' }),
      cancelledDateKeys: [],
    });
    expect(parseGoogleRecurrence(['RRULE:FREQ=MONTHLY;BYMONTHDAY=31;UNTIL=20261231'])?.rule.byMonthDay).toBe(31);
    expect(parseGoogleRecurrence(['RRULE:FREQ=YEARLY'])).toBeNull();
    expect(parseGoogleRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=2MO'])).toBeNull();
    expect(parseGoogleRecurrence(['RRULE:FREQ=WEEKLY;BYSETPOS=1'])).toBeNull();
    expect(parseGoogleRecurrence(['RRULE:FREQ=DAILY', 'RDATE:20260105'])).toBeNull();
    expect(parseGoogleRecurrence(['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY'])).toBeNull();
    expect(parseGoogleRecurrence(['EXDATE;TZID=UTC:20260105T090000'])).toBeNull(); // no RRULE
  });
});

describe('meeting model integration', () => {
  const ctx = { id: 'ser1', userId: 'u1', now: '2026-01-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' as const };

  it('buildMeeting stores the rule, derives seriesId and drops orphan overrides', () => {
    const meeting = buildMeeting(
      {
        title: 'Weekly',
        startAt: '2026-01-05T14:00:00.000Z',
        source: 'manual',
        timezone: 'America/New_York',
        recurrence: rule({}),
      },
      ctx,
    );
    expect(meeting.recurrence).toEqual(rule({}));
    expect(meeting.seriesId).toBe('ser1');
    const oneOff = buildMeeting(
      {
        title: 'Once',
        startAt: '2026-01-05T14:00:00.000Z',
        source: 'manual',
        recurrenceOverrides: { '2026-01-05': { ...CANCELLED_OVERRIDE } },
      },
      ctx,
    );
    expect(oneOff.recurrence).toBeNull();
    expect(oneOff.recurrenceOverrides).toBeNull();
    expect(oneOff.seriesId).toBeNull();
  });

  it('applyMeetingPatch upgrades a one-off to a series and clears overrides with the rule', () => {
    const oneOff = buildMeeting({ title: 'T', startAt: '2026-01-05T14:00:00.000Z', source: 'manual' }, ctx);
    const upgraded = applyMeetingPatch(oneOff, { recurrence: rule({}) }, '2026-01-02T00:00:00.000Z');
    expect(upgraded.seriesId).toBe(oneOff.id);
    const withOverride = applyMeetingPatch(
      upgraded,
      { recurrenceOverrides: { '2026-01-12': { ...CANCELLED_OVERRIDE } } },
      '2026-01-03T00:00:00.000Z',
    );
    expect(withOverride.recurrenceOverrides).not.toBeNull();
    const collapsed = applyMeetingPatch(withOverride, { recurrence: null }, '2026-01-04T00:00:00.000Z');
    expect(collapsed.recurrence).toBeNull();
    expect(collapsed.recurrenceOverrides).toBeNull();
  });

  it('toMeetingDoc serializes the new fields sparsely and parseMeetingDoc restores them', () => {
    const oneOff = buildMeeting({ title: 'T', startAt: '2026-01-05T14:00:00.000Z', source: 'manual' }, ctx);
    const doc = toMeetingDoc(oneOff);
    expect('recurrence' in doc).toBe(false);
    expect('recurrenceOverrides' in doc).toBe(false);
    expect('seriesId' in doc).toBe(false);
    expect('outlookEventId' in doc.external).toBe(false);
    const parsed = parseMeetingDoc(oneOff.id, doc);
    expect(parsed?.recurrence).toBeNull();
    expect(parsed?.seriesId).toBeNull();
    expect(parsed?.external.outlookEventId).toBeNull();

    const recurring = buildMeeting(
      { title: 'T', startAt: '2026-01-05T14:00:00.000Z', source: 'manual', recurrence: rule({}) },
      ctx,
    );
    const recurringDoc = toMeetingDoc(recurring);
    expect(recurringDoc.recurrence).toEqual(rule({}));
    expect(recurringDoc.seriesId).toBe('ser1');
    expect(parseMeetingDoc(recurring.id, recurringDoc)?.recurrence).toEqual(rule({}));
  });

  it('parseMeetingDoc drops overrides that lost their rule and old docs default to null', () => {
    const recurring = buildMeeting(
      { title: 'T', startAt: '2026-01-05T14:00:00.000Z', source: 'manual', recurrence: rule({}) },
      ctx,
    );
    const doc = toMeetingDoc(
      applyMeetingPatch(recurring, { recurrenceOverrides: { '2026-01-12': { ...CANCELLED_OVERRIDE } } }, ctx.now),
    );
    const orphan = { ...doc, recurrence: null } as Record<string, unknown>;
    expect(parseMeetingDoc('ser1', orphan)?.recurrenceOverrides).toBeNull();
    // Pre-recurrence document (no new keys at all).
    const { recurrence: _r, recurrenceOverrides: _o, seriesId: _s, ...legacy } = doc as Record<string, unknown>;
    const parsedLegacy = parseMeetingDoc('ser1', legacy);
    expect(parsedLegacy?.recurrence).toBeNull();
    expect(parsedLegacy?.recurrenceOverrides).toBeNull();
    expect(parsedLegacy?.seriesId).toBeNull();
  });

  it('tombstoneMeeting scrubs the rule and overrides but keeps seriesId', () => {
    const recurring = buildMeeting(
      {
        title: 'T',
        startAt: '2026-01-05T14:00:00.000Z',
        source: 'manual',
        recurrence: rule({}),
        recurrenceOverrides: { '2026-01-12': { status: 'modified', startAt: null, durationMinutes: null, title: 'Secret' } },
      },
      ctx,
    );
    const tombstone = tombstoneMeeting(recurring, '2026-02-01T00:00:00.000Z');
    expect(tombstone.recurrence).toBeNull();
    expect(tombstone.recurrenceOverrides).toBeNull();
    expect(tombstone.seriesId).toBe('ser1');
  });
});
