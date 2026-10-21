/**
 * Controller test for the daily briefing: proves the notification really reaches the port, that an
 * unchanged reconcile keeps it, that a changed day reschedules it, and that signing out cancels
 * it. The planner and the text are covered by briefing.test.ts.
 */
import type { FullScreenAlarmModule, FullScreenAlarmSpec, FullScreenAlarmStatus } from '../../../core/contracts';
import { createEventBus, type AppEventMap } from '../../../core/events';
import { AppError } from '../../../core/errors';
import type { Meeting, Preferences, Task } from '../../../core/types';
import { createBriefingScheduler, type BriefingScheduler } from '../briefing';
import type { BriefingData, ScheduledNotificationRecord, ScheduledSpec } from '../types';
import { fakeFormatTime, makeMeeting, makePrefs, translator } from '../__fixtures__/alertFixtures';

const NOW = new Date('2026-10-05T07:00:00.000Z'); // 09:00 Madrid
const ZONE = 'Europe/Madrid';

interface Harness {
  scheduler: BriefingScheduler;
  scheduled: Map<string, ScheduledSpec>;
  cancelled: string[];
  events: ReturnType<typeof createEventBus<AppEventMap>>;
  setMeetings(meetings: Meeting[]): void;
  setTasks(tasks: Task[]): void;
  setPreferences(preferences: Preferences | null): void;
  emitAppState(state: string): void;
}

function setup(options: { preferences?: Partial<Preferences>; meetings?: Meeting[] } = {}): Harness {
  const scheduled = new Map<string, ScheduledSpec>();
  const cancelled: string[] = [];
  const events = createEventBus<AppEventMap>();
  let meetings: Meeting[] = options.meetings ?? [];
  let tasks: Task[] = [];
  let preferences: Preferences | null = makePrefs({
    timezone: ZONE,
    briefingEnabled: true,
    briefingTime: '08:00',
    ...options.preferences,
  });
  let appStateListener: ((state: string) => void) | null = null;

  const scheduler = createBriefingScheduler({
    notifications: {
      async getScheduled(): Promise<ScheduledNotificationRecord[]> {
        // The platform may or may not expose the trigger time, exactly like the real port.
        return [...scheduled.values()].map((spec) => ({
          identifier: spec.identifier,
          data: spec.data,
          triggerDate: null,
        }));
      },
      async schedule(spec: ScheduledSpec): Promise<void> {
        scheduled.set(spec.identifier, spec);
      },
      async cancel(identifier: string): Promise<void> {
        cancelled.push(identifier);
        scheduled.delete(identifier);
      },
    },
    getPreferences: async () => {
      if (preferences === null) throw new AppError('unauthenticated', 'signed out');
      return preferences;
    },
    listMeetings: async () => meetings,
    listTasks: async () => tasks,
    subscribeTasks: () => () => undefined,
    i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
    events,
    appState: {
      subscribe: (listener) => {
        appStateListener = listener;
        return () => {
          appStateListener = null;
        };
      },
    },
    deviceTimeZone: () => ZONE,
    now: () => NOW,
  });

  return {
    scheduler,
    scheduled,
    cancelled,
    events,
    setMeetings: (next) => {
      meetings = next;
    },
    setTasks: (next) => {
      tasks = next;
    },
    setPreferences: (next) => {
      preferences = next;
    },
    emitAppState: (state) => appStateListener?.(state),
  };
}

