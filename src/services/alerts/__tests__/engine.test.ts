/**
 * Alert engine with a MOCKED expo-notifications (in-memory OS): the real adapter
 * (expoNotificationsPort) + the real engine, fake data / i18n / storage / timers.
 */
import { AppError } from '../../../core/errors';
import { createEventBus, type AppEventMap } from '../../../core/events';
import type { Logger } from '../../../core/logger';
import type { Meeting, Preferences } from '../../../core/types';
import { NOW, fakeFormatTime, makeMeeting, makePrefs, minutesFrom, translator } from '../__fixtures__/alertFixtures';
import { createAlertEngine } from '../engineCore';
import { createExpoNotificationsPort, toIncomingResponse } from '../expoNotificationsPort';
import type { ActiveAlertView, AlertDataPort, AppStateName, TimerPort } from '../types';

interface MockRequest {
  identifier: string;
  content: Record<string, unknown>;
  trigger: unknown;
}

interface MockNotification {
  date: number;
  request: MockRequest;
}

interface MockPermission {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
  expires: string;
}

interface MockHandler {
  handleNotification(notification: MockNotification): Promise<Record<string, boolean>>;
}

interface MockState {
  scheduled: Map<string, MockRequest>;
  presented: Map<string, MockNotification>;
  received: Set<(notification: MockNotification) => void>;
  responses: Set<(response: unknown) => void>;
  categories: Map<string, { identifier: string; buttonTitle: string }[]>;
  permission: MockPermission;
  handler: MockHandler | null;
}

