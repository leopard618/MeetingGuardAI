import { pushGoogleMeeting, type GoogleSyncDeps } from '../google/sync';
import {
  bothCalendarsConnected,
  createInvitationRouter,
  defaultInvitationsState,
  homeForNewEvent,
  type InvitationsState,
} from '../invitationRouting';
import { defaultOutlookSyncState, type OutlookSyncState } from '../outlook/state';
import { pushOutlookMeeting, type OutlookSyncDeps } from '../outlook/sync';
import type { GraphEvent, GraphEventWrite } from '../outlook/types';
import { defaultGoogleSyncState, type GoogleSyncState } from '../stateStore';
import { initialOutlookStatus, type CalendarStatusStore } from '../status';
import { FakeClock, FakeGoogleApi, FakeMeetings, memoryStateStore } from '../__testUtils__/fakes';

const NOW = new Date('2026-10-01T08:00:00.000Z');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type Status = ReturnType<CalendarStatusStore['get']>;

function status(google: boolean, outlook: boolean): Status {
  return {
    google: { enabled: google, syncing: false, lastSyncAt: null, lastError: null, connected: google, hasScope: google },
    device: { enabled: false, syncing: false, lastSyncAt: null, lastError: null },
    outlook: { ...initialOutlookStatus(), configured: true, connected: outlook },
  } as Status;
}

function router(initial: Partial<InvitationsState> = {}, both = true) {
  const state = memoryStateStore<InvitationsState>({ ...defaultInvitationsState(), ...initial });
  return { state, router: createInvitationRouter({ state, status: { get: () => status(both, both) } }) };
}

const NO_REFS = { googleEventId: null, outlookEventId: null };

describe('invitation routing (Google + Outlook)', () => {
  it('both connected needs Google sync on and Outlook connected', () => {
    expect(bothCalendarsConnected(status(true, true))).toBe(true);
    expect(bothCalendarsConnected(status(true, false))).toBe(false);
    expect(bothCalendarsConnected(status(false, true))).toBe(false);
  });

  it('a new meeting goes to the chosen calendar (Google until chosen); an event made earlier keeps the guests there', () => {
    const state = defaultInvitationsState();
    const meeting = { id: 'm1', external: NO_REFS } as never;
    expect(homeForNewEvent(state, 'outlook', meeting)).toBe('google');
    expect(homeForNewEvent({ ...state, invitationsFrom: 'outlook' }, 'google', meeting)).toBe('outlook');
    const withGoogleEvent = { id: 'm1', external: { googleEventId: 'g', outlookEventId: null } } as never;
    expect(homeForNewEvent({ ...state, invitationsFrom: 'outlook' }, 'outlook', withGoogleEvent)).toBe('google');
    expect(homeForNewEvent({ ...state, home: { m1: 'outlook' } }, 'google', meeting)).toBe('outlook');
  });

  it('fixes the home on the first event and never moves it when the choice changes', async () => {
    const { router: r, state } = router({ invitationsFrom: 'outlook' });
    const meeting = { id: 'm1', external: NO_REFS };
    expect(await r.withoutGuests('google', meeting, true)).toBe(true);
    expect(state.value.home).toEqual({ m1: 'outlook' });
    expect(await r.withoutGuests('outlook', meeting, true)).toBe(false);
    await r.setInvitationsFrom('google');
    expect(await r.withoutGuests('google', meeting, false)).toBe(true);
    expect(r.withoutGuestsSync(state.value, 'outlook', 'm1')).toBe(false);
    // A meeting from before the rule (no home) keeps its guests everywhere.
    expect(await r.withoutGuests('google', { id: 'old', external: NO_REFS }, false)).toBe(false);
  });

  it('with only one calendar connected every event carries the guests and nothing is stored', async () => {
    const { router: r, state } = router({ invitationsFrom: 'outlook' }, false);
    expect(await r.withoutGuests('google', { id: 'm1', external: NO_REFS }, true)).toBe(false);
    expect(state.value.home).toEqual({});
  });
});

