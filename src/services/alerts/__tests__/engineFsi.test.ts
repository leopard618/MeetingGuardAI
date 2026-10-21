/**
 * Alert engine + full-screen alarm module (deps.fsi; contract in ../fsi.ts): MAX alerts are
 * routed to the module's declarative setAlarms and EXCLUDED from the expo-notifications set
 * before the diff, with an expo fallback in the same reconcile when the module is unavailable,
 * denied or failing. Pure fakes (no expo mocks): the engine only sees the ports.
 */
import type { FullScreenAlarmModule, FullScreenAlarmSpec, FullScreenAlarmStatus } from '../../../core/contracts';
import { ANDROID_CHANNELS, meetingDeepLink } from '../../../core/identifiers';
import { createEventBus, type AppEventMap } from '../../../core/events';
import type { Logger } from '../../../core/logger';
import type { Meeting, Preferences } from '../../../core/types';
import { NOW, fakeFormatTime, makeMeeting, makePrefs, minutesFrom, translator } from '../__fixtures__/alertFixtures';
import { createAlertEngine, type AlertEngineImpl } from '../engineCore';
import type { NotificationsPort, ScheduledNotificationRecord, ScheduledSpec } from '../types';

const silentLogger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

interface FakeNotifications {
  port: NotificationsPort;
  scheduled: Map<string, ScheduledSpec>;
  cancelled: string[];
}

function fakeNotifications(platform: NotificationsPort['platform'] = 'android'): FakeNotifications {
  const scheduled = new Map<string, ScheduledSpec>();
  const cancelled: string[] = [];
  const port: NotificationsPort = {
    platform,
    setPresentationHandler: jest.fn(),
    setChannels: jest.fn(async () => undefined),
    deleteChannels: jest.fn(async () => undefined),
    setCategories: jest.fn(async () => undefined),
    getPermission: jest.fn(async () => ({ status: 'granted' as const, canAskAgain: true, provisional: false })),
    requestPermission: jest.fn(async () => ({ status: 'granted' as const, canAskAgain: true, provisional: false })),
    getScheduled: jest.fn(async (): Promise<ScheduledNotificationRecord[]> =>
      [...scheduled.values()].map((spec) => ({
        identifier: spec.identifier,
        data: spec.data,
        triggerDate: Date.parse(spec.fireAt),
      })),
    ),
    present: jest.fn(async () => undefined),
    schedule: jest.fn(async (spec: ScheduledSpec) => {
      scheduled.set(spec.identifier, spec);
    }),
    cancel: jest.fn(async (identifier: string) => {
      cancelled.push(identifier);
      scheduled.delete(identifier);
    }),
    getPresented: jest.fn(async () => []),
    dismiss: jest.fn(async () => undefined),
    addReceivedListener: jest.fn(() => () => undefined),
    addResponseListener: jest.fn(() => () => undefined),
    getLastResponse: () => null,
  };
  return { port, scheduled, cancelled };
}

interface FakeFsi {
  fsi: FullScreenAlarmModule;
  state: {
    available: boolean;
    status: FullScreenAlarmStatus;
    alarms: Map<string, FullScreenAlarmSpec>;
    setError: Error | null;
  };
  setAlarms: jest.Mock;
  clearAlarms: jest.Mock;
  getStatus: jest.Mock;
}

function fakeFsi(overrides: Partial<{ available: boolean; status: FullScreenAlarmStatus }> = {}): FakeFsi {
  const state: FakeFsi['state'] = {
    available: overrides.available ?? true,
    status: overrides.status ?? { exactAllowed: true, fullScreenAllowed: true, notificationsAllowed: true },
    alarms: new Map<string, FullScreenAlarmSpec>(),
    setError: null,
  };
  const setAlarms = jest.fn(async (alarms: readonly FullScreenAlarmSpec[], scope?: string) => {
    if (state.setError) throw state.setError;
    // Faithful to the native module: a scope restricts the replace-all to ids starting with it.
    const next = new Map(alarms.map((alarm) => [alarm.id, alarm]));
    for (const id of [...state.alarms.keys()]) {
      const inScope = scope === undefined || scope === '' || id.startsWith(scope);
      if (inScope && !next.has(id)) state.alarms.delete(id);
    }
    for (const [id, alarm] of next) state.alarms.set(id, alarm);
  });
  const clearAlarms = jest.fn(async (ids?: readonly string[]) => {
    if (ids === undefined) state.alarms.clear();
    else for (const id of ids) state.alarms.delete(id);
  });
  const getStatus = jest.fn(async () => ({ ...state.status }));
  const fsi: FullScreenAlarmModule = {
    isAvailable: () => state.available,
    setAlarms,
    clearAlarms,
    getStatus,
    openFullScreenIntentSettings: jest.fn(async () => undefined),
  };
  return { fsi, state, setAlarms, clearAlarms, getStatus };
}