describe('createBriefingScheduler', () => {
  it('schedules tomorrow and hands the real content to the port', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-06T07:30:00.000Z')] });
    await h.scheduler.reconcile();

    expect([...h.scheduled.keys()]).toEqual(['mgbrief:2026-10-06']);
    const spec = h.scheduled.get('mgbrief:2026-10-06');
    expect(spec).toMatchObject({ kind: 'briefing', fireAt: '2026-10-06T06:00:00.000Z' });
    expect(spec?.body).toBe('1 meeting today at 09:30: Meeting m1.');
  });

  it('keeps an identical briefing instead of rescheduling it', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-06T07:30:00.000Z')] });
    await h.scheduler.reconcile();
    const first = h.scheduled.get('mgbrief:2026-10-06');

    await h.scheduler.reconcile();

    expect(h.cancelled).toEqual([]);
    expect(h.scheduled.get('mgbrief:2026-10-06')).toBe(first);
  });

  it('reschedules when the day changed, because the body is fixed at schedule time', async () => {
    const h = setup({ meetings: [makeMeeting('m1', '2026-10-06T07:30:00.000Z')] });
    await h.scheduler.reconcile();
    const before = h.scheduled.get('mgbrief:2026-10-06')?.data as BriefingData;

    h.setMeetings([makeMeeting('m1', '2026-10-06T07:30:00.000Z'), makeMeeting('m2', '2026-10-06T09:00:00.000Z')]);
    await h.scheduler.reconcile();

    expect(h.cancelled).toEqual(['mgbrief:2026-10-06']);
    const after = h.scheduled.get('mgbrief:2026-10-06')?.data as BriefingData;
    expect(after.hash).not.toBe(before.hash);
    expect(h.scheduled.get('mgbrief:2026-10-06')?.body).toBe('2 meetings today, the first at 09:30.');
  });

  it('cancels everything when the briefing is switched off', async () => {
    const h = setup();
    await h.scheduler.reconcile();
    expect(h.scheduled.size).toBe(1);

    h.setPreferences(makePrefs({ timezone: ZONE, briefingEnabled: false }));
    await h.scheduler.reconcile();

    expect(h.cancelled).toEqual(['mgbrief:2026-10-06']);
    expect(h.scheduled.size).toBe(0);
  });

  it('cancels everything while signed out and schedules nothing', async () => {
    const h = setup();
    await h.scheduler.reconcile();

    h.setPreferences(null);
    await h.scheduler.reconcile();

    expect(h.cancelled).toEqual(['mgbrief:2026-10-06']);
    expect(h.scheduled.size).toBe(0);
  });

  it('never touches notifications owned by the other two schedulers', async () => {
    const h = setup();
    const foreign: ScheduledSpec[] = [];
    h.scheduled.set('mg:m1:15', { identifier: 'mg:m1:15', data: {} } as unknown as ScheduledSpec);
    h.scheduled.set('mgtask:t1', { identifier: 'mgtask:t1', data: {} } as unknown as ScheduledSpec);

    await h.scheduler.reconcile();

    expect(h.cancelled).toEqual(foreign.map((spec) => spec.identifier));
    expect(h.scheduled.has('mg:m1:15')).toBe(true);
    expect(h.scheduled.has('mgtask:t1')).toBe(true);
  });

  it('reconciles on the events that can change the briefing, and on returning to the foreground', async () => {
    const h = setup();
    h.scheduler.start();
    await h.scheduler.reconcile();
    expect(h.scheduled.size).toBe(1);

    // Switching off through a preference change must take effect without an explicit reconcile.
    h.setPreferences(makePrefs({ timezone: ZONE, briefingEnabled: false }));
    h.events.emit('preferences:changed', { uid: 'u1', preferences: makePrefs(), changedKeys: ['briefingEnabled'], origin: 'local' });
    await h.scheduler.reconcile();
    expect(h.scheduled.size).toBe(0);

    h.setPreferences(makePrefs({ timezone: ZONE, briefingEnabled: true, briefingTime: '08:00' }));
    h.emitAppState('active');
    await h.scheduler.reconcile();
    expect(h.scheduled.size).toBe(1);

    h.scheduler.stop();
  });
});

// --- Full-screen morning summary (Android; preferences.briefingFullScreen) --------------------

interface FsHarness {
  scheduler: BriefingScheduler;
  scheduled: Map<string, ScheduledSpec>;
  cancelled: string[];
  alarms: Map<string, FullScreenAlarmSpec>;
  setAlarmsCalls: { scope?: string; ids: string[] }[];
}

