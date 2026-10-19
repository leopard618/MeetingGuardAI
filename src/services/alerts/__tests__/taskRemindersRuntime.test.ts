/**
 * Runtime test for task reminders: proves the reminder is really handed to the notifications port
 * with the right identifier, fire time and payload, that an unchanged reconcile keeps it, that an
 * edited task reschedules it, and that completing a task or signing out cancels it.
 * computeTaskReminderPlan is covered by taskReminders.test.ts; this covers everything after it.
 */
import { createEventBus, type AppEventMap } from '../../../core/events';
import { AppError } from '../../../core/errors';
import { buildTask, createDefaultPreferences, type Preferences, type Task } from '../../../core/types';
import { createTaskReminders, type TaskReminders } from '../taskReminders';
import { fakeFormatTime, translator } from '../__fixtures__/alertFixtures';
import type { ScheduledNotificationRecord, ScheduledSpec, TaskReminderData } from '../types';

const NOW = new Date('2030-03-10T09:00:00.000Z');
const ZONE = 'Europe/Madrid';

function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return { ...createDefaultPreferences({ language: 'en', timezone: ZONE }), ...overrides };
}

function task(id: string, overrides: Partial<Parameters<typeof buildTask>[0]> = {}): Task {
  return buildTask(
    { title: `Task ${id}`, dueDate: '2030-03-12', dueTime: '16:00', reminderMinutesBefore: 30, ...overrides },
    { id, userId: 'u1', timezone: ZONE, now: NOW },
  );
}

interface Harness {
  reminders: TaskReminders;
  scheduled: Map<string, ScheduledSpec>;
  cancelled: string[];
  events: ReturnType<typeof createEventBus<AppEventMap>>;
  deliver(tasks: Task[]): Promise<void>;
  setPreferences(preferences: Preferences | null): void;
}

function setup(): Harness {
  const scheduled = new Map<string, ScheduledSpec>();
  const cancelled: string[] = [];
  const events = createEventBus<AppEventMap>();
  let preferences: Preferences | null = prefs();
  let listener: ((tasks: Task[]) => void) | null = null;
  let pending: Promise<void> = Promise.resolve();

  const reminders = createTaskReminders({
    notifications: {
      async getScheduled(): Promise<ScheduledNotificationRecord[]> {
        return [...scheduled.values()].map((spec) => ({ identifier: spec.identifier, data: spec.data, triggerDate: null }));
      },
      async schedule(spec: ScheduledSpec): Promise<void> {
        scheduled.set(spec.identifier, spec);
      },
      async cancel(identifier: string): Promise<void> {
        cancelled.push(identifier);
        scheduled.delete(identifier);
      },
    },
    subscribeTasks: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    getPreferences: async () => {
      if (preferences === null) throw new AppError('unauthenticated', 'signed out');
      return preferences;
    },
    i18n: { t: translator('en'), getLanguage: () => 'en', formatTime: fakeFormatTime },
    events,
    deviceTimeZone: () => ZONE,
    now: () => NOW,
  });

  reminders.start();

  return {
    reminders,
    scheduled,
    cancelled,
    events,
    async deliver(tasks) {
      listener?.(tasks);
      // The scheduler serializes reconciles on its own chain; two turns drain it.
      await pending;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    setPreferences: (next) => {
      preferences = next;
    },
  };
}

describe('createTaskReminders runtime', () => {
  it('hands the reminder to the OS with its identifier, fire time and payload', async () => {
    const h = setup();
    await h.deliver([task('taska11')]);

    expect([...h.scheduled.keys()]).toEqual(['mgtask:taska11']);
    const spec = h.scheduled.get('mgtask:taska11');
    // 2030-03-12 16:00 Madrid (CET, +01:00) = 15:00Z, minus the 30 minute reminder.
    expect(spec).toMatchObject({ kind: 'task', fireAt: '2030-03-12T14:30:00.000Z', categoryId: null });
    expect(spec?.body).toContain('Task taska11');
    expect((spec?.data as TaskReminderData).kind).toBe('task');
  });

  it('keeps an unchanged reminder instead of rescheduling it', async () => {
    const h = setup();
    await h.deliver([task('taska11')]);
    const first = h.scheduled.get('mgtask:taska11');

    await h.deliver([task('taska11')]);

    expect(h.cancelled).toEqual([]);
    expect(h.scheduled.get('mgtask:taska11')).toBe(first);
  });

  it('reschedules when the due time moves', async () => {
    const h = setup();
    await h.deliver([task('taska11')]);

    await h.deliver([task('taska11', { dueTime: '18:00' })]);

    expect(h.cancelled).toEqual(['mgtask:taska11']);
    expect(h.scheduled.get('mgtask:taska11')?.fireAt).toBe('2030-03-12T16:30:00.000Z');
  });

  it('reschedules when the title changes, because the body is fixed at schedule time', async () => {
    const h = setup();
    await h.deliver([task('taska11')]);

    await h.deliver([task('taska11', { title: 'Renamed' })]);

    expect(h.cancelled).toEqual(['mgtask:taska11']);
    expect(h.scheduled.get('mgtask:taska11')?.body).toContain('Renamed');
  });

  it('cancels the reminder when the task is completed', async () => {
    const h = setup();
    const open = task('taska11');
    await h.deliver([open]);

    await h.deliver([{ ...open, status: 'done', completedAt: NOW.toISOString() }]);

    expect(h.cancelled).toEqual(['mgtask:taska11']);
    expect(h.scheduled.size).toBe(0);
  });

  it('cancels the reminder when the task is deleted (it leaves the snapshot)', async () => {
    const h = setup();
    await h.deliver([task('taska11')]);

    await h.deliver([]);

    expect(h.cancelled).toEqual(['mgtask:taska11']);
    expect(h.scheduled.size).toBe(0);
  });

  it('cancels everything while signed out and schedules nothing', async () => {
    const h = setup();
    await h.deliver([task('taska11')]);

    h.setPreferences(null);
    await h.deliver([task('taska11')]);

    expect(h.cancelled).toEqual(['mgtask:taska11']);
    expect(h.scheduled.size).toBe(0);
  });

  it('cancels everything when the master alert switch goes off', async () => {
    const h = setup();
    await h.deliver([task('taska11')]);

    h.setPreferences(prefs({ alertEnabled: false }));
    h.events.emit('preferences:changed', {
      uid: 'u1',
      preferences: prefs({ alertEnabled: false }),
      changedKeys: ['alertEnabled'],
      origin: 'local',
    });
    await h.deliver([task('taska11')]);

    expect(h.scheduled.size).toBe(0);
  });

  it('never touches notifications owned by the alert engine or the briefing', async () => {
    const h = setup();
    h.scheduled.set('mg:m1:15', { identifier: 'mg:m1:15', data: {} } as unknown as ScheduledSpec);
    h.scheduled.set('mgbrief:2030-03-11', { identifier: 'mgbrief:2030-03-11', data: {} } as unknown as ScheduledSpec);

    await h.deliver([task('taska11')]);

    expect(h.cancelled).toEqual([]);
    expect(h.scheduled.has('mg:m1:15')).toBe(true);
    expect(h.scheduled.has('mgbrief:2030-03-11')).toBe(true);
  });
});