jest.mock('expo-notifications', () => {
  const state: MockState = {
    scheduled: new Map(),
    presented: new Map(),
    received: new Set(),
    responses: new Set(),
    categories: new Map(),
    permission: { granted: true, status: 'granted', canAskAgain: true, expires: 'never' },
    handler: null,
  };
  return {
    __state: state,
    AndroidImportance: { DEFAULT: 5, HIGH: 6, MAX: 7 },
    AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 2 },
    AndroidAudioUsage: { ALARM: 4 },
    AndroidAudioContentType: { SONIFICATION: 4 },
    AndroidNotificationPriority: { DEFAULT: 'default', HIGH: 'high', MAX: 'max' },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    IosAuthorizationStatus: { PROVISIONAL: 3 },
    setNotificationHandler: jest.fn((handler: MockHandler | null) => {
      state.handler = handler;
    }),
    setNotificationChannelAsync: jest.fn(async () => null),
    getNotificationChannelAsync: jest.fn(async () => null),
    deleteNotificationChannelAsync: jest.fn(async () => undefined),
    setNotificationCategoryAsync: jest.fn(async (id: string, actions: { identifier: string; buttonTitle: string }[]) => {
      state.categories.set(id, actions);
      return { identifier: id, actions };
    }),
    getPermissionsAsync: jest.fn(async () => state.permission),
    requestPermissionsAsync: jest.fn(async () => state.permission),
    // iOS-like: DATE triggers come back as time intervals (the fire time lives in our payload).
    getAllScheduledNotificationsAsync: jest.fn(async () =>
      [...state.scheduled.values()].map((request) => ({
        identifier: request.identifier,
        content: { ...request.content },
        trigger: { type: 'timeInterval', repeats: false, seconds: 60 },
      })),
    ),
    scheduleNotificationAsync: jest.fn(async (request: MockRequest) => {
      state.scheduled.set(request.identifier, request);
      return request.identifier;
    }),
    cancelScheduledNotificationAsync: jest.fn(async (identifier: string) => {
      state.scheduled.delete(identifier);
    }),
    getPresentedNotificationsAsync: jest.fn(async () => [...state.presented.values()]),
    dismissNotificationAsync: jest.fn(async (identifier: string) => {
      state.presented.delete(identifier);
    }),
    addNotificationReceivedListener: jest.fn((listener: (notification: MockNotification) => void) => {
      state.received.add(listener);
      return { remove: () => state.received.delete(listener) };
    }),
    addNotificationResponseReceivedListener: jest.fn((listener: (response: unknown) => void) => {
      state.responses.add(listener);
      return { remove: () => state.responses.delete(listener) };
    }),
    getLastNotificationResponse: jest.fn(() => null),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications = require('expo-notifications') as {
  __state: MockState;
  scheduleNotificationAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
  dismissNotificationAsync: jest.Mock;
};
const os = Notifications.__state;

const silentLogger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const flush = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

interface ManualTimer {
  callback: () => void;
  ms: number;
  cancelled: boolean;
}

interface SetupOptions {
  meetings?: Meeting[];
  prefs?: Preferences;
  store?: Map<string, string>;
  appState?: AppStateName;
  exactAlarmSettings?: boolean;
}

function setup(options: SetupOptions = {}) {
  const data = {
    meetings: options.meetings ?? [],
    prefs: options.prefs ?? makePrefs(),
    uid: 'user-1' as string | null,
    failure: null as Error | null,
    cachedPrefs: null as Preferences | null,
  };
  const dataPort: AlertDataPort = {
    getActiveUid: () => data.uid,
    listMeetings: jest.fn(async () => {
      if (data.failure) throw data.failure;
      return data.meetings;
    }),
    getMeeting: async (id) => data.meetings.find((meeting) => meeting.id === id) ?? null,
    getPreferences: async () => {
      if (data.failure) throw data.failure;
      return data.prefs;
    },
    getCachedUpcoming: jest.fn(async () => data.meetings),
    getCachedPreferences: jest.fn(async () => data.cachedPrefs),
  };
  const manualTimers: ManualTimer[] = [];
  const timers: TimerPort = {
    setTimeout(callback, ms) {
      if (ms <= 0) return setTimeout(callback, 0);
      const entry: ManualTimer = { callback, ms, cancelled: false };
      manualTimers.push(entry);
      return entry;
    },
    clearTimeout(handle) {
      if (typeof handle === 'object' && handle !== null && 'cancelled' in handle) {
        (handle as ManualTimer).cancelled = true;
      } else {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    },
  };
  const store = options.store ?? new Map<string, string>();
  const events = createEventBus<AppEventMap>();
  const feedback = { stopAll: jest.fn() };
  let now = NOW;
  let appStateValue: AppStateName = options.appState ?? 'active';
  const appStateListeners = new Set<(state: AppStateName) => void>();
  const engine = createAlertEngine({
    notifications: createExpoNotificationsPort(),
    data: dataPort,
    i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
    settings: {
      exactAlarmSettingsAvailable: options.exactAlarmSettings ?? false,
      openExactAlarmSettings: jest.fn(async () => undefined),
      openNotificationSettings: jest.fn(async () => undefined),
    },
    appState: {
      current: () => appStateValue,
      subscribe: (listener) => {
        appStateListeners.add(listener);
        return () => appStateListeners.delete(listener);
      },
    },
    storage: {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        store.set(key, value);
      },
    },
    feedback,
    events,
    logger: silentLogger,
    deviceTimeZone: () => 'UTC',
    now: () => now,
    timers,
    debounceMs: 0,
  });
  return {
    engine,
    data,
    dataPort,
    store,
    events,
    feedback,
    manualTimers,
    setNow(value: Date) {
      now = value;
    },
    setAppState(value: AppStateName) {
      appStateValue = value;
      appStateListeners.forEach((listener) => listener(value));
    },
  };
}

function scheduledIds(): string[] {
  return [...os.scheduled.keys()].sort();
}

function requestOf(identifier: string): MockRequest {
  const request = os.scheduled.get(identifier);
  if (!request) throw new Error(`not scheduled: ${identifier}`);
  return request;
}

function deliveredNotification(identifier: string, date: number): MockNotification {
  const request = requestOf(identifier);
  return { date, request: { identifier, content: { ...request.content }, trigger: null } };
}

beforeEach(() => {
  os.scheduled.clear();
  os.presented.clear();
  os.received.clear();
  os.responses.clear();
  os.categories.clear();
  os.permission = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
  os.handler = null;
  jest.clearAllMocks();
});

describe('alert engine reconcile (mocked expo-notifications)', () => {
  const weekly = () => makeMeeting('m1', minutesFrom(NOW, 120), { title: 'Weekly sync' });

  it('schedules the plan with DATE triggers, the channel inside the trigger and localized text', async () => {
    const { engine } = setup({ meetings: [weekly()] });
    await engine.startSession('user-1');

    expect(scheduledIds()).toEqual(['mg:m1:0', 'mg:m1:15', 'mg:m1:5', 'mg:m1:followup']);
    const alert = requestOf('mg:m1:15');
    expect(alert.trigger).toEqual({ type: 'date', date: new Date(minutesFrom(NOW, 105)), channelId: 'mg-alert-max-v1' });
    expect(alert.content).toMatchObject({
      title: 'Weekly sync starts in 15 minutes',
      body: '14:00',
      categoryIdentifier: 'mg-alert',
      sound: 'meeting_alarm.wav',
      interruptionLevel: 'timeSensitive',
      priority: 'max',
      sticky: true,
    });
    expect(JSON.stringify(alert.content)).not.toContain('[object Object]');
    expect(requestOf('mg:m1:followup').trigger).toMatchObject({ channelId: 'mg-followup-v1' });
    expect(requestOf('mg:m1:followup').content).toMatchObject({ categoryIdentifier: 'mg-followup' });

    expect(os.categories.get('mg-alert')?.map((action) => [action.identifier, action.buttonTitle])).toEqual([
      ['mg-open', 'Open'],
      ['mg-snooze', 'Snooze 5 min'],
      ['mg-snooze-10', 'Snooze 10 min'],
    ]);
    expect(os.categories.get('mg-followup')?.map((action) => action.identifier)).toEqual(['mg-assistant']);
    expect((await engine.getStatus()).lastReconcileError).toBeNull();
  });

  it('touches nothing when nothing changed (never cancel-all-then-refill)', async () => {
    const { engine } = setup({ meetings: [weekly()] });
    await engine.startSession('user-1');
    jest.clearAllMocks();

    const result = await engine.reconcile('manual');
    expect(result).toEqual({ scheduled: 0, cancelled: 0, kept: 4, truncated: false, skipped: null });
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('reschedules only what changed, cancels stale ids, removes legacy ones and leaves foreign ones alone', async () => {
    const other = makeMeeting('m2', minutesFrom(NOW, 240));
    const { engine, data } = setup({ meetings: [weekly(), other] });
    await engine.startSession('user-1');
    os.scheduled.set('other-app', { identifier: 'other-app', content: { data: { foo: 1 } }, trigger: null });
    os.scheduled.set('legacy-1', {
      identifier: 'legacy-1',
      content: { data: { meetingId: 'old', alertType: '5min' } },
      trigger: null,
    });
    jest.clearAllMocks();

    data.meetings = [
      makeMeeting('m1', minutesFrom(NOW, 130), { title: 'Weekly sync' }),
      makeMeeting('m2', minutesFrom(NOW, 240), { status: 'cancelled' }),
    ];
    const result = await engine.reconcile('meetings_changed');

    expect(result).toMatchObject({ scheduled: 4, cancelled: 9, kept: 0, skipped: null });
    expect(scheduledIds()).toEqual(['mg:m1:0', 'mg:m1:15', 'mg:m1:5', 'mg:m1:followup', 'other-app']);
    expect(requestOf('mg:m1:15').trigger).toMatchObject({ date: new Date(minutesFrom(NOW, 115)) });
  });

  it('aborts on a data failure without cancelling anything, but treats a real empty list as empty', async () => {
    const { engine, data } = setup({ meetings: [weekly()] });
    await engine.startSession('user-1');
    jest.clearAllMocks();

    data.failure = new AppError('offline', 'no network');
    await expect(engine.reconcile('manual')).rejects.toMatchObject({ code: 'offline' });
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(scheduledIds()).toHaveLength(4);
    expect((await engine.getStatus()).lastReconcileError).toBe('offline');

    data.failure = null;
    data.meetings = [];
    const result = await engine.reconcile('manual');
    expect(result.cancelled).toBe(4);
    expect(scheduledIds()).toEqual([]);
  });

  it('cancels every MeetingGuard notification when alerts are disabled', async () => {
    const { engine, data } = setup({ meetings: [weekly()] });
    await engine.startSession('user-1');
    data.prefs = makePrefs({ alertEnabled: false });
    const result = await engine.reconcile('preferences_changed');
    expect(result).toMatchObject({ skipped: 'alerts_disabled', cancelled: 4, scheduled: 0 });
    expect(scheduledIds()).toEqual([]);
  });

  it('reacts to preferences:changed and meetings:changed events of the session user only', async () => {
    const { engine, data, events } = setup({ meetings: [weekly()] });
    await engine.startSession('user-1');
    data.meetings = [];
    events.emit('meetings:changed', { uid: 'someone-else', reason: 'remote' });
    await flush();
    expect(scheduledIds()).toHaveLength(4);
    events.emit('meetings:changed', { uid: 'user-1', reason: 'deleted', origin: 'user', changedIds: ['m1'] });
    await flush();
    expect(scheduledIds()).toEqual([]);
  });

  it('re-creates every alert after the user visits the exact-alarm settings (Android 12+)', async () => {
    const { engine, setAppState } = setup({ meetings: [weekly()], exactAlarmSettings: true });
    await engine.startSession('user-1');
    setAppState('active');
    await flush();
    jest.clearAllMocks();

    await engine.openExactAlarmSettings();
    setAppState('background');
    setAppState('active');
    await flush();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(4);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(4);
    expect(scheduledIds()).toHaveLength(4);
    expect((await engine.getPermissionStatus()).exactAlarms).toBe('unknown');

    jest.clearAllMocks();
    setAppState('active'); // only once
    await flush();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule without notification permission (skipped: no_permission)', async () => {
    os.permission = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' };
    const { engine } = setup({ meetings: [weekly()] });
    await engine.startSession('user-1');
    expect(scheduledIds()).toEqual([]);
    expect(await engine.reconcile('manual')).toMatchObject({ skipped: 'no_permission', scheduled: 0 });
    expect(await engine.getPermissionStatus()).toEqual({
      notifications: 'denied',
      canAskAgain: false,
      exactAlarms: 'not_required',
    });
  });

  it('does nothing without a session and uses the per-user cache for headless runs', async () => {
    const { engine, data, dataPort } = setup({ meetings: [weekly()] });
    data.uid = null;
    expect(await engine.reconcile('foreground')).toMatchObject({ skipped: 'no_session' });
    expect(await engine.reconcile('background')).toMatchObject({ skipped: 'no_session' });
    expect(scheduledIds()).toEqual([]);

    // Session known to the engine but no data session: cached reads only.
    await engine.startSession('user-1'); // no cached preferences => skipped, nothing touched
    expect(scheduledIds()).toEqual([]);
    expect(dataPort.getCachedPreferences).toHaveBeenCalledWith('user-1');
    data.cachedPrefs = makePrefs();
    const result = await engine.reconcile('background');
    expect(result.scheduled).toBe(4);
    expect(dataPort.getCachedUpcoming).toHaveBeenCalled();
    expect(dataPort.listMeetings).not.toHaveBeenCalled();
  });

  it('endSession cancels and dismisses every MeetingGuard notification and stops feedback', async () => {
    const { engine, feedback } = setup({ meetings: [weekly()] });
    await engine.startSession('user-1');
    os.scheduled.set('other-app', { identifier: 'other-app', content: {}, trigger: null });
    os.presented.set('mg:m1:15', deliveredNotification('mg:m1:15', Date.parse(minutesFrom(NOW, 105))));
    os.presented.set('foreign', { date: 0, request: { identifier: 'foreign', content: {}, trigger: null } });

    await engine.endSession();
    expect(scheduledIds()).toEqual(['other-app']);
    expect([...os.presented.keys()]).toEqual(['foreign']);
    expect(feedback.stopAll).toHaveBeenCalled();
    expect(await engine.reconcile('foreground')).toMatchObject({ skipped: 'no_session' });
    expect(scheduledIds()).toEqual(['other-app']);
  });
});

describe('snooze', () => {
  const meeting = () => makeMeeting('m1', minutesFrom(NOW, 30), { title: 'Weekly sync' });

  it('handles the same snooze action once even if the background task and the listener both deliver it', async () => {
    const store = new Map<string, string>();
    const { engine, setNow } = setup({ meetings: [meeting()], store });
    await engine.startSession('user-1');
    const fireAt = Date.parse(minutesFrom(NOW, 25));
    const raw = {
      actionIdentifier: 'mg-snooze-10',
      notification: deliveredNotification('mg:m1:5', fireAt),
    };
    setNow(new Date(fireAt));
    jest.clearAllMocks();

    await engine.handleNotificationResponse(toIncomingResponse(raw)!, 'background');
    os.responses.forEach((listener) => listener(raw)); // the same tap reaches the foreground listener
    await flush();

    const snoozeCalls = Notifications.scheduleNotificationAsync.mock.calls.filter(
      ([request]: [MockRequest]) => request.identifier === 'mg:m1:snooze',
    );
    expect(snoozeCalls).toHaveLength(1);
    const snooze = requestOf('mg:m1:snooze');
    expect(snooze.trigger).toEqual({ type: 'date', date: new Date(fireAt + 10 * 60_000), channelId: 'mg-alert-max-v1' });
    expect(snooze.content).toMatchObject({ title: 'Weekly sync has started', categoryIdentifier: 'mg-alert' });
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('mg:m1:5');

    // App relaunch after a headless run: the pending response is delivered again -> ignored.
    const relaunched = setup({ meetings: [meeting()], store });
    relaunched.setNow(new Date(fireAt));
    jest.clearAllMocks();
    await relaunched.engine.handleNotificationResponse(toIncomingResponse(raw)!, 'foreground');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('snoozes by the preference length and works from the notification payload alone (headless)', async () => {
    const { engine, data } = setup({ meetings: [meeting()], prefs: makePrefs({ snoozeMinutes: 7 }) });
    await engine.startSession('user-1');
    const raw = { actionIdentifier: 'mg-snooze', notification: deliveredNotification('mg:m1:15', Date.parse(minutesFrom(NOW, 15))) };

    const headless = setup({ meetings: [] });
    headless.data.uid = null; // no session, no data: only the payload
    await headless.engine.handleNotificationResponse(toIncomingResponse(raw)!, 'background');
    expect(requestOf('mg:m1:snooze').trigger).toMatchObject({ date: new Date(NOW.getTime() + 5 * 60_000) });
    expect(requestOf('mg:m1:snooze').content).toMatchObject({ title: 'Reminder: Weekly sync starts in 25 minutes' });

    await engine.snooze('m1');
    expect(requestOf('mg:m1:snooze').trigger).toMatchObject({ date: new Date(NOW.getTime() + 7 * 60_000) });
    data.meetings = [makeMeeting('m1', minutesFrom(NOW, 30), {}, { deletedAt: NOW.toISOString() })];
    await engine.reconcile('manual');
    await expect(engine.snooze('m1', 5)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps a valid snooze, drops the planned alert it duplicates, and cancels it when the meeting is cancelled', async () => {
    const { engine, data } = setup({ meetings: [meeting()], prefs: makePrefs({ followUpEnabled: false }) });
    await engine.startSession('user-1');
    expect(scheduledIds()).toEqual(['mg:m1:0', 'mg:m1:15', 'mg:m1:5']);

    await engine.snooze('m1', 24); // fires at +24, next to the 5-min alert (+25)
    await flush();
    const result = await engine.reconcile('manual');
    expect(scheduledIds()).toEqual(['mg:m1:0', 'mg:m1:15', 'mg:m1:snooze']);
    expect(result.kept).toBe(3);

    data.meetings = [makeMeeting('m1', minutesFrom(NOW, 30), { status: 'cancelled' })];
    await engine.reconcile('meetings_changed');
    expect(scheduledIds()).toEqual([]);
  });
});

describe('in-app alerts', () => {
  const meeting = () =>
    makeMeeting('m1', minutesFrom(NOW, 30), {
      title: 'Weekly sync',
      conference: { provider: 'zoom', url: 'https://zoom.us/j/123', password: null },
    });

  it('turns a foreground delivery into one ActiveAlert and suppresses the OS banner while a host is attached', async () => {
    const { engine, events } = setup({ meetings: [meeting()] });
    await engine.startSession('user-1');
    const seen: ActiveAlertView[][] = [];
    const fired: unknown[] = [];
    events.on('alerts:fired', (event) => {
      fired.push(event);
    });
    const unsubscribe = engine.subscribeActiveAlerts((alerts) => seen.push(alerts));

    const notification = deliveredNotification('mg:m1:5', Date.parse(minutesFrom(NOW, 25)));
    expect(await os.handler!.handleNotification(notification)).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
    });
    os.received.forEach((listener) => listener(notification));
    os.received.forEach((listener) => listener(notification)); // duplicate delivery
    await flush();

    const current = seen[seen.length - 1] ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      key: 'mg:m1:5',
      kind: 'alert',
      intensity: 'max',
      offsetMinutes: 5,
      title: 'Weekly sync',
      joinUrl: 'https://zoom.us/j/123',
      locationText: 'Zoom',
    });
    expect(fired).toEqual([
      { uid: 'user-1', meetingId: 'm1', kind: 'alert', offsetMinutes: 5, intensity: 'max', via: 'notification_received' },
    ]);

    await engine.resolveActiveAlert('mg:m1:5', 'acknowledge');
    expect(engine.getActiveAlerts()).toEqual([]);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('mg:m1:5');
    expect(await os.handler!.handleNotification(notification)).toMatchObject({ shouldShowList: false });

    unsubscribe();
    expect(await os.handler!.handleNotification(notification)).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
  });

  it('fires exactly on time with the in-app timer and cancels the OS copy', async () => {
    const { engine, manualTimers, setNow } = setup({ meetings: [meeting()] });
    const seen: ActiveAlertView[][] = [];
    engine.subscribeActiveAlerts((alerts) => seen.push(alerts));
    await engine.startSession('user-1');

    const timer = manualTimers.filter((entry) => !entry.cancelled).find((entry) => entry.ms === 15 * 60_000);
    expect(timer).toBeDefined();
    setNow(new Date(minutesFrom(NOW, 15)));
    timer!.callback();
    await flush();

    expect(seen[seen.length - 1]?.map((alert) => alert.key)).toEqual(['mg:m1:15']);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mg:m1:15');
    await engine.resolveActiveAlert('mg:m1:15', 'snooze', { snoozeMinutes: 5 });
    expect(requestOf('mg:m1:snooze').trigger).toMatchObject({ date: new Date(minutesFrom(NOW, 20)) });
  });

  it('withdraws an on-screen alert when its meeting is cancelled meanwhile', async () => {
    const { engine, data } = setup({ meetings: [meeting()] });
    engine.subscribeActiveAlerts(() => undefined);
    await engine.startSession('user-1');
    os.received.forEach((listener) => listener(deliveredNotification('mg:m1:15', Date.parse(minutesFrom(NOW, 15)))));
    await flush();
    expect(engine.getActiveAlerts()).toHaveLength(1);
    data.meetings = [makeMeeting('m1', minutesFrom(NOW, 30), { status: 'cancelled' })];
    await engine.reconcile('meetings_changed');
    expect(engine.getActiveAlerts()).toEqual([]);
  });

  it('auto-snoozes an unhandled MAX alert when the user leaves the app', async () => {
    const { engine, setAppState } = setup({ meetings: [meeting()] });
    engine.subscribeActiveAlerts(() => undefined);
    await engine.startSession('user-1');
    const notification = deliveredNotification('mg:m1:15', Date.parse(minutesFrom(NOW, 15)));
    os.received.forEach((listener) => listener(notification));
    await flush();
    expect(engine.getActiveAlerts().map((alert) => alert.key)).toEqual(['mg:m1:15']);

    setAppState('background');
    await flush();
    expect(engine.getActiveAlerts()).toEqual([]);
    expect(requestOf('mg:m1:snooze').trigger).toMatchObject({ date: new Date(minutesFrom(NOW, 5)) });
  });
});
