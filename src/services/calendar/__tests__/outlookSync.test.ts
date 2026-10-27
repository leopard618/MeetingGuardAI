import { AppError } from '../../../core/errors';
import { graphHttpStatus, type OutlookGraphApi } from '../outlook/api';
import { OUTLOOK_DEFAULT_CALENDAR } from '../outlook/mapping';
import { defaultOutlookSyncState, type OutlookSyncState } from '../outlook/state';
import {
  applyOccurrenceOverrides,
  deleteOutlookEvent,
  enqueueOutlookPushes,
  enqueueUpcomingOwnMeetings,
  flushOutlookPushes,
  isOutlookPushable,
  outlookTransactionId,
  pullOutlookChanges,
  pushOutlookMeeting,
  removeOutlookLinks,
  type OutlookSyncDeps,
} from '../outlook/sync';
import type { GraphDeltaPage, GraphEvent, GraphEventWrite } from '../outlook/types';
import { FakeClock, FakeMeetings, memoryStateStore } from '../__testUtils__/fakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');

beforeEach(() => {
  // Expected warnings/info from the code under test.
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function graphError(status: number, code: string | null = null): AppError {
  const appCode = status === 404 || status === 410 ? 'not_found' : status === 409 || status === 412 ? 'conflict' : 'upstream_error';
  return new AppError(appCode, `HTTP ${status}`, { details: { status, graphCode: code }, retryable: status === 429 || status >= 500 });
}

function timedEvent(id: string, overrides: Partial<GraphEvent> = {}): GraphEvent {
  return {
    id,
    changeKey: `${id}-ck1`,
    lastModifiedDateTime: '2026-09-30T10:00:00Z',
    type: 'singleInstance',
    subject: `Event ${id}`,
    start: { dateTime: '2026-10-03T09:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-10-03T10:00:00.0000000', timeZone: 'UTC' },
    isAllDay: false,
    ...overrides,
  };
}

interface GraphCall {
  method: 'startDelta' | 'deltaPage' | 'get' | 'create' | 'patch' | 'delete' | 'me' | 'instances';
  id?: string;
  url?: string;
  body?: GraphEventWrite;
}

/** Scriptable Graph: stores events; delta responses can be queued explicitly. */
class FakeGraphApi implements OutlookGraphApi {
  events = new Map<string, GraphEvent>();
  calls: GraphCall[] = [];
  deltaResponses: (GraphDeltaPage | AppError)[] = [];
  failures: Partial<Record<GraphCall['method'], AppError[]>> = {};
  /** Whether created Teams meetings get a join URL right away. */
  teamsJoinUrlOnCreate = true;
  /** Series master id -> generated instances (set by tests; a real Graph generates them). */
  instances = new Map<string, GraphEvent[]>();
  private seq = 0;
  private byTransactionId = new Map<string, string>();

  constructor(private clock: FakeClock) {}

  private fail(method: GraphCall['method']): void {
    const next = this.failures[method]?.shift();
    if (next) throw next;
  }

  private store(event: GraphEvent): GraphEvent {
    this.seq += 1;
    const stored = { ...event, changeKey: `${event.id}-ck${this.seq}`, lastModifiedDateTime: this.clock.now().toISOString() };
    this.events.set(stored.id, stored);
    return JSON.parse(JSON.stringify(stored)) as GraphEvent;
  }

  private defaultPage(): GraphDeltaPage {
    return {
      value: [...this.events.values()].map((event) => JSON.parse(JSON.stringify(event)) as GraphEvent),
      '@odata.deltaLink': `https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=d${this.seq}`,
    };
  }

  private nextDelta(): GraphDeltaPage {
    const next = this.deltaResponses.shift();
    if (next instanceof AppError) throw next;
    return next ?? this.defaultPage();
  }

  async startDelta(startIso: string, endIso: string): Promise<GraphDeltaPage> {
    this.calls.push({ method: 'startDelta', url: `${startIso}..${endIso}` });
    this.fail('startDelta');
    return this.nextDelta();
  }

  async getDeltaPage(url: string): Promise<GraphDeltaPage> {
    this.calls.push({ method: 'deltaPage', url });
    this.fail('deltaPage');
    return this.nextDelta();
  }

  async getEvent(eventId: string): Promise<GraphEvent> {
    this.calls.push({ method: 'get', id: eventId });
    this.fail('get');
    const event = this.events.get(eventId);
    if (!event) throw graphError(404, 'ErrorItemNotFound');
    return JSON.parse(JSON.stringify(event)) as GraphEvent;
  }

  async createEvent(body: GraphEventWrite): Promise<GraphEvent> {
    this.calls.push({ method: 'create', body });
    this.fail('create');
    if (body.transactionId !== undefined) {
      // Graph replays a POST with a known transactionId idempotently.
      const existingId = this.byTransactionId.get(body.transactionId);
      if (existingId !== undefined) return this.getEvent(existingId);
    }
    this.seq += 1;
    const id = `gen-${this.seq}`;
    if (body.transactionId !== undefined) this.byTransactionId.set(body.transactionId, id);
    const event: GraphEvent = {
      id,
      subject: body.subject,
      start: body.start,
      end: body.end,
      isAllDay: body.isAllDay,
      attendees: body.attendees,
      location: body.location,
    };
    if (body.isOnlineMeeting === true) {
      event.isOnlineMeeting = true;
      event.onlineMeetingProvider = 'teamsForBusiness';
      if (this.teamsJoinUrlOnCreate) event.onlineMeeting = { joinUrl: `https://teams.microsoft.com/l/meetup-join/${id}` };
    }
    if (body.recurrence !== undefined) {
      event.type = 'seriesMaster';
      event.recurrence = body.recurrence;
    }
    return this.store(event);
  }

  async listInstances(masterId: string, startIso: string, endIso: string): Promise<GraphEvent[]> {
    this.calls.push({ method: 'instances', id: masterId, url: `${startIso}..${endIso}` });
    this.fail('instances');
    if (!this.events.has(masterId)) throw graphError(404, 'ErrorItemNotFound');
    const from = Date.parse(startIso);
    const to = Date.parse(endIso);
    return (this.instances.get(masterId) ?? [])
      .filter((instance) => this.events.has(instance.id))
      .filter((instance) => {
        const start = Date.parse(`${(instance.start?.dateTime ?? '').replace(/\.\d+$/, '')}Z`);
        return start >= from && start < to;
      })
      .map((instance) => JSON.parse(JSON.stringify(instance)) as GraphEvent);
  }

  /** Registers generated instances of a master (they become deletable / patchable events). */
  generateInstances(masterId: string, starts: readonly string[], durationMinutes = 60): string[] {
    const ids: string[] = [];
    const list: GraphEvent[] = [];
    for (const start of starts) {
      this.seq += 1;
      const id = `${masterId}-i${this.seq}`;
      const startMs = Date.parse(start);
      const instance: GraphEvent = {
        id,
        type: 'occurrence',
        seriesMasterId: masterId,
        originalStart: new Date(startMs).toISOString().replace('.000Z', 'Z'),
        subject: this.events.get(masterId)?.subject,
        start: { dateTime: new Date(startMs).toISOString().replace('Z', '0000'), timeZone: 'UTC' },
        end: { dateTime: new Date(startMs + durationMinutes * 60_000).toISOString().replace('Z', '0000'), timeZone: 'UTC' },
        isAllDay: false,
      };
      this.events.set(id, { ...instance, changeKey: `${id}-ck1` });
      list.push(instance);
      ids.push(id);
    }
    this.instances.set(masterId, list);
    return ids;
  }

  /** Completes a pending Teams meeting (the next get returns the link). */
  completeTeamsCreation(eventId: string): void {
    const event = this.events.get(eventId);
    if (!event) return;
    event.onlineMeeting = { joinUrl: `https://teams.microsoft.com/l/meetup-join/${eventId}` };
  }

  async patchEvent(eventId: string, body: GraphEventWrite): Promise<GraphEvent> {
    this.calls.push({ method: 'patch', id: eventId, body });
    this.fail('patch');
    const existing = this.events.get(eventId);
    if (!existing) throw graphError(404, 'ErrorItemNotFound');
    return this.store({ ...existing, ...body });
  }

  async deleteEvent(eventId: string): Promise<void> {
    this.calls.push({ method: 'delete', id: eventId });
    this.fail('delete');
    if (!this.events.has(eventId)) throw graphError(404, 'ErrorItemNotFound');
    this.events.delete(eventId);
  }

  async getMe(): Promise<{ mail?: string | null; userPrincipalName?: string | null }> {
    this.calls.push({ method: 'me' });
    this.fail('me');
    return { mail: 'me@example.com', userPrincipalName: 'me@example.com' };
  }
}

function setup(initialState: Partial<OutlookSyncState> = {}) {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeGraphApi(clock);
  const meetings = new FakeMeetings(clock);
  const state = memoryStateStore<OutlookSyncState>({ ...defaultOutlookSyncState(), ...initialState });
  const sleep = jest.fn(async (_ms: number) => undefined);
  const deps: OutlookSyncDeps = {
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

describe('pullOutlookChanges', () => {
  it('runs a full delta first (following nextLinks), then incremental pulls from the deltaLink', async () => {
    const { api, meetings, state, deps } = setup();
    api.deltaResponses.push(
      { value: [timedEvent('a1')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-1' },
      { value: [timedEvent('b2')], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-1' },
    );

    const first = await pullOutlookChanges(deps);
    expect(first.fullSync).toBe(true);
    expect(first.counts.created).toBe(2);
    expect(api.calls.map((call) => call.method)).toEqual(['startDelta', 'deltaPage']);
    expect(api.calls[1]?.url).toBe('https://graph.microsoft.com/v1.0/next-1');
    expect(state.value.deltaLink).toBe('https://graph.microsoft.com/v1.0/delta-1');
    expect(meetings.all().every((meeting) => meeting.source === 'outlook')).toBe(true);
    expect(meetings.all().every((meeting) => meeting.external.outlookCalendarId === OUTLOOK_DEFAULT_CALENDAR)).toBe(true);

    api.calls = [];
    api.deltaResponses.push({
      value: [timedEvent('a1', { changeKey: 'a1-ck2', subject: 'Renamed', lastModifiedDateTime: '2026-10-01T07:00:00Z' })],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-2',
    });
    const second = await pullOutlookChanges(deps);
    expect(second.fullSync).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: 'deltaPage', url: 'https://graph.microsoft.com/v1.0/delta-1' });
    expect(second.counts.updated).toBe(1);
    expect(meetings.all().find((meeting) => meeting.external.outlookEventId === 'a1')?.title).toBe('Renamed');
    expect(state.value.deltaLink).toBe('https://graph.microsoft.com/v1.0/delta-2');
  });

  it('suppresses echoes: the stored changeKey short-circuits, a queued local edit wins', async () => {
    const { api, meetings, deps } = setup();
    api.deltaResponses.push({ value: [timedEvent('a1')], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-1' });
    await pullOutlookChanges(deps);
    const local = meetings.all()[0]!;

    api.deltaResponses.push({ value: [timedEvent('a1')], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-2' });
    const echo = await pullOutlookChanges(deps);
    expect(echo.counts).toMatchObject({ created: 0, updated: 0, unchanged: 1 });

    await meetings.update(local.id, { title: 'Edited here' }, { origin: 'user' });
    await enqueueOutlookPushes(deps, [local.id], 'upsert');
    api.deltaResponses.push({
      value: [timedEvent('a1', { changeKey: 'a1-ck9', subject: 'Edited in Outlook' })],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-3',
    });
    await pullOutlookChanges(deps);
    expect(meetings.all()[0]?.title).toBe('Edited here');
  });

  it('tombstones @removed and cancelled events', async () => {
    const { api, meetings, deps } = setup();
    api.deltaResponses.push({
      value: [timedEvent('a1'), timedEvent('b2')],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-1',
    });
    await pullOutlookChanges(deps);

    api.deltaResponses.push({
      value: [
        { id: 'a1', '@removed': { reason: 'deleted' } },
        timedEvent('b2', { changeKey: 'b2-ck2', isCancelled: true }),
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-2',
    });
    const result = await pullOutlookChanges(deps);
    expect(result.counts.removed).toBe(2);
    expect(meetings.all().every((meeting) => meeting.deletedAt !== null)).toBe(true);
  });

  it('falls back to a full re-delta on 410 and removes events that disappeared', async () => {
    const { api, meetings, state, deps } = setup();
    api.deltaResponses.push({
      value: [timedEvent('a1'), timedEvent('b2')],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-1',
    });
    await pullOutlookChanges(deps);

    api.calls = [];
    api.deltaResponses.push(graphError(410, 'syncStateNotFound'), {
      value: [timedEvent('a1')],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-fresh',
    });
    const result = await pullOutlookChanges(deps);
    expect(result.fullSync).toBe(true);
    expect(api.calls.map((call) => call.method)).toEqual(['deltaPage', 'startDelta']);
    expect(state.value.deltaLink).toBe('https://graph.microsoft.com/v1.0/delta-fresh');
    const b2 = meetings.all().find((meeting) => meeting.external.outlookEventId === 'b2');
    expect(b2?.deletedAt).not.toBeNull();
    expect(result.counts.removed).toBe(1);
  });

  it('propagates other listing errors without touching the deltaLink', async () => {
    const { api, state, deps } = setup({ deltaLink: 'https://graph.microsoft.com/v1.0/delta-1', lastFullSyncAt: NOW.toISOString() });
    api.deltaResponses.push(new AppError('offline', 'down'));
    await expect(pullOutlookChanges(deps)).rejects.toMatchObject({ code: 'offline' });
    expect(state.value.deltaLink).toBe('https://graph.microsoft.com/v1.0/delta-1');
  });

  it('ignores new events outside the window on incremental pulls', async () => {
    const { api, meetings, deps } = setup({ deltaLink: 'https://graph.microsoft.com/v1.0/delta-1', lastFullSyncAt: NOW.toISOString() });
    api.deltaResponses.push({
      value: [
        timedEvent('far', {
          start: { dateTime: '2030-01-01T09:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2030-01-01T10:00:00.0000000', timeZone: 'UTC' },
        }),
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-2',
    });
    await pullOutlookChanges(deps);
    expect(meetings.all()).toHaveLength(0);
  });
});

describe('pushOutlookMeeting', () => {
  it('creates with the transactionId, stores the refs with origin calendar_outlook and suppresses the re-push', async () => {
    const { api, meetings, deps } = setup();
    const meeting = meetings.add({
      title: 'Kickoff',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'ai_chat',
      participants: [{ email: 'ana@example.com' }],
    });

    const outcome = await pushOutlookMeeting(deps, meeting);
    expect(outcome.sent).toBe(true);
    const create = api.calls.find((call) => call.method === 'create');
    expect(create?.body?.transactionId).toBe(outlookTransactionId(meeting.id));
    expect(outcome.meeting.external.outlookEventId).toBe('gen-1');
    expect(outcome.meeting.external.outlookChangeKey).toBe(api.events.get('gen-1')?.changeKey);
    expect(meetings.writes.at(-1)).toMatchObject({ id: meeting.id, origin: 'calendar_outlook', kind: 'update' });

    // Unchanged visible fields: nothing is sent again.
    api.calls = [];
    const second = await pushOutlookMeeting(deps, outcome.meeting);
    expect(second.sent).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it('patches a changed linked meeting and re-creates when the event is gone (404)', async () => {
    const { api, meetings, deps } = setup();
    const meeting = meetings.add({ title: 'Kickoff', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushOutlookMeeting(deps, meeting)).meeting;

    const renamed = await meetings.update(pushed.id, { title: 'Kickoff v2' }, { origin: 'user' });
    api.calls = [];
    await pushOutlookMeeting(deps, renamed);
    expect(api.calls[0]?.method).toBe('patch');

    api.events.clear();
    const moved = await meetings.update(pushed.id, { title: 'Kickoff v3' }, { origin: 'user' });
    api.calls = [];
    const recreated = await pushOutlookMeeting(deps, moved);
    expect(api.calls.map((call) => call.method)).toEqual(['patch', 'create']);
    expect(recreated.meeting.external.outlookEventId).toMatch(/^gen-/);
    expect(recreated.meeting.external.outlookEventId).not.toBe(pushed.external.outlookEventId);
  });

  it('never pushes meetings imported from Google or the device; recurring masters are pushable', async () => {
    const { api, meetings, deps } = setup();
    const fromGoogle = meetings.add({ title: 'From Google', startAt: '2026-10-03T09:00:00.000Z', source: 'google' });
    const fromDevice = meetings.add({ title: 'From phone', startAt: '2026-10-03T10:00:00.000Z', source: 'device' });
    const recurring = meetings.add({
      title: 'Weekly',
      startAt: '2026-10-03T11:00:00.000Z',
      source: 'manual',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    });
    expect(isOutlookPushable(fromGoogle)).toBe(false);
    expect(isOutlookPushable(fromDevice)).toBe(false);
    expect(isOutlookPushable(recurring)).toBe(true);

    for (const meeting of [fromGoogle, fromDevice]) {
      const outcome = await pushOutlookMeeting(deps, meeting);
      expect(outcome.sent).toBe(false);
    }
    expect(api.calls).toHaveLength(0);
  });

  it('creates a recurring master as a Graph series, remembers the shape and suppresses the re-push', async () => {
    const { api, meetings, deps, state } = setup();
    const weekly = meetings.add({
      title: 'Weekly',
      startAt: '2026-10-03T11:00:00.000Z', // a Saturday
      source: 'manual',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: 4 },
    });
    const outcome = await pushOutlookMeeting(deps, weekly);
    expect(outcome.sent).toBe(true);
    const create = api.calls.find((call) => call.method === 'create');
    expect(create?.body?.recurrence).toEqual({
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'monday' },
      range: { type: 'numbered', startDate: '2026-10-05', numberOfOccurrences: 4, recurrenceTimeZone: 'UTC' },
    });
    // The anchor moved to the first Monday, same wall-clock time.
    expect(create?.body?.start).toEqual({ dateTime: '2026-10-05T11:00:00', timeZone: 'UTC' });
    const eventId = outcome.meeting.external.outlookEventId as string;
    expect(api.events.get(eventId)?.type).toBe('seriesMaster');
    expect(state.value.kinds[eventId]).toBe('series');
    // No overrides: no instance listing was needed.
    expect(api.calls.some((call) => call.method === 'instances')).toBe(false);

    api.calls = [];
    const again = await pushOutlookMeeting(deps, outcome.meeting);
    expect(again.sent).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it('applies cancelled and modified occurrences to the generated instances after a series push', async () => {
    const { api, meetings, deps } = setup();
    const weekly = meetings.add({
      title: 'Weekly',
      startAt: '2026-10-05T11:00:00.000Z', // Monday
      source: 'manual',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    });
    const pushed = (await pushOutlookMeeting(deps, weekly)).meeting;
    const masterId = pushed.external.outlookEventId as string;
    const [first, second, third] = api.generateInstances(masterId, ['2026-10-05T11:00:00.000Z', '2026-10-12T11:00:00.000Z', '2026-10-19T11:00:00.000Z']);

    const edited = await meetings.update(
      pushed.id,
      {
        recurrenceOverrides: {
          '2026-10-12': { status: 'cancelled', startAt: null, durationMinutes: null, title: null },
          '2026-10-19': { status: 'modified', startAt: '2026-10-19T13:00:00.000Z', durationMinutes: 30, title: 'Weekly (short)' },
        },
      },
      { origin: 'user' },
    );
    api.calls = [];
    const outcome = await pushOutlookMeeting(deps, edited);
    expect(outcome.sent).toBe(true);
    // The master is patched (rule unchanged, overrides changed the hash), then the instances.
    expect(api.calls.map((call) => call.method)).toEqual(['patch', 'instances', 'delete', 'patch']);
    expect(api.calls[2]).toMatchObject({ method: 'delete', id: second });
    expect(api.calls[3]).toMatchObject({
      method: 'patch',
      id: third,
      body: { subject: 'Weekly (short)', start: { dateTime: '2026-10-19T13:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-19T13:30:00', timeZone: 'UTC' } },
    });
    expect(api.events.has(first)).toBe(true);
    expect(api.events.has(second)).toBe(false);

    // Idempotent: the same overrides again find the deleted instance gone and re-patch the other.
    api.instances.set(masterId, (api.instances.get(masterId) ?? []).filter((instance) => instance.id !== second));
    api.calls = [];
    const result = await applyOccurrenceOverrides(deps, outcome.meeting, masterId);
    expect(result).toEqual({ deleted: 0, patched: 1 });
  });

  it('a one-off already in Outlook that becomes recurring is deleted and re-created as a series (and back)', async () => {
    const { api, meetings, deps, state } = setup();
    const meeting = meetings.add({ title: 'Planning', startAt: '2026-10-05T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushOutlookMeeting(deps, meeting)).meeting;
    const singleId = pushed.external.outlookEventId as string;
    expect(state.value.kinds[singleId]).toBe('single');

    const recurring = await meetings.update(
      pushed.id,
      { recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null } },
      { origin: 'user' },
    );
    api.calls = [];
    const outcome = await pushOutlookMeeting(deps, recurring);
    expect(outcome.sent).toBe(true);
    expect(api.calls.map((call) => call.method)).toEqual(['delete', 'create']);
    expect(api.events.has(singleId)).toBe(false);
    const seriesId = outcome.meeting.external.outlookEventId as string;
    expect(seriesId).not.toBe(singleId);
    expect(api.events.get(seriesId)?.type).toBe('seriesMaster');
    expect(state.value.kinds).toEqual({ [seriesId]: 'series' });
    // A fresh, deterministic transactionId: never the original one (that would replay the deleted event).
    const create = api.calls.find((call) => call.method === 'create');
    expect(create?.body?.transactionId).toMatch(new RegExp(`^${outlookTransactionId(pushed.id)}-k`));

    // Removing the repeat again: the series is deleted and a single event re-created.
    const single = await meetings.update(outcome.meeting.id, { recurrence: null }, { origin: 'user' });
    api.calls = [];
    const back = await pushOutlookMeeting(deps, single);
    expect(api.calls.map((call) => call.method)).toEqual(['delete', 'create']);
    expect(api.events.has(seriesId)).toBe(false);
    expect(state.value.kinds[back.meeting.external.outlookEventId as string]).toBe('single');
  });

  it('a link made before shapes were tracked counts as a single event', async () => {
    const { api, meetings, deps } = setup();
    const meeting = meetings.add({ title: 'Legacy', startAt: '2026-10-05T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushOutlookMeeting(deps, meeting)).meeting;
    await deps.state.update((current) => ({ ...current, kinds: {} }));
    api.calls = [];
    const edited = await meetings.update(pushed.id, { title: 'Legacy renamed' }, { origin: 'user' });
    await pushOutlookMeeting(deps, edited);
    expect(api.calls.map((call) => call.method)).toEqual(['patch']);
  });

  it('deletes the event of a deleted meeting (missing events count as deleted)', async () => {
    const { api, meetings, deps, clock } = setup();
    const meeting = meetings.add({ title: 'Old', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushOutlookMeeting(deps, meeting)).meeting;
    await meetings.remove(pushed.id, { origin: 'user' });
    const tombstone = (await meetings.list({ includeDeleted: true }))[0]!;

    const outcome = await pushOutlookMeeting(deps, tombstone);
    expect(outcome.sent).toBe(true);
    expect(api.events.size).toBe(0);

    // Second delete (already gone at Graph): 404 is tolerated.
    clock.advanceMinutes(1);
    await expect(deleteOutlookEvent(deps, tombstone)).resolves.toBe(true);
  });

  it('removes cancelled own meetings from Outlook and clears the refs', async () => {
    const { api, meetings, deps } = setup();
    const meeting = meetings.add({ title: 'Maybe', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushOutlookMeeting(deps, meeting)).meeting;
    const cancelled = await meetings.update(pushed.id, { status: 'cancelled' }, { origin: 'user' });

    const outcome = await pushOutlookMeeting(deps, cancelled);
    expect(outcome.sent).toBe(true);
    expect(api.events.size).toBe(0);
    expect(outcome.meeting.external.outlookEventId).toBeNull();
  });

  it('creates Teams meetings and stores the join URL (polling until Graph fills it)', async () => {
    const { api, meetings, deps, sleep } = setup();
    api.teamsJoinUrlOnCreate = false;
    const meeting = meetings.add({
      title: 'Remote sync',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'manual',
      conference: { provider: 'teams', url: null, password: null },
    });

    // The fake fills the link after the first poll sleep.
    sleep.mockImplementationOnce(async () => {
      api.completeTeamsCreation('gen-1');
    });
    const outcome = await pushOutlookMeeting(deps, meeting);
    const create = api.calls.find((call) => call.method === 'create');
    expect(create?.body?.isOnlineMeeting).toBe(true);
    expect(create?.body?.onlineMeetingProvider).toBe('teamsForBusiness');
    expect(outcome.meeting.conference).toEqual({
      provider: 'teams',
      url: 'https://teams.microsoft.com/l/meetup-join/gen-1',
      password: null,
    });
  });
});

describe('flushOutlookPushes', () => {
  it('pushes queued changes oldest-first and clears the queue', async () => {
    const { meetings, state, deps } = setup();
    const m1 = meetings.add({ title: 'One', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const m2 = meetings.add({ title: 'Two', startAt: '2026-10-04T09:00:00.000Z', source: 'manual' });
    await enqueueOutlookPushes(deps, [m1.id, m2.id], 'upsert');

    const result = await flushOutlookPushes(deps);
    expect(result).toMatchObject({ pushed: 2, failed: 0, pending: 0, blockedBy: null });
    expect(Object.keys(state.value.pending)).toHaveLength(0);
  });

  it('a blocking error stops the flush and keeps everything queued', async () => {
    const { api, meetings, state, deps } = setup();
    const m1 = meetings.add({ title: 'One', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    await enqueueOutlookPushes(deps, [m1.id], 'upsert');
    api.failures.create = [new AppError('offline', 'down')];

    const result = await flushOutlookPushes(deps);
    expect(result.blockedBy).toBe('offline');
    expect(result.pending).toBe(1);
    expect(state.value.pending[m1.id]?.lastError).toBe('offline');
  });

  it('drops permanently rejected changes and counts them as failed', async () => {
    const { api, meetings, deps } = setup();
    const m1 = meetings.add({ title: 'One', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    await enqueueOutlookPushes(deps, [m1.id], 'upsert');
    api.failures.create = [new AppError('invalid_input', 'bad', { details: { status: 400 } })];

    const result = await flushOutlookPushes(deps);
    expect(result).toMatchObject({ pushed: 0, failed: 1, pending: 0 });
  });
});

describe('enqueueUpcomingOwnMeetings', () => {
  it('queues only own, upcoming, unlinked meetings (recurring masters included)', async () => {
    const { meetings, state, deps } = setup();
    meetings.add({ title: 'Own', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    meetings.add({ title: 'Imported', startAt: '2026-10-03T09:00:00.000Z', source: 'google' });
    meetings.add({
      title: 'Weekly',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'manual',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    });
    meetings.add({ title: 'Long past', startAt: '2020-01-01T09:00:00.000Z', source: 'manual' });

    const queued = await enqueueUpcomingOwnMeetings(deps);
    expect(queued).toBe(2);
    expect(Object.keys(state.value.pending)).toHaveLength(2);
  });
});

describe('pull and our own series', () => {
  it('skips the instances of a series we pushed and never sweeps the master on a full sync', async () => {
    const { api, meetings, deps } = setup();
    const weekly = meetings.add({
      title: 'Weekly',
      startAt: '2026-10-05T11:00:00.000Z',
      source: 'manual',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    });
    const pushed = (await pushOutlookMeeting(deps, weekly)).meeting;
    const masterId = pushed.external.outlookEventId as string;
    api.generateInstances(masterId, ['2026-10-05T11:00:00.000Z', '2026-10-12T11:00:00.000Z']);
    // calendarView lists the instances (never the master) plus an ordinary event.
    api.events.set('other', timedEvent('other'));
    const instances = api.instances.get(masterId) ?? [];
    api.deltaResponses.push({ value: [...instances, timedEvent('other')], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/d1' });

    const result = await pullOutlookChanges(deps, { full: true });
    expect(result.counts.created).toBe(1);
    expect(result.counts.removed).toBe(0);
    const titles = (await meetings.list({ includeDeleted: true }))
      .map((meeting) => [meeting.title, meeting.deletedAt === null] as const)
      .sort((x, y) => x[0].localeCompare(y[0]));
    expect(titles).toEqual([['Event other', true], ['Weekly', true]]);
  });
});

describe('removeOutlookLinks', () => {
  it('tombstones imported meetings and clears refs of pushed ones', async () => {
    const { meetings, deps } = setup();
    const pushedSource = meetings.add({ title: 'Mine', startAt: '2026-10-03T09:00:00.000Z', source: 'manual' });
    const pushed = (await pushOutlookMeeting(deps, pushedSource)).meeting;
    meetings.add({
      title: 'Imported',
      startAt: '2026-10-04T09:00:00.000Z',
      source: 'outlook',
      external: { outlookEventId: 'ev-imported', outlookCalendarId: OUTLOOK_DEFAULT_CALENDAR },
    });

    const { removed, unlinked } = await removeOutlookLinks(deps);
    expect(removed).toBe(1);
    expect(unlinked).toBe(1);
    const all = await meetings.list({ includeDeleted: true });
    expect(all.find((meeting) => meeting.source === 'outlook')?.deletedAt).not.toBeNull();
    expect(all.find((meeting) => meeting.id === pushed.id)?.external.outlookEventId).toBeNull();
  });
});

describe('graphHttpStatus helper', () => {
  it('reads the status detail written by the api layer', () => {
    expect(graphHttpStatus(graphError(410))).toBe(410);
    expect(graphHttpStatus(new Error('x'))).toBeNull();
  });
});
