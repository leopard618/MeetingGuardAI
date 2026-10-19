/**
 * The ongoing "alerts are on" notification (V2 Stage 1; owner: alerts).
 *
 * WHAT IT IS AND IS NOT. It is a permanent, silent notification that tells the user their alerts
 * are armed and when the next meeting is. It is NOT a foreground service and does not keep the
 * app alive: meeting alarms already fire with the app closed, because they are real AlarmManager
 * alarms (modules/mg-fullscreen-alarm) and expo-notifications triggers, both restored after a
 * reboot. This exists because "is it still watching?" is a fair question for an alarm app, and the
 * honest answer is easier to show than to explain.
 *
 * - Its own id (`mgstatus:1`) and its own LOW-importance Android channel, so it is silent, can be
 *   hidden on its own, and is invisible to the other three schedulers.
 * - PRESENTED rather than scheduled, and re-presented whenever the next meeting or the switches
 *   change. A content hash keeps an identical notification instead of re-posting it, so the shade
 *   does not flicker on every reconcile.
 * - Off by default. A permanent notification is an imposition, so the user asks for it in
 *   Settings > Alerts. It is also removed whenever alerts are off, or nobody is signed in.
 */
import type { Unsubscribe } from '../../core/contracts';
import { FEATURES } from '../../core/features';
import { appEvents, type AppEventMap, type EventBus } from '../../core/events';
import { STATUS_NOTIFICATION_ID, channelFor } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { expandOccurrences } from '../../core/recurrence';
import { getDeviceTimeZone } from '../../core/time';
import type { Meeting, Preferences } from '../../core/types';
import type { AlertI18nPort, AlertTextDeps, NotificationsPort, StatusNotificationData, StatusNotificationSpec } from './types';

const log = createLogger('alerts.status');

/** How far ahead the next meeting is looked for; beyond this the body just says alerts are on. */
const LOOKAHEAD_MS = 14 * 86_400_000;

export interface StatusView {
  /** Title of the next meeting, or null when there is none in the lookahead. */
  nextTitle: string | null;
  /** Start of that meeting (UTC ISO), or null. */
  nextStartAt: string | null;
}

/**
 * PURE: the next meeting the user has, occurrences expanded so a repeating meeting shows its next
 * occurrence rather than the series master's first one. Cancelled and deleted meetings are
 * ignored, exactly as they are in the briefing.
 */
export function computeStatusView(meetings: readonly Meeting[], now: Date, options: { lookaheadMs?: number } = {}): StatusView {
  const nowMs = now.getTime();
  const untilMs = nowMs + (options.lookaheadMs ?? LOOKAHEAD_MS);
  const from = new Date(nowMs).toISOString();
  const to = new Date(untilMs).toISOString();

  let bestAt: string | null = null;
  let bestTitle: string | null = null;
  const consider = (startAt: string, title: string): void => {
    const startMs = Date.parse(startAt);
    if (!Number.isFinite(startMs) || startMs < nowMs || startMs > untilMs) return;
    if (bestAt === null || startAt < bestAt) {
      bestAt = startAt;
      bestTitle = title;
    }
  };

  for (const meeting of meetings) {
    if (meeting.deletedAt !== null || meeting.status === 'cancelled') continue;
    if (meeting.recurrence !== null) {
      try {
        for (const occurrence of expandOccurrences(meeting, from, to)) {
          consider(occurrence.startAt, occurrence.title ?? meeting.title);
        }
      } catch {
        // An unusable rule must not cost the user the whole status notification.
      }
      continue;
    }
    consider(meeting.startAt, meeting.title);
  }
  return { nextTitle: bestTitle, nextStartAt: bestAt };
}

function hashContent(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  const text = parts.join('\u0000');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(36);
}


/** PURE renderer. */
export function renderStatusSpec(view: StatusView, preferences: Preferences, deps: AlertTextDeps): StatusNotificationSpec {
  const title = deps.t('alerts:status.title');
  const body =
    view.nextTitle !== null && view.nextStartAt !== null
      ? deps.t('alerts:status.next', {
          title: view.nextTitle,
          time: deps.formatTime(view.nextStartAt, {
            language: deps.language,
            timeZone: deps.timeZone,
            use24Hour: deps.use24Hour,
          }),
        })
      : deps.t('alerts:status.idle');
  const data: StatusNotificationData = { v: 1, kind: 'status', hash: hashContent([title, body]) };
  return {
    identifier: STATUS_NOTIFICATION_ID,
    channelId: channelFor('status', preferences.vibrationEnabled),
    title,
    body,
    data,
  };
}

export interface StatusNotificationDeps {
  notifications: Pick<NotificationsPort, 'getScheduled' | 'getPresented' | 'present' | 'cancel' | 'dismiss'>;
  /** Rejects while signed out; the notification is then removed. */
  getPreferences(): Promise<Preferences>;
  listMeetings(range: { from: string; to: string }): Promise<Meeting[]>;
  i18n: AlertI18nPort;
  events?: EventBus<AppEventMap>;
  appState?: { subscribe(listener: (state: string) => void): Unsubscribe };
  deviceTimeZone?: () => string;
  now?: () => Date;
}

export interface StatusNotification {
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
}

export function createStatusNotification(deps: StatusNotificationDeps): StatusNotification {
  const events = deps.events ?? appEvents;
  const nowDate = deps.now ?? (() => new Date());
  const deviceZone = deps.deviceTimeZone ?? getDeviceTimeZone;
  let subscriptions: Unsubscribe[] = [];
  let chain: Promise<void> = Promise.resolve();
  let shownHash: string | null = null;

  async function remove(): Promise<void> {
    shownHash = null;
    // It may be sitting in the shade (presented) or, after a restart, nowhere at all.
    await deps.notifications.dismiss(STATUS_NOTIFICATION_ID);
    await deps.notifications.cancel(STATUS_NOTIFICATION_ID);
  }

  async function run(): Promise<void> {
    let preferences: Preferences | null = null;
    try {
      preferences = await deps.getPreferences();
    } catch {
      // No session: remove it below.
    }
    if (!FEATURES.statusNotification || preferences === null || !preferences.alertEnabled || !preferences.statusNotificationEnabled) {
      await remove();
      return;
    }

    const now = nowDate();
    const range = { from: new Date(now.getTime()).toISOString(), to: new Date(now.getTime() + LOOKAHEAD_MS).toISOString() };
    const meetings = await deps.listMeetings(range);
    const spec = renderStatusSpec(computeStatusView(meetings, now), preferences, {
      t: deps.i18n.t,
      formatTime: deps.i18n.formatTime,
      language: deps.i18n.getLanguage(),
      timeZone: deviceZone(),
      use24Hour: preferences.use24HourClock,
      vibrationEnabled: preferences.vibrationEnabled,
    });

    // Re-presenting an identical notification would rebuild it in the shade for no reason; and
    // after a restart it is gone from the OS, so a remembered hash alone is not enough.
    const presented = await deps.notifications.getPresented();
    const isShowing = presented.some((record) => record.identifier === STATUS_NOTIFICATION_ID);
    if (isShowing && shownHash === spec.data.hash) return;
    await deps.notifications.present(spec);
    shownHash = spec.data.hash;
  }

  function enqueue(): Promise<void> {
    chain = chain.then(() => run()).catch((error: unknown) => {
      log.warn('status notification refresh failed', error);
    });
    return chain;
  }

  return {
    start() {
      if (subscriptions.length > 0) return;
      subscriptions = [
        events.on('meetings:changed', () => void enqueue()),
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
    refresh() {
      return enqueue();
    },
  };
}
