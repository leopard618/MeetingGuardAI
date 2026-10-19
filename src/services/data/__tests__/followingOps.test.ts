/**
 * "This and following" repository ops on the data engine (editFollowing / deleteFollowing,
 * MeetingRecurrenceOps, docs/v1/ARCHITECTURE.md §16). The pure split math is covered by
 * src/core/__tests__/recurrenceSplit.test.ts; these tests cover the engine semantics: atomic
 * two-document writes, content copy, override partitioning, events, sources and failure modes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEventBus, type AppEventMap, type MeetingsChangedEvent } from '../../../core/events';
import type { Meeting, MeetingCreateInput } from '../../../core/types';
import { DataEngine } from '../engine';
import type { NetworkMonitor } from '../platform';
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

/** Daily 09:00 Madrid series starting 2026-10-05 (CEST, 07:00Z), 10 occurrences: 10-05 .. 10-14. */
const SERIES_INPUT: MeetingCreateInput = {
  title: 'Standup',
  startAt: '2026-10-05T07:00:00.000Z',
  source: 'manual',
  timezone: 'Europe/Madrid',
  durationMinutes: 30,
  notes: 'bring notes',
  preparationTips: ['agenda'],
  customAlertTimes: [15, 5],
  recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 10 },
};

async function startWithSeries(input: MeetingCreateInput = SERIES_INPUT): Promise<{ h: Harness; meeting: Meeting }> {
  const h = harness();
  await h.engine.startSession(UID, { mode: 'foreground' });
  const meeting = await h.engine.createMeeting(input, { id: 'series1' });
  h.meetingEvents.length = 0;
  return { h, meeting };
}

