import { buildMeeting, type Meeting, type MeetingCreateInput } from '../../../core/types';
import {
  GRID_DAYS,
  buildMonthGrid,
  dayDots,
  daysInMonth,
  indexMeetingsByDay,
  meetingDayKeys,
  monthOf,
  monthTitle,
  shiftMonth,
  weekStartsOn,
  weekdayLabels,
  weekdayOf,
} from '../calendarModel';

let seq = 0;
function meeting(input: Partial<MeetingCreateInput> & { startAt: string }): Meeting {
  seq += 1;
  return buildMeeting(
    { title: `Meeting ${seq}`, source: 'manual', timezone: 'UTC', ...input },
    { id: `m${seq}`, userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

describe('month grid', () => {
  it('has 6 full weeks starting on the locale weekday', () => {
    expect(weekStartsOn('en')).toBe(0);
    expect(weekStartsOn('es')).toBe(1);
    // October 2026 starts on a Thursday.
    expect(weekdayOf('2026-10-01')).toBe(4);
    const sunday = buildMonthGrid({ year: 2026, month: 10 }, 0);
    expect(sunday).toHaveLength(GRID_DAYS);
    expect(sunday[0]).toEqual({ key: '2026-09-27', day: 27, inMonth: false });
    expect(sunday[4]).toEqual({ key: '2026-10-01', day: 1, inMonth: true });
    const monday = buildMonthGrid({ year: 2026, month: 10 }, 1);
    expect(monday[0]?.key).toBe('2026-09-28');
    expect(monday.filter((day) => day.inMonth)).toHaveLength(31);
    expect(monday[GRID_DAYS - 1]?.key).toBe('2026-11-08');
  });

  it('shifts months across years and knows leap years', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 });
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(monthOf('2026-10-05')).toEqual({ year: 2026, month: 10 });
  });

  it('labels months and weekdays in the UI language', () => {
    expect(monthTitle({ year: 2026, month: 10 }, 'en')).toBe('October 2026');
    expect(monthTitle({ year: 2026, month: 10 }, 'es')).toBe('Octubre 2026');
    expect(weekdayLabels(0, 'en').map((label) => label.short)).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    const es = weekdayLabels(1, 'es');
    expect(es[0]?.full).toBe('lunes');
    expect(es[6]?.full).toBe('domingo');
  });
});

describe('day index', () => {
  it('puts a meeting on its local day in the user zone', () => {
    const late = meeting({ startAt: '2026-10-06T02:30:00.000Z', durationMinutes: 30 });
    expect(meetingDayKeys(late, 'UTC')).toEqual(['2026-10-06']);
    expect(meetingDayKeys(late, 'America/Los_Angeles')).toEqual(['2026-10-05']);
  });

  it('marks every day of multi-day meetings, but not the day a meeting ends at midnight', () => {
    const overnight = meeting({ startAt: '2026-10-05T22:00:00.000Z', durationMinutes: 240 });
    expect(meetingDayKeys(overnight, 'UTC')).toEqual(['2026-10-05', '2026-10-06']);
    const toMidnight = meeting({ startAt: '2026-10-05T22:00:00.000Z', durationMinutes: 120 });
    expect(meetingDayKeys(toMidnight, 'UTC')).toEqual(['2026-10-05']);
    const trip = meeting({ startAt: '2026-10-30T00:00:00.000Z', allDay: true, durationMinutes: 3 * 1440 });
    expect(meetingDayKeys(trip, 'Asia/Tokyo')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('indexes all sources and gives one dot per source category', () => {
    const a = meeting({ startAt: '2026-10-05T15:00:00.000Z', source: 'google' });
    const b = meeting({ startAt: '2026-10-05T09:00:00.000Z', source: 'ai_chat' });
    const c = meeting({ startAt: '2026-10-05T10:00:00.000Z', source: 'manual' });
    const d = meeting({ startAt: '2026-10-07T10:00:00.000Z', source: 'device' });
    const index = indexMeetingsByDay([a, b, c, d], 'UTC');
    expect(index.get('2026-10-05')?.map((m) => m.id)).toEqual([b.id, c.id, a.id]);
    expect(dayDots(index.get('2026-10-05'))).toEqual(['meetingguard', 'google']);
    expect(dayDots(index.get('2026-10-07'))).toEqual(['device']);
    expect(dayDots(index.get('2026-10-06'))).toEqual([]);
  });
});
