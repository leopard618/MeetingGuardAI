/**
 * The engine's optional Outlook branch: queue + persist-first pushes while connected, the outlook
 * part of syncNow reports, and complete absence when the provider is not registered.
 */
import type { CalendarPullResult } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { createEventBus, type AppEventMap, type MeetingsChangedEvent } from '../../../core/events';
import { createDefaultPreferences, type Preferences } from '../../../core/types';
import type { DeviceCalendarServiceInternal } from '../device/service';
import { createCalendarSyncEngine, PUSH_DEBOUNCE_MS } from '../engine';
import type { GoogleCalendarServiceInternal } from '../google/service';
import type { OutlookCalendarServiceInternal } from '../outlook/service';
import { defaultOutlookSyncState } from '../outlook/state';
import { defaultDeviceSyncState, defaultGoogleSyncState } from '../stateStore';
import { createCalendarStatusStore } from '../status';

const UID = 'user-1';

function pullResult(provider: 'google' | 'device' | 'outlook'): CalendarPullResult {
  return {
    provider,
    fullSync: false,
    counts: { created: 1, updated: 0, removed: 0, unchanged: 0, pushed: 0, failed: 0 },
    syncedAt: '2026-10-01T08:00:00.000Z',
  };
}

function setup(options: { outlook?: boolean; connected?: boolean } = {}) {
  const preferences: Preferences = { ...createDefaultPreferences(), googleCalendarSyncEnabled: false };
  const status = createCalendarStatusStore();
  const connected = options.connected !== false;

  const google = {
    isConnected: jest.fn(async () => false),
    connect: jest.fn(),
    disconnect: jest.fn(),
    pushMeeting: jest.fn(),
    removeMeeting: jest.fn(),
    pullChanges: jest.fn(),
    createMeetLink: jest.fn(),
    enqueue: jest.fn(async () => undefined),
    flushPending: jest.fn(async () => ({ pushed: 0, failed: 0, pending: 0, blockedBy: null })),
    sync: jest.fn(async () => pullResult('google')),
    loadState: jest.fn(async () => defaultGoogleSyncState()),
    resetLocalState: jest.fn(async () => undefined),
    refreshStatus: jest.fn(async () => ({ enabled: false, hasScope: false })),
  } satisfies GoogleCalendarServiceInternal;

  const device = {
    getPermission: jest.fn(async () => 'granted' as const),
    requestPermission: jest.fn(),
    listCalendars: jest.fn(),
    importFrom: jest.fn(),
    exportMeeting: jest.fn(),
    removeExported: jest.fn(),
    sync: jest.fn(async (): Promise<CalendarPullResult | null> => null),
    syncExports: jest.fn(async () => ({ exported: 0, removed: 0, failed: 0 })),
    ownSelection: jest.fn(async () => ({ importIds: [] as string[], exportId: null })),
    loadState: jest.fn(async () => defaultDeviceSyncState()),
  } satisfies DeviceCalendarServiceInternal;

  const outlook = {
    isConfigured: jest.fn(() => true),
    isConnected: jest.fn(async () => connected),
    connect: jest.fn(),
    disconnect: jest.fn(),
    pushMeeting: jest.fn(),
    removeMeeting: jest.fn(),
    pullChanges: jest.fn(),
    enqueue: jest.fn(async () => undefined),
    flushPending: jest.fn(async () => ({ pushed: 1, failed: 0, pending: 0, blockedBy: null })),
    sync: jest.fn(async () => pullResult('outlook')),
    loadState: jest.fn(async () => ({ ...defaultOutlookSyncState(), lastSyncAt: '2026-09-30T08:00:00.000Z' })),
    resetLocalState: jest.fn(async () => undefined),
    setDisconnectHook: jest.fn(),
    refreshStatus: jest.fn(async () => {
      status.patchOutlook({ configured: true, connected, enabled: connected });
      return { configured: true, connected };
    }),
  } satisfies OutlookCalendarServiceInternal;

  const events = createEventBus<AppEventMap>();
  const engine = createCalendarSyncEngine({
    google,
    device,
    outlook: options.outlook === false ? undefined : outlook,
    preferences: { get: async () => preferences },
    getActiveUid: () => UID,
    status,
    events,
    now: () => new Date(),
  });
  return { engine, google, device, outlook, events, status };
}

