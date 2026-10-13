/**
 * Alert engine with RECURRING meetings (docs/ARCHITECTURE.md §16), against an in-memory
 * NotificationsPort: occurrence scheduling, occurrence payloads, occurrence snoozes and their
 * validation across reconciles. One-off engine behaviour is covered by engine.test.ts.
 */
import { createEventBus, type AppEventMap } from '../../../core/events';
import type { Logger } from '../../../core/logger';
import type { Meeting, MeetingRecurrence, Preferences } from '../../../core/types';
import { NOW, fakeFormatTime, makeMeeting, makePrefs, translator } from '../__fixtures__/alertFixtures';
import { filterMeetings } from '../../data/engine';
import { createAlertEngine } from '../engineCore';
import type {
  AlertDataPort,
  AppStateName,
  IncomingResponse,
  NotificationsPort,
  ScheduledNotificationRecord,
  ScheduledSpec,
  StoredAlertData,
} from '../types';

const silentLogger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const DAILY: MeetingRecurrence = { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: 3 };

class FakeNotifications implements NotificationsPort {
  readonly platform = 'android' as const;
  scheduled = new Map<string, ScheduledSpec>();
  setPresentationHandler(): void {}
  async setChannels(): Promise<void> {}
  async deleteChannels(): Promise<void> {}
  async setCategories(): Promise<void> {}
  async getPermission() {
    return { status: 'granted' as const, canAskAgain: true, provisional: false };
  }
  async requestPermission() {
    return this.getPermission();
  }
  async getScheduled(): Promise<ScheduledNotificationRecord[]> {
    return [...this.scheduled.values()].map((spec) => ({
      identifier: spec.identifier,
      data: spec.data,
      triggerDate: Date.parse(spec.fireAt),
    }));
  }
  async schedule(spec: ScheduledSpec): Promise<void> {
    this.scheduled.set(spec.identifier, spec);
  }
  async cancel(identifier: string): Promise<void> {
    this.scheduled.delete(identifier);
  }
  async getPresented() {
    return [];
  }
  async dismiss(): Promise<void> {}
  addReceivedListener() {
    return () => undefined;
  }
  addResponseListener() {
    return () => undefined;
  }
  getLastResponse(): IncomingResponse | null {
    return null;
  }
}

function setup(options: { meetings: Meeting[]; prefs?: Preferences }) {
  const notifications = new FakeNotifications();
  const data = { meetings: options.meetings, prefs: options.prefs ?? makePrefs() };
  const dataPort: AlertDataPort = {
    getActiveUid: () => 'user-1',
    // The REAL range filter: the engine's reconcile window (now - 2 d .. now + 22 d) must keep
    // recurring masters whose own startAt (their first occurrence) is already far in the past.
    listMeetings: async (range) => filterMeetings(data.meetings, range),
    getMeeting: async (id) => data.meetings.find((meeting) => meeting.id === id) ?? null,
    getPreferences: async () => data.prefs,
    getCachedUpcoming: async () => data.meetings,
    getCachedPreferences: async () => data.prefs,
  };
  const store = new Map<string, string>();
  const engine = createAlertEngine({
    notifications,
    data: dataPort,
    i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
    settings: {
      exactAlarmSettingsAvailable: false,
      openExactAlarmSettings: async () => undefined,
      openNotificationSettings: async () => undefined,
      openChannelSettings: async () => undefined,
    },
    appState: { current: (): AppStateName => 'active', subscribe: () => () => undefined },
    storage: {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        store.set(key, value);
      },
    },
    feedback: { stopAll: jest.fn() },
    events: createEventBus<AppEventMap>(),
    logger: silentLogger,
    deviceTimeZone: () => 'UTC',
    now: () => NOW,
    debounceMs: 0,
  });
  engines.push(engine);
  return { engine, notifications, data };
}

const engines: ReturnType<typeof createAlertEngine>[] = [];

/** Daily 14:00 UTC series (3 occurrences) starting the day after NOW. */
function series(overrides: Partial<Meeting> = {}): Meeting {
  return makeMeeting('rec1', '2026-10-06T14:00:00.000Z', { recurrence: DAILY }, overrides);
}

function occurrenceAlertData(notifications: FakeNotifications, identifier: string): StoredAlertData {
  const spec = notifications.scheduled.get(identifier);
  if (!spec || spec.kind === 'refill' || spec.kind === 'task') throw new Error(`not scheduled: ${identifier}`);
  return spec.data;
}

afterEach(async () => {
  // Ends every engine session so no real timer (registry save, in-app) outlives the test.
  while (engines.length > 0) await engines.pop()?.endSession();
  jest.restoreAllMocks();
});

