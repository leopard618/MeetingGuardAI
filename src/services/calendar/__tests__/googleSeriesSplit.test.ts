/**
 * Google push behavior of a "this and following" series split (docs/v1/ARCHITECTURE.md §16): the
 * split is two ordinary local writes, so the existing push must PATCH the old event with the
 * truncated RRULE (UNTIL) and INSERT the tail as a brand-new series event with the deterministic
 * id, while the ref write-backs (origin 'calendar_google') are never re-pushed and an unchanged
 * event is not re-sent (hash short-circuit).
 */
import { googleEventIdForMeeting } from '../../../core/identifiers';
import { splitRecurrenceAt, type SeriesSplit } from '../../../core/recurrence';
import type { MeetingCreateInput } from '../../../core/types';
import { isPushableChange } from '../engine';
import { pushGoogleMeeting, type GoogleSyncDeps } from '../google/sync';
import { defaultGoogleSyncState, type GoogleSyncState } from '../stateStore';
import { FakeClock, FakeGoogleApi, FakeMeetings, memoryStateStore } from '../__testUtils__/fakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup() {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeGoogleApi(clock);
  const meetings = new FakeMeetings(clock);
  const state = memoryStateStore<GoogleSyncState>({ ...defaultGoogleSyncState() });
  const deps: GoogleSyncDeps = {
    api,
    meetings,
    state,
    now: clock.now,
    defaultTimeZone: () => 'Europe/Madrid',
    untitledTitle: () => '(No title)',
    sleep: jest.fn(async () => undefined),
  };
  return { clock, api, meetings, state, deps };
}

/** Daily 09:00 Madrid, 10 occurrences from Mon 2026-10-05, one cancelled before the split. */
const SERIES_INPUT: MeetingCreateInput = {
  title: 'Standup',
  startAt: '2026-10-05T07:00:00.000Z',
  source: 'manual',
  timezone: 'Europe/Madrid',
  durationMinutes: 30,
  recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 10 },
  recurrenceOverrides: { '2026-10-06': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } },
};

/** Applies the split to the fake repository exactly like the data engine's editFollowing. */
async function applySplit(meetings: FakeMeetings, masterId: string, fromDateKey: string, tailId: string) {
  const master = meetings.meetings.get(masterId)!;
  const split = splitRecurrenceAt(master, fromDateKey) as SeriesSplit;
  const truncated = await meetings.update(
    masterId,
    { recurrence: split.masterRule, recurrenceOverrides: split.masterOverrides },
    { origin: 'user' },
  );
  const tail = meetings.add(
    {
      title: master.title,
      startAt: split.tailStartAt,
      source: master.source,
      timezone: master.timezone,
      durationMinutes: master.durationMinutes,
      recurrence: split.tailRule,
      recurrenceOverrides: split.tailOverrides,
    },
    tailId,
  );
  return { truncated, tail, split };
}

