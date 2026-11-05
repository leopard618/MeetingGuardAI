import { buildMeeting, type Meeting, type MeetingCreateInput } from '../../../../core/types';
import {
  DEFAULT_FILTERS,
  buildMeetingSections,
  dayRelation,
  filterMeetings,
  groupMeetingsByDay,
  hasActiveFilters,
  isInProgress,
  matchesSearch,
  meetingDayKey,
  normalizeSearchText,
  sourceCategory,
} from '../meetingListModel';

let seq = 0;
function meeting(input: Partial<MeetingCreateInput> & { startAt: string }, id?: string): Meeting {
  seq += 1;
  return buildMeeting(
    { title: `Meeting ${seq}`, source: 'manual', timezone: 'UTC', ...input },
    { id: id ?? `m${seq}`, userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

describe('meetingDayKey', () => {
  it('uses the local day of the start in the given zone (not the UTC day)', () => {
    // 02:30 UTC on Oct 6 is still Oct 5 in Mexico City (UTC-6) and Los Angeles (UTC-7).
    const late = meeting({ startAt: '2026-10-06T02:30:00.000Z' });
    expect(meetingDayKey(late, 'UTC')).toBe('2026-10-06');
    expect(meetingDayKey(late, 'America/Mexico_City')).toBe('2026-10-05');
    expect(meetingDayKey(late, 'America/Los_Angeles')).toBe('2026-10-05');
    // 23:30 UTC on Oct 5 is already Oct 6 in Madrid (UTC+2).
    expect(meetingDayKey(meeting({ startAt: '2026-10-05T23:30:00.000Z' }), 'Europe/Madrid')).toBe('2026-10-06');
  });

  it('keeps the own date of all-day meetings in every zone', () => {
    const allDay = meeting({ startAt: '2026-10-05T00:00:00.000Z', allDay: true, durationMinutes: 1440, timezone: 'Asia/Tokyo' });
    expect(allDay.date).toBe('2026-10-05');
    expect(meetingDayKey(allDay, 'America/Los_Angeles')).toBe('2026-10-05');
    expect(meetingDayKey(allDay, 'Pacific/Auckland')).toBe('2026-10-05');
  });
});

describe('dayRelation', () => {
  it('labels today, tomorrow and yesterday, also across month ends', () => {
    expect(dayRelation('2026-10-05', '2026-10-05')).toBe('today');
    expect(dayRelation('2026-11-01', '2026-10-31')).toBe('tomorrow');
    expect(dayRelation('2026-09-30', '2026-10-01')).toBe('yesterday');
    expect(dayRelation('2026-10-08', '2026-10-05')).toBeNull();
  });
});

describe('filters', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const past = meeting({ title: 'Retro', startAt: '2026-10-04T09:00:00.000Z', source: 'google' }, 'past');
  const running = meeting({ title: 'Standup', startAt: '2026-10-05T11:30:00.000Z', durationMinutes: 60 }, 'running');
  const later = meeting({ title: 'Reunión de presupuesto', startAt: '2026-10-07T15:00:00.000Z', source: 'device' }, 'later');
  const ai = meeting(
    {
      title: 'Lunch',
      startAt: '2026-10-06T12:00:00.000Z',
      source: 'ai_chat',
      participants: [{ email: 'ana@example.com', name: 'Ana Pérez' }],
      location: { type: 'physical', address: 'Café Central', virtualUrl: null },
    },
    'ai',
  );
  const all = [past, running, later, ai];

  it('upcoming keeps meetings that have not ended (in progress included); past only ended ones', () => {
    expect(filterMeetings(all, { ...DEFAULT_FILTERS, time: 'upcoming' }, now).map((m) => m.id)).toEqual(['running', 'later', 'ai']);
    expect(filterMeetings(all, { ...DEFAULT_FILTERS, time: 'past' }, now).map((m) => m.id)).toEqual(['past']);
    expect(filterMeetings(all, { ...DEFAULT_FILTERS, time: 'all' }, now)).toHaveLength(4);
    expect(isInProgress(running, now)).toBe(true);
    expect(isInProgress(later, now)).toBe(false);
  });

  it('filters by source category (AI and manual meetings are Meeting Guard meetings)', () => {
    expect(sourceCategory('ai_chat')).toBe('meetingguard');
    expect(sourceCategory('whatsapp')).toBe('meetingguard');
    expect(sourceCategory('outlook')).toBe('outlook');
    const only = (source: 'meetingguard' | 'google' | 'outlook' | 'device') =>
      filterMeetings(all, { time: 'all', source, query: '' }, now).map((m) => m.id);
    expect(only('meetingguard')).toEqual(['running', 'ai']);
    expect(only('google')).toEqual(['past']);
    expect(only('device')).toEqual(['later']);
  });

  it('searches title, place and people, ignoring case and accents', () => {
    expect(normalizeSearchText('  Reunión ÁRBOL ')).toBe('reunion arbol');
    expect(matchesSearch(later, 'reunion')).toBe(true);
    expect(matchesSearch(ai, 'perez')).toBe(true);
    expect(matchesSearch(ai, 'ana@example')).toBe(true);
    expect(matchesSearch(ai, 'cafe lunch')).toBe(true);
    expect(matchesSearch(ai, 'cafe dinner')).toBe(false);
    expect(matchesSearch(ai, '   ')).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, query: '  ' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, source: 'google' })).toBe(true);
  });
});

describe('grouping', () => {
  it('groups by local day with all-day meetings first and chronological order inside a day', () => {
    const zone = 'America/Mexico_City';
    const evening = meeting({ title: 'Evening', startAt: '2026-10-06T01:00:00.000Z' }, 'evening'); // Oct 5, 19:00 local
    const morning = meeting({ title: 'Morning', startAt: '2026-10-05T15:00:00.000Z' }, 'morning'); // Oct 5, 09:00 local
    const allDay = meeting({ title: 'Holiday', startAt: '2026-10-05T06:00:00.000Z', allDay: true, durationMinutes: 1440, timezone: zone }, 'holiday');
    const next = meeting({ title: 'Next', startAt: '2026-10-06T15:00:00.000Z' }, 'next');
    const sections = groupMeetingsByDay([next, evening, morning, allDay], { timeZone: zone, order: 'asc' });
    expect(sections.map((section) => [section.dayKey, section.data.map((m) => m.id)])).toEqual([
      ['2026-10-05', ['holiday', 'morning', 'evening']],
      ['2026-10-06', ['next']],
    ]);
    const desc = groupMeetingsByDay([next, evening, morning], { timeZone: zone, order: 'desc' });
    expect(desc.map((section) => section.dayKey)).toEqual(['2026-10-06', '2026-10-05']);
  });

  it('past meetings show the most recent day first', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const a = meeting({ startAt: '2026-10-01T10:00:00.000Z' }, 'a');
    const b = meeting({ startAt: '2026-10-08T10:00:00.000Z' }, 'b');
    const sections = buildMeetingSections([a, b], { ...DEFAULT_FILTERS, time: 'past' }, { timeZone: 'UTC', now });
    expect(sections.map((section) => section.dayKey)).toEqual(['2026-10-08', '2026-10-01']);
  });
});