describe('reconcile with a recurring meeting', () => {
  it('schedules per-occurrence notifications whose payload carries the occurrence values', async () => {
    const { engine, notifications } = setup({
      meetings: [series()],
      prefs: makePrefs({ defaultAlertTimes: [15], followUpEnabled: false }),
    });
    await engine.startSession('user-1');

    expect([...notifications.scheduled.keys()].sort()).toEqual([
      'mg:rec1:2026-10-06:15',
      'mg:rec1:2026-10-07:15',
      'mg:rec1:2026-10-08:15',
    ]);
    const data = occurrenceAlertData(notifications, 'mg:rec1:2026-10-07:15');
    expect(data.localDateKey).toBe('2026-10-07');
    expect(data.startAt).toBe('2026-10-07T14:00:00.000Z');
    expect(data.fireAt).toBe('2026-10-07T13:45:00.000Z');
    expect(data.url).toBe('meetingguardai://meeting/rec1');

    const scheduled = await engine.getScheduled();
    expect(scheduled.map((info) => info.localDateKey)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
  });

  it('a series whose FIRST occurrence is weeks past still alerts, and its notifications survive a reconcile', async () => {
    // Weekly Mondays 14:00 UTC anchored a month before NOW (2026-09-07): the master's own startAt
    // is far outside the reconcile's 2-day lookback, but the series is still running.
    const aged = makeMeeting('old1', '2026-09-07T14:00:00.000Z', {
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null },
    });
    const { engine, notifications } = setup({
      meetings: [aged],
      prefs: makePrefs({ defaultAlertTimes: [15], followUpEnabled: false }),
    });
    await engine.startSession('user-1');

    // NOW is Monday 2026-10-05 12:00Z: today's 14:00 occurrence and the following Mondays.
    const ids = [...notifications.scheduled.keys()].sort();
    expect(ids).toContain('mg:old1:2026-10-05:15');
    expect(ids).toContain('mg:old1:2026-10-12:15');
    expect(ids.length).toBeGreaterThanOrEqual(2);

    // The regression this guards: the reconcile diff must KEEP them, not cancel the series.
    await engine.reconcile('manual');
    expect([...notifications.scheduled.keys()].sort()).toEqual(ids);
  });

  it('renders a modified occurrence with its overridden title and time', async () => {
    const meeting = series({
      recurrenceOverrides: {
        '2026-10-07': { status: 'modified', startAt: '2026-10-07T16:00:00.000Z', durationMinutes: null, title: 'Special' },
      },
    });
    const { engine, notifications } = setup({
      meetings: [meeting],
      prefs: makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }),
    });
    await engine.startSession('user-1');
    const data = occurrenceAlertData(notifications, 'mg:rec1:2026-10-07:0');
    expect(data.startAt).toBe('2026-10-07T16:00:00.000Z');
    expect(data.title).toBe('Special');
  });

  it('cancelling one occurrence removes exactly its notifications on the next reconcile', async () => {
    const { engine, notifications, data } = setup({
      meetings: [series()],
      prefs: makePrefs({ defaultAlertTimes: [0], followUpEnabled: false }),
    });
    await engine.startSession('user-1');
    expect(notifications.scheduled.has('mg:rec1:2026-10-07:0')).toBe(true);

    data.meetings = [
      series({
        recurrenceOverrides: { '2026-10-07': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } },
      }),
    ];
    await engine.reconcile('manual');
    expect([...notifications.scheduled.keys()].sort()).toEqual(['mg:rec1:2026-10-06:0', 'mg:rec1:2026-10-08:0']);
  });
});

describe('occurrence snoozes', () => {
  it('a snooze from an occurrence alert keeps the occurrence key and start, and survives the reconcile', async () => {
    const { engine, notifications } = setup({
      meetings: [series()],
      prefs: makePrefs({ defaultAlertTimes: [15], followUpEnabled: false }),
    });
    await engine.startSession('user-1');

    const response: IncomingResponse = {
      actionIdentifier: 'mg-snooze',
      notification: {
        identifier: 'mg:rec1:2026-10-06:15',
        date: NOW.getTime(),
        data: occurrenceAlertData(notifications, 'mg:rec1:2026-10-06:15'),
      },
    };
    await engine.handleNotificationResponse(response, 'foreground');

    const snooze = occurrenceAlertData(notifications, 'mg:rec1:snooze');
    expect(snooze.localDateKey).toBe('2026-10-06');
    expect(snooze.startAt).toBe('2026-10-06T14:00:00.000Z');

    // The reconcile validates the snooze against the OCCURRENCE (not the master's startAt) and keeps it.
    await engine.reconcile('manual');
    expect(notifications.scheduled.has('mg:rec1:snooze')).toBe(true);
  });

  it('the snooze is dropped once its occurrence is cancelled', async () => {
    const { engine, notifications, data } = setup({
      meetings: [series()],
      prefs: makePrefs({ defaultAlertTimes: [15], followUpEnabled: false }),
    });
    await engine.startSession('user-1');
    await engine.handleNotificationResponse(
      {
        actionIdentifier: 'mg-snooze',
        notification: {
          identifier: 'mg:rec1:2026-10-06:15',
          date: NOW.getTime() + 1,
          data: occurrenceAlertData(notifications, 'mg:rec1:2026-10-06:15'),
        },
      },
      'foreground',
    );
    expect(notifications.scheduled.has('mg:rec1:snooze')).toBe(true);

    data.meetings = [
      series({
        recurrenceOverrides: { '2026-10-06': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } },
      }),
    ];
    await engine.reconcile('manual');
    expect(notifications.scheduled.has('mg:rec1:snooze')).toBe(false);
  });
});