interface SetupOptions {
  meetings?: Meeting[];
  prefs?: Preferences;
  platform?: NotificationsPort['platform'];
  fsi?: FakeFsi;
}

function setup(options: SetupOptions = {}) {
  const notifications = fakeNotifications(options.platform ?? 'android');
  const fsi = options.fsi ?? fakeFsi();
  const data = {
    meetings: options.meetings ?? [],
    prefs: options.prefs ?? makePrefs({ followUpEnabled: false, defaultAlertTimes: [10] }),
  };
  const engine: AlertEngineImpl = createAlertEngine({
    notifications: notifications.port,
    data: {
      getActiveUid: () => 'user-1',
      listMeetings: jest.fn(async () => data.meetings),
      getMeeting: async (id) => data.meetings.find((meeting) => meeting.id === id) ?? null,
      getPreferences: async () => data.prefs,
      getCachedUpcoming: jest.fn(async () => data.meetings),
      getCachedPreferences: jest.fn(async () => data.prefs),
    },
    i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
    settings: {
      exactAlarmSettingsAvailable: true,
      openExactAlarmSettings: jest.fn(async () => undefined),
      openNotificationSettings: jest.fn(async () => undefined),
      openChannelSettings: jest.fn(async () => undefined),
    },
    appState: { current: () => 'active', subscribe: () => () => undefined },
    storage: { getItem: async () => null, setItem: async () => undefined },
    feedback: { stopAll: jest.fn() },
    events: createEventBus<AppEventMap>(),
    logger: silentLogger,
    deviceTimeZone: () => 'UTC',
    now: () => NOW,
    debounceMs: 0,
    fsi: fsi.fsi,
  });
  return { engine, notifications, fsi, data };
}

/** Meeting m-max: MAX intensity, one alert 5 min before a start 60 min from NOW. */
function maxMeeting(id = 'm-max'): Meeting {
  return makeMeeting(id, minutesFrom(NOW, 60), { alertIntensity: 'max', customAlertTimes: [5] });
}

function mediumMeeting(id = 'm-med'): Meeting {
  return makeMeeting(id, minutesFrom(NOW, 60), { alertIntensity: 'medium', customAlertTimes: [5] });
}

async function startSession(engine: AlertEngineImpl): Promise<void> {
  await engine.startSession('user-1');
}

