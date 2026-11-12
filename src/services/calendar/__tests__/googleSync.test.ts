import { AppError } from '../../../core/errors';
import { googleEventIdForMeeting } from '../../../core/identifiers';
import {
  enqueueGooglePushes,
  flushGooglePushes,
  MAX_PUSH_ATTEMPTS,
  pullGoogleChanges,
  pushGoogleMeeting,
  removeGoogleLinks,
  type GoogleSyncDeps,
} from '../google/sync';
import type { GoogleEvent } from '../google/types';
import { defaultGoogleSyncState, type GoogleSyncState } from '../stateStore';
import { FakeClock, FakeGoogleApi, FakeMeetings, httpError, memoryStateStore } from '../__testUtils__/fakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');

beforeEach(() => {
  // Expected warnings/info from the code under test.
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function timedEvent(id: string, overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id,
    etag: `"${id}-1"`,
    status: 'confirmed',
    summary: `Event ${id}`,
    updated: '2026-09-30T10:00:00.000Z',
    start: { dateTime: '2026-10-03T09:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2026-10-03T10:00:00Z', timeZone: 'UTC' },
    ...overrides,
  };
}

function setup(initialState: Partial<GoogleSyncState> = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeGoogleApi(clock);
  const meetings = new FakeMeetings(clock);
  const state = memoryStateStore<GoogleSyncState>({ ...defaultGoogleSyncState(), ...initialState });
  const sleep = jest.fn(async (_ms: number) => undefined);
  const deps: GoogleSyncDeps = {
    api,
    meetings,
    state,
    now: clock.now,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
    sleep,
  };
  return { clock, api, meetings, state, deps, sleep };
}

describe('pullGoogleChanges', () => {
  it('runs a bounded full sync first, then incremental syncs with the stored token', async () => {
    const { api, meetings, state, deps } = setup();
    api.listResponses.push(
      { items: [timedEvent('a1')], nextPageToken: 'page-2', timeZone: 'Europe/Madrid' },
      { items: [timedEvent('b2')], nextSyncToken: 'sync-1' },
    );

    const first = await pullGoogleChanges(deps);
    expect(first.fullSync).toBe(true);
    expect(first.counts.created).toBe(2);
    const [page1, page2] = api.calls;
    expect(page1?.params).toMatchObject({ timeMin: '2026-09-01T08:00:00.000Z', timeMax: '2027-03-30T08:00:00.000Z' });
    expect(page2?.params).toMatchObject({ pageToken: 'page-2' });
    expect(state.value.syncToken).toBe('sync-1');
    expect(state.value.calendarTimeZone).toBe('Europe/Madrid');
    expect(meetings.all().every((meeting) => meeting.source === 'google')).toBe(true);

    api.calls = [];
    api.listResponses.push({ items: [timedEvent('a1', { etag: '"a1-2"', summary: 'Renamed' })], nextSyncToken: 'sync-2' });
    const second = await pullGoogleChanges(deps);
    expect(second.fullSync).toBe(false);
    expect(api.calls[0]?.params).toEqual({ syncToken: 'sync-1', pageToken: undefined });
    expect(second.counts.updated).toBe(1);
    expect(meetings.all().find((meeting) => meeting.external.googleEventId === 'a1')?.title).toBe('Renamed');
    expect(state.value.syncToken).toBe('sync-2');
  });

  it('tombstones meetings whose events were cancelled', async () => {
    const { api, meetings, deps } = setup();
    api.listResponses.push({ items: [timedEvent('a1')], nextSyncToken: 'sync-1' });
    await pullGoogleChanges(deps);
    api.listResponses.push({ items: [{ id: 'a1', status: 'cancelled' }], nextSyncToken: 'sync-2' });
    const result = await pullGoogleChanges(deps);
    expect(result.counts.removed).toBe(1);
    expect(meetings.all()[0]?.deletedAt).not.toBeNull();
  });

  it('falls back to a full resync on 410 GONE and removes events that disappeared', async () => {
    const { api, meetings, state, deps } = setup();
    api.listResponses.push({ items: [timedEvent('a1'), timedEvent('b2')], nextSyncToken: 'sync-1' });
    await pullGoogleChanges(deps);

    api.calls = [];
    api.listResponses.push(httpError(410, 'fullSyncRequired'), { items: [timedEvent('a1')], nextSyncToken: 'sync-fresh' });
    const result = await pullGoogleChanges(deps);
    expect(result.fullSync).toBe(true);
    expect(api.calls[0]?.params).toMatchObject({ syncToken: 'sync-1' });
    expect(api.calls[1]?.params).toMatchObject({ timeMin: expect.any(String), timeMax: expect.any(String) });
    expect(state.value.syncToken).toBe('sync-fresh');
    const b2 = meetings.all().find((meeting) => meeting.external.googleEventId === 'b2');
    expect(b2?.deletedAt).not.toBeNull();
    expect(result.counts.removed).toBe(1);
  });

  it('propagates other listing errors without touching the token', async () => {
    const { api, state, deps } = setup({ syncToken: 'sync-1', lastFullSyncAt: NOW.toISOString() });
    api.listResponses.push(new AppError('offline', 'down'));
    await expect(pullGoogleChanges(deps)).rejects.toMatchObject({ code: 'offline' });
    expect(state.value.syncToken).toBe('sync-1');
  });

  it('suppresses echoes: same etag is unchanged, a queued local edit wins', async () => {
    const { api, meetings, deps } = setup();
    api.listResponses.push({ items: [timedEvent('a1')], nextSyncToken: 'sync-1' });
    await pullGoogleChanges(deps);
    const local = meetings.all()[0]!;

    api.listResponses.push({ items: [timedEvent('a1')], nextSyncToken: 'sync-2' });
    const echo = await pullGoogleChanges(deps);
    expect(echo.counts).toMatchObject({ created: 0, updated: 0, unchanged: 1 });

    await meetings.update(local.id, { title: 'Edited here' }, { origin: 'user' });
    await enqueueGooglePushes(deps, [local.id], 'upsert');
    api.listResponses.push({ items: [timedEvent('a1', { etag: '"a1-9"', summary: 'Edited in Google' })], nextSyncToken: 'sync-3' });
    await pullGoogleChanges(deps);
    expect(meetings.all()[0]?.title).toBe('Edited here');
  });

  it("links Meeting Guard's own events to their meeting instead of importing a copy", async () => {
    const { api, meetings, deps } = setup();
    const own = meetings.add({ title: 'Mine', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' }, 'ownMeeting');
    const ownEventId = googleEventIdForMeeting(own.id);
    api.listResponses.push({
      items: [
        timedEvent(ownEventId, { summary: 'Mine (moved)', start: { dateTime: '2026-10-03T11:00:00Z' }, end: { dateTime: '2026-10-03T12:00:00Z' } }),
        timedEvent(googleEventIdForMeeting('otherDevice')),
      ],
      nextSyncToken: 'sync-1',
    });
    await pullGoogleChanges(deps);
    expect(meetings.all()).toHaveLength(1);
    const updated = meetings.all()[0]!;
    expect(updated.source).toBe('manual');
    expect(updated.external.googleEventId).toBe(ownEventId);
    expect(updated.startAt).toBe('2026-10-03T11:00:00.000Z');
  });

  it('ignores new events outside the window on incremental syncs', async () => {
    const { api, meetings, deps } = setup({ syncToken: 'sync-1', lastFullSyncAt: NOW.toISOString() });
    api.listResponses.push({
      items: [
        timedEvent('far', { start: { dateTime: '2030-01-01T09:00:00Z' }, end: { dateTime: '2030-01-01T10:00:00Z' } }),
        timedEvent('ooo', { eventType: 'outOfOffice' }),
      ],
      nextSyncToken: 'sync-2',
    });
    await pullGoogleChanges(deps);
    expect(meetings.all()).toHaveLength(0);
  });
});

describe('pushGoogleMeeting', () => {
  it('inserts with the deterministic id, invites attendees and stores the refs', async () => {
    const { api, meetings, deps } = setup();
    const meeting = meetings.add({
      title: 'Kickoff',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'ai_chat',
      participants: [{ email: 'ana@example.com' }],
    });
    const outcome = await pushGoogleMeeting(deps, meeting);
    expect(outcome.sent).toBe(true);
    const insert = api.calls.find((call) => call.method === 'insert');
    expect(insert?.eventId).toBe(googleEventIdForMeeting(meeting.id));
    expect(insert?.params).toMatchObject({ sendUpdates: 'all' });
    expect(outcome.meeting.external.googleEventId).toBe(googleEventIdForMeeting(meeting.id));
    expect(outcome.meeting.external.googleEtag).toBe(api.events.get(googleEventIdForMeeting(meeting.id))?.etag);
    expect(meetings.writes.at(-1)).toMatchObject({ id: meeting.id, origin: 'calendar_google', kind: 'update' });
  });

  it('does not re-send (or email attendees) when only Meeting Guard fields changed', async () => {
    const { api, meetings, deps } = setup();
    const meeting = meetings.add({
      title: 'Kickoff',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'manual',
      participants: [{ email: 'ana@example.com' }],
    });
    const pushed = (await pushGoogleMeeting(deps, meeting)).meeting;
    api.calls = [];
    const alertsOnly = await meetings.update(pushed.id, { customAlertTimes: [60, 10] }, { origin: 'user' });
    expect((await pushGoogleMeeting(deps, alertsOnly)).sent).toBe(false);
    expect(api.calls).toHaveLength(0);

    const retitled = await meetings.update(pushed.id, { title: 'Kickoff v2' }, { origin: 'user' });
    const outcome = await pushGoogleMeeting(deps, retitled);
    expect(outcome.sent).toBe(true);
    expect(api.calls.map((call) => call.method)).toEqual(['patch']);
    expect(api.calls[0]?.params).toMatchObject({ ifMatch: pushed.external.googleEtag, sendUpdates: 'all' });
  });

  it('restores an existing event on 409 (patch with status confirmed)', async () => {
    const { api, meetings, deps } = setup();
    const meeting = meetings.add({ title: 'Retry', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const eventId = googleEventIdForMeeting(meeting.id);
    api.events.set(eventId, { id: eventId, status: 'cancelled', etag: '"old"' });
    const outcome = await pushGoogleMeeting(deps, meeting);
    expect(api.calls.map((call) => call.method)).toEqual(['insert', 'patch']);
    expect(api.calls[1]?.body?.status).toBe('confirmed');
    expect(api.events.get(eventId)?.status).toBe('confirmed');
    expect(outcome.meeting.external.googleEventId).toBe(eventId);
  });

  it('keeps the Google version when Google changed later (412 + last writer wins)', async () => {
    const { api, clock, meetings, deps } = setup();
    const meeting = meetings.add({ title: 'Mine', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushGoogleMeeting(deps, meeting)).meeting;
    const local = await meetings.update(pushed.id, { title: 'Local edit' }, { origin: 'user' });
    clock.advanceMinutes(5);
    const eventId = pushed.external.googleEventId!;
    api.events.set(eventId, { ...api.events.get(eventId)!, etag: '"remote"', updated: clock.now().toISOString(), summary: 'Remote edit' });
    const outcome = await pushGoogleMeeting(deps, local);
    expect(outcome.sent).toBe(false);
    expect(api.events.get(eventId)?.summary).toBe('Remote edit');
  });

  it('creates a real Meet link and stores it on the meeting', async () => {
    const { api, meetings, deps, sleep } = setup();
    api.meetStatusOnCreate = 'pending';
    const meeting = meetings.add({
      title: 'Video call',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'manual',
      conference: { provider: 'google_meet', url: null, password: null },
    });
    const eventId = googleEventIdForMeeting(meeting.id);
    sleep.mockImplementationOnce(async () => {
      api.completeMeetCreation(eventId);
    });
    const outcome = await pushGoogleMeeting(deps, meeting);
    const insert = api.calls.find((call) => call.method === 'insert');
    expect(insert?.params).toMatchObject({ conferenceDataVersion: 1 });
    expect(insert?.body?.conferenceData?.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
    expect(api.calls.some((call) => call.method === 'get')).toBe(true);
    expect(outcome.meeting.conference).toEqual({ provider: 'google_meet', url: 'https://meet.google.com/xyz-done', password: null });
  });

  it('removes our cancelled meetings from Google but keeps imported ones', async () => {
    const { api, meetings, deps } = setup();
    const own = meetings.add({ title: 'Mine', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushGoogleMeeting(deps, own)).meeting;
    const cancelled = await meetings.update(pushed.id, { status: 'cancelled' }, { origin: 'user' });
    const outcome = await pushGoogleMeeting(deps, cancelled);
    expect(outcome.sent).toBe(true);
    expect(api.events.get(pushed.external.googleEventId!)?.status).toBe('cancelled');
    expect(outcome.meeting.external.googleEventId).toBeNull();

    api.calls = [];
    const imported = meetings.add({
      title: 'Invite',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'google',
      status: 'cancelled',
      external: { googleEventId: 'theirs', googleCalendarId: 'primary' },
    });
    expect((await pushGoogleMeeting(deps, imported)).sent).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it('never pushes device calendar meetings', async () => {
    const { meetings, deps } = setup();
    const device = meetings.add({ title: 'Dentist', startAt: '2026-10-03T09:00:00.000Z', source: 'device' });
    await expect(pushGoogleMeeting(deps, device)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('flushGooglePushes', () => {
  it('keeps everything queued while offline and pushes later', async () => {
    const { api, meetings, state, deps } = setup();
    const a = meetings.add({ title: 'A', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const b = meetings.add({ title: 'B', startAt: '2026-10-03T11:00:00.000Z', source: 'manual' });
    await enqueueGooglePushes(deps, [a.id, b.id], 'upsert');

    api.failures.insert = [new AppError('offline', 'down')];
    const blocked = await flushGooglePushes(deps);
    expect(blocked).toMatchObject({ pushed: 0, blockedBy: 'offline', pending: 2 });

    const flushed = await flushGooglePushes(deps);
    expect(flushed).toMatchObject({ pushed: 2, failed: 0, pending: 0, blockedBy: null });
    expect(Object.keys(state.value.pending)).toHaveLength(0);
  });

  it('skips a held meeting (Zoom link on its way) and keeps it queued', async () => {
    const { api, meetings, state, deps } = setup();
    const a = meetings.add({ title: 'A', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const b = meetings.add({ title: 'B', startAt: '2026-10-03T11:00:00.000Z', source: 'manual' });
    await enqueueGooglePushes(deps, [a.id, b.id], 'upsert');

    deps.holdPush = (meetingId) => meetingId === a.id;
    expect(await flushGooglePushes(deps)).toMatchObject({ pushed: 1, failed: 0, pending: 1, blockedBy: null });
    expect(Object.keys(state.value.pending)).toEqual([a.id]);
    expect(api.calls.filter((call) => call.method === 'insert')).toHaveLength(1);

    deps.holdPush = () => false;
    expect(await flushGooglePushes(deps)).toMatchObject({ pushed: 1, pending: 0 });
    expect(api.calls.filter((call) => call.method === 'insert')).toHaveLength(2);
  });

  it('retries transient failures and drops permanent ones', async () => {
    const { api, meetings, state, deps } = setup();
    const a = meetings.add({ title: 'A', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    await enqueueGooglePushes(deps, [a.id], 'upsert');
    api.failures.insert = [new AppError('upstream_error', '500', { retryable: true })];
    expect(await flushGooglePushes(deps)).toMatchObject({ pushed: 0, pending: 1 });
    expect(state.value.pending[a.id]?.attempts).toBe(1);

    const b = meetings.add({ title: 'B', startAt: '2026-10-03T11:00:00.000Z', source: 'manual' });
    state.value.pending = {};
    await enqueueGooglePushes(deps, [b.id], 'upsert');
    api.failures.insert = [new AppError('invalid_input', '400', { retryable: false })];
    expect(await flushGooglePushes(deps)).toMatchObject({ failed: 1, pending: 0 });
    expect(MAX_PUSH_ATTEMPTS).toBeGreaterThan(1);
  });

  it('deletes events of meetings deleted locally', async () => {
    const { api, meetings, deps } = setup();
    const own = meetings.add({ title: 'Mine', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushGoogleMeeting(deps, own)).meeting;
    await meetings.remove(pushed.id, { origin: 'user' });
    await enqueueGooglePushes(deps, [pushed.id], 'delete');
    expect(await flushGooglePushes(deps)).toMatchObject({ pushed: 1, pending: 0 });
    expect(api.events.get(pushed.external.googleEventId!)?.status).toBe('cancelled');
  });
});

describe('removeGoogleLinks', () => {
  it('tombstones imported meetings and unlinks our own', async () => {
    const { meetings, deps } = setup();
    meetings.add({ title: 'Invite', startAt: '2026-10-03T09:00:00.000Z', source: 'google', external: { googleEventId: 'g1', googleCalendarId: 'primary' } });
    const own = meetings.add({
      title: 'Mine',
      startAt: '2026-10-03T10:00:00.000Z',
      source: 'manual',
      external: { googleEventId: googleEventIdForMeeting('x1'), googleCalendarId: 'primary', googleEtag: '"1"' },
    });
    expect(await removeGoogleLinks(deps)).toEqual({ removed: 1, unlinked: 1 });
    expect(meetings.all().find((meeting) => meeting.source === 'google')?.deletedAt).not.toBeNull();
    expect(meetings.meetings.get(own.id)?.external).toMatchObject({ googleEventId: null, googleEtag: null });
  });
});