describe('editFollowing', () => {
  it('truncates the master, creates the tail with the patch applied, and emits both events', async () => {
    const { h } = await startWithSeries();
    h.setNow('2026-10-01T11:00:00.000Z');

    const { master, created } = await h.engine.editFollowing('series1', '2026-10-08', { title: 'New standup' });

    // Master: count converted to until = 1 s before the split occurrence's original start.
    expect(master.recurrence).toEqual({
      freq: 'daily',
      interval: 1,
      byWeekday: null,
      byMonthDay: null,
      until: '2026-10-08T06:59:59.000Z',
      count: null,
    });
    expect(master.title).toBe('Standup');
    expect(master.startAt).toBe('2026-10-05T07:00:00.000Z');

    // Tail: new id/seriesId, original split start, content copied, remaining count, patch applied.
    expect(created).not.toBeNull();
    expect(created!.id).not.toBe('series1');
    expect(created!.seriesId).toBe(created!.id);
    expect(created!.startAt).toBe('2026-10-08T07:00:00.000Z');
    expect(created!.date).toBe('2026-10-08');
    expect(created!.time).toBe('09:00');
    expect(created!.title).toBe('New standup');
    expect(created!.durationMinutes).toBe(30);
    expect(created!.notes).toBe('bring notes');
    expect(created!.preparationTips).toEqual(['agenda']);
    expect(created!.customAlertTimes).toEqual([15, 5]);
    expect(created!.recurrence).toEqual({ ...SERIES_INPUT.recurrence, count: 7 });
    expect(created!.external.googleEventId).toBeNull();

    expect(h.meetingEvents).toEqual([
      { uid: UID, changedIds: ['series1'], reason: 'updated', origin: 'user' },
      { uid: UID, changedIds: [created!.id], reason: 'created', origin: 'user' },
    ]);

    // Both documents reach the server (outbox flush).
    await settle();
    const masterDoc = h.remote.docs.get(`users/${UID}/meetings/series1`) as { recurrence?: { until: string | null } };
    const tailDoc = h.remote.docs.get(`users/${UID}/meetings/${created!.id}`) as { title?: string; seriesId?: string };
    expect(masterDoc?.recurrence?.until).toBe('2026-10-08T06:59:59.000Z');
    expect(tailDoc?.title).toBe('New standup');
    expect(tailDoc?.seriesId).toBe(created!.id);
  });

  it('partitions overrides at the split date; a modified override ON the split date stays an override on the tail', async () => {
    const { h } = await startWithSeries();
    await h.engine.cancelOccurrence('series1', '2026-10-06');
    await h.engine.updateOccurrence('series1', '2026-10-08', { startAt: '2026-10-08T10:00:00.000Z' });
    await h.engine.updateOccurrence('series1', '2026-10-09', { title: 'Review' });
    h.meetingEvents.length = 0;

    const { master, created } = await h.engine.editFollowing('series1', '2026-10-08', {});

    expect(master.recurrenceOverrides).toEqual({ '2026-10-06': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } });
    // The tail's own start is the ORIGINAL split start; the moved time stays an override.
    expect(created!.startAt).toBe('2026-10-08T07:00:00.000Z');
    expect(created!.recurrenceOverrides).toEqual({
      '2026-10-08': { status: 'modified', startAt: '2026-10-08T10:00:00.000Z', durationMinutes: null, title: null },
      '2026-10-09': { status: 'modified', startAt: null, durationMinutes: null, title: 'Review' },
    });
    // 3 occurrences generated before the split (10-05, cancelled 10-06 consumes count, 10-07).
    expect(created!.recurrence?.count).toBe(7);
  });

  it('keeps an until rule on both sides and preserves the wall clock across a DST change', async () => {
    // Daily 09:00 Madrid from Fri 2026-10-23; DST ends Sun 2026-10-25 (CEST 07:00Z -> CET 08:00Z).
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      startAt: '2026-10-23T07:00:00.000Z',
      recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: '2026-10-28T08:00:00.000Z', count: null },
    });

    const { master, created } = await h.engine.editFollowing('series1', '2026-10-26', {});

    expect(master.recurrence?.until).toBe('2026-10-26T07:59:59.000Z');
    expect(master.recurrence?.count).toBeNull();
    // Tail keeps 09:00 Madrid: 08:00Z after the clocks changed, and the original until.
    expect(created!.startAt).toBe('2026-10-26T08:00:00.000Z');
    expect(created!.date).toBe('2026-10-26');
    expect(created!.time).toBe('09:00');
    expect(created!.recurrence?.until).toBe('2026-10-28T08:00:00.000Z');
    expect(created!.recurrence?.count).toBeNull();
  });

  it('collapses to a plain series update at the FIRST occurrence (created null, single event)', async () => {
    const { h } = await startWithSeries();

    const { master, created } = await h.engine.editFollowing('series1', '2026-10-05', { title: 'Renamed' });

    expect(created).toBeNull();
    expect(master.title).toBe('Renamed');
    expect(master.recurrence).toEqual(SERIES_INPUT.recurrence); // rule untouched
    expect(h.meetingEvents).toEqual([{ uid: UID, changedIds: ['series1'], reason: 'updated', origin: 'user' }]);
  });

  it('collapse with a no-op patch writes nothing', async () => {
    const { h, meeting } = await startWithSeries();
    const { master, created } = await h.engine.editFollowing('series1', '2026-10-05', {});
    expect(created).toBeNull();
    expect(master).toEqual(meeting);
    expect(h.meetingEvents).toEqual([]);
  });

  it('re-anchors byWeekday when a date-moving patch lands on the tail (the moved occurrence must exist)', async () => {
    // Weekly Monday series (form rules always carry byWeekday = [anchor weekday]).
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: 10 },
    });

    // "This and following" from Mon 2026-10-12, moved to Tue 2026-10-13 09:00 Madrid.
    const { master, created } = await h.engine.editFollowing('series1', '2026-10-12', {
      startAt: '2026-10-13T07:00:00.000Z',
    });

    expect(master.recurrence?.byWeekday).toEqual(['MO']);
    expect(created!.date).toBe('2026-10-13');
    // Without the swap the tail would keep ['MO'] and skip its own Tuesday anchor entirely.
    expect(created!.recurrence?.byWeekday).toEqual(['TU']);
  });

  it('re-anchors byMonthDay for monthly rules and keeps an explicitly patched rule verbatim', async () => {
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      recurrence: { freq: 'monthly', interval: 1, byWeekday: null, byMonthDay: 5, until: null, count: 6 },
    });
    // Nov 2026 in Madrid is CET: 09:00 local = 08:00Z.
    const { created } = await h.engine.editFollowing('series1', '2026-11-05', { startAt: '2026-11-10T08:00:00.000Z' });
    expect(created!.date).toBe('2026-11-10');
    expect(created!.recurrence?.byMonthDay).toBe(10);

    // An explicit patch.recurrence is the caller's rule choice: no reconciliation on top.
    const explicitRule = { freq: 'weekly', interval: 1, byWeekday: ['FR'], byMonthDay: null, until: null, count: null } as const;
    const second = await h.engine.editFollowing(created!.id, '2027-01-10', {
      startAt: '2027-01-12T08:00:00.000Z',
      recurrence: { ...explicitRule, byWeekday: [...explicitRule.byWeekday] },
    });
    expect(second.created!.recurrence).toEqual(explicitRule);
  });

  it("rejects a patched start past the tail rule's until (the series would have zero occurrences)", async () => {
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: '2026-10-10T07:00:00.000Z', count: null },
    });

    await expect(
      h.engine.editFollowing('series1', '2026-10-08', { startAt: '2026-10-20T07:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    // Nothing was written: no truncated master without a live tail.
    expect(h.meetingEvents).toEqual([]);
  });

  it('re-anchors the rule on the series_edit collapse too (date move from the FIRST occurrence)', async () => {
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: 10 },
    });

    const { master, created } = await h.engine.editFollowing('series1', '2026-10-05', {
      startAt: '2026-10-06T07:00:00.000Z',
    });

    expect(created).toBeNull();
    expect(master.date).toBe('2026-10-06');
    expect(master.recurrence?.byWeekday).toEqual(['TU']);
  });

  it('applies the patch to the tail only, with the caller origin', async () => {
    const { h } = await startWithSeries();

    const { master, created } = await h.engine.editFollowing(
      'series1',
      '2026-10-10',
      { startAt: '2026-10-10T09:00:00.000Z', durationMinutes: 45 },
      { origin: 'ai' },
    );

    expect(master.durationMinutes).toBe(30);
    expect(created!.startAt).toBe('2026-10-10T09:00:00.000Z');
    expect(created!.durationMinutes).toBe(45);
    expect(h.meetingEvents.map((event) => event.origin)).toEqual(['ai', 'ai']);
  });

  it('a Google-imported master splits into a locally-owned tail (source manual, no external refs)', async () => {
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      source: 'google',
      external: { googleEventId: 'gev1', googleCalendarId: 'primary' },
    });

    const { master, created } = await h.engine.editFollowing('series1', '2026-10-08', {});

    expect(master.source).toBe('google');
    expect(master.external.googleEventId).toBe('gev1');
    // The tail must be INSERTED into Google as a brand-new event: no refs, not source 'google'
    // (the push refuses a google-source meeting without an event id).
    expect(created!.source).toBe('manual');
    expect(created!.external.googleEventId).toBeNull();
    expect(created!.external.googleCalendarId).toBeNull();
  });

  it('a server-created Zoom link stays with the master; the tail gets url/password null (§24)', async () => {
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      conference: { provider: 'zoom', url: 'https://zoom.us/j/987654321?pwd=abc', password: 'abc123' },
      external: { zoomMeetingId: '987654321' },
    });

    const { master, created } = await h.engine.editFollowing('series1', '2026-10-08', {});

    expect(master.conference).toEqual({ provider: 'zoom', url: 'https://zoom.us/j/987654321?pwd=abc', password: 'abc123' });
    expect(master.external.zoomMeetingId).toBe('987654321');
    // Copying the url would point the tail at a Zoom meeting it does not own: deleting the old
    // series kills that link, and tail edits could never sync. url null makes the zoom flow
    // create a FRESH Zoom meeting for the tail (zoomHooks / the details card's auto-ensureLink).
    expect(created!.conference).toEqual({ provider: 'zoom', url: null, password: null });
    expect(created!.external.zoomMeetingId).toBeNull();
  });

  it('a PASTED zoom link (no zoomMeetingId) is copied to the tail like any other field', async () => {
    const { h } = await startWithSeries({
      ...SERIES_INPUT,
      conference: { provider: 'zoom', url: 'https://zoom.us/j/555?pwd=user', password: 'user1' },
    });

    const { created } = await h.engine.editFollowing('series1', '2026-10-08', {});

    expect(created!.conference).toEqual({ provider: 'zoom', url: 'https://zoom.us/j/555?pwd=user', password: 'user1' });
  });

  it('an invalid patch changes nothing (the master is never truncated without its tail)', async () => {
    const { h, meeting } = await startWithSeries();

    await expect(h.engine.editFollowing('series1', '2026-10-08', { startAt: 'not-a-date' })).rejects.toMatchObject({
      code: 'invalid_input',
    });

    expect(await h.engine.getMeeting('series1')).toEqual(meeting);
    expect(h.meetingEvents).toEqual([]);
    await settle();
    expect([...h.remote.docs.keys()].filter((key) => key.includes('/meetings/'))).toEqual([`users/${UID}/meetings/series1`]);
  });

  it('rejects non-occurrence dates, dates past the series end, one-off meetings and missing meetings', async () => {
    const { h } = await startWithSeries();
    await h.engine.createMeeting({ title: 'One-off', startAt: '2026-10-06T10:00:00.000Z', source: 'manual' }, { id: 'single1' });
    h.meetingEvents.length = 0;

    // Past the count end (last occurrence is 10-14).
    await expect(h.engine.editFollowing('series1', '2026-10-20', {})).rejects.toMatchObject({ code: 'invalid_input' });
    // Malformed date key.
    await expect(h.engine.editFollowing('series1', '2026-13-40', {})).rejects.toMatchObject({ code: 'invalid_input' });
    // Not recurring.
    await expect(h.engine.editFollowing('single1', '2026-10-06', {})).rejects.toMatchObject({ code: 'invalid_input' });
    // Missing.
    await expect(h.engine.editFollowing('ghost', '2026-10-08', {})).rejects.toMatchObject({ code: 'not_found' });
    expect(h.meetingEvents).toEqual([]);
  });

  it('honors options.id for the tail and refuses an id that is already taken', async () => {
    const { h } = await startWithSeries();

    const { created } = await h.engine.editFollowing('series1', '2026-10-08', {}, { id: 'tail1' });
    expect(created!.id).toBe('tail1');

    await expect(h.engine.editFollowing('tail1', '2026-10-10', {}, { id: 'series1' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('running the same split again fails loudly instead of splitting twice', async () => {
    const { h } = await startWithSeries();
    await h.engine.editFollowing('series1', '2026-10-08', {});
    // 10-08 is no longer an occurrence of the truncated master.
    await expect(h.engine.editFollowing('series1', '2026-10-08', {})).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('deleteFollowing', () => {
  it('truncates the master and creates nothing', async () => {
    const { h } = await startWithSeries();
    await h.engine.cancelOccurrence('series1', '2026-10-06');
    h.meetingEvents.length = 0;

    const result = await h.engine.deleteFollowing('series1', '2026-10-08', { origin: 'ai' });

    expect(result).not.toBeNull();
    expect(result!.recurrence).toEqual({ ...SERIES_INPUT.recurrence, until: '2026-10-08T06:59:59.000Z', count: null });
    expect(result!.recurrenceOverrides).toEqual({
      '2026-10-06': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
    });
    expect(result!.deletedAt).toBeNull();
    expect(h.meetingEvents).toEqual([{ uid: UID, changedIds: ['series1'], reason: 'updated', origin: 'ai' }]);

    await settle();
    expect([...h.remote.docs.keys()].filter((key) => key.includes('/meetings/'))).toEqual([`users/${UID}/meetings/series1`]);
  });

  it('collapses to a series remove at the FIRST occurrence and resolves null', async () => {
    const { h } = await startWithSeries();

    const result = await h.engine.deleteFollowing('series1', '2026-10-05');

    expect(result).toBeNull();
    expect(h.meetingEvents).toEqual([{ uid: UID, changedIds: ['series1'], reason: 'deleted', origin: 'user' }]);
    await settle();
    const doc = h.remote.docs.get(`users/${UID}/meetings/series1`) as { deletedAt?: string | null };
    expect(doc?.deletedAt).not.toBeNull();
  });

  it('validates like editFollowing', async () => {
    const { h } = await startWithSeries();
    await expect(h.engine.deleteFollowing('series1', '2026-10-20')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(h.engine.deleteFollowing('ghost', '2026-10-08')).rejects.toMatchObject({ code: 'not_found' });
    // Deleting "this and following" twice: the date is gone from the truncated series.
    await h.engine.deleteFollowing('series1', '2026-10-08');
    await expect(h.engine.deleteFollowing('series1', '2026-10-08')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