function googleDeps(withRouter: boolean, choice: 'google' | 'outlook' = 'outlook') {
  const clock = new FakeClock(new Date(NOW));
  const api = new FakeGoogleApi(clock);
  const meetings = new FakeMeetings(clock);
  const deps: GoogleSyncDeps = {
    api,
    meetings,
    state: memoryStateStore<GoogleSyncState>(defaultGoogleSyncState()),
    now: clock.now,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
    sleep: async () => undefined,
    ...(withRouter ? { invitations: router({ invitationsFrom: choice }).router } : {}),
  };
  return { api, meetings, deps };
}

type InsertCall = { method: string; body: { attendees?: unknown[] }; params: { sendUpdates: string } };

describe('pushes when the guests live in the other calendar', () => {
  it('Google: no attendees and no email; an unchanged meeting is not sent again', async () => {
    const { api, meetings, deps } = googleDeps(true);
    const meeting = meetings.add({ title: 'Prueba', startAt: '2026-10-03T09:00:00.000Z', source: 'manual', participants: [{ email: 'guest@example.com' }] });
    const pushed = await pushGoogleMeeting(deps, meeting);
    const insert = api.calls.find((call) => call.method === 'insert') as unknown as InsertCall;
    expect(insert.body.attendees).toEqual([]);
    expect(insert.params.sendUpdates).toBe('none');
    expect(pushed.meeting.participants).toHaveLength(1);
    api.calls = [];
    expect((await pushGoogleMeeting(deps, pushed.meeting)).sent).toBe(false);
  });

  it('Google carries the guests when it is the chosen calendar', async () => {
    const { api, meetings, deps } = googleDeps(true, 'google');
    const meeting = meetings.add({ title: 'Prueba', startAt: '2026-10-03T09:00:00.000Z', source: 'manual', participants: [{ email: 'guest@example.com' }] });
    await pushGoogleMeeting(deps, meeting);
    const insert = api.calls.find((call) => call.method === 'insert') as unknown as InsertCall;
    expect(insert.body.attendees).toHaveLength(1);
    expect(insert.params.sendUpdates).toBe('all');
  });

  it('Google: a one-off meeting that already ended never emails its guests', async () => {
    const { api, meetings, deps } = googleDeps(false);
    const meeting = meetings.add({
      title: 'Done',
      startAt: '2026-10-01T06:00:00.000Z',
      durationMinutes: 30,
      source: 'manual',
      participants: [{ email: 'guest@example.com' }],
    });
    await pushGoogleMeeting(deps, meeting);
    expect((api.calls.find((call) => call.method === 'insert') as unknown as InsertCall).params.sendUpdates).toBe('none');
  });

  it('Outlook: created without attendees when Google carries the guests', async () => {
    const clock = new FakeClock(new Date(NOW));
    const meetings = new FakeMeetings(clock);
    const created: GraphEventWrite[] = [];
    const api = {
      createEvent: async (body: GraphEventWrite): Promise<GraphEvent> => {
        created.push(body);
        return { id: 'AAMk1', changeKey: 'ck1', lastModifiedDateTime: NOW.toISOString(), subject: body.subject } as GraphEvent;
      },
    };
    const deps = {
      api,
      meetings,
      state: memoryStateStore<OutlookSyncState>(defaultOutlookSyncState()),
      now: clock.now,
      defaultTimeZone: () => 'UTC',
      untitledTitle: () => '(No title)',
      sleep: async () => undefined,
      invitations: router({ invitationsFrom: 'google' }).router,
    } as unknown as OutlookSyncDeps;
    const meeting = meetings.add({ title: 'Prueba', startAt: '2026-10-03T09:00:00.000Z', source: 'manual', participants: [{ email: 'guest@example.com' }] });
    await pushOutlookMeeting(deps, meeting);
    expect(created).toHaveLength(1);
    expect(created[0]!.attendees).toEqual([]);
  });
});
