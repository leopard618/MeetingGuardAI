/**
 * Google sync of RECURRING meetings (docs/ARCHITECTURE.md §16): RRULE/EXDATE push, the
 * change-detection hash, the import skip of our own series instances, and full-sync sweep safety.
 */
import { googleEventIdForMeeting } from '../../../core/identifiers';
import type { Meeting, MeetingRecurrence } from '../../../core/types';
import { googleVisibleHash, meetingToGoogleEvent } from '../google/mapping';
import { enqueueUpcomingOwnMeetings, pullGoogleChanges, pushGoogleMeeting } from '../google/sync';
import type { GoogleEvent } from '../google/types';
import { defaultGoogleSyncState, type GoogleSyncState } from '../stateStore';
import { FakeClock, FakeGoogleApi, FakeMeetings, memoryStateStore } from '../__testUtils__/fakes';
import type { GoogleSyncDeps } from '../google/sync';

const NOW = new Date('2026-10-01T08:00:00.000Z');
const WEEKLY: MeetingRecurrence = { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup(initialState: Partial<GoogleSyncState> = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeGoogleApi(clock);
  const meetings = new FakeMeetings(clock);
  const state = memoryStateStore<GoogleSyncState>({ ...defaultGoogleSyncState(), ...initialState });
  const deps: GoogleSyncDeps = {
    api,
    meetings,
    state,
    now: clock.now,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
    sleep: async () => undefined,
  };
  return { clock, api, meetings, state, deps };
}

/** Weekly Monday 14:00 UTC master starting 2026-10-05. */
function addSeries(meetings: FakeMeetings, id = 'ser1', extra: Partial<Meeting> = {}): Meeting {
  const meeting = meetings.add(
    { title: 'Weekly sync', startAt: '2026-10-05T14:00:00.000Z', source: 'manual', recurrence: WEEKLY },
    id,
  );
  const merged = { ...meeting, ...extra };
  meetings.meetings.set(id, merged);
  return merged;
}

describe('meetingToGoogleEvent for recurring masters', () => {
  it('adds one RRULE line plus one EXDATE per cancelled override; modified overrides are not pushed', () => {
    const { meetings } = setup();
    const meeting = addSeries(meetings, 'ser1', {
      recurrenceOverrides: {
        '2026-10-12': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
        '2026-10-19': { status: 'modified', startAt: '2026-10-19T16:00:00.000Z', durationMinutes: null, title: null },
      },
    });
    const body = meetingToGoogleEvent(meeting);
    expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=UTC:20261012T140000']);
  });

  it('one-off meetings carry no recurrence field', () => {
    const { meetings } = setup();
    const meeting = meetings.add({ title: 'One-off', startAt: '2026-10-05T14:00:00.000Z', source: 'manual' }, 'one1');
    expect(meetingToGoogleEvent(meeting).recurrence).toBeUndefined();
  });
});

describe('googleVisibleHash with recurrence', () => {
  it('is unchanged for one-offs, changes with the rule and with cancelled overrides, ignores modified ones', () => {
    const { meetings } = setup();
    const oneOff = meetings.add({ title: 'A', startAt: '2026-10-05T14:00:00.000Z', source: 'manual' }, 'a1');
    const series = addSeries(meetings, 'b1');

    const oneOffHash = googleVisibleHash(oneOff, 'UTC');
    const seriesHash = googleVisibleHash(series, 'UTC');
    expect(seriesHash).not.toBe(oneOffHash);

    const cancelled = {
      ...series,
      recurrenceOverrides: { '2026-10-12': { status: 'cancelled' as const, startAt: null, durationMinutes: null, title: null } },
    };
    expect(googleVisibleHash(cancelled, 'UTC')).not.toBe(seriesHash);

    const modified = {
      ...series,
      recurrenceOverrides: {
        '2026-10-12': { status: 'modified' as const, startAt: '2026-10-12T16:00:00.000Z', durationMinutes: null, title: null },
      },
    };
    expect(googleVisibleHash(modified, 'UTC')).toBe(seriesHash);

    const otherRule = { ...series, recurrence: { ...WEEKLY, interval: 2 } };
    expect(googleVisibleHash(otherRule, 'UTC')).not.toBe(seriesHash);
  });
});

describe('pull: instances of our own pushed series are skipped', () => {
  function instanceOf(masterGoogleId: string, dateTime: string, overrides: Partial<GoogleEvent> = {}): GoogleEvent {
    return {
      id: `${masterGoogleId}_${dateTime.replace(/[-:]/g, '').replace('.000', '')}`,
      etag: `"i-${dateTime}"`,
      status: 'confirmed',
      summary: 'Weekly sync',
      updated: '2026-09-30T10:00:00.000Z',
      start: { dateTime, timeZone: 'UTC' },
      end: { dateTime: dateTime.replace('T14', 'T15'), timeZone: 'UTC' },
      recurringEventId: masterGoogleId,
      ...overrides,
    };
  }

  it('never imports them - active or cancelled - so the series is not duplicated per occurrence', async () => {
    const { api, meetings, deps } = setup();
    const gid = googleEventIdForMeeting('ser1');
    const base = addSeries(meetings, 'ser1');
    meetings.meetings.set('ser1', {
      ...base,
      external: {
        ...base.external,
        googleEventId: gid,
        googleCalendarId: 'primary',
        googleEtag: '"m-1"',
        googleUpdatedAt: '2026-09-29T10:00:00.000Z',
      },
    });
    api.listResponses.push({
      items: [
        instanceOf(gid, '2026-10-05T14:00:00Z'),
        instanceOf(gid, '2026-10-12T14:00:00Z', { status: 'cancelled' }),
      ],
      nextSyncToken: 'sync-1',
    });

    const result = await pullGoogleChanges(deps);
    expect(result.counts.created).toBe(0);
    expect(result.counts.removed).toBe(0);
    expect(meetings.all()).toHaveLength(1);
    const master = meetings.meetings.get('ser1')!;
    expect(master.deletedAt).toBeNull();
    expect(master.recurrenceOverrides).toBeNull(); // Google-side occurrence deletes do NOT import (v1)
  });

  it('still imports foreign recurring instances one meeting per occurrence (unchanged behaviour)', async () => {
    const { api, meetings, deps } = setup();
    api.listResponses.push({
      items: [instanceOf('foreignseries', '2026-10-05T14:00:00Z'), instanceOf('foreignseries', '2026-10-12T14:00:00Z')],
      nextSyncToken: 'sync-1',
    });
    const result = await pullGoogleChanges(deps);
    expect(result.counts.created).toBe(2);
    expect(meetings.all().every((meeting) => meeting.recurrence === null)).toBe(true);
  });

  it('a full sync never sweeps a recurring master (masters do not appear in singleEvents listings)', async () => {
    const { api, meetings, deps } = setup();
    const gid = googleEventIdForMeeting('ser1');
    const base = addSeries(meetings, 'ser1');
    meetings.meetings.set('ser1', {
      ...base,
      external: { ...base.external, googleEventId: gid, googleCalendarId: 'primary' },
    });
    const oneOff = meetings.add({ title: 'Gone', startAt: '2026-10-06T10:00:00.000Z', source: 'manual' }, 'gone1');
    meetings.meetings.set('gone1', {
      ...oneOff,
      external: { ...oneOff.external, googleEventId: googleEventIdForMeeting('gone1'), googleCalendarId: 'primary' },
    });
    api.listResponses.push({ items: [], nextSyncToken: 'sync-1' }); // full sync, nothing listed

    const result = await pullGoogleChanges(deps);
    expect(result.fullSync).toBe(true);
    expect(meetings.meetings.get('ser1')?.deletedAt).toBeNull(); // master kept
    expect(meetings.meetings.get('gone1')?.deletedAt).not.toBeNull(); // one-off swept as before
  });
});

describe('push', () => {
  it('inserts the master with its recurrence lines and stores a hash that skips unchanged pushes', async () => {
    const { api, meetings, deps, state } = setup();
    const meeting = addSeries(meetings, 'ser1');

    const outcome = await pushGoogleMeeting(deps, meeting);
    expect(outcome.sent).toBe(true);
    const insert = api.calls.find((call) => call.method === 'insert');
    expect(insert?.body?.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
    const gid = googleEventIdForMeeting('ser1');
    expect(state.value.hashes[gid]).toBeDefined();

    // Unchanged: nothing sent again.
    const again = await pushGoogleMeeting(deps, meetings.meetings.get('ser1')!);
    expect(again.sent).toBe(false);
  });

  it('a cancelled occurrence triggers a patch with the new EXDATE; a modified one does not push', async () => {
    const { api, meetings, deps } = setup();
    const meeting = addSeries(meetings, 'ser1');
    await pushGoogleMeeting(deps, meeting);
    api.calls = [];

    // Local-only occurrence move: not Google-visible, nothing sent.
    const moved = await meetings.update('ser1', {
      recurrenceOverrides: {
        '2026-10-12': { status: 'modified', startAt: '2026-10-12T16:00:00.000Z', durationMinutes: null, title: null },
      },
    });
    expect((await pushGoogleMeeting(deps, moved)).sent).toBe(false);
    expect(api.calls).toHaveLength(0);

    // Cancelled occurrence: pushed as an EXDATE line.
    const cancelled = await meetings.update('ser1', {
      recurrenceOverrides: {
        '2026-10-12': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
      },
    });
    expect((await pushGoogleMeeting(deps, cancelled)).sent).toBe(true);
    const patch = api.calls.find((call) => call.method === 'patch');
    expect(patch?.body?.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=UTC:20261012T140000']);
  });

  it('enqueueUpcomingOwnMeetings includes a running master whose first occurrence is long past', async () => {
    const { meetings, deps, state } = setup();
    // Started six months ago, endless: startAt is far outside the [now-24h, ...] range.
    meetings.add({ title: 'Old series', startAt: '2026-04-06T14:00:00.000Z', source: 'manual', recurrence: WEEKLY }, 'old1');
    // Ended series: not queued.
    meetings.add(
      {
        title: 'Ended series',
        startAt: '2026-04-06T14:00:00.000Z',
        source: 'manual',
        recurrence: { ...WEEKLY, byWeekday: null, until: '2026-06-01T14:00:00.000Z', count: null },
      },
      'ended1',
    );
    // Past one-off: not queued (unchanged behaviour).
    meetings.add({ title: 'Past', startAt: '2026-09-01T14:00:00.000Z', source: 'manual' }, 'past1');

    const queued = await enqueueUpcomingOwnMeetings(deps);
    expect(queued).toBe(1);
    expect(Object.keys(state.value.pending)).toEqual(['old1']);
  });
});
