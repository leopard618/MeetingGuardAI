/**
 * OutlookCalendarService orchestration: connect (PKCE prompt -> exchange -> store -> first sync),
 * disconnect cleanup and the not-configured / not-connected guards.
 */
import { createEventBus, type AppEventMap } from '../../../core/events';
import type { MicrosoftAuthPort, PromptResult } from '../outlook/authAdapter';
import type { OutlookGraphApi } from '../outlook/api';
import { createOutlookCalendarService, MS_REDIRECT_URI } from '../outlook/service';
import { defaultOutlookSyncState, type OutlookSyncState } from '../outlook/state';
import type { MicrosoftTokenManager, TokenGrant } from '../outlook/tokenManager';
import type { GraphDeltaPage } from '../outlook/types';
import { createCalendarStatusStore } from '../status';
import { FakeClock, FakeMeetings, memoryStateStore } from '../__testUtils__/fakes';

const UID = 'user-1';
const NOW = new Date('2026-10-01T08:00:00.000Z');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setup(options: { clientId?: string | null; hasToken?: boolean; prompt?: PromptResult } = {}) {
  const clock = new FakeClock(new Date(NOW));
  const meetings = new FakeMeetings(clock);
  const state = memoryStateStore<OutlookSyncState>(defaultOutlookSyncState());
  const status = createCalendarStatusStore();
  const events = createEventBus<AppEventMap>();
  let hasToken = options.hasToken === true;

  const grant: TokenGrant = { accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3600 };
  const tokens = {
    hasRefreshToken: jest.fn(async () => hasToken),
    getAccessToken: jest.fn(async () => 'at-1'),
    invalidateAccessToken: jest.fn(async () => undefined),
    adoptGrant: jest.fn(async () => {
      hasToken = true;
    }),
    exchangeCode: jest.fn(async () => grant),
    clear: jest.fn(async () => {
      hasToken = false;
    }),
    dropMemory: jest.fn(),
  } satisfies MicrosoftTokenManager;

  const session = { uid: UID as string | null };
  const auth = {
    promptForCode: jest.fn(async () => options.prompt ?? ({ type: 'success', code: 'code-1', codeVerifier: 'ver-1' } as PromptResult)),
    openConsentPage: jest.fn(async () => undefined),
  } satisfies MicrosoftAuthPort;

  const emptyDelta: GraphDeltaPage = { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-1' };
  const api = {
    startDelta: jest.fn(async () => emptyDelta),
    getDeltaPage: jest.fn(async () => emptyDelta),
    getEvent: jest.fn(),
    createEvent: jest.fn(),
    patchEvent: jest.fn(),
    deleteEvent: jest.fn(async () => undefined),
    getMe: jest.fn(async () => ({ mail: 'me@outlook.com', userPrincipalName: 'me@outlook.com' })),
  } as unknown as jest.Mocked<OutlookGraphApi>;

  const service = createOutlookCalendarService({
    api,
    meetings,
    state,
    tokens,
    auth,
    status,
    events,
    getUid: () => session.uid,
    now: clock.now,
    sleep: async () => undefined,
    defaultTimeZone: () => 'UTC',
    untitledTitle: () => '(No title)',
    config: { clientId: options.clientId === undefined ? '11111111-2222-3333-4444-555555555555' : options.clientId, tenant: 'common' },
  });
  return { service, tokens, auth, api, state, status, meetings, events, session };
}

describe('outlook service', () => {
  it('is unconfigured without a client id and every method reports calendar_not_connected', async () => {
    const { service, status } = setup({ clientId: null });
    expect(service.isConfigured()).toBe(false);
    await expect(service.isConnected()).resolves.toBe(false);
    await expect(service.pullChanges()).rejects.toMatchObject({ code: 'calendar_not_connected' });
    await expect(service.connect()).rejects.toMatchObject({ code: 'not_configured' });
    expect(status.get().outlook).toBeUndefined();
  });

  it('connects: prompt -> exchange -> adopt -> account -> initial full sync', async () => {
    const { service, tokens, auth, api, state, status, events } = setup();
    const synced: string[] = [];
    events.on('calendar:synced', (event) => {
      synced.push(event.provider);
    });

    const result = await service.connect();
    expect(result.status).toBe('connected');
    expect(result.initialSync?.fullSync).toBe(true);

    expect(auth.promptForCode).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: MS_REDIRECT_URI, tenant: 'common', clientId: '11111111-2222-3333-4444-555555555555' }),
    );
    expect(tokens.exchangeCode).toHaveBeenCalledWith('code-1', 'ver-1', MS_REDIRECT_URI);
    expect(tokens.adoptGrant).toHaveBeenCalled();
    expect(api.getMe).toHaveBeenCalled();
    expect(state.value.accountEmail).toBe('me@outlook.com');
    expect(status.get().outlook).toMatchObject({ configured: true, connected: true, accountEmail: 'me@outlook.com' });
    expect(synced).toEqual(['outlook']);
  });

  it('returns cancelled without touching tokens when the user closes the sheet', async () => {
    const { service, tokens } = setup({ prompt: { type: 'cancelled' } });
    await expect(service.connect()).resolves.toEqual({ status: 'cancelled', initialSync: null });
    expect(tokens.exchangeCode).not.toHaveBeenCalled();
  });

  it('discards the grant when the app account changes during the browser round-trip (uid pinned)', async () => {
    const { service, tokens, auth, session } = setup();
    // Sign out + sign in as another profile while the Microsoft sheet is open: user A's grant
    // must never be stored under user B's key (A's calendar would sync into B's meetings).
    auth.promptForCode.mockImplementationOnce(async () => {
      session.uid = 'user-2';
      return { type: 'success', code: 'code-1', codeVerifier: 'ver-1' };
    });
    await expect(service.connect()).resolves.toEqual({ status: 'cancelled', initialSync: null });
    expect(tokens.exchangeCode).not.toHaveBeenCalled();
    expect(tokens.adoptGrant).not.toHaveBeenCalled();
  });

  it('refuses to connect while signed out', async () => {
    const { service, session, auth } = setup();
    session.uid = null;
    await expect(service.connect()).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(auth.promptForCode).not.toHaveBeenCalled();
  });

  it('returns failed when the sign-in or the exchange fails (never fake success)', async () => {
    const failedPrompt = setup({ prompt: { type: 'failed', message: 'boom' } });
    await expect(failedPrompt.service.connect()).resolves.toEqual({ status: 'failed', initialSync: null });

    const { service, tokens } = setup();
    tokens.exchangeCode.mockRejectedValueOnce(new Error('exchange down'));
    await expect(service.connect()).resolves.toEqual({ status: 'failed', initialSync: null });
    expect(tokens.clear).toHaveBeenCalled();
  });

  it('stays "connected" when only the first sync fails (retried later, error surfaced)', async () => {
    const { service, api, status } = setup();
    (api.startDelta as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'Error' }));
    const result = await service.connect();
    expect(result.status).toBe('connected');
    expect(result.initialSync).toBeNull();
    expect(status.get().outlook?.connected).toBe(true);
    expect(status.get().outlook?.lastError).not.toBeNull();
  });

  it('disconnect clears tokens + state, tombstones imports and can open the consent page', async () => {
    const { service, tokens, auth, meetings, status, state } = setup({ hasToken: true });
    meetings.add({
      title: 'Imported',
      startAt: '2026-10-03T09:00:00.000Z',
      source: 'outlook',
      external: { outlookEventId: 'ev1', outlookCalendarId: 'default' },
    });
    state.value = { ...state.value, deltaLink: 'https://graph.microsoft.com/v1.0/delta-1', accountEmail: 'me@outlook.com' };

    await service.disconnect({ revoke: true });
    expect(tokens.clear).toHaveBeenCalled();
    expect(auth.openConsentPage).toHaveBeenCalled();
    expect(state.value.deltaLink).toBeNull();
    expect((await meetings.list({ includeDeleted: true }))[0]?.deletedAt).not.toBeNull();
    expect(status.get().outlook).toMatchObject({ connected: false, enabled: false, accountEmail: null });
    await expect(service.isConnected()).resolves.toBe(false);
  });

  it('sync() refuses while not connected', async () => {
    const { service } = setup({ hasToken: false });
    await expect(service.sync()).rejects.toMatchObject({ code: 'calendar_not_connected' });
  });
});
