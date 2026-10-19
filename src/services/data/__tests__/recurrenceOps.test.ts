/**
 * MeetingRecurrenceOps on the data engine (updateOccurrence / cancelOccurrence /
 * restoreOccurrence) + the pure occurrence-date validation. docs/v1/ARCHITECTURE.md §16.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEventBus, type AppEventMap, type MeetingsChangedEvent } from '../../../core/events';
import { buildMeeting, toMeetingDoc, type Meeting, type MeetingCreateInput, type MeetingDoc } from '../../../core/types';
import { cacheKeys } from '../cache';
import { DataEngine } from '../engine';
import type { NetworkMonitor } from '../platform';
import { isSeriesOccurrenceDate } from '../recurrence';
import { FakeRemote, settle } from '../testing/fakeRemote';

const UID = 'user1';
const T0 = '2026-10-01T10:00:00.000Z';

interface Harness {
  engine: DataEngine;
  remote: FakeRemote;
  meetingEvents: MeetingsChangedEvent[];
  setNow(iso: string): void;
}

let current: Harness | null = null;

function harness(): Harness {
  const remote = new FakeRemote();
  const events = createEventBus<AppEventMap>();
  const meetingEvents: MeetingsChangedEvent[] = [];
  events.on('meetings:changed', (event) => {
    meetingEvents.push(event);
  });
  let now = new Date(T0);
  const network: NetworkMonitor = {
    fetch: async () => true,
    subscribe: () => () => undefined,
  };
  const engine = new DataEngine({
    remote,
    storage: AsyncStorage,
    events,
    network,
    now: () => now,
    getLanguage: () => 'en',
    getTimeZone: () => 'Europe/Madrid',
    timeouts: {
      flushDelayMs: 0,
      commitMs: 2_000,
      fetchMs: 2_000,
      headlessMs: 2_000,
      preferencesFallbackMs: 60_000,
      migrationPreferencesWaitMs: 100,
      retryBaseMs: 60_000,
    },
  });
  current = {
    engine,
    remote,
    meetingEvents,
    setNow: (iso) => {
      now = new Date(iso);
    },
  };
  return current;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (current) await current.engine.endSession({ wipeLocal: false });
  current = null;
  await settle();
  jest.restoreAllMocks();
});

/** Daily 09:00 Madrid series starting 2026-10-05, 10 occurrences. */
const SERIES_INPUT: MeetingCreateInput = {
  title: 'Standup',
  startAt: '2026-10-05T07:00:00.000Z', // 09:00 Europe/Madrid (CEST)
  source: 'manual',
  timezone: 'Europe/Madrid',
  recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 10 },
};

async function startWithSeries(): Promise<{ h: Harness; meeting: Meeting }> {
  const h = harness();
  await h.engine.startSession(UID, { mode: 'foreground' });
  const meeting = await h.engine.createMeeting(SERIES_INPUT, { id: 'series1' });
  h.meetingEvents.length = 0;
  return { h, meeting };
}