describe('full-screen alarm routing (MAX path)', () => {
  it('scopes its reconcile to the engine prefix so briefing alarms survive', async () => {
    const fsi = fakeFsi();
    // A briefing full-screen alarm already in the native store (owned by briefing.ts).
    fsi.state.alarms.set('mgbrief:2026-10-22', {
      id: 'mgbrief:2026-10-22', atMs: Date.parse(minutesFrom(NOW, 600)), title: 'Briefing', body: '3 meetings', deepLink: '', channelId: 'mg-alert-max-v2',
    });
    const { engine } = setup({ meetings: [maxMeeting()], fsi });
    await startSession(engine);

    expect(fsi.setAlarms).toHaveBeenCalledWith(expect.any(Array), 'mg:');
    // The engine added its own alarm and left the briefing's alone.
    expect(fsi.state.alarms.has('mg:m-max:5')).toBe(true);
    expect(fsi.state.alarms.has('mgbrief:2026-10-22')).toBe(true);
  });

  it('routes MAX alerts to fsi.setAlarms and keeps them OFF the expo schedule', async () => {
    const { engine, notifications, fsi } = setup({ meetings: [maxMeeting(), mediumMeeting()] });
    await startSession(engine);

    expect(fsi.setAlarms).toHaveBeenCalledTimes(1);
    expect([...fsi.state.alarms.keys()]).toEqual(['mg:m-max:5']);
    const alarm = fsi.state.alarms.get('mg:m-max:5')!;
    expect(alarm.atMs).toBe(NOW.getTime() + 55 * 60_000);
    expect(alarm.channelId).toBe(ANDROID_CHANNELS.max);
    expect(alarm.deepLink).toBe(meetingDeepLink('m-max'));
    expect(alarm.title).toContain('Meeting m-max');
    expect(alarm.body.length).toBeGreaterThan(0);

    // Only the MEDIUM alert went through expo-notifications.
    expect([...notifications.scheduled.keys()]).toEqual(['mg:m-med:5']);
  });

  it('lists the routed alarms as pending (getScheduled / getStatus)', async () => {
    const { engine } = setup({ meetings: [maxMeeting(), mediumMeeting()] });
    await startSession(engine);

    const scheduled = await engine.getScheduled();
    expect(scheduled.map((info) => info.identifier).sort()).toEqual(['mg:m-max:5', 'mg:m-med:5']);
    const status = await engine.getStatus();
    expect(status.pendingCount).toBe(2);
    expect(status.fullScreenAlarms).toEqual({ exactAllowed: true, fullScreenAllowed: true, notificationsAllowed: true });
  });

  it('cancels a stale expo copy of a rerouted identifier through the ordinary diff', async () => {
    const { engine, notifications } = setup({ meetings: [maxMeeting()] });
    // A copy from before the module was active (any payload: it is not desired on expo any more).
    await notifications.port.schedule({
      identifier: 'mg:m-max:5',
      kind: 'alert',
      meetingId: 'm-max',
      fireAt: minutesFrom(NOW, 55),
      intensity: 'max',
      channelId: ANDROID_CHANNELS.max,
      categoryId: null,
      title: 'stale',
      body: 'stale',
      sound: 'default',
      interruptionLevel: 'timeSensitive',
      androidPriority: 'max',
      vibrate: [],
      sticky: true,
      data: {
        v: 1,
        kind: 'alert',
        meetingId: 'm-max',
        offsetMinutes: 5,
        intensity: 'max',
        startAt: minutesFrom(NOW, 60),
        url: meetingDeepLink('m-max'),
        hash: 'stale',
        fireAt: minutesFrom(NOW, 55),
        title: 'stale',
        language: 'en',
        durationMinutes: 60,
      },
    });
    await startSession(engine);

    expect(notifications.cancelled).toContain('mg:m-max:5');
    expect(notifications.scheduled.has('mg:m-max:5')).toBe(false);
  });

  it('falls back to expo in the SAME reconcile when the permission is denied', async () => {
    const fsi = fakeFsi({ status: { exactAllowed: true, fullScreenAllowed: false, notificationsAllowed: true } });
    const { engine, notifications } = setup({ meetings: [maxMeeting()], fsi });
    await startSession(engine);

    // Deactivated: the engine clears only its own scope (an empty scoped replace-all), never
    // the briefing's alarms, and does not touch the global clearAlarms.
    expect(fsi.setAlarms).toHaveBeenCalledWith([], 'mg:');
    expect(fsi.clearAlarms).not.toHaveBeenCalled();
    expect([...notifications.scheduled.keys()]).toEqual(['mg:m-max:5']);
  });

  it('falls back to expo in the SAME reconcile when setAlarms fails', async () => {
    const fsi = fakeFsi();
    fsi.state.setError = new Error('native down');
    const { engine, notifications } = setup({ meetings: [maxMeeting()], fsi });
    await startSession(engine);

    expect([...notifications.scheduled.keys()]).toEqual(['mg:m-max:5']);
    // Nothing is double-counted as pending on the module side.
    const scheduled = await engine.getScheduled();
    expect(scheduled.map((info) => info.identifier)).toEqual(['mg:m-max:5']);
  });

  it('moves MAX alerts back to expo and clears the module when the permission is revoked later', async () => {
    const fsi = fakeFsi();
    const { engine, notifications } = setup({ meetings: [maxMeeting()], fsi });
    await startSession(engine);
    expect(fsi.state.alarms.size).toBe(1);
    expect(notifications.scheduled.size).toBe(0);

    fsi.state.status = { exactAllowed: true, fullScreenAllowed: false, notificationsAllowed: true };
    await engine.reconcile('manual');

    expect(fsi.state.alarms.size).toBe(0);
    expect([...notifications.scheduled.keys()]).toEqual(['mg:m-max:5']);
    const status = await engine.getStatus();
    expect(status.fullScreenAlarms?.fullScreenAllowed).toBe(false);
  });

  it('never touches the module on other platforms', async () => {
    const fsi = fakeFsi();
    const { engine, notifications } = setup({ meetings: [maxMeeting()], platform: 'ios', fsi });
    await startSession(engine);

    expect(fsi.setAlarms).not.toHaveBeenCalled();
    expect(fsi.getStatus).not.toHaveBeenCalled();
    expect(fsi.clearAlarms).not.toHaveBeenCalled();
    expect([...notifications.scheduled.keys()]).toEqual(['mg:m-max:5']);
    expect((await engine.getStatus()).fullScreenAlarms).toBeUndefined();
  });

  it('clears every native alarm on cancelAll and at session end', async () => {
    const fsi = fakeFsi();
    const { engine } = setup({ meetings: [maxMeeting()], fsi });
    await startSession(engine);
    expect(fsi.state.alarms.size).toBe(1);

    await engine.cancelAll();
    expect(fsi.state.alarms.size).toBe(0);
    expect((await engine.getScheduled()).length).toBe(0);

    await engine.reconcile('manual');
    expect(fsi.state.alarms.size).toBe(1);
    await engine.endSession();
    expect(fsi.state.alarms.size).toBe(0);
  });

  it('keeps working with alerts disabled: the declarative empty set clears the module', async () => {
    const fsi = fakeFsi();
    const { engine, data } = setup({ meetings: [maxMeeting()], fsi });
    await startSession(engine);
    expect(fsi.state.alarms.size).toBe(1);

    data.prefs = makePrefs({ alertEnabled: false, followUpEnabled: false, defaultAlertTimes: [10] });
    await engine.reconcile('manual');
    expect(fsi.state.alarms.size).toBe(0);
  });
});
