/**
 * Daily briefing (V2 Stage 1, week 4; owner: alerts): the optional "here is your day"
 * notification, at a time the user controls. It is the THIRD scheduler and, like task reminders,
 * lives BESIDE the meeting alert engine rather than inside it.
 *
 * - Identifiers use the `mgbrief:` prefix, one per briefing DAY. The engine reconciles `mg:*`
 *   only and taskReminders `mgtask:*` only, so the three can never cancel each other's work.
 * - Two switches: `preferences.alertEnabled` (the same master switch as every other alert) and
 *   `preferences.briefingEnabled`, which is OFF until the user asks for it.
 * - CONTENT IS FIXED AT SCHEDULE TIME. A local notification's text is handed to the OS when it is
 *   scheduled and cannot be recomputed when it fires (there is no push path and no notification
 *   service extension), so the body is rendered now and kept fresh by re-rendering on every
 *   reconcile: a content hash in the payload keeps an identical notification and reschedules a
 *   changed one. The body is deliberately coarse ("3 meetings, first at 09:30") so ordinary edits
 *   do not churn the schedule, and so a body that goes stale between reconciles stays roughly
 *   true.
 * - It fires even on an empty day, with its own "nothing scheduled" wording. The user asked for a
 *   daily briefing: silence on empty days would be indistinguishable from a broken briefing.
 * - The day is anchored in the DEVICE time zone read at reconcile time, not in
 *   `preferences.timezone` (which this app only uses as a default for new meetings and can be
 *   stale). Returning to the foreground re-reconciles, so a flight across zones re-aims the
 *   briefing, and a new day gets scheduled as soon as the app is opened or the background
 *   refresh runs.
 * - Reconciles are serialized on one chain, so overlapping triggers never interleave their
 *   cancel/schedule calls.
 */
import type { Unsubscribe } from '../../core/contracts';
import { appEvents, type AppEventMap, type EventBus } from '../../core/events';
import { BRIEFING_NOTIFICATION_ID_PREFIX, briefingNotificationId, channelFor } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { expandOccurrences } from '../../core/recurrence';
import { addDaysToLocalDate, dayRangeUtc, getDeviceTimeZone, todayInZone, zonedDateTimeToUtcIso } from '../../core/time';
import type { Meeting, Preferences, Task } from '../../core/types';
import type { AlertI18nPort, AlertTextDeps, BriefingData, BriefingSpec, NotificationsPort } from './types';

const log = createLogger('alerts.briefing');

/**
 * How many days are scheduled ahead, today included. Two gives one day of slack: a missed
 * background refresh (Android Doze, iOS throttling) then still leaves tomorrow's briefing armed.
 * It is also a deliberately small slice of the shared OS budget, which meeting alerts (60) and
 * task reminders (20) already share.
 */
export const BRIEFING_DAYS_AHEAD = 2;

/** Meeting titles named in the body; beyond this the body only counts them. */
export const BRIEFING_TITLES_IN_BODY = 2;

export interface BriefingItem {
  identifier: string;
  /** The day this briefing is about, in the device zone ("YYYY-MM-DD"). */
  localDateKey: string;
  /** Fire instant (UTC ISO), strictly in the future. */
  fireAt: string;
  meetingCount: number;
  /** Start of the first meeting that day (UTC ISO), or null when there is none. */
  firstMeetingAt: string | null;
  /** Titles of the first meetings that day, at most BRIEFING_TITLES_IN_BODY. */
  titles: string[];
  /** Open tasks due that day. */
  dueTaskCount: number;
  /** Open tasks whose due date is before that day, still not done. */
  overdueTaskCount: number;
}

/** One meeting instance on a day: a one-off meeting, or one occurrence of a series. */
interface DayInstance {
  startAt: string;
  title: string;
}

function instancesOnDay(meetings: readonly Meeting[], from: string, to: string): DayInstance[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const instances: DayInstance[] = [];
  for (const meeting of meetings) {
    if (meeting.deletedAt !== null || meeting.status === 'cancelled') continue;
    if (meeting.recurrence !== null) {
      // expandOccurrences applies the overrides: a skipped occurrence is absent and a moved one
      // carries its new start, so a briefing never announces a standup that was cancelled.
      let occurrences;
      try {
        occurrences = expandOccurrences(meeting, from, to);
      } catch {
        continue;
      }
      for (const occurrence of occurrences) {
        const startMs = Date.parse(occurrence.startAt);
        if (startMs >= fromMs && startMs < toMs) {
          instances.push({ startAt: occurrence.startAt, title: occurrence.title ?? meeting.title });
        }
      }
      continue;
    }
    const startMs = Date.parse(meeting.startAt);
    if (Number.isFinite(startMs) && startMs >= fromMs && startMs < toMs) {
      instances.push({ startAt: meeting.startAt, title: meeting.title });
    }
  }
  instances.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
  return instances;
}

