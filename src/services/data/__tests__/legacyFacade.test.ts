import AsyncStorage from '@react-native-async-storage/async-storage';

import { Meeting, UserPreferences, User, ApiKey } from '../../../api/entities';
import { localStorageAPI } from '../../../api/localStorage';
import { setDeviceTimeZoneProvider } from '../../../core/time';
import type { KeyValueStorage } from '../cache';
import type { DataEngine } from '../engine';
import type { FakeRemote } from '../testing/fakeRemote';
import { settle } from '../testing/fakeRemote';

// The facade talks to the app-wide engine; replace it with one wired to in-memory fakes.
jest.mock('../instance', () => {
  const { DataEngine: Engine } = jest.requireActual<typeof import('../engine')>('../engine');
  const { FakeRemote: Remote } = jest.requireActual<typeof import('../testing/fakeRemote')>('../testing/fakeRemote');
  const storageModule = jest.requireMock<{ default?: unknown }>('@react-native-async-storage/async-storage');
  const remote = new Remote();
  const dataEngine = new Engine({
    remote,
    storage: (storageModule.default ?? storageModule) as KeyValueStorage,
    getLanguage: () => 'en',
    getTimeZone: () => 'America/Los_Angeles',
    timeouts: { flushDelayMs: 0, preferencesFallbackMs: 60_000, retryBaseMs: 60_000 },
  });
  return { dataEngine, mockRemote: remote };
});

const { dataEngine, mockRemote } = jest.requireMock<{ dataEngine: DataEngine; mockRemote: FakeRemote }>('../instance');

const UID = 'user1';

beforeAll(() => {
  setDeviceTimeZoneProvider(() => 'America/Los_Angeles');
});

afterAll(() => {
  setDeviceTimeZoneProvider(null);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await dataEngine.endSession({ wipeLocal: true });
  await settle();
  jest.restoreAllMocks();
});

describe('entities.js compat facade', () => {
  it('surfaces errors instead of silently returning empty data when nobody is signed in', async () => {
    await expect(Meeting.list()).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(UserPreferences.filter({ created_by: 'a@b.co' })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(ApiKey.list()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('creates meetings from the ModernCreateMeeting payload (undefined fields, legacy labels) and returns legacy views', async () => {
    await dataEngine.startSession(UID);
    const created = await Meeting.create({
      title: 'Design review',
      description: 'Q4',
      date: '2026-10-05',
      time: '23:30',
      duration: 45,
      location: { type: 'physical', address: 'No location specified', virtualPlatform: undefined, virtualLink: undefined },
      participants: [{ name: 'Ana', email: 'ana@example.com' }],
      preparation_tips: ['Bring mockups'],
      attachments: [{ id: 'f1', uri: 'file:///x' }],
      source: 'Manual',
      confidence: 100,
      created_by: 'someone@example.com',
      attendees: [{ email: 'ana@example.com', displayName: 'Ana' }],
    });
    expect(created).toMatchObject({
      title: 'Design review',
      date: '2026-10-05',
      time: '23:30',
      duration: 45,
      source: 'Manual',
      sourceKey: 'manual',
      location: null,
      preparation_tips: ['Bring mockups'],
      startTime: '2026-10-06T06:30:00.000Z',
    });
    const stored = await dataEngine.getMeeting(created.id);
    expect(stored).toMatchObject({ timezone: 'America/Los_Angeles', date: '2026-10-05' });
    expect(stored).not.toHaveProperty('attachments');

    const moved = await Meeting.update(created.id, { time: '09:15' });
    expect(moved).toMatchObject({ date: '2026-10-05', time: '09:15' });
    expect(await Meeting.filter({ date: '2026-10-05' })).toHaveLength(1);
    expect(await Meeting.delete(created.id)).toEqual({ success: true });
    expect(await Meeting.list()).toEqual([]);
    await expect(Meeting.update('missing', { title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('UserPreferences.filter always returns exactly one element and updates never reset other fields (#19)', async () => {
    await dataEngine.startSession(UID);
    const [initial, ...rest] = await UserPreferences.filter({ created_by: 'a@b.co' });
    expect(rest).toEqual([]);
    expect(initial).toMatchObject({ id: 'preferences', alert_enabled: true, alert_intensity: 'maximum' });

    await UserPreferences.update('preferences', { alert_intensity: 'light' });
    await UserPreferences.update('preferences', { alert_enabled: false, theme: 'dark', created_by: 'x' });
    const [after] = await UserPreferences.filter({});
    expect(after).toMatchObject({ alert_enabled: false, alert_intensity: 'light' });
    await expect(UserPreferences.delete('preferences')).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('UserPreferences.update never takes flow-owned fields from a (stale) legacy view', async () => {
    await dataEngine.startSession(UID);
    await dataEngine.updatePreferences({ googleCalendarSyncEnabled: true, onboardingCompleted: true });
    const [view] = await UserPreferences.filter({});
    // A legacy screen saving an old copy of its view.
    await UserPreferences.update('preferences', { ...view, google_calendar_sync_enabled: false, onboarding_completed: false, alert_volume: 0.5 });
    const [after] = await UserPreferences.filter({});
    expect(after).toMatchObject({ google_calendar_sync_enabled: true, onboarding_completed: true, alert_volume: 0.5 });
  });

  it('User.me returns the profile with the server-owned plan; sign-in APIs are unsupported', async () => {
    mockRemote.docs.set('entitlements/user1', { plan: 'premium', status: 'active', expiresAt: null, source: 'manual', updatedAt: null });
    await dataEngine.startSession(UID, {
      user: { uid: UID, email: 'ana@example.com', displayName: 'Ana', photoURL: null, emailVerified: true, providerIds: ['google.com'] },
    });
    await settle();
    expect(await User.me()).toMatchObject({ id: UID, email: 'ana@example.com', name: 'Ana', plan: 'premium' });
    await expect(User.signIn()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('localStorageAPI.clearAllMeetings deletes MeetingGuard meetings for real and keeps calendar imports', async () => {
    await dataEngine.startSession(UID);
    await Meeting.create({ title: 'Mine', date: '2026-10-05', time: '10:00' });
    await dataEngine.upsertExternal([
      {
        provider: 'google',
        externalId: 'evt1',
        calendarId: 'primary',
        etag: null,
        providerUpdatedAt: null,
        deleted: false,
        meeting: { title: 'From Google', startAt: '2026-10-06T17:00:00.000Z' },
      },
    ]);
    expect(await localStorageAPI.clearAllMeetings()).toBe(true);
    expect((await Meeting.list()).map((view: { title: string }) => view.title)).toEqual(['From Google']);
    await expect(localStorageAPI.getData()).rejects.toMatchObject({ code: 'unsupported' });
  });
});