function setupFs(options: { available?: boolean; status?: Partial<FullScreenAlarmStatus>; fullScreen?: boolean } = {}): FsHarness {
  const scheduled = new Map<string, ScheduledSpec>();
  const cancelled: string[] = [];
  const alarms = new Map<string, FullScreenAlarmSpec>();
  const setAlarmsCalls: { scope?: string; ids: string[] }[] = [];
  const status: FullScreenAlarmStatus = {
    exactAllowed: true,
    fullScreenAllowed: options.status?.fullScreenAllowed ?? true,
    notificationsAllowed: options.status?.notificationsAllowed ?? true,
  };
  const fsi: FullScreenAlarmModule = {
    isAvailable: () => options.available ?? true,
    async setAlarms(next, scope) {
      setAlarmsCalls.push({ scope, ids: next.map((alarm) => alarm.id) });
      const nextMap = new Map(next.map((alarm) => [alarm.id, alarm]));
      for (const id of [...alarms.keys()]) {
        if ((scope === undefined || id.startsWith(scope)) && !nextMap.has(id)) alarms.delete(id);
      }
      for (const [id, alarm] of nextMap) alarms.set(id, alarm);
    },
    async clearAlarms(ids) {
      if (ids === undefined) alarms.clear();
      else for (const id of ids) alarms.delete(id);
    },
    async getStatus() {
      return { ...status };
    },
    async openFullScreenIntentSettings() {},
  };
  const scheduler = createBriefingScheduler({
    notifications: {
      async getScheduled() {
        return [...scheduled.values()].map((spec) => ({ identifier: spec.identifier, data: spec.data, triggerDate: null }));
      },
      async schedule(spec) {
        scheduled.set(spec.identifier, spec);
      },
      async cancel(identifier) {
        cancelled.push(identifier);
        scheduled.delete(identifier);
      },
    },
    fsi,
    getPreferences: async () => makePrefs({ timezone: ZONE, briefingEnabled: true, briefingTime: '08:00', briefingFullScreen: options.fullScreen ?? true }),
    listMeetings: async () => [makeMeeting('m1', '2026-10-06T07:30:00.000Z')],
    listTasks: async () => [],
    subscribeTasks: () => () => undefined,
    i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
    deviceTimeZone: () => ZONE,
    now: () => NOW,
  });
  return { scheduler, scheduled, cancelled, alarms, setAlarmsCalls };
}

describe('createBriefingScheduler full-screen summary', () => {
  it('fires the briefing full-screen and schedules no notification when the user opted in', async () => {
    const h = setupFs();
    await h.scheduler.reconcile();

    expect([...h.alarms.keys()]).toEqual(['mgbrief:2026-10-06']);
    expect(h.alarms.get('mgbrief:2026-10-06')).toMatchObject({ channelId: 'mg-alert-max-v2', deepLink: '' });
    expect(h.scheduled.size).toBe(0);
    // Scoped to the briefing prefix so it never clears the meeting engine's alarms.
    expect(h.setAlarmsCalls.every((call) => call.scope === 'mgbrief:')).toBe(true);
  });

  it('falls back to a notification and clears the full-screen alarm when the permission is denied', async () => {
    const h = setupFs({ status: { fullScreenAllowed: false } });
    await h.scheduler.reconcile();

    expect([...h.scheduled.keys()]).toEqual(['mgbrief:2026-10-06']);
    expect(h.alarms.size).toBe(0);
    expect(h.setAlarmsCalls).toContainEqual({ scope: 'mgbrief:', ids: [] });
  });

  it('switches a scheduled notification to full-screen, cancelling the notification', async () => {
    const notify = setupFs({ fullScreen: false });
    await notify.scheduler.reconcile();
    expect(notify.scheduled.size).toBe(1);
    expect(notify.alarms.size).toBe(0);

    const full = setupFs({ fullScreen: true });
    // Pretend a notification from the previous mode is still scheduled.
    full.scheduled.set('mgbrief:2026-10-06', { identifier: 'mgbrief:2026-10-06', data: {} } as unknown as ScheduledSpec);
    await full.scheduler.reconcile();

    expect(full.cancelled).toContain('mgbrief:2026-10-06');
    expect(full.scheduled.size).toBe(0);
    expect(full.alarms.has('mgbrief:2026-10-06')).toBe(true);
  });

  it('stays a notification when the module is unavailable (iOS)', async () => {
    const h = setupFs({ available: false });
    await h.scheduler.reconcile();

    expect([...h.scheduled.keys()]).toEqual(['mgbrief:2026-10-06']);
    expect(h.alarms.size).toBe(0);
    // Never calls the native module when it is not available.
    expect(h.setAlarmsCalls).toEqual([]);
  });
});