/**
 * PURE planner: one briefing per day from today to today + daysAhead - 1, each firing at
 * `preferences.briefingTime` in `timeZone`, counting that day's meetings and tasks. Days whose
 * fire instant has already passed are dropped (today's briefing is gone by the afternoon), so the
 * result is naturally 1 or 2 items. A day with broken time data is skipped, never thrown.
 */
export function computeBriefingPlan(
  meetings: readonly Meeting[],
  tasks: readonly Task[],
  preferences: Preferences,
  now: Date,
  timeZone: string,
  options: { daysAhead?: number } = {},
): BriefingItem[] {
  if (!preferences.alertEnabled || !preferences.briefingEnabled) return [];
  const daysAhead = Math.max(0, Math.floor(options.daysAhead ?? BRIEFING_DAYS_AHEAD));
  const nowMs = now.getTime();

  let today: string;
  try {
    today = todayInZone(timeZone, now);
  } catch {
    return [];
  }

  const items: BriefingItem[] = [];
  for (let offset = 0; offset < daysAhead; offset += 1) {
    const localDateKey = addDaysToLocalDate(today, offset);
    let fireAt: string;
    let range: { from: string; to: string };
    try {
      fireAt = zonedDateTimeToUtcIso(localDateKey, preferences.briefingTime, timeZone);
      range = dayRangeUtc(localDateKey, timeZone);
    } catch {
      continue;
    }
    if (Date.parse(fireAt) <= nowMs) continue;

    const instances = instancesOnDay(meetings, range.from, range.to);
    const open = tasks.filter((task) => task.status === 'open' && task.dueDate !== null);
    items.push({
      identifier: briefingNotificationId(localDateKey),
      localDateKey,
      fireAt,
      meetingCount: instances.length,
      firstMeetingAt: instances[0]?.startAt ?? null,
      titles: instances.slice(0, BRIEFING_TITLES_IN_BODY).map((instance) => instance.title),
      dueTaskCount: open.filter((task) => task.dueDate === localDateKey).length,
      overdueTaskCount: open.filter((task) => (task.dueDate ?? '') < localDateKey).length,
    });
  }
  items.sort((a, b) => (a.fireAt < b.fireAt ? -1 : a.fireAt > b.fireAt ? 1 : 0));
  return items;
}

