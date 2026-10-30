import type { CalendarPullResult } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { createEventBus, type AppEventMap, type MeetingsChangedEvent } from '../../../core/events';
import { createPushHold } from '../../../core/pushHold';
import { createDefaultPreferences, type Preferences } from '../../../core/types';
import type { DeviceCalendarServiceInternal } from '../device/service';
import { createCalendarSyncEngine, isPushableChange, PUSH_DEBOUNCE_MS } from '../engine';
import type { GoogleCalendarServiceInternal } from '../google/service';
import { defaultDeviceSyncState, defaultGoogleSyncState } from '../stateStore';
import { createCalendarStatusStore } from '../status';

const UID = 'user-1';

function pullResult(provider: 'google' | 'device'): CalendarPullResult {
  return {
    provider,
    fullSync: false,
    counts: { created: 1, updated: 0, removed: 0, unchanged: 0, pushed: 0, failed: 0 },
    syncedAt: '2026-10-01T08:00:00.000Z',
  };
}

function setup(prefs: Partial<Preferences> = {}, extra: { pushHold?: ReturnType<typeof createPushHold> } = {}) {
  const preferences: Preferences = { ...createDefaultPreferences(), googleCalendarSyncEnabled: true, ...prefs };
  const google = {
    isConnected: jest.fn(async () => true),
    connect: jest.fn(),
    disconnect: jest.fn(),
    pushMeeting: jest.fn(),
    removeMeeting: jest.fn(),
    pullChanges: jest.fn(),
    createMeetLink: jest.fn(),
    enqueue: jest.fn(async () => undefined),
    flushPending: jest.fn(async () => ({ pushed: 1, failed: 0, pending: 0, blockedBy: null })),
    sync: jest.fn(async () => pullResult('google')),
    loadState: jest.fn(async () => defaultGoogleSyncState()),
    resetLocalState: jest.fn(async () => undefined),
    refreshStatus: jest.fn(async () => ({ enabled: preferences.googleCalendarSyncEnabled, hasScope: true })),
  } satisfies GoogleCalendarServiceInternal;
  const device = {
    getPermission: jest.fn(async () => 'granted' as const),
    requestPermission: jest.fn(),
    listCalendars: jest.fn(),
    importFrom: jest.fn(),
    exportMeeting: jest.fn(),
    removeExported: jest.fn(),
    sync: jest.fn(async (): Promise<CalendarPullResult | null> => pullResult('device')),
    syncExports: jest.fn(async () => ({ exported: 1, removed: 0, failed: 0 })),
    ownSelection: jest.fn(async (p: Preferences) => ({
      importIds: p.deviceCalendarImportIds,
      exportId: p.deviceCalendarExportId,
    })),
    loadState: jest.fn(async () => defaultDeviceSyncState()),
  } satisfies DeviceCalendarServiceInternal;
  const events = createEventBus<AppEventMap>();
  const status = createCalendarStatusStore();
  const engine = createCalendarSyncEngine({
    google,
    device,
    preferences: { get: async () => preferences },
    pushHold: extra.pushHold,
    getActiveUid: () => UID,
    status,
    events,
    now: () => new Date(),
  });
  return { engine, google, device, events, status, preferences };
}