describe('updateOccurrence', () => {
  it('writes a modified override, keeps the master untouched and emits meetings:changed', async () => {
    const { h } = await startWithSeries();
    h.setNow('2026-10-01T11:00:00.000Z');

    const updated = await h.engine.updateOccurrence('series1', '2026-10-07', {
      startAt: '2026-10-07T09:30:00.000Z',
      durationMinutes: 30,
      title: 'Moved standup',
    });

    expect(updated.recurrenceOverrides).toEqual({
      '2026-10-07': { status: 'modified', startAt: '2026-10-07T09:30:00.000Z', durationMinutes: 30, title: 'Moved standup' },
    });
    expect(updated.startAt).toBe('2026-10-05T07:00:00.000Z');
    expect(updated.title).toBe('Standup');
    expect(updated.updatedAt).toBe('2026-10-01T11:00:00.000Z');
    expect(h.meetingEvents).toEqual([{ uid: UID, changedIds: ['series1'], reason: 'updated', origin: 'user' }]);
  });

  it('normalizes an offset ISO start to UTC', async () => {
    const { h } = await startWithSeries();
    const updated = await h.engine.updateOccurrence('series1', '2026-10-06', { startAt: '2026-10-06T11:00:00+02:00' });
    expect(updated.recurrenceOverrides?.['2026-10-06']?.startAt).toBe('2026-10-06T09:00:00.000Z');
  });

  it('merges into an existing modified override (absent fields stay overridden)', async () => {
    const { h } = await startWithSeries();
    await h.engine.updateOccurrence('series1', '2026-10-07', { title: 'Renamed' });
    const updated = await h.engine.updateOccurrence('series1', '2026-10-07', { durationMinutes: 45 });
    expect(updated.recurrenceOverrides?.['2026-10-07']).toEqual({
      status: 'modified',
      startAt: null,
      durationMinutes: 45,
      title: 'Renamed',
    });
  });

  it('editing a cancelled occurrence restores it as modified', async () => {
    const { h } = await startWithSeries();
    await h.engine.cancelOccurrence('series1', '2026-10-08');
    const updated = await h.engine.updateOccurrence('series1', '2026-10-08', { title: 'Back on' });
    expect(updated.recurrenceOverrides?.['2026-10-08']).toEqual({
      status: 'modified',
      startAt: null,
      durationMinutes: null,
      title: 'Back on',
    });
  });

  it('an empty patch on a pristine occurrence is a no-op (no event, no override)', async () => {
    const { h, meeting } = await startWithSeries();
    const result = await h.engine.updateOccurrence('series1', '2026-10-07', {});
    expect(result.recurrenceOverrides).toBeNull();
    expect(result.updatedAt).toBe(meeting.updatedAt);
    expect(h.meetingEvents).toEqual([]);
  });

  it('rejects invalid override values through the schema', async () => {
    const { h } = await startWithSeries();
    await expect(h.engine.updateOccurrence('series1', '2026-10-07', { durationMinutes: 0 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(h.engine.updateOccurrence('series1', '2026-10-07', { startAt: 'garbage' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

describe('cancelOccurrence / restoreOccurrence', () => {
  it('cancel writes a cancelled override; a second cancel is a silent no-op', async () => {
    const { h } = await startWithSeries();
    const cancelled = await h.engine.cancelOccurrence('series1', '2026-10-06');
    expect(cancelled.recurrenceOverrides?.['2026-10-06']).toEqual({
      status: 'cancelled',
      startAt: null,
      durationMinutes: null,
      title: null,
    });
    expect(h.meetingEvents).toHaveLength(1);

    const again = await h.engine.cancelOccurrence('series1', '2026-10-06');
    expect(again.updatedAt).toBe(cancelled.updatedAt);
    expect(h.meetingEvents).toHaveLength(1);
  });

  it('restore removes the override; removing the last one stores null (sparse doc)', async () => {
    const { h } = await startWithSeries();
    await h.engine.cancelOccurrence('series1', '2026-10-06');
    const restored = await h.engine.restoreOccurrence('series1', '2026-10-06');
    expect(restored.recurrenceOverrides).toBeNull();

    const raw = (await AsyncStorage.getItem(cacheKeys.meeting(UID, 'series1'))) as string;
    const doc = JSON.parse(raw) as Record<string, unknown>;
    expect('recurrenceOverrides' in doc).toBe(false);
    expect(doc.recurrence).toEqual(SERIES_INPUT.recurrence);
    expect(doc.seriesId).toBe('series1');
  });

  it('restore of a date without an override is a no-op; restore also removes stale override keys', async () => {
    const { h, meeting } = await startWithSeries();
    const untouched = await h.engine.restoreOccurrence('series1', '2026-10-07');
    expect(untouched.updatedAt).toBe(meeting.updatedAt);
    expect(h.meetingEvents).toEqual([]);

    // Rule edited after an override was written: the old key is no longer a pattern date but
    // must stay removable.
    await h.engine.cancelOccurrence('series1', '2026-10-06');
    await h.engine.updateMeeting('series1', {
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null },
    });
    const restored = await h.engine.restoreOccurrence('series1', '2026-10-06'); // a Tuesday
    expect(restored.recurrenceOverrides).toBeNull();
  });
});

describe('validation', () => {
  it('rejects occurrence writes on one-off and missing meetings', async () => {
    const h = harness();
    await h.engine.startSession(UID, { mode: 'foreground' });
    await h.engine.createMeeting({ title: 'One-off', startAt: '2026-10-05T07:00:00.000Z', source: 'manual' }, { id: 'plain' });

    await expect(h.engine.cancelOccurrence('plain', '2026-10-05')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(h.engine.cancelOccurrence('missing', '2026-10-05')).rejects.toMatchObject({ code: 'not_found' });

    await h.engine.removeMeeting('plain');
    await expect(h.engine.cancelOccurrence('plain', '2026-10-05')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects dates the series never generates (pattern, before start, past count/until, malformed)', async () => {
    const { h } = await startWithSeries();
    // Before the first occurrence.
    await expect(h.engine.cancelOccurrence('series1', '2026-10-04')).rejects.toMatchObject({ code: 'invalid_input' });
    // Past the 10-occurrence count (last one is 2026-10-14).
    await expect(h.engine.cancelOccurrence('series1', '2026-10-15')).rejects.toMatchObject({ code: 'invalid_input' });
    // Malformed key.
    await expect(h.engine.cancelOccurrence('series1', 'not-a-date')).rejects.toMatchObject({ code: 'invalid_input' });
    // In range and valid.
    await expect(h.engine.cancelOccurrence('series1', '2026-10-14')).resolves.toBeDefined();
  });
});

describe('migration safety (pre-recurrence documents)', () => {
  it('a cached document without the new keys loads and updates as a one-off', async () => {
    const meeting = buildMeeting(
      { title: 'Old shape', startAt: '2026-10-06T09:00:00.000Z', source: 'manual' },
      { id: 'old1', userId: UID, now: T0, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
    );
    const doc = toMeetingDoc(meeting) as MeetingDoc & Record<string, unknown>;
    expect('recurrence' in doc).toBe(false);
    expect('recurrenceOverrides' in doc).toBe(false);
    expect('seriesId' in doc).toBe(false);
    await AsyncStorage.setItem(cacheKeys.meeting(UID, 'old1'), JSON.stringify(doc));

    const h = harness();
    h.remote.online = false;
    await h.engine.startSession(UID, { mode: 'foreground' });
    const loaded = await h.engine.getMeeting('old1');
    expect(loaded?.recurrence).toBeNull();
    expect(loaded?.recurrenceOverrides).toBeNull();
    expect(loaded?.seriesId).toBeNull();

    const updated = await h.engine.updateMeeting('old1', { title: 'Still fine' });
    expect(updated.title).toBe('Still fine');
    // An unchanged one-off keeps its exact sparse shape on write.
    const raw = (await AsyncStorage.getItem(cacheKeys.meeting(UID, 'old1'))) as string;
    expect('recurrence' in (JSON.parse(raw) as Record<string, unknown>)).toBe(false);
  });

  it('upgrading a one-off to a series sets seriesId and serializes the new keys', async () => {
    const h = harness();
    await h.engine.startSession(UID, { mode: 'foreground' });
    await h.engine.createMeeting({ title: 'Upgraded', startAt: '2026-10-06T09:00:00.000Z', source: 'manual' }, { id: 'up1' });
    const upgraded = await h.engine.updateMeeting('up1', {
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 5 },
    });
    expect(upgraded.seriesId).toBe('up1');
    const raw = (await AsyncStorage.getItem(cacheKeys.meeting(UID, 'up1'))) as string;
    const doc = JSON.parse(raw) as Record<string, unknown>;
    expect(doc.seriesId).toBe('up1');
    expect(doc.recurrence).toEqual(upgraded.recurrence);
  });
});

describe('isSeriesOccurrenceDate (pure)', () => {
  function series(input: Partial<MeetingCreateInput> = {}): Meeting {
    return buildMeeting(
      {
        title: 'S',
        startAt: '2026-10-05T07:00:00.000Z',
        source: 'manual',
        timezone: 'Europe/Madrid',
        recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
        ...input,
      },
      { id: 's', userId: UID, now: T0, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
    ) as Meeting & { recurrence: NonNullable<Meeting['recurrence']> };
  }

  it('accepts pattern dates and rejects off-pattern ones', () => {
    const weekly = series({
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO', 'WE'], byMonthDay: null, until: null, count: null },
    }) as Parameters<typeof isSeriesOccurrenceDate>[0];
    expect(isSeriesOccurrenceDate(weekly, '2026-10-05')).toBe(true); // Monday (anchor)
    expect(isSeriesOccurrenceDate(weekly, '2026-10-07')).toBe(true); // Wednesday
    expect(isSeriesOccurrenceDate(weekly, '2026-10-06')).toBe(false); // Tuesday
    expect(isSeriesOccurrenceDate(weekly, '2026-09-28')).toBe(false); // before the anchor
  });

  it('cancelled overrides consume count exactly like the expander', () => {
    const counted = series({
      recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 3 },
      recurrenceOverrides: { '2026-10-06': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } },
    }) as Parameters<typeof isSeriesOccurrenceDate>[0];
    expect(isSeriesOccurrenceDate(counted, '2026-10-06')).toBe(true); // cancelled but addressable
    expect(isSeriesOccurrenceDate(counted, '2026-10-07')).toBe(true); // 3rd occurrence
    expect(isSeriesOccurrenceDate(counted, '2026-10-08')).toBe(false); // count exhausted
  });

  it('monthly rules skip months without the day', () => {
    const monthly = series({
      startAt: '2026-01-31T08:00:00.000Z', // 09:00 Madrid (CET)
      recurrence: { freq: 'monthly', interval: 1, byWeekday: null, byMonthDay: 31, until: null, count: null },
    }) as Parameters<typeof isSeriesOccurrenceDate>[0];
    expect(isSeriesOccurrenceDate(monthly, '2026-01-31')).toBe(true);
    expect(isSeriesOccurrenceDate(monthly, '2026-02-28')).toBe(false); // February skipped entirely
    expect(isSeriesOccurrenceDate(monthly, '2026-03-31')).toBe(true);
  });

  it('respects until (inclusive) and rejects malformed keys', () => {
    const until = series({
      recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: '2026-10-07T07:00:00.000Z', count: null },
    }) as Parameters<typeof isSeriesOccurrenceDate>[0];
    expect(isSeriesOccurrenceDate(until, '2026-10-07')).toBe(true);
    expect(isSeriesOccurrenceDate(until, '2026-10-08')).toBe(false);
    expect(isSeriesOccurrenceDate(until, '2026-13-40')).toBe(false);
    expect(isSeriesOccurrenceDate(until, 'nope')).toBe(false);
  });
});