/** 32-bit FNV-1a over the visible content: a changed body reschedules, an identical one is kept. */
function hashContent(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  const text = parts.join('\u0000');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * PURE renderer. The body is built from at most two short sentences (meetings, then tasks) so it
 * stays readable in a collapsed notification, and from the counts rather than the full list so
 * that editing one meeting title does not reschedule the briefing.
 */
export function renderBriefingSpec(item: BriefingItem, preferences: Preferences, deps: AlertTextDeps): BriefingSpec {
  const { t } = deps;
  const sentences: string[] = [];

  if (item.meetingCount > 0) {
    const time =
      item.firstMeetingAt === null
        ? ''
        : deps.formatTime(item.firstMeetingAt, {
            language: deps.language,
            timeZone: deps.timeZone,
            use24Hour: deps.use24Hour,
          });
    sentences.push(
      t('alerts:briefing.meetings', {
        count: item.meetingCount,
        time,
        titles: item.titles.join(', '),
      }),
    );
  }
  if (item.dueTaskCount > 0) sentences.push(t('alerts:briefing.tasksDue', { count: item.dueTaskCount }));
  if (item.overdueTaskCount > 0) sentences.push(t('alerts:briefing.tasksOverdue', { count: item.overdueTaskCount }));

  const body = sentences.length > 0 ? sentences.join(' ') : t('alerts:briefing.empty');
  const title = t('alerts:briefing.title');
  const data: BriefingData = {
    v: 1,
    kind: 'briefing',
    localDateKey: item.localDateKey,
    fireAt: item.fireAt,
    hash: hashContent([title, body]),
  };
  return {
    identifier: item.identifier,
    kind: 'briefing',
    localDateKey: item.localDateKey,
    fireAt: item.fireAt,
    channelId: channelFor('briefing', preferences.vibrationEnabled),
    categoryId: null,
    title,
    body,
    sound: 'default',
    interruptionLevel: 'active',
    androidPriority: 'default',
    vibrate: preferences.vibrationEnabled ? [0, 200] : [],
    sticky: false,
    data,
  };
}

export interface BriefingDeps {
  notifications: Pick<NotificationsPort, 'getScheduled' | 'schedule' | 'cancel'>;
  /** Rejects while signed out; the plan is then empty (everything is cancelled). */
  getPreferences(): Promise<Preferences>;
  /** Meetings around today; may include cancelled and deleted ones (they are filtered out). */
  listMeetings(range: { from: string; to: string }): Promise<Meeting[]>;
  listTasks(): Promise<Task[]>;
  /** Trigger only (the plan is re-read in run): every local write, sync and session change. */
  subscribeTasks(listener: (tasks: Task[]) => void): Unsubscribe;
  i18n: AlertI18nPort;
  events?: EventBus<AppEventMap>;
  /** 'active' re-reconciles, so the date rolls over and a zone change re-aims the briefing. */
  appState?: { subscribe(listener: (state: string) => void): Unsubscribe };
  deviceTimeZone?: () => string;
  now?: () => Date;
}

export interface BriefingScheduler {
  /** Idempotent. Subscribes to the events that can change the briefing and reconciles once. */
  start(): void;
  stop(): void;
  /** Reconcile now (the background refresh calls this while the app is closed). */
  reconcile(): Promise<void>;
}

export function createBriefingScheduler(deps: BriefingDeps): BriefingScheduler {
  const events = deps.events ?? appEvents;
  const nowDate = deps.now ?? (() => new Date());
  const deviceZone = deps.deviceTimeZone ?? getDeviceTimeZone;
  let subscriptions: Unsubscribe[] = [];
  let chain: Promise<void> = Promise.resolve();

  function textDeps(preferences: Preferences, timeZone: string): AlertTextDeps {
    return {
      t: deps.i18n.t,
      formatTime: deps.i18n.formatTime,
      language: deps.i18n.getLanguage(),
      timeZone,
      use24Hour: preferences.use24HourClock,
      vibrationEnabled: preferences.vibrationEnabled,
    };
  }

  async function run(): Promise<void> {
    let preferences: Preferences | null = null;
    try {
      preferences = await deps.getPreferences();
    } catch {
      // No session (signed out or ending): plan nothing, cancel everything below.
    }

    const timeZone = deviceZone();
    let desired: BriefingItem[] = [];
    if (preferences !== null && preferences.alertEnabled && preferences.briefingEnabled) {
      const now = nowDate();
      // Read a window wide enough for every day being scheduled, then let the planner cut it to
      // each local day. Reading per day would multiply the work for no gain.
      const today = todayInZone(timeZone, now);
      const range = {
        from: dayRangeUtc(today, timeZone).from,
        to: dayRangeUtc(addDaysToLocalDate(today, BRIEFING_DAYS_AHEAD), timeZone).from,
      };
      const [meetings, tasks] = await Promise.all([deps.listMeetings(range), deps.listTasks()]);
      desired = computeBriefingPlan(meetings, tasks, preferences, now, timeZone);
    }

    const specs = preferences === null ? [] : desired.map((item) => renderBriefingSpec(item, preferences, textDeps(preferences, timeZone)));
    const specById = new Map(specs.map((spec) => [spec.identifier, spec]));

    const scheduled = await deps.notifications.getScheduled();
    const kept = new Set<string>();
    for (const record of scheduled) {
      if (!record.identifier.startsWith(`${BRIEFING_NOTIFICATION_ID_PREFIX}:`)) continue;
      const want = specById.get(record.identifier);
      const data = (record.data ?? {}) as Partial<BriefingData>;
      if (want && data.fireAt === want.data.fireAt && data.hash === want.data.hash) {
        kept.add(record.identifier);
        continue;
      }
      await deps.notifications.cancel(record.identifier);
    }
    for (const spec of specs) {
      if (kept.has(spec.identifier)) continue;
      await deps.notifications.schedule(spec);
    }
  }

  function enqueue(): Promise<void> {
    chain = chain.then(() => run()).catch((error: unknown) => {
      log.warn('briefing reconcile failed', error);
    });
    return chain;
  }

  return {
    start() {
      if (subscriptions.length > 0) return;
      subscriptions = [
        events.on('meetings:changed', () => void enqueue()),
        deps.subscribeTasks(() => void enqueue()),
        events.on('preferences:changed', () => void enqueue()),
        events.on('language:changed', () => void enqueue()),
        events.on('session:started', () => void enqueue()),
        events.on('session:ended', () => void enqueue()),
      ];
      if (deps.appState) {
        subscriptions.push(
          deps.appState.subscribe((state) => {
            if (state === 'active') void enqueue();
          }),
        );
      }
      void enqueue();
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
    reconcile() {
      return enqueue();
    },
  };
}