function change(overrides: Partial<MeetingsChangedEvent>): MeetingsChangedEvent {
  return { uid: UID, reason: 'updated', origin: 'user', changedIds: ['m1'], ...overrides };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('isPushableChange (loop prevention)', () => {
  it('pushes only local user/ai writes', () => {
    expect(isPushableChange(change({}))).toBe(true);
    expect(isPushableChange(change({ origin: 'ai', reason: 'created' }))).toBe(true);
    expect(isPushableChange(change({ origin: 'calendar_google' }))).toBe(false);
    expect(isPushableChange(change({ origin: 'calendar_device' }))).toBe(false);
    expect(isPushableChange(change({ reason: 'remote', origin: undefined }))).toBe(false);
    expect(isPushableChange(change({ reason: 'imported', origin: 'calendar_google' }))).toBe(false);
    expect(isPushableChange(change({ origin: 'migration' }))).toBe(false);
    expect(isPushableChange(change({ changedIds: [] }))).toBe(false);
  });
});

describe('calendarSyncEngine', () => {
  it('starts once per uid and runs the session-start sync', async () => {
    const { engine, google, device } = setup();
    engine.start(UID);
    engine.start(UID);
    await jest.runAllTimersAsync();
    expect(google.sync).toHaveBeenCalledTimes(1);
    expect(device.sync).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('debounces local changes into one persisted push', async () => {
    const { engine, google, events } = setup();
    engine.start(UID);
    await jest.runAllTimersAsync();

    events.emit('meetings:changed', change({ changedIds: ['m1'] }));
    events.emit('meetings:changed', change({ changedIds: ['m2'], reason: 'deleted' }));
    events.emit('meetings:changed', change({ changedIds: ['m3'], origin: 'calendar_google' }));
    // Persisted right away (survives the app being killed during the debounce), flushed later.
    await settle();
    expect(google.enqueue).toHaveBeenCalledWith(['m1'], 'upsert');
    expect(google.enqueue).toHaveBeenCalledWith(['m2'], 'delete');
    expect(google.enqueue).not.toHaveBeenCalledWith(['m3'], expect.anything());
    expect(google.flushPending).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    expect(google.enqueue).toHaveBeenCalledWith(['m1'], 'upsert');
    expect(google.enqueue).toHaveBeenCalledWith(['m2'], 'delete');
    expect(google.flushPending).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('keeps a held meeting (Zoom link on its way) out of the flush until its release', async () => {
    const pushHold = createPushHold();
    const { engine, google, device, events } = setup({ deviceCalendarExportId: 'dabcdefghij12.3' }, { pushHold });
    engine.start(UID);
    await jest.runAllTimersAsync();

    const release = pushHold.hold('m1');
    events.emit('meetings:changed', change({ changedIds: ['m1'], reason: 'created' }));
    events.emit('meetings:changed', change({ changedIds: ['m2'] }));
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    // m1 is persisted (survives a kill) but neither flushed to Google nor exported; m2 goes out.
    expect(google.enqueue).toHaveBeenCalledWith(['m1'], 'upsert');
    expect(google.enqueue).toHaveBeenCalledWith(['m2'], 'upsert');
    expect(google.flushPending).toHaveBeenCalledTimes(1);
    expect(device.syncExports).toHaveBeenCalledWith({ meetingIds: ['m2'] });

    release();
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    expect(google.flushPending).toHaveBeenCalledTimes(2);
    expect(device.syncExports).toHaveBeenCalledWith({ meetingIds: ['m1'] });
    engine.stop();
  });

  it('does not queue Google pushes while Google sync is off', async () => {
    const { engine, google, events } = setup({ googleCalendarSyncEnabled: false });
    engine.start(UID);
    await jest.runAllTimersAsync();
    events.emit('meetings:changed', change({}));
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    expect(google.enqueue).not.toHaveBeenCalled();
    expect(google.sync).not.toHaveBeenCalled();
    engine.stop();
  });

  it('refreshes exported copies for remote edits when this device exports', async () => {
    const { engine, device, google, events } = setup({ deviceCalendarExportId: 'dabcdefghij12.3' });
    engine.start(UID);
    await jest.runAllTimersAsync();
    events.emit('meetings:changed', change({ reason: 'remote', origin: undefined, changedIds: ['m9'] }));
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    expect(device.syncExports).toHaveBeenCalledWith({ meetingIds: ['m9'] });
    expect(google.enqueue).not.toHaveBeenCalled();
    engine.stop();
  });

  it('reports provider errors without failing the whole sync', async () => {
    const { engine, google } = setup({ deviceCalendarImportIds: ['dabcdefghij12.3'] });
    google.sync.mockRejectedValueOnce(new AppError('offline', 'down'));
    const report = await engine.syncNow({ reason: 'manual', headless: true });
    expect(report.google).toBeNull();
    expect(report.device?.provider).toBe('device');
    expect(report.errors).toEqual([{ provider: 'google', code: 'offline' }]);
  });

  it('coalesces calls made during a run into ONE follow-up run', async () => {
    const { engine, google } = setup();
    const [a, b, c] = [engine.syncNow({ headless: true }), engine.syncNow({ headless: true }), engine.syncNow({ headless: true })];
    expect(b).toBe(c);
    expect(a).not.toBe(b);
    await Promise.all([a, b, c]);
    expect(google.sync).toHaveBeenCalledTimes(2);
    // Nothing queued afterwards.
    await engine.syncNow({ headless: true });
    expect(google.sync).toHaveBeenCalledTimes(3);
  });

  it('runs the Google pull when sync is enabled while the first (device-only) run is in flight', async () => {
    const { engine, google, device, events, preferences } = setup({ googleCalendarSyncEnabled: false });
    let releaseDevice: () => void = () => undefined;
    device.sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDevice = () => resolve(pullResult('device'));
        }),
    );
    engine.start(UID);
    await settle();
    await jest.advanceTimersByTimeAsync(0);
    expect(device.sync).toHaveBeenCalledTimes(1);
    expect(google.sync).not.toHaveBeenCalled();

    // The server preferences arrive while the session-start run is still running.
    events.emit('preferences:changed', {
      uid: UID,
      preferences: { ...preferences, googleCalendarSyncEnabled: true },
      changedKeys: ['googleCalendarSyncEnabled'],
      origin: 'remote',
    });
    await settle();
    releaseDevice();
    await jest.runAllTimersAsync();
    expect(google.sync).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('syncs when calendar settings change and resets on stop', async () => {
    const { engine, google, events, status, preferences } = setup({ googleCalendarSyncEnabled: false });
    engine.start(UID);
    await jest.runAllTimersAsync();
    const enabled = { ...preferences, googleCalendarSyncEnabled: true };
    events.emit('preferences:changed', { uid: UID, preferences: enabled, changedKeys: ['googleCalendarSyncEnabled'], origin: 'local' });
    await settle();
    await jest.runAllTimersAsync();
    expect(google.sync).toHaveBeenCalled();
    expect(status.get().google.enabled).toBe(true);

    engine.stop();
    expect(status.get().google.enabled).toBe(false);
    events.emit('meetings:changed', change({}));
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(google.enqueue).not.toHaveBeenCalled();
  });

  it('forgets the Google sync state when sync is turned off on another device', async () => {
    const { engine, google, events, preferences } = setup();
    engine.start(UID);
    await jest.runAllTimersAsync();
    events.emit('preferences:changed', {
      uid: UID,
      preferences: { ...preferences, googleCalendarSyncEnabled: false },
      changedKeys: ['googleCalendarSyncEnabled'],
      origin: 'remote',
    });
    await settle();
    expect(google.resetLocalState).toHaveBeenCalled();
    engine.stop();
  });
});