function change(overrides: Partial<MeetingsChangedEvent> = {}): MeetingsChangedEvent {
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

describe('calendarSyncEngine + outlook', () => {
  it('syncs Outlook on session start and reports it', async () => {
    const { engine, outlook, status } = setup();
    engine.start(UID);
    await jest.runAllTimersAsync();
    expect(outlook.sync).toHaveBeenCalledTimes(1);
    // The stored last sync time reached the status before the first sync.
    expect(status.get().outlook?.configured).toBe(true);
    engine.stop();
    // Session end resets the status back to "absent".
    expect(status.get().outlook).toBeUndefined();
  });

  it('reports outlook: null when configured but not connected (and never calls sync)', async () => {
    const { engine, outlook } = setup({ connected: false });
    engine.start(UID);
    await jest.runAllTimersAsync();
    expect(outlook.sync).not.toHaveBeenCalled();
    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.outlook).toBeNull();
    engine.stop();
  });

  it('leaves outlook out of the report entirely when the provider is not registered', async () => {
    const { engine, outlook } = setup({ outlook: false });
    engine.start(UID);
    await jest.runAllTimersAsync();
    const report = await engine.syncNow({ reason: 'manual' });
    expect('outlook' in report).toBe(false);
    expect(outlook.refreshStatus).not.toHaveBeenCalled();
    engine.stop();
  });

  it('queues a change pulled from Google for Outlook (the other provider holds a copy of the same meeting)', async () => {
    const { engine, google, outlook, events } = setup();
    engine.start(UID);
    await jest.runAllTimersAsync();
    events.emit('meetings:changed', change({ reason: 'imported', origin: 'calendar_google', changedIds: ['m1'] }));
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    expect(outlook.enqueue).toHaveBeenCalledWith(['m1'], 'upsert');
    expect(outlook.flushPending).toHaveBeenCalled();
    // Never back to the provider the change came from.
    expect(google.enqueue).not.toHaveBeenCalled();
    engine.stop();
  });

  it('queues local changes for Outlook (persist-first) and flushes after the debounce', async () => {
    const { engine, outlook, events } = setup();
    engine.start(UID);
    await jest.runAllTimersAsync();

    events.emit('meetings:changed', change({ changedIds: ['m1'] }));
    events.emit('meetings:changed', change({ changedIds: ['m2'], reason: 'deleted' }));
    events.emit('meetings:changed', change({ changedIds: ['m3'], origin: 'calendar_outlook' }));
    await settle();
    expect(outlook.enqueue).toHaveBeenCalledWith(['m1'], 'upsert');
    expect(outlook.enqueue).toHaveBeenCalledWith(['m2'], 'delete');
    expect(outlook.enqueue).not.toHaveBeenCalledWith(['m3'], expect.anything());
    expect(outlook.flushPending).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    expect(outlook.flushPending).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('does not queue Outlook pushes while disconnected', async () => {
    const { engine, outlook, events } = setup({ connected: false });
    engine.start(UID);
    await jest.runAllTimersAsync();
    events.emit('meetings:changed', change());
    await jest.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    await settle();
    expect(outlook.enqueue).not.toHaveBeenCalled();
    expect(outlook.flushPending).not.toHaveBeenCalled();
    engine.stop();
  });

  it('an Outlook failure lands in report.errors without breaking the other providers', async () => {
    const { engine, outlook } = setup();
    outlook.sync.mockRejectedValue(new AppError('upstream_error', 'graph down'));
    engine.start(UID);
    await jest.runAllTimersAsync();
    const report = await engine.syncNow({ reason: 'manual' });
    expect(report.errors).toContainEqual({ provider: 'outlook', code: 'upstream_error' });
    engine.stop();
  });
});
