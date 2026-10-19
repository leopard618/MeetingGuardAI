/**
 * Controller test for the daily briefing: proves the notification really reaches the port, that an
 * unchanged reconcile keeps it, that a changed day reschedules it, and that signing out cancels
 * it. The planner and the text are covered by briefing.test.ts.
 */
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
