/**
 * Task reminders (V2 Stage 1; owner: alerts): a small, self-contained scheduler that lives
 * BESIDE the meeting alert engine instead of inside it.
 *
 * - Identifiers use the `mgtask:` prefix. The alert engine's reconcile manages `mg:*` ids only,
 *   so the two schedulers can never cancel each other's notifications; in the foreground a task
 *   reminder presents as a normal banner (the engine's presentation handler ignores unknown ids).
 * - One notification per open task with a due date, a due time and a reminder offset; the fire
 *   instant is dueDate+dueTime in the TASK's zone minus the offset.
 * - Reconciled from the task snapshot (every local write, remote sync and session change
 *   re-delivers it), preference changes and language changes. Signed out, the snapshot is empty
 *   and every mgtask:* notification is cancelled.
 * - Reconciles are serialized on one chain, so overlapping triggers never interleave their
 *   cancel/schedule calls.
 */
import type { Unsubscribe } from '../../core/contracts';
import { appEvents, type AppEventMap, type EventBus } from '../../core/events';
import { ALERT_HORIZON_DAYS, TASK_NOTIFICATION_ID_PREFIX, channelFor, taskReminderNotificationId } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone, zonedDateTimeToUtcIso } from '../../core/time';
import type { Preferences, Task } from '../../core/types';
import type { AlertI18nPort, NotificationsPort, TaskReminderData, TaskReminderSpec } from './types';

const log = createLogger('alerts.tasks');

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Scheduled task reminders at most; the earliest win (the OS budget belongs to meeting alerts). */
export const TASK_REMINDER_BUDGET = 20;

export interface TaskReminderItem {
  identifier: string;
  taskId: string;
  /** Reminder instant (UTC ISO), strictly in the future. */
  fireAt: string;
  /** Due instant (UTC ISO), rendered into the notification body. */
  dueAt: string;
  title: string;
}

/**
 * PURE planner: one item per open task with a due time and a reminder offset, fireAt inside
 * (now, now + horizon], earliest first, at most `budget` items. preferences.alertEnabled is the
 * same master switch as for meeting alerts. A task with broken time data is skipped, never thrown.
 */
export function computeTaskReminderPlan(
  tasks: readonly Task[],
  preferences: Preferences,
  now: Date,
  options: { budget?: number; horizonDays?: number } = {},
): TaskReminderItem[] {
  if (!preferences.alertEnabled) return [];
  const budget = Math.max(0, Math.floor(options.budget ?? TASK_REMINDER_BUDGET));
  const nowMs = now.getTime();
  const horizonEndMs = nowMs + (options.horizonDays ?? ALERT_HORIZON_DAYS) * DAY_MS;

  const items: TaskReminderItem[] = [];
  for (const task of tasks) {
    if (task.status !== 'open' || task.dueDate === null || task.dueTime === null || task.reminderMinutesBefore === null) {
      continue;
    }
    let dueAt: string;
    try {
      dueAt = zonedDateTimeToUtcIso(task.dueDate, task.dueTime, task.timezone);
    } catch {
      continue;
    }
    const fireMs = Date.parse(dueAt) - task.reminderMinutesBefore * MINUTE_MS;
    if (!Number.isFinite(fireMs) || fireMs <= nowMs || fireMs > horizonEndMs) continue;
    items.push({
      identifier: taskReminderNotificationId(task.id),
      taskId: task.id,
      fireAt: new Date(fireMs).toISOString(),
      dueAt,
      title: task.title,
    });
  }
  items.sort((a, b) => (a.fireAt !== b.fireAt ? (a.fireAt < b.fireAt ? -1 : 1) : a.identifier < b.identifier ? -1 : 1));
  return items.slice(0, budget);
}