describe('pushing a series split to Google', () => {
  it('PATCHes the old event with the truncated UNTIL rule and INSERTs the tail as a new series', async () => {
    const { api, meetings, deps } = setup();
    const master = meetings.add(SERIES_INPUT, 'series1');

    // The series was already pushed once (insert with the deterministic id + stored hash).
    const first = await pushGoogleMeeting(deps, master);
    expect(first.sent).toBe(true);
    const masterEventId = googleEventIdForMeeting('series1');
    expect(api.calls.map((call) => call.method)).toEqual(['insert']);

    const { truncated, tail } = await applySplit(meetings, 'series1', '2026-10-08', 'tail1');
    api.calls = [];

    const pushedMaster = await pushGoogleMeeting(deps, truncated);
    const pushedTail = await pushGoogleMeeting(deps, tail);
    expect(pushedMaster.sent).toBe(true);
    expect(pushedTail.sent).toBe(true);

    // Old event: PATCH with the truncated rule; the pre-split EXDATE stays with it.
    expect(api.calls[0]).toMatchObject({ method: 'patch', eventId: masterEventId });
    expect(api.calls[0]?.body?.recurrence).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20261008T065959Z',
      'EXDATE;TZID=Europe/Madrid:20261006T090000',
    ]);

    // Tail: INSERT as a brand-new series event with its own deterministic id and remaining count.
    const tailEventId = googleEventIdForMeeting('tail1');
    expect(api.calls[1]).toMatchObject({ method: 'insert' });
    expect(api.calls[1]?.body?.id).toBe(tailEventId);
    expect(api.calls[1]?.body?.recurrence).toEqual(['RRULE:FREQ=DAILY;COUNT=7']);
    expect(api.calls[1]?.body?.start).toMatchObject({ dateTime: expect.stringContaining('2026-10-08') });

    // Both meetings got their refs written back with the sync origin.
    const masterRefs = meetings.meetings.get('series1')!.external;
    const tailRefs = meetings.meetings.get('tail1')!.external;
    expect(masterRefs.googleEventId).toBe(masterEventId);
    expect(tailRefs.googleEventId).toBe(tailEventId);
    expect(meetings.writes.filter((write) => write.origin === 'calendar_google').length).toBeGreaterThanOrEqual(2);
  });

  it('suppresses echoes: ref write-backs are not pushable and an unchanged event is not re-sent', async () => {
    const { api, meetings, deps } = setup();
    const master = meetings.add(SERIES_INPUT, 'series1');
    await pushGoogleMeeting(deps, master);
    const { truncated, tail } = await applySplit(meetings, 'series1', '2026-10-08', 'tail1');
    await pushGoogleMeeting(deps, truncated);
    await pushGoogleMeeting(deps, tail);

    // The write-backs carry origin 'calendar_google': the engine never queues them again.
    for (const write of meetings.writes.filter((entry) => entry.origin === 'calendar_google')) {
      expect(
        isPushableChange({ uid: 'user-1', changedIds: [write.id], reason: 'updated', origin: 'calendar_google' }),
      ).toBe(false);
    }

    // Re-pushing both without changes: the Google-visible hash short-circuits, nothing is sent.
    api.calls = [];
    const masterAgain = await pushGoogleMeeting(deps, meetings.meetings.get('series1')!);
    const tailAgain = await pushGoogleMeeting(deps, meetings.meetings.get('tail1')!);
    expect(masterAgain.sent).toBe(false);
    expect(tailAgain.sent).toBe(false);
    expect(api.calls).toEqual([]);
  });

  it('a split of an IMPORTED Google series patches the imported event and inserts an mgev tail', async () => {
    const { api, meetings, deps } = setup();
    meetings.add(
      {
        ...SERIES_INPUT,
        source: 'google',
        recurrenceOverrides: null,
        external: { googleEventId: 'gev1', googleCalendarId: 'primary', googleEtag: '"gev1-1"' },
      },
      'series1',
    );
    // The engine's editFollowing gives the tail of a google-source master source 'manual'
    // (a google-source meeting without an event id is refused by the push).
    const master = meetings.meetings.get('series1')!;
    const split = splitRecurrenceAt(master, '2026-10-08') as SeriesSplit;
    const truncated = await meetings.update(
      'series1',
      { recurrence: split.masterRule, recurrenceOverrides: split.masterOverrides },
      { origin: 'user' },
    );
    const tail = meetings.add(
      { ...SERIES_INPUT, source: 'manual', startAt: split.tailStartAt, recurrence: split.tailRule, recurrenceOverrides: split.tailOverrides },
      'tail1',
    );
    api.events.set('gev1', {
      id: 'gev1',
      etag: '"gev1-1"',
      status: 'confirmed',
      summary: 'Standup',
      start: { dateTime: '2026-10-05T09:00:00+02:00', timeZone: 'Europe/Madrid' },
      end: { dateTime: '2026-10-05T09:30:00+02:00', timeZone: 'Europe/Madrid' },
    });

    await pushGoogleMeeting(deps, truncated);
    await pushGoogleMeeting(deps, tail);

    expect(api.calls[0]).toMatchObject({ method: 'patch', eventId: 'gev1' });
    expect(api.calls[0]?.body?.recurrence?.[0]).toBe('RRULE:FREQ=DAILY;UNTIL=20261008T065959Z');
    expect(api.calls[1]).toMatchObject({ method: 'insert' });
    expect(api.calls[1]?.body?.id).toBe(googleEventIdForMeeting('tail1'));
  });
});
