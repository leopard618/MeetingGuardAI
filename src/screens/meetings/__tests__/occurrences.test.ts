import type { RecurrenceRule } from '../../../core/aiContract';
import { CANCELLED_OVERRIDE } from '../../../core/recurrence';
import { buildMeeting, type Meeting } from '../../../core/types';
import {
  displayKeyOf,
  displayWindowAround,
  displayWindowForDays,
  expandMeetingsForDisplay,
  isOccurrenceDraftValid,
  occurrenceEditDraftOf,
  occurrenceEditPatch,
  type DisplayMeeting,
} from '../occurrences';

const NOW = '2026-10-01T00:00:00.000Z';

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}, id = 'm1'): Meeting {
  return buildMeeting(
    {
      title: 'Standup',
      startAt: '2026-10-05T07:00:00.000Z', // Monday 09:00 in Madrid (CEST)
      durationMinutes: 15,
      timezone: 'Europe/Madrid',
      source: 'manual',
      ...overrides,
    },
    { id, userId: 'u1', now: NOW, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
  );
}

function weekly(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null, ...overrides };
}

const WINDOW = { startIso: '2026-10-01T00:00:00.000Z', endIso: '2026-11-09T00:00:00.000Z' };

describe('expandMeetingsForDisplay', () => {
  it('passes one-off meetings through untouched and replaces masters with their occurrences', () => {
    const oneOff = meeting({}, 'single');
    const master = meeting({ recurrence: weekly() }, 'series');
    const entries = expandMeetingsForDisplay([oneOff, master], WINDOW);

    expect(entries[0]).toBe(oneOff);
    const series = entries.filter((entry) => entry.id === 'series');
    // Mondays Oct 5 .. Nov 2 overlap the window.
    expect(series.map((entry) => entry.occurrence?.localDateKey)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
    // No bare master row remains for a recurring meeting.
    expect(series.every((entry) => entry.occurrence !== undefined)).toBe(true);
  });

  it('keeps the wall-clock time across the DST change (Madrid: Oct 25, 2026)', () => {
    const master = meeting({ recurrence: weekly() }, 'series');
    const entries = expandMeetingsForDisplay([master], WINDOW);
    const before = entries.find((entry) => entry.occurrence?.localDateKey === '2026-10-19')!;
    const after = entries.find((entry) => entry.occurrence?.localDateKey === '2026-10-26')!;
    expect(before.time).toBe('09:00');
    expect(after.time).toBe('09:00');
    expect(before.startAt).toBe('2026-10-19T07:00:00.000Z'); // CEST (+02:00)
    expect(after.startAt).toBe('2026-10-26T08:00:00.000Z'); // CET (+01:00)
    expect(after.date).toBe('2026-10-26');
  });

  it('applies overrides: cancelled occurrences disappear, modified ones carry their values', () => {
    const master = meeting(
      {
        recurrence: weekly(),
        recurrenceOverrides: {
          '2026-10-12': CANCELLED_OVERRIDE,
          '2026-10-19': { status: 'modified', startAt: '2026-10-19T10:30:00.000Z', durationMinutes: 30, title: 'Long standup' },
        },
      },
      'series',
    );
    const entries = expandMeetingsForDisplay([master], WINDOW);
    expect(entries.some((entry) => entry.occurrence?.localDateKey === '2026-10-12')).toBe(false);
    const modified = entries.find((entry) => entry.occurrence?.localDateKey === '2026-10-19')!;
    expect(modified).toMatchObject({
      title: 'Long standup',
      startAt: '2026-10-19T10:30:00.000Z',
      durationMinutes: 30,
      occurrence: { overridden: true, occurrenceId: 'series:2026-10-19' },
    });
    // The row's derived wall-clock fields follow the override (10:30Z = 12:30 in Madrid, CEST).
    expect(modified.time).toBe('12:30');
  });

  it('falls back to the master row when a rule cannot be expanded (corrupt data)', () => {
    const broken = { ...meeting({}, 'broken'), recurrence: { ...weekly(), interval: 0 } } as Meeting;
    const entries = expandMeetingsForDisplay([broken], WINDOW);
    expect(entries).toEqual([broken]);
  });

  it('gives every row a unique, stable key', () => {
    const master = meeting({ recurrence: weekly() }, 'series');
    const keys = expandMeetingsForDisplay([meeting({}, 'single'), master], WINDOW).map((entry) => displayKeyOf(entry));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('single');
    expect(keys).toContain('series:2026-10-05');
  });
});

describe('display windows', () => {
  it('spans whole local days around now', () => {
    const window = displayWindowAround(new Date('2026-10-05T15:30:00.000Z'), 'UTC', 1, 2);
    expect(window).toEqual({ startIso: '2026-10-04T00:00:00.000Z', endIso: '2026-10-08T00:00:00.000Z' });
  });

  it('covers a day range with one day of slack (calendar grid)', () => {
    const window = displayWindowForDays('2026-09-28', '2026-11-08', 'UTC');
    expect(window).toEqual({ startIso: '2026-09-27T00:00:00.000Z', endIso: '2026-11-10T00:00:00.000Z' });
  });
});

describe('occurrence editing helpers', () => {
  const entry: DisplayMeeting = expandMeetingsForDisplay([meeting({ recurrence: weekly() }, 'series')], WINDOW)[0]!;

  it('starts from the occurrence effective values in the meeting zone', () => {
    expect(occurrenceEditDraftOf(entry)).toEqual({ title: 'Standup', date: '2026-10-05', time: '09:00', durationMinutes: 15 });
  });

  it('validates the draft', () => {
    const draft = occurrenceEditDraftOf(entry);
    expect(isOccurrenceDraftValid(draft)).toBe(true);
    expect(isOccurrenceDraftValid({ ...draft, title: '   ' })).toBe(false);
    expect(isOccurrenceDraftValid({ ...draft, date: '2026-13-01' })).toBe(false);
    expect(isOccurrenceDraftValid({ ...draft, time: '25:00' })).toBe(false);
    expect(isOccurrenceDraftValid({ ...draft, durationMinutes: 0 })).toBe(false);
  });

  it('produces a minimal patch (empty when nothing changed; DST-safe start)', () => {
    const draft = occurrenceEditDraftOf(entry);
    expect(occurrenceEditPatch(entry, draft)).toEqual({});
    expect(occurrenceEditPatch(entry, { ...draft, title: 'Renamed' })).toEqual({ title: 'Renamed' });
    // Moving to Oct 26 (after the DST change) keeps 09:00 wall clock => CET instant.
    expect(occurrenceEditPatch(entry, { ...draft, date: '2026-10-26' })).toEqual({ startAt: '2026-10-26T08:00:00.000Z' });
    expect(occurrenceEditPatch(entry, { ...draft, durationMinutes: 30 })).toEqual({ durationMinutes: 30 });
  });
});