export interface TaskRemindersDeps {
  notifications: Pick<NotificationsPort, 'getScheduled' | 'schedule' | 'cancel'>;
  subscribeTasks(listener: (tasks: Task[]) => void): Unsubscribe;
  /** Rejects while signed out; the plan is then empty (everything is cancelled). */
  getPreferences(): Promise<Preferences>;
  i18n: AlertI18nPort;
  events?: EventBus<AppEventMap>;
  deviceTimeZone?: () => string;
  now?: () => Date;
}

export interface TaskReminders {
  /** Idempotent. Subscribes to tasks, preference and language changes and reconciles. */
  start(): void;
  stop(): void;
}

export function createTaskReminders(deps: TaskRemindersDeps): TaskReminders {
  const events = deps.events ?? appEvents;
  const nowDate = deps.now ?? (() => new Date());
  const deviceZone = deps.deviceTimeZone ?? getDeviceTimeZone;
  let subscriptions: Unsubscribe[] = [];
  let latestTasks: readonly Task[] = [];
  let chain: Promise<void> = Promise.resolve();

  function buildSpec(item: TaskReminderItem, preferences: Preferences): TaskReminderSpec {
    const data: TaskReminderData = { v: 1, kind: 'task', taskId: item.taskId, fireAt: item.fireAt, title: item.title };
    const time = deps.i18n.formatTime(item.dueAt, {
      language: deps.i18n.getLanguage(),
      timeZone: deviceZone(),
      use24Hour: preferences.use24HourClock,
    });
    return {
      identifier: item.identifier,
      kind: 'task',
      taskId: item.taskId,
      fireAt: item.fireAt,
      channelId: channelFor('medium', preferences.vibrationEnabled),
      categoryId: null,
      title: deps.i18n.t('alerts:taskReminder.title'),
      body: deps.i18n.t('alerts:taskReminder.body', { title: item.title, time }),
      sound: 'meeting_chime.wav',
      interruptionLevel: 'timeSensitive',
      androidPriority: 'high',
      vibrate: preferences.vibrationEnabled ? [0, 300, 150, 300] : [],
      sticky: false,
      data,
    };
  }

  async function run(tasks: readonly Task[]): Promise<void> {
    let preferences: Preferences | null = null;
    try {
      preferences = await deps.getPreferences();
    } catch {
      // No session (signed out / ending): plan nothing, cancel everything below.
    }
    const desired = preferences ? computeTaskReminderPlan(tasks, preferences, nowDate()) : [];
    const desiredById = new Map(desired.map((item) => [item.identifier, item]));

    const scheduled = await deps.notifications.getScheduled();
    const kept = new Set<string>();
    for (const record of scheduled) {
      if (!record.identifier.startsWith(`${TASK_NOTIFICATION_ID_PREFIX}:`)) continue;
      const want = desiredById.get(record.identifier);
      const data = (record.data ?? {}) as Partial<TaskReminderData>;
      if (want && data.fireAt === want.fireAt && data.title === want.title) {
        kept.add(record.identifier);
        continue;
      }
      await deps.notifications.cancel(record.identifier);
    }
    if (!preferences) return;
    for (const item of desired) {
      if (kept.has(item.identifier)) continue;
      await deps.notifications.schedule(buildSpec(item, preferences));
    }
  }

  function reconcile(tasks: readonly Task[]): void {
    chain = chain
      .then(() => run(tasks))
      .catch((error: unknown) => {
        log.warn('task reminder reconcile failed', error);
      });
  }

  return {
    start() {
      if (subscriptions.length > 0) return;
      subscriptions = [
        deps.subscribeTasks((tasks) => {
          latestTasks = tasks;
          reconcile(tasks);
        }),
        events.on('preferences:changed', () => reconcile(latestTasks)),
        events.on('language:changed', () => reconcile(latestTasks)),
      ];
    },
    stop() {
      for (const unsubscribe of subscriptions) {
        try {
          unsubscribe();
        } catch {
          // A failing unsubscribe must not keep the others alive.
        }
      }
      subscriptions = [];
    },
  };
}
