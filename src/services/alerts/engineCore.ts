/**
 * Alert engine (owner: alerts), dependency-injected so it is unit-testable without Expo.
 * engine.ts wires the real ports (expo-notifications, data, i18n, AppState, AsyncStorage).
 *
 * OS notifications are the source of truth:
 * - reconcile() diffs getAllScheduledNotificationsAsync() (mg:* ids only) against
 *   computeAlertPlan() and cancels / schedules the difference (never cancel-all-then-refill).
 *   It is serialized + debounced, and a failure to load meetings/preferences aborts WITHOUT
 *   touching the schedule (an error is never treated as "no meetings").
 * - Snoozes ("mg:{id}:snooze") are validated against the meeting and kept; planned alerts within
 *   2 minutes of a pending snooze are dropped (no duplicate), and snoozes count against the budget.
 * - While a host (AlertHost) is attached and the app is in the foreground, delivered notifications
 *   and an in-app timer (exact, even when Android alarms are inexact) produce ActiveAlerts; the
 *   registry ("<id>@<fireAt>") makes sure each delivery is shown once.
 * - Notification actions: snooze is handled here (foreground listener, cold start and the Android
 *   background task) with de-duplication of the same response; taps / open / assistant are routed
 *   by navigation through data.url.
 * - Android + mg-fullscreen-alarm module (deps.fsi; contract in ./fsi.ts): MAX alerts are routed
 *   to native full-screen alarms and excluded from the expo set before the diff - one path per
 *   identifier, with an expo fallback in the same reconcile when the module cannot take them.
 */
import type {
  ActiveAlert,
  AlertEngine,
  AlertEngineStatus,
  AlertPermissionStatus,
  AlertPlan,
  FullScreenAlarmModule,
  FullScreenAlarmSpec,
  FullScreenAlarmStatus,
  ReconcileReason,
  ReconcileResult,
  ScheduledAlertInfo,
  Unsubscribe,
} from '../../core/contracts';
import { AppError, toAppError, type AppErrorCode } from '../../core/errors';
import type { AppEventMap, EventBus } from '../../core/events';
import {
  ALERT_HORIZON_DAYS,
  ALERT_NOTIFICATION_BUDGET,
  NOTIFICATION_ACTIONS,
  NOTIFICATION_CATEGORIES,
  REFILL_NOTIFICATION_ID,
  SUPERSEDED_ANDROID_CHANNELS,
  USER_STORAGE,
  channelFor,
  parseNotificationId,
  snoozeNotificationId,
  userStorageKey,
  type ParsedNotificationId,
} from '../../core/identifiers';
import type { Logger } from '../../core/logger';
import { DEFAULT_PREFERENCES, DEFAULT_SNOOZE_MINUTES, type PreferenceKey } from '../../core/types';
import {
  CHANNEL_VIBRATION,
  FOREGROUND_SWEEP_DELAY_MS,
  HANDLED_RESPONSES_MAX,
  HANDLED_RESPONSES_STORAGE_KEY,
  LEGACY_CHANNEL_IDS,
  MAX_TIMER_DELAY_MS,
  MIN_SCHEDULE_LEAD_MS,
  PRESENTED_CLEANUP_AFTER_END_MS,
  PRESENTED_RESHOW_WINDOW_MS,
  RECONCILE_DEBOUNCE_MS,
  SNOOZE_DEDUPE_WINDOW_MS,
  ALARM_SOUND_FILE,
  CHIME_SOUND_FILE,
  parseSnoozeAction,
  snoozeActionId,
  snoozeChoices,
} from './constants';
import { createCoalescingRunner } from './coalescer';
import {
  meetingJoinUrl,
  meetingLocationText,
  parseAlertData,
  parseRefillData,
  renderPlanItem,
  renderRefillSpec,
  renderSnoozeSpec,
  summarizeMeeting,
  summaryFromAlertData,
} from './content';
import { diffNotifications, isLegacyNotification, snoozeEntries, toScheduledEntries, type ScheduledEntry } from './diff';
import { computeAlertPlan, isAlertEligibleMeeting, meetingEndMs, occurrenceEffective } from './plan';
import {
  emptyRegistry,
  hasFired,
  isAcknowledged,
  markAcknowledged,
  markFired,
  mergeRegistries,
  parseRegistry,
  pruneRegistry,
  registryKey,
  serializeRegistry,
  withLastReconcile,
  type AlertRegistryState,
} from './registry';
import type {
  ActiveAlertView,
  AlertDataPort,
  AlertI18nPort,
  AlertIntensity,
  AlertNotificationSpec,
  AlertPresentationPrefs,
  AlertSettingsPort,
  AlertTextDeps,
  AppStatePort,
  CategorySpec,
  ChannelSpec,
  FeedbackPort,
  IncomingNotification,
  IncomingResponse,
  KeyValueStorage,
  Meeting,
  MeetingSummary,
  NotificationKind,
  NotificationPresentation,
  NotificationsPort,
  Preferences,
  ResolveAction,
  ScheduledSpec,
  StoredAlertData,
  TimerPort,
} from './types';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Meetings that started this long ago can still need a follow-up / snooze. */
const LOOKBACK_MS = 2 * DAY_MS;
/** Largest alert offset is 7 days (AI_LIMITS.maxAlertMinutes): load that far past the horizon. */
const LOOKAHEAD_EXTRA_DAYS = 8;
const REGISTRY_SAVE_DELAY_MS = 500;
/** The in-app timer presents an alert at most this late (older ones fired while in the background). */
const IN_APP_LATE_WINDOW_MS = 5 * MINUTE_MS;
const EMPTY_PLAN: AlertPlan = { items: [], truncated: false, refillBefore: null, refillReminderAt: null };

/** Reasons that skip the debounce. */
const IMMEDIATE_REASONS: ReadonlySet<ReconcileReason> = new Set<ReconcileReason>([
  'app_start',
  'session_started',
  'background',
  'manual',
  'snooze',
  'permission_changed',
]);

/** Preference keys that change what is scheduled or how it is rendered. */
const ALERT_PREFERENCE_KEYS: ReadonlySet<PreferenceKey> = new Set<PreferenceKey>([
  'alertEnabled',
  'alertIntensity',
  'defaultAlertTimes',
  'followUpEnabled',
  'snoozeMinutes',
  'use24HourClock',
  'timezone',
  // Picks the vibration / no-vibration channel of every notification.
  'vibrationEnabled',
]);

export interface AlertEngineDeps {
  notifications: NotificationsPort;
  data: AlertDataPort;
  i18n: AlertI18nPort;
  settings: AlertSettingsPort;
  appState: AppStatePort;
  storage: KeyValueStorage;
  feedback: FeedbackPort;
  events: EventBus<AppEventMap>;
  logger: Logger;
  deviceTimeZone(): string;
  now?: () => Date;
  timers?: TimerPort;
  debounceMs?: number;
  /**
   * Full-screen alarm module (Android; src/services/alerts/fsi.ts). When present, available and
   * permitted, MAX alerts are routed to native AlarmManager alarms instead of expo-notifications
   * (contract in fsi.ts). Absent everywhere else: nothing changes.
   */
  fsi?: FullScreenAlarmModule;
}

export interface ResolveOptions {
  /** Snooze length for action 'snooze' (default Preferences.snoozeMinutes). */
  snoozeMinutes?: number;
}

export interface ResponseOptions {
  /**
   * Signed-in user when no alert session runs (Android headless task): their cached preferences
   * give the snooze length and the language/clock of the snooze notification.
   */
  uid?: string | null;
}

/** AlertEngine + the extras used by AlertHost, usePendingAlerts and the headless tasks. */
export interface AlertEngineImpl extends AlertEngine {
  subscribeActiveAlerts(listener: (alerts: ActiveAlertView[]) => void): Unsubscribe;
  resolveActiveAlert(key: string, action: ResolveAction, options?: ResolveOptions): Promise<void>;
  /**
   * Handles a notification response: any response acknowledges the delivery and removes it from
   * the tray; snooze actions reschedule it.
   */
  handleNotificationResponse(response: IncomingResponse, via: 'foreground' | 'background', options?: ResponseOptions): Promise<void>;
  /** Installs the foreground presentation handler (idempotent; safe at module scope). */
  installPresentationHandler(): void;
  /** Called after every reconcile / permission refresh (usePendingAlerts). */
  subscribeStatus(listener: () => void): Unsubscribe;
  /** [default, longer] snooze lengths in minutes. */
  getSnoozeChoices(): [number, number];
  getActiveAlerts(): ActiveAlertView[];
}

interface InAppItem {
  identifier: string;
  kind: NotificationKind;
  meetingId: string;
  offsetMinutes: number | null;
  fireAt: string;
  intensity: AlertIntensity;
  data: StoredAlertData | null;
}

const defaultTimers: TimerPort = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Occurrence date key of a notification: from its 4-part identifier, else from its payload
 * (a snooze keeps its 3-part id but carries the snoozed occurrence's key in the payload).
 */
function occurrenceKeyOf(identifier: string, payload: StoredAlertData | null): string | undefined {
  const parsed = parseNotificationId(identifier);
  if (parsed !== null && parsed.kind !== 'snooze' && parsed.localDateKey !== undefined) return parsed.localDateKey;
  return payload?.localDateKey;
}

/** Native alarm of a rendered MAX alert (the id IS the notification identifier). */
function toFullScreenAlarmSpec(spec: AlertNotificationSpec): FullScreenAlarmSpec {
  return {
    id: spec.identifier,
    atMs: Date.parse(spec.fireAt),
    title: spec.title,
    body: spec.body,
    deepLink: spec.data.url,
    channelId: spec.channelId,
  };
}

/** Pending-list entry of a MAX alert routed to the full-screen alarm module. */
function toFsiScheduledInfo(spec: AlertNotificationSpec): ScheduledAlertInfo {
  return {
    identifier: spec.identifier,
    meetingId: spec.meetingId,
    ...(spec.data.localDateKey !== undefined ? { localDateKey: spec.data.localDateKey } : {}),
    kind: spec.kind,
    offsetMinutes: spec.data.offsetMinutes,
    fireAt: spec.fireAt,
    intensity: spec.intensity,
  };
}

function presentationPrefs(prefs: Preferences): AlertPresentationPrefs {
  return {
    soundType: prefs.alertSoundType,
    volume: prefs.alertVolume,
    vibrationEnabled: prefs.vibrationEnabled,
    snoozeMinutes: prefs.snoozeMinutes,
    use24HourClock: prefs.use24HourClock,
  };
}

export function createAlertEngine(deps: AlertEngineDeps): AlertEngineImpl {
  const { notifications, data, i18n, settings, appState, storage, feedback, events, logger: log } = deps;
  const timers = deps.timers ?? defaultTimers;
  const clock = deps.now ?? (() => new Date());

  // ---- state -------------------------------------------------------------------------------
  let initPromise: Promise<void> | null = null;
  let initialized = false;
  let handlerInstalled = false;
  let listenersAttached = false;
  let setupDone = false;
  let sessionUid: string | null = null;
  let generation = 0;
  let registry: AlertRegistryState = emptyRegistry();
  let registryUid: string | null = null;
  let registrySaveTimer: unknown = null;
  let lastPrefs: Preferences | null = null;
  let meetingCache = new Map<string, Meeting>();
  let inAppQueue: InAppItem[] = [];
  /** MAX alerts currently handed to the full-screen alarm module (mirrors its declarative set). */
  let fsiScheduled: ScheduledAlertInfo[] = [];
  let active: ActiveAlertView[] = [];
  const activeListeners = new Set<(alerts: ActiveAlertView[]) => void>();
  const statusListeners = new Set<() => void>();
  let lastReconcileAt: string | null = null;
  let lastReconcileError: AppErrorCode | null = null;
  let inAppTimer: unknown = null;
  let sweepTimer: unknown = null;
  const pendingReasons = new Set<ReconcileReason>();
  /**
   * Set after the exact-alarm settings screen was opened: Android keeps alarms that were set while
   * the permission was denied inexact, so the next foreground reconcile reschedules everything.
   */
  let forceRescheduleOnForeground = false;
  const handledResponsesMemory = new Set<string>();
  let handledResponsesPersisted: string[] | null = null;

  // ---- small helpers -----------------------------------------------------------------------
  const nowDate = (): Date => clock();

  function prefsOrDefault(): Preferences {
    return lastPrefs ?? { ...DEFAULT_PREFERENCES, defaultAlertTimes: [...DEFAULT_PREFERENCES.defaultAlertTimes] };
  }

  /**
   * Rendering deps. In the foreground the UI language is authoritative (it switches instantly and
   * preferences follow). With no alert session (Android headless task / background refresh) no
   * React tree restored the user's choice, so the notification text follows the preferences'
   * language instead of whatever the device language is.
   */
  function textDeps(prefs: Preferences | null, options: { headless?: boolean } = {}): AlertTextDeps {
    const language = options.headless && prefs ? prefs.language : i18n.getLanguage();
    const t: AlertTextDeps['t'] =
      language === i18n.getLanguage() ? i18n.t : (key, tOptions) => i18n.t(key, { ...(tOptions ?? {}), lng: language });
    return {
      t,
      formatTime: i18n.formatTime,
      language,
      timeZone: deps.deviceTimeZone(),
      use24Hour: prefs?.use24HourClock ?? null,
      vibrationEnabled: prefs?.vibrationEnabled ?? true,
    };
  }

  function notifyActive(): void {
    const snapshot = [...active];
    activeListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        log.error('active alert listener failed', error);
      }
    });
  }

  function notifyStatus(): void {
    statusListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        log.error('status listener failed', error);
      }
    });
  }

  function hostAttached(): boolean {
    return activeListeners.size > 0;
  }

  // ---- registry persistence ---------------------------------------------------------------
  function scheduleRegistrySave(): void {
    if (!registryUid || registrySaveTimer !== null) return;
    registrySaveTimer = timers.setTimeout(() => {
      registrySaveTimer = null;
      const uid = registryUid;
      if (!uid) return;
      registry = pruneRegistry(registry, nowDate());
      storage.setItem(userStorageKey(uid, USER_STORAGE.alerts), serializeRegistry(registry)).catch((error: unknown) => {
        log.warn('could not persist the alert registry', error);
      });
    }, REGISTRY_SAVE_DELAY_MS);
  }

  function updateRegistry(next: AlertRegistryState): void {
    if (next === registry) return;
    registry = next;
    scheduleRegistrySave();
  }

  async function loadRegistry(uid: string): Promise<AlertRegistryState> {
    try {
      return parseRegistry(await storage.getItem(userStorageKey(uid, USER_STORAGE.alerts)));
    } catch (error) {
      log.warn('could not read the alert registry', error);
      return emptyRegistry();
    }
  }

  // ---- handled responses (snooze de-duplication) -------------------------------------------
  /** true the first time a response key is seen (memory + device storage); false for duplicates. */
  async function claimResponse(key: string): Promise<boolean> {
    if (handledResponsesMemory.has(key)) return false;
    handledResponsesMemory.add(key);
    if (handledResponsesPersisted === null) {
      try {
        const raw = await storage.getItem(HANDLED_RESPONSES_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        handledResponsesPersisted = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
      } catch (error) {
        log.warn('could not read handled notification responses', error);
        handledResponsesPersisted = [];
      }
    }
    if (handledResponsesPersisted.includes(key)) return false;
    handledResponsesPersisted = [...handledResponsesPersisted, key].slice(-HANDLED_RESPONSES_MAX);
    try {
      await storage.setItem(HANDLED_RESPONSES_STORAGE_KEY, JSON.stringify(handledResponsesPersisted));
    } catch (error) {
      log.warn('could not persist handled notification responses', error);
    }
    return true;
  }

  // ---- channels + categories ---------------------------------------------------------------
  /**
   * Every channel exists with and without vibration (channels are immutable, so the vibration
   * preference picks the channel). Lock-screen visibility is PRIVATE everywhere: Android then
   * follows the user's "hide sensitive content" setting (meeting titles and addresses can come
   * from third-party invitations). The in-app AlertHost shows the full details once unlocked.
   */
  function channelSpecs(): ChannelSpec[] {
    const { t } = i18n;
    const kinds = [
      { kind: 'max', importance: 'max', sound: ALARM_SOUND_FILE, bypassDnd: true, alarmUsage: true },
      { kind: 'medium', importance: 'high', sound: CHIME_SOUND_FILE, bypassDnd: false, alarmUsage: false },
      { kind: 'light', importance: 'default', sound: CHIME_SOUND_FILE, bypassDnd: false, alarmUsage: false },
      { kind: 'followup', importance: 'default', sound: 'default', bypassDnd: false, alarmUsage: false },
    ] as const;
    const specs: ChannelSpec[] = [];
    for (const vibration of [true, false]) {
      for (const item of kinds) {
        const name = t(`alerts:channels.${item.kind}.name`);
        specs.push({
          id: channelFor(item.kind, vibration),
          name: vibration ? name : t('alerts:channels.noVibrationName', { name }),
          description: t(`alerts:channels.${item.kind}.description`),
          importance: item.importance,
          sound: item.sound,
          vibrationPattern: vibration ? [...CHANNEL_VIBRATION[item.kind]] : [],
          bypassDnd: item.bypassDnd,
          lockscreenPublic: false,
          alarmUsage: item.alarmUsage,
        });
      }
    }
    return specs;
  }

  function categorySpecs(): CategorySpec[] {
    const { t } = i18n;
    const [short, long] = snoozeChoices(prefsOrDefault().snoozeMinutes);
    return [
      {
        id: NOTIFICATION_CATEGORIES.alert,
        actions: [
          { id: NOTIFICATION_ACTIONS.open, title: t('alerts:actions.open'), opensApp: true },
          { id: snoozeActionId(null), title: t('alerts:actions.snooze', { count: short }), opensApp: false },
          { id: snoozeActionId(long), title: t('alerts:actions.snooze', { count: long }), opensApp: false },
        ],
      },
      {
        id: NOTIFICATION_CATEGORIES.followup,
        actions: [{ id: NOTIFICATION_ACTIONS.assistant, title: t('alerts:actions.assistant'), opensApp: true }],
      },
    ];
  }

  async function setupChannelsAndCategories(): Promise<void> {
    try {
      await notifications.setChannels(channelSpecs());
      await notifications.setCategories(categorySpecs());
      setupDone = true;
    } catch (error) {
      setupDone = false;
      log.error('could not register notification channels/categories', error);
    }
  }

  async function removeLegacyArtifacts(): Promise<void> {
    try {
      // Pre-rebuild channels + earlier MeetingGuard channel versions (their pending notifications
      // carry a different channel in their hash and are rescheduled by the next reconcile).
      await notifications.deleteChannels([...LEGACY_CHANNEL_IDS, ...SUPERSEDED_ANDROID_CHANNELS]);
      const presented = await notifications.getPresented();
      for (const record of presented) {
        if (isLegacyNotification(record.identifier, record.data)) await notifications.dismiss(record.identifier);
      }
    } catch (error) {
      log.warn('could not remove legacy notification artefacts', error);
    }
  }

  // ---- presentation handler (foreground) ----------------------------------------------------
  function decidePresentation(notification: IncomingNotification): NotificationPresentation {
    const show: NotificationPresentation = {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
    // The refill reminder only matters while the app is closed: in the foreground the app
    // reconciles right away instead (received listener).
    if (notification.identifier === REFILL_NOTIFICATION_ID) {
      return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
    }
    if (!parseNotificationId(notification.identifier) || !hostAttached()) return show;
    const payload = parseAlertData(notification.data);
    const key = registryKey(notification.identifier, payload?.fireAt ?? new Date(notification.date).toISOString());
    if (hasFired(registry, key)) {
      // Already shown in-app by the timer: do not show it a second time.
      return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
    }
    // AlertHost presents it (MAX modal / MEDIUM banner / LIGHT toast) with its own sound.
    return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  }

  function installPresentationHandler(): void {
    if (handlerInstalled) return;
    handlerInstalled = true;
    notifications.setPresentationHandler(decidePresentation);
  }

  // ---- active alerts -------------------------------------------------------------------------
  async function resolveMeeting(meetingId: string): Promise<Meeting | null> {
    const cached = meetingCache.get(meetingId);
    if (cached) return cached;
    if (!data.getActiveUid()) return null;
    try {
      const meeting = await data.getMeeting(meetingId);
      if (meeting) meetingCache.set(meeting.id, meeting);
      return meeting;
    } catch (error) {
      log.warn(`could not load meeting ${meetingId} for an alert`, error);
      return null;
    }
  }

  async function buildActiveView(
    item: { identifier: string; kind: NotificationKind; meetingId: string; offsetMinutes: number | null; intensity: AlertIntensity | null },
    payload: StoredAlertData | null,
  ): Promise<ActiveAlertView | null> {
    const meeting = await resolveMeeting(item.meetingId);
    if (meeting && !isAlertEligibleMeeting(meeting)) return null; // deleted / cancelled since scheduling
    if (!meeting && !payload) return null;
    // Occurrence of a recurring meeting: show the OCCURRENCE's live values (a cancelled occurrence
    // is withdrawn like a deleted meeting; the payload snapshot covers a meeting that is gone).
    const occurrenceKey = occurrenceKeyOf(item.identifier, payload);
    const occurrence = meeting && occurrenceKey !== undefined ? occurrenceEffective(meeting, occurrenceKey) : null;
    if (meeting && meeting.recurrence !== null && occurrenceKey !== undefined && occurrence === null) return null;
    const prefs = prefsOrDefault();
    const intensity = item.intensity ?? meeting?.alertIntensity ?? prefs.alertIntensity;
    const base: ActiveAlert = {
      key: item.identifier,
      meetingId: item.meetingId,
      kind: item.kind,
      intensity,
      offsetMinutes: item.offsetMinutes,
      meeting,
      firedAt: nowDate().toISOString(),
    };
    // For occurrence items the payload beats the master meeting (its startAt is the master's
    // FIRST occurrence, not this one); for one-offs the live meeting beats the stale payload.
    const preferPayload = occurrenceKey !== undefined;
    return {
      ...base,
      title: occurrence?.title ?? (preferPayload ? (payload?.title ?? meeting?.title) : (meeting?.title ?? payload?.title)) ?? '',
      startAt:
        occurrence?.startAt ??
        (preferPayload ? (payload?.startAt ?? meeting?.startAt) : (meeting?.startAt ?? payload?.startAt)) ??
        base.firedAt,
      durationMinutes:
        occurrence?.durationMinutes ??
        (preferPayload ? (payload?.durationMinutes ?? meeting?.durationMinutes) : (meeting?.durationMinutes ?? payload?.durationMinutes)) ??
        60,
      language: meeting?.language ?? payload?.language ?? i18n.getLanguage(),
      joinUrl: meeting ? meetingJoinUrl(meeting) : null,
      locationText: meeting ? safeLocationText(meeting) : null,
      prefs: presentationPrefs(prefs),
    };
  }

  function safeLocationText(meeting: Meeting): string | null {
    try {
      return meetingLocationText(meeting, i18n.t);
    } catch (error) {
      log.warn('could not render the meeting location', error);
      return meeting.location?.address ?? null;
    }
  }

  /** registry key of each active alert (ActiveAlert.key is the notification identifier). */
  const activeRegistryKeys = new Map<string, string>();

  function pushActive(view: ActiveAlertView, regKey: string): void {
    const isFollowUp = view.kind === 'followup';
    const superseded = active.filter(
      (alert) => alert.key === view.key || (alert.meetingId === view.meetingId && (alert.kind === 'followup') === isFollowUp),
    );
    for (const alert of superseded) {
      // A newer alert of the same meeting replaces this one: it counts as handled, so the tray
      // sweep never brings it back (with sound) and its sticky tray copy goes away.
      const oldKey = activeRegistryKeys.get(alert.key) ?? registryKey(alert.key, alert.firedAt);
      if (oldKey !== regKey) updateRegistry(markAcknowledged(registry, oldKey, nowDate()));
      // Same identifier = the tray now holds the NEW delivery: keep it.
      if (alert.key !== view.key) void dismissQuietly(alert.key);
      activeRegistryKeys.delete(alert.key);
    }
    active = [...active.filter((alert) => !superseded.includes(alert)), view];
    activeRegistryKeys.set(view.key, regKey);
    notifyActive();
  }

  /** Alerts on screen whose meeting (or occurrence, for a recurring one) was cancelled / deleted since they fired. */
  function withdrawStaleActiveAlerts(): void {
    for (const alert of active) {
      const meeting = meetingCache.get(alert.meetingId);
      if (!meeting) continue;
      const occurrenceKey = occurrenceKeyOf(alert.key, null);
      const occurrenceGone =
        meeting.recurrence !== null && occurrenceKey !== undefined && occurrenceEffective(meeting, occurrenceKey) === null;
      if (!isAlertEligibleMeeting(meeting) || occurrenceGone) {
        removeActive(alert.key);
        void dismissQuietly(alert.key);
      }
    }
  }

  function removeActive(identifier: string): ActiveAlertView | null {
    const found = active.find((alert) => alert.key === identifier) ?? null;
    if (!found) return null;
    active = active.filter((alert) => alert.key !== identifier);
    activeRegistryKeys.delete(identifier);
    notifyActive();
    return found;
  }

  async function presentIncoming(
    notification: IncomingNotification,
    via: 'notification_received' | 'in_app_timer',
    options: { force?: boolean } = {},
  ): Promise<void> {
    const parsed = parseNotificationId(notification.identifier);
    if (!parsed) return;
    const payload = parseAlertData(notification.data);
    const fireAt = payload?.fireAt ?? new Date(notification.date).toISOString();
    const key = registryKey(notification.identifier, fireAt);
    if (!options.force && hasFired(registry, key)) return;
    if (isAcknowledged(registry, key) || !hostAttached()) return;
    updateRegistry(markFired(registry, key, nowDate()));
    const view = await buildActiveView(
      {
        identifier: notification.identifier,
        kind: parsed.kind,
        meetingId: parsed.meetingId,
        offsetMinutes: parsed.kind === 'alert' ? parsed.offsetMinutes : null,
        intensity: payload?.intensity ?? null,
      },
      payload,
    );
    if (!view) {
      await dismissQuietly(notification.identifier);
      return;
    }
    pushActive(view, key);
    events.emit('alerts:fired', {
      uid: sessionUid,
      meetingId: view.meetingId,
      kind: view.kind,
      offsetMinutes: view.offsetMinutes,
      intensity: view.intensity,
      via,
    });
  }

  async function dismissQuietly(identifier: string): Promise<void> {
    try {
      await notifications.dismiss(identifier);
    } catch (error) {
      log.warn(`could not dismiss notification ${identifier}`, error);
    }
  }

  // ---- in-app timer (foreground exactness) ------------------------------------------------------
  function clearInAppTimer(): void {
    if (inAppTimer !== null) timers.clearTimeout(inAppTimer);
    inAppTimer = null;
  }

  function armInAppTimer(): void {
    clearInAppTimer();
    if (!sessionUid || !hostAttached() || appState.current() !== 'active') return;
    const nowMs = nowDate().getTime();
    const next = inAppQueue
      .filter((item) => !hasFired(registry, registryKey(item.identifier, item.fireAt)))
      .map((item) => Date.parse(item.fireAt))
      // Items that fired too long ago (while the app was in the background) are never presented
      // by the timer: arming for them would re-arm at 0 ms forever.
      .filter((at) => Number.isFinite(at) && at > nowMs - IN_APP_LATE_WINDOW_MS)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, next - nowMs));
    inAppTimer = timers.setTimeout(() => {
      inAppTimer = null;
      void onInAppTimer();
    }, delay);
  }

  async function onInAppTimer(): Promise<void> {
    // Only present (and cancel the OS copy) while a host is visible in the foreground.
    if (!sessionUid || !hostAttached() || appState.current() !== 'active') return;
    const nowMs = nowDate().getTime();
    // Drop items that are too late to present (the OS notification covered them).
    inAppQueue = inAppQueue.filter((item) => {
      const at = Date.parse(item.fireAt);
      return Number.isFinite(at) && at > nowMs - IN_APP_LATE_WINDOW_MS;
    });
    const due = inAppQueue.filter((item) => {
      const at = Date.parse(item.fireAt);
      return at <= nowMs + 500 && !hasFired(registry, registryKey(item.identifier, item.fireAt));
    });
    for (const item of due) {
      // The OS copy of an alert shown in-app would only be a late duplicate.
      try {
        await notifications.cancel(item.identifier);
      } catch (error) {
        log.warn(`could not cancel ${item.identifier} after the in-app alert`, error);
      }
      if (deps.fsi?.isAvailable()) {
        // Same for a MAX alert routed to the full-screen alarm module: clearing its id cancels
        // the pending native alarm AND removes an already posted tray copy (race at fire time).
        try {
          await deps.fsi.clearAlarms([item.identifier]);
        } catch (error) {
          log.warn(`could not clear the full-screen alarm ${item.identifier}`, error);
        }
      }
      await presentIncoming({ identifier: item.identifier, date: Date.parse(item.fireAt), data: item.data }, 'in_app_timer');
    }
    inAppQueue = inAppQueue.filter((item) => !due.includes(item));
    armInAppTimer();
    if (due.length > 0) requestReconcile('manual');
  }

  // ---- tray sweep (foreground) -------------------------------------------------------------------
  function scheduleSweep(): void {
    if (sweepTimer !== null) timers.clearTimeout(sweepTimer);
    sweepTimer = timers.setTimeout(() => {
      sweepTimer = null;
      sweepPresented().catch((error: unknown) => log.warn('tray sweep failed', error));
    }, FOREGROUND_SWEEP_DELAY_MS);
  }

  /**
   * Delivered notifications still in the tray: removes stale ones (meeting gone / ended, legacy),
   * and re-shows unhandled MAX/MEDIUM alerts in-app (the user opened the app without tapping).
   */
  async function sweepPresented(): Promise<void> {
    if (!sessionUid) return;
    const presented = await notifications.getPresented();
    const nowMs = nowDate().getTime();
    for (const record of presented) {
      if (isLegacyNotification(record.identifier, record.data)) {
        await dismissQuietly(record.identifier);
        continue;
      }
      const parsed = parseNotificationId(record.identifier);
      if (!parsed) continue;
      const payload = parseAlertData(record.data);
      const meeting = meetingCache.get(parsed.meetingId);
      // Occurrence notifications end when the OCCURRENCE ends (the master's own start can be far
      // in the past for a long-running series); a cancelled occurrence counts as gone.
      const occurrenceKey = occurrenceKeyOf(record.identifier, payload);
      const occurrence = meeting && occurrenceKey !== undefined ? occurrenceEffective(meeting, occurrenceKey) : null;
      const occurrenceGone =
        meeting !== undefined && meeting.recurrence !== null && occurrenceKey !== undefined && occurrence === null;
      const endMs = occurrence
        ? meetingEndMs(occurrence)
        : occurrenceKey !== undefined && payload
          ? meetingEndMs(payload)
          : meeting
            ? meetingEndMs(meeting)
            : payload
              ? meetingEndMs(payload)
              : null;
      const gone = (meeting !== undefined && !isAlertEligibleMeeting(meeting)) || occurrenceGone;
      if (gone || (endMs !== null && nowMs - endMs > PRESENTED_CLEANUP_AFTER_END_MS)) {
        await dismissQuietly(record.identifier);
        continue;
      }
      if (parsed.kind === 'followup' || !payload || payload.intensity === 'light') continue;
      const key = registryKey(record.identifier, payload.fireAt);
      if (isAcknowledged(registry, key)) {
        await dismissQuietly(record.identifier);
        continue;
      }
      if (nowMs - record.date > PRESENTED_RESHOW_WINDOW_MS) continue;
      if (active.some((alert) => alert.key === record.identifier)) continue;
      await presentIncoming(record, 'notification_received', { force: true });
    }
  }

  // ---- reconcile -----------------------------------------------------------------------------------
  function isValidSnooze(entry: ScheduledEntry, nowMs: number): boolean {
    if (!entry.data || !entry.fireAt || Date.parse(entry.fireAt) <= nowMs) return false;
    const meeting = meetingCache.get(entry.data.meetingId);
    if (meeting === undefined || !isAlertEligibleMeeting(meeting)) return false;
    if (meeting.recurrence !== null) {
      const key = entry.data.localDateKey;
      // No occurrence key (engine.snooze() on a series, or a pre-recurrence payload): a snooze
      // lives at most two hours, keep it while it is pending instead of guessing its occurrence.
      if (key === undefined) return true;
      const occurrence = occurrenceEffective(meeting, key);
      return occurrence !== null && occurrence.startAt === entry.data.startAt;
    }
    return meeting.startAt === entry.data.startAt;
  }

  async function runReconcile(): Promise<ReconcileResult> {
    const reasons = [...pendingReasons];
    pendingReasons.clear();
    const forceReschedule = forceRescheduleOnForeground && reasons.includes('foreground');
    if (forceReschedule) forceRescheduleOnForeground = false;
    const gen = generation;
    const allowHeadless = reasons.includes('background');
    const uid = sessionUid ?? (allowHeadless ? data.getActiveUid() : null);
    const skippedResult = (skipped: ReconcileResult['skipped']): ReconcileResult => ({
      scheduled: 0,
      cancelled: 0,
      kept: 0,
      truncated: false,
      skipped,
    });
    if (!uid) return skippedResult('no_session');

    try {
      if (!setupDone) await setupChannelsAndCategories();
      const now = nowDate();
      const nowMs = now.getTime();
      let prefs: Preferences;
      let meetings: Meeting[];
      if (data.getActiveUid() === uid) {
        [prefs, meetings] = await Promise.all([
          data.getPreferences(),
          data.listMeetings({
            from: new Date(nowMs - LOOKBACK_MS).toISOString(),
            to: new Date(nowMs + (ALERT_HORIZON_DAYS + LOOKAHEAD_EXTRA_DAYS) * DAY_MS).toISOString(),
            includeCancelled: true,
            // Tombstones too: an alert on screen for a meeting deleted meanwhile is withdrawn.
            includeDeleted: true,
          }),
        ]);
      } else {
        const cached = await data.getCachedPreferences(uid);
        if (!cached) {
          log.info('reconcile skipped: no cached preferences for a headless run');
          return skippedResult('no_session');
        }
        prefs = cached;
        meetings = await data.getCachedUpcoming(uid, { horizonDays: ALERT_HORIZON_DAYS + LOOKAHEAD_EXTRA_DAYS, now });
      }
      if (gen !== generation) return skippedResult('no_session');
      const headless = sessionUid === null;

      lastPrefs = prefs;
      meetingCache = new Map(meetings.map((meeting) => [meeting.id, meeting]));
      withdrawStaleActiveAlerts();

      const currentPermission = await getPermissionStatus();
      const records = await notifications.getScheduled();
      const existing = toScheduledEntries(records);
      const legacyIds = records.filter((r) => isLegacyNotification(r.identifier, r.data)).map((r) => r.identifier);

      const validSnoozes = prefs.alertEnabled ? snoozeEntries(existing).filter((entry) => isValidSnooze(entry, nowMs)) : [];
      const plan = prefs.alertEnabled
        ? computeAlertPlan(meetings, prefs, now, {
            budget: ALERT_NOTIFICATION_BUDGET - validSnoozes.length,
            suppress: validSnoozes.map((entry) => ({ meetingId: entry.data!.meetingId, fireAt: entry.fireAt! })),
            suppressWindowMs: SNOOZE_DEDUPE_WINDOW_MS,
          })
        : EMPTY_PLAN;

      // Full-screen alarm availability + permission (re-read on EVERY reconcile: the foreground
      // reconcile on AppState 'active' then picks up grants/revocations, like exact alarms).
      const fsi = deps.fsi;
      const fsiAvailable = fsi !== undefined && notifications.platform === 'android' && fsi.isAvailable();
      let fsiStatus: FullScreenAlarmStatus | null = null;
      if (fsiAvailable && fsi) {
        try {
          fsiStatus = await fsi.getStatus();
        } catch (error) {
          log.warn('could not read the full-screen alarm status', error);
        }
      }
      let fsiActive = fsiStatus !== null && fsiStatus.fullScreenAllowed && fsiStatus.notificationsAllowed;

      const text = textDeps(prefs, { headless });
      const desired: AlertNotificationSpec[] = [];
      /** MAX alerts routed to the full-screen alarm module (excluded from the expo set). */
      const fsiRendered: AlertNotificationSpec[] = [];
      /** Planned items due within MIN_SCHEDULE_LEAD_MS: too late to hand to the OS again. */
      const imminent = new Set<string>();
      for (const item of plan.items) {
        const fireMs = Date.parse(item.fireAt);
        // Contract in ./fsi.ts: with the module active, MAX alerts go to AlarmManager. No
        // MIN_SCHEDULE_LEAD_MS exclusion there: re-setting an imminent alarm at the same time is
        // safe (the native side skips already-fired instants), while excluding it would cancel it.
        const routeToFsi = fsiActive && item.kind === 'alert' && item.intensity === 'max' && fireMs > nowMs;
        if (!routeToFsi && fireMs <= nowMs + MIN_SCHEDULE_LEAD_MS) {
          imminent.add(item.identifier);
          continue;
        }
        const meeting = meetingCache.get(item.meetingId);
        if (!meeting) continue;
        let summary = summarizeMeeting(meeting, text.t);
        if (item.localDateKey !== undefined) {
          // Occurrence of a recurring meeting: the text and payload carry the OCCURRENCE's values.
          const occurrence = occurrenceEffective(meeting, item.localDateKey);
          if (occurrence === null) continue; // cancelled between planning and rendering
          summary = {
            ...summary,
            startAt: occurrence.startAt,
            durationMinutes: occurrence.durationMinutes,
            title: occurrence.title,
          };
        }
        const spec = renderPlanItem(item, summary, text);
        if (routeToFsi) fsiRendered.push(spec);
        else desired.push(spec);
      }

      // Full-screen alarm path, BEFORE the expo diff so each identifier is scheduled through
      // exactly one path per reconcile: setAlarms is declarative (replace-all = the module side of
      // the diff), stale expo copies of rerouted ids are cancelled by the ordinary diff below, and
      // stale native alarms disappear with the replace-all (or clearAlarms when FSI deactivates).
      if (fsi && fsiAvailable && gen === generation) {
        if (fsiActive) {
          try {
            await fsi.setAlarms(fsiRendered.map(toFullScreenAlarmSpec));
            fsiScheduled = fsiRendered.map(toFsiScheduledInfo);
          } catch (error) {
            log.warn('full-screen alarms could not be set; falling back to notifications', error);
            fsiActive = false;
          }
        }
        if (!fsiActive) {
          fsiScheduled = [];
          try {
            await fsi.clearAlarms();
          } catch (error) {
            log.warn('full-screen alarms could not be cleared', error);
          }
        }
      }
      if (!fsiActive && fsiRendered.length > 0) {
        // setAlarms failed: the same entries fall back to the expo path in this SAME reconcile.
        for (const spec of fsiRendered) {
          if (Date.parse(spec.fireAt) <= nowMs + MIN_SCHEDULE_LEAD_MS) imminent.add(spec.identifier);
          else desired.push(spec);
        }
      }

      // An already scheduled notification that is about to fire (and is still planned) is kept
      // as it is: cancelling it would lose the alert, and it is too late to schedule a new one.
      const keepImminent = existing.filter((entry) => {
        if (!imminent.has(entry.identifier) || entry.fireAt === null) return false;
        const fireMs = Date.parse(entry.fireAt);
        return fireMs > nowMs && fireMs <= nowMs + MIN_SCHEDULE_LEAD_MS;
      });

      // Forced: every planned notification is re-created (hash mismatch => cancel + schedule).
      const existingForDiff = forceReschedule
        ? existing.map((entry) => (parseNotificationId(entry.identifier)?.kind === 'snooze' ? entry : { ...entry, data: null }))
        : existing;
      const diff = diffNotifications(
        existingForDiff,
        desired,
        new Set([...validSnoozes, ...keepImminent].map((entry) => entry.identifier)),
      );
      const canSchedule =
        currentPermission.notifications === 'granted' || currentPermission.notifications === 'provisional';

      // Refill reminder ("open the app to keep your alerts up to date"), managed outside the diff.
      const refillRecord = records.find((record) => record.identifier === REFILL_NOTIFICATION_ID) ?? null;
      const refillSpec =
        plan.refillReminderAt !== null && Date.parse(plan.refillReminderAt) > nowMs + MIN_SCHEDULE_LEAD_MS
          ? renderRefillSpec(plan.refillReminderAt, text)
          : null;
      const refillKept =
        refillRecord !== null && refillSpec !== null && parseRefillData(refillRecord.data)?.hash === refillSpec.data.hash;
      const cancelIds = [...diff.cancel, ...legacyIds];
      if (refillRecord !== null && !refillKept) cancelIds.push(REFILL_NOTIFICATION_ID);
      const toSchedule: ScheduledSpec[] = [...diff.schedule];
      if (refillSpec !== null && !refillKept) toSchedule.push(refillSpec);

      let cancelled = 0;
      let scheduled = 0;
      const failures: string[] = [];
      for (const identifier of cancelIds) {
        if (gen !== generation) break;
        try {
          await notifications.cancel(identifier);
          cancelled += 1;
        } catch (error) {
          failures.push(identifier);
          log.warn(`could not cancel ${identifier}`, error);
        }
      }
      if (canSchedule) {
        for (const spec of toSchedule) {
          if (gen !== generation) break;
          try {
            await notifications.schedule(spec);
            scheduled += 1;
          } catch (error) {
            failures.push(spec.identifier);
            log.warn(`could not schedule ${spec.identifier}`, error);
          }
        }
      }
      if (gen !== generation) return skippedResult('no_session');

      // In-app timer queue: the plan + kept snoozes.
      const existingById = new Map(existing.map((entry) => [entry.identifier, entry]));
      inAppQueue = [
        ...plan.items.map<InAppItem>((item) => ({
          identifier: item.identifier,
          kind: item.kind,
          meetingId: item.meetingId,
          offsetMinutes: item.offsetMinutes,
          fireAt: item.fireAt,
          intensity: item.intensity,
          data:
            desired.find((spec) => spec.identifier === item.identifier)?.data ??
            fsiRendered.find((spec) => spec.identifier === item.identifier)?.data ??
            existingById.get(item.identifier)?.data ??
            null,
        })),
        ...validSnoozes.map<InAppItem>((entry) => ({
          identifier: entry.identifier,
          kind: 'snooze',
          meetingId: entry.data!.meetingId,
          offsetMinutes: null,
          fireAt: entry.fireAt!,
          intensity: entry.data!.intensity,
          data: entry.data,
        })),
      ];

      lastReconcileAt = now.toISOString();
      lastReconcileError = failures.length > 0 ? 'unknown' : null;
      updateRegistry(withLastReconcile(registry, now));
      if (failures.length > 0) {
        log.error(`reconcile: ${failures.length} notification operation(s) failed`, new AppError('unknown', 'reconcile partial failure', { details: { count: failures.length } }));
      }
      log.debug('reconciled', { reasons, scheduled, cancelled, kept: diff.keep.length, items: plan.items.length });
      armInAppTimer();
      notifyStatus();

      return {
        scheduled,
        cancelled,
        kept: diff.keep.length + (refillKept ? 1 : 0),
        truncated: plan.truncated,
        skipped: !prefs.alertEnabled ? 'alerts_disabled' : canSchedule ? null : 'no_permission',
      };
    } catch (error) {
      const appError = toAppError(error);
      lastReconcileError = appError.code;
      log.error(`reconcile failed (${appError.code})`, appError);
      notifyStatus();
      throw appError;
    }
  }

  const runner = createCoalescingRunner(runReconcile, {
    delayMs: deps.debounceMs ?? RECONCILE_DEBOUNCE_MS,
    timers,
  });

  async function reconcile(reason: ReconcileReason): Promise<ReconcileResult> {
    await init();
    pendingReasons.add(reason);
    return runner.request({ immediate: IMMEDIATE_REASONS.has(reason) });
  }

  /** Fire-and-forget reconcile (errors are logged and kept in the status by runReconcile). */
  function requestReconcile(reason: ReconcileReason): void {
    reconcile(reason).catch(() => undefined);
  }

  // ---- permissions -------------------------------------------------------------------------------
  async function getPermissionStatus(): Promise<AlertPermissionStatus> {
    const raw = await notifications.getPermission();
    const status: AlertPermissionStatus = {
      notifications: raw.provisional ? 'provisional' : raw.status,
      canAskAgain: raw.canAskAgain,
      exactAlarms: settings.exactAlarmSettingsAvailable ? 'unknown' : 'not_required',
    };
    return status;
  }

  // ---- snooze ------------------------------------------------------------------------------------
  /**
   * The preferences a snooze is rendered with: the session's, else the signed-in user's cached
   * ones (headless task: `uidHint` from auth), else null (device defaults).
   */
  async function preferencesForSnooze(uidHint: string | null = null): Promise<Preferences | null> {
    if (lastPrefs) return lastPrefs;
    const uid = sessionUid ?? data.getActiveUid() ?? uidHint;
    if (!uid) return null;
    try {
      return await data.getCachedPreferences(uid);
    } catch (error) {
      log.warn('could not read cached preferences for a snooze', error);
      return null;
    }
  }

  async function defaultSnoozeMinutes(uidHint: string | null = null): Promise<number> {
    return (await preferencesForSnooze(uidHint))?.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES;
  }

  async function findPayloadForMeeting(meetingId: string): Promise<StoredAlertData | null> {
    const pick = (records: { identifier: string; data: unknown }[]): StoredAlertData | null => {
      for (const record of records) {
        const payload = parseAlertData(record.data);
        if (payload && payload.meetingId === meetingId) return payload;
      }
      return null;
    };
    try {
      return pick(await notifications.getPresented()) ?? pick(await notifications.getScheduled());
    } catch (error) {
      log.warn('could not look up notification payloads for a snooze', error);
      return null;
    }
  }

  async function snoozeInternal(
    meetingId: string,
    minutes: number,
    hint: StoredAlertData | null,
    fallback: { summary: MeetingSummary; intensity: AlertIntensity } | null = null,
    renderPrefs: Preferences | null = lastPrefs,
    localDateKey: string | null = null,
  ): Promise<void> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      throw new AppError('invalid_input', `Invalid snooze length: ${minutes}`);
    }
    const meeting = await resolveMeeting(meetingId);
    let summary: MeetingSummary;
    let intensity: AlertIntensity;
    /** Snoozed occurrence of a recurring meeting (kept in the payload for later validation). */
    let occurrenceKey = localDateKey ?? hint?.localDateKey ?? null;
    const prefs = prefsOrDefault();
    if (meeting) {
      if (!isAlertEligibleMeeting(meeting)) {
        throw new AppError('not_found', 'The meeting was deleted or cancelled', { details: { meetingId } });
      }
      summary = summarizeMeeting(meeting, i18n.t);
      if (meeting.recurrence === null) {
        occurrenceKey = null; // the series collapsed to a one-off since: snooze the meeting itself
      } else if (occurrenceKey !== null) {
        const occurrence = occurrenceEffective(meeting, occurrenceKey);
        if (occurrence === null) {
          throw new AppError('not_found', 'The occurrence was cancelled', { details: { meetingId } });
        }
        summary = {
          ...summary,
          startAt: occurrence.startAt,
          durationMinutes: occurrence.durationMinutes,
          title: occurrence.title,
        };
      }
      intensity = meeting.alertIntensity ?? hint?.intensity ?? prefs.alertIntensity;
    } else {
      const payload = hint && hint.meetingId === meetingId ? hint : await findPayloadForMeeting(meetingId);
      if (payload) {
        summary = summaryFromAlertData(payload);
        intensity = payload.intensity;
        occurrenceKey = occurrenceKey ?? payload.localDateKey ?? null;
      } else if (fallback) {
        summary = fallback.summary;
        intensity = fallback.intensity;
      } else {
        throw new AppError('not_found', 'No meeting data available for this snooze', { details: { meetingId } });
      }
    }

    const fireAt = new Date(nowDate().getTime() + minutes * MINUTE_MS).toISOString();
    const spec = renderSnoozeSpec(
      summary,
      intensity,
      fireAt,
      textDeps(renderPrefs, { headless: sessionUid === null }),
      occurrenceKey ?? undefined,
    );
    try {
      await notifications.cancel(snoozeNotificationId(meetingId));
    } catch (error) {
      log.warn('could not replace the previous snooze', error);
    }
    await notifications.schedule(spec);

    inAppQueue = [
      ...inAppQueue.filter((item) => item.identifier !== spec.identifier),
      {
        identifier: spec.identifier,
        kind: 'snooze',
        meetingId,
        offsetMinutes: null,
        fireAt,
        intensity,
        data: spec.data,
      },
    ];
    armInAppTimer();
    notifyStatus();
    if (sessionUid) requestReconcile('snooze');
  }

  async function snooze(meetingId: string, minutes?: number): Promise<void> {
    await init();
    await snoozeInternal(meetingId, minutes ?? (await defaultSnoozeMinutes()), null);
  }

  // ---- responses -----------------------------------------------------------------------------
  async function handleNotificationResponse(
    response: IncomingResponse,
    via: 'foreground' | 'background',
    options: ResponseOptions = {},
  ): Promise<void> {
    const { notification, actionIdentifier } = response;
    if (notification.identifier === REFILL_NOTIFICATION_ID) {
      // Tapped "keep your alerts up to date": the app is opening; refresh the window.
      if (sessionUid) requestReconcile('manual');
      return;
    }
    const parsed: ParsedNotificationId | null = parseNotificationId(notification.identifier);
    if (!parsed) return;
    const payload = parseAlertData(notification.data);
    const fireAt = payload?.fireAt ?? new Date(notification.date).toISOString();
    // Any response means the user saw it: never re-show this delivery in-app.
    updateRegistry(markAcknowledged(registry, registryKey(notification.identifier, fireAt), nowDate()));
    removeActive(notification.identifier);

    const snoozeAction = parseSnoozeAction(actionIdentifier);
    if (!snoozeAction) {
      // Default tap / open / assistant: navigation routes via data.url. Android does not remove a
      // notification whose ACTION button was tapped (and MAX/MEDIUM ones are sticky): remove the
      // tray copy here so it cannot linger or be re-shown by the tray sweep.
      await dismissQuietly(notification.identifier);
      return;
    }

    const responseKey = `${notification.identifier}|${notification.date}|${actionIdentifier}`;
    if (!(await claimResponse(responseKey))) {
      log.info(`duplicate snooze response ignored (${via})`);
      await dismissQuietly(notification.identifier);
      return;
    }
    try {
      const prefs = await preferencesForSnooze(options.uid ?? null);
      const minutes = snoozeAction.minutes ?? prefs?.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES;
      const occurrenceKey = occurrenceKeyOf(notification.identifier, payload) ?? null;
      await snoozeInternal(parsed.meetingId, minutes, payload, null, prefs, occurrenceKey);
    } finally {
      await dismissQuietly(notification.identifier);
    }
  }

  // ---- init ----------------------------------------------------------------------------------
  function attachListeners(): void {
    if (listenersAttached) return;
    listenersAttached = true;

    notifications.addReceivedListener((notification) => {
      if (notification.identifier === REFILL_NOTIFICATION_ID) {
        // Delivered while the app is open: refresh the window now instead of asking the user.
        void dismissQuietly(notification.identifier);
        if (sessionUid) requestReconcile('manual');
        return;
      }
      presentIncoming(notification, 'notification_received')
        .then(() => {
          if (sessionUid && parseNotificationId(notification.identifier)) requestReconcile('manual');
        })
        .catch((error: unknown) => log.error('could not present a delivered notification', error));
    });
    notifications.addResponseListener((response) => {
      handleNotificationResponse(response, 'foreground').catch((error: unknown) =>
        log.error('could not handle a notification response', error),
      );
    });

    events.on('meetings:changed', (event) => {
      // 'synced' = outbox acknowledgements (no content change); 'session_reset' = session teardown.
      if (event.reason === 'synced' || event.reason === 'session_reset') return;
      if (sessionUid && event.uid === sessionUid) requestReconcile('meetings_changed');
    });
    events.on('preferences:changed', (event) => {
      if (!sessionUid || event.uid !== sessionUid) return;
      const previousSnooze = lastPrefs?.snoozeMinutes;
      lastPrefs = event.preferences;
      if (previousSnooze !== event.preferences.snoozeMinutes) {
        notifications.setCategories(categorySpecs()).catch((error: unknown) => log.warn('could not update categories', error));
      }
      const relevant = event.changedKeys.length === 0 || event.changedKeys.some((key) => ALERT_PREFERENCE_KEYS.has(key));
      if (relevant) requestReconcile('preferences_changed');
    });
    events.on('language:changed', () => {
      void setupChannelsAndCategories();
      if (sessionUid) requestReconcile('language_changed');
    });

    appState.subscribe((state) => {
      if (state === 'active') {
        if (sessionUid) {
          requestReconcile('foreground');
          scheduleSweep();
        }
        armInAppTimer();
      } else if (state === 'background') {
        clearInAppTimer();
        autoSnoozeUnhandled().catch((error: unknown) => log.error('auto-snooze on background failed', error));
      }
    });
  }

  /**
   * Leaving the app with an unhandled MAX/MEDIUM alert on screen counts as "snooze": the OS copy
   * of an alert shown by the in-app timer was cancelled, so without this nothing would ring again.
   */
  async function autoSnoozeUnhandled(): Promise<void> {
    const pending = active.filter((alert) => alert.kind !== 'followup' && alert.intensity !== 'light');
    for (const alert of pending) {
      try {
        await engine.resolveActiveAlert(alert.key, 'snooze');
      } catch (error) {
        log.warn(`could not auto-snooze ${alert.key}`, error);
      }
    }
  }

  async function doInit(): Promise<void> {
    installPresentationHandler();
    attachListeners();
    await setupChannelsAndCategories();
    await removeLegacyArtifacts();
    // The response that launched the app (cold start). Every MeetingGuard response is handled
    // here, not only snoozes: the Android response task that also sees "Open" / "Assistant" taps
    // may run in a separate headless runtime, so this runtime acknowledges the delivery and
    // removes the (sticky) tray copy itself. Snoozes stay de-duplicated by claimResponse.
    const last = notifications.getLastResponse();
    if (last && (parseNotificationId(last.notification.identifier) || last.notification.identifier === REFILL_NOTIFICATION_ID)) {
      handleNotificationResponse(last, 'foreground').catch((error: unknown) =>
        log.error('could not handle the launch notification response', error),
      );
    }
    initialized = true;
    notifyStatus();
  }

  function init(): Promise<void> {
    if (!initPromise) {
      initPromise = doInit().catch((error: unknown) => {
        initPromise = null;
        throw toAppError(error);
      });
    }
    return initPromise;
  }

  // ---- session ------------------------------------------------------------------------------
  async function startSession(uid: string): Promise<void> {
    try {
      await init();
      if (sessionUid !== uid) {
        generation += 1;
        sessionUid = uid;
        const stored = await loadRegistry(uid);
        registry = registryUid === null ? mergeRegistries(stored, registry) : stored;
        registryUid = uid;
      }
      await reconcile('session_started');
      scheduleSweep();
    } catch (error) {
      // Callers do not await this (session manager); failures are logged and kept in the status.
      log.error('alert session start failed', error);
    }
  }

  async function endSession(): Promise<void> {
    generation += 1;
    sessionUid = null;
    clearInAppTimer();
    if (sweepTimer !== null) timers.clearTimeout(sweepTimer);
    sweepTimer = null;
    if (registrySaveTimer !== null) timers.clearTimeout(registrySaveTimer);
    registrySaveTimer = null;
    feedback.stopAll();
    active = [];
    activeRegistryKeys.clear();
    notifyActive();
    lastPrefs = null;
    meetingCache = new Map();
    inAppQueue = [];
    fsiScheduled = [];
    registry = emptyRegistry();
    registryUid = null;
    await runner.idle();
    try {
      await cancelAll();
    } catch (error) {
      // Sign-out must not be blocked by a notification failure; it is reported.
      log.error('could not cancel alerts at session end', error);
    }
    notifyStatus();
  }

  function isOwnOrLegacy(identifier: string, payload: unknown): boolean {
    return (
      parseNotificationId(identifier) !== null ||
      identifier === REFILL_NOTIFICATION_ID ||
      isLegacyNotification(identifier, payload)
    );
  }

  async function cancelAll(): Promise<void> {
    await init();
    let failed = 0;
    const records = await notifications.getScheduled();
    for (const record of records) {
      if (!isOwnOrLegacy(record.identifier, record.data)) continue;
      try {
        await notifications.cancel(record.identifier);
      } catch (error) {
        failed += 1;
        log.warn(`could not cancel ${record.identifier}`, error);
      }
    }
    const presented = await notifications.getPresented();
    for (const record of presented) {
      if (!isOwnOrLegacy(record.identifier, record.data)) continue;
      try {
        await notifications.dismiss(record.identifier);
      } catch (error) {
        failed += 1;
        log.warn(`could not dismiss ${record.identifier}`, error);
      }
    }
    if (deps.fsi?.isAvailable()) {
      // Contract in ./fsi.ts: cancelAll (and endSession through it) clears every native alarm.
      try {
        await deps.fsi.clearAlarms();
      } catch (error) {
        failed += 1;
        log.warn('could not clear the full-screen alarms', error);
      }
    }
    fsiScheduled = [];
    inAppQueue = [];
    clearInAppTimer();
    notifyStatus();
    if (failed > 0) throw new AppError('unknown', `cancelAll: ${failed} notification(s) could not be removed`);
  }

  // ---- status ---------------------------------------------------------------------------------
  async function getScheduled(): Promise<ScheduledAlertInfo[]> {
    await init();
    const entries = toScheduledEntries(await notifications.getScheduled());
    const infos: ScheduledAlertInfo[] = [];
    for (const entry of entries) {
      if (!entry.data || !entry.fireAt) continue;
      infos.push({
        identifier: entry.identifier,
        meetingId: entry.data.meetingId,
        ...(entry.data.localDateKey !== undefined ? { localDateKey: entry.data.localDateKey } : {}),
        kind: entry.data.kind,
        offsetMinutes: entry.data.offsetMinutes,
        fireAt: entry.fireAt,
        intensity: entry.data.intensity,
      });
    }
    // MAX alerts handed to the full-screen alarm module are pending too (not visible through
    // expo-notifications). Already-fired ones (native side removed them) are filtered by time.
    const seen = new Set(infos.map((info) => info.identifier));
    const nowMs = nowDate().getTime();
    for (const info of fsiScheduled) {
      if (seen.has(info.identifier) || Date.parse(info.fireAt) <= nowMs) continue;
      infos.push({ ...info });
    }
    return infos.sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt));
  }

  async function getStatus(): Promise<AlertEngineStatus> {
    await init();
    const [currentPermission, scheduled] = await Promise.all([getPermissionStatus(), getScheduled()]);
    const status: AlertEngineStatus = {
      initialized,
      permission: currentPermission,
      pendingCount: scheduled.length,
      nextAlertAt: scheduled[0]?.fireAt ?? null,
      lastReconcileAt: lastReconcileAt ?? registry.lastReconcileAt,
      lastReconcileError,
    };
    if (deps.fsi && notifications.platform === 'android' && deps.fsi.isAvailable()) {
      try {
        status.fullScreenAlarms = await deps.fsi.getStatus();
      } catch (error) {
        log.warn('could not read the full-screen alarm status', error);
        status.fullScreenAlarms = null;
      }
    }
    return status;
  }

  // ---- public API --------------------------------------------------------------------------------
  const engine: AlertEngineImpl = {
    init,

    async requestPermissions() {
      await init(); // channels exist before the Android 13+ prompt
      await notifications.requestPermission();
      const status = await getPermissionStatus();
      notifyStatus();
      if (sessionUid) requestReconcile('permission_changed');
      return status;
    },

    async getPermissionStatus() {
      await init();
      return getPermissionStatus();
    },

    async openExactAlarmSettings() {
      await init();
      if (!settings.exactAlarmSettingsAvailable) return;
      try {
        await settings.openExactAlarmSettings();
      } catch (error) {
        throw toAppError(error, 'unsupported');
      }
      // No JS API reads the permission: reschedule everything when the user comes back.
      forceRescheduleOnForeground = true;
    },

    async openNotificationSettings() {
      await init();
      try {
        await settings.openNotificationSettings();
      } catch (error) {
        throw toAppError(error, 'unsupported');
      }
    },

    async openAlarmChannelSettings() {
      await init();
      const vibration = (lastPrefs ?? prefsOrDefault()).vibrationEnabled;
      try {
        await settings.openChannelSettings(channelFor('max', vibration));
      } catch (error) {
        throw toAppError(error, 'unsupported');
      }
    },

    startSession,
    endSession,
    reconcile,
    cancelAll,
    snooze,
    getStatus,
    getScheduled,

    subscribeActiveAlerts(listener) {
      init().catch((error: unknown) => log.error('alert engine init failed', error));
      activeListeners.add(listener);
      listener([...active]);
      armInAppTimer();
      if (sessionUid) scheduleSweep();
      return () => {
        activeListeners.delete(listener);
        if (!hostAttached()) clearInAppTimer();
      };
    },

    async resolveActiveAlert(key, action, options = {}) {
      const regKey = activeRegistryKeys.get(key);
      const alert = removeActive(key);
      if (!alert) return;
      updateRegistry(markAcknowledged(registry, regKey ?? registryKey(key, alert.firedAt), nowDate()));
      await dismissQuietly(key);
      if (action === 'snooze') {
        const fallback = {
          summary: {
            id: alert.meetingId,
            title: alert.title,
            startAt: alert.startAt,
            durationMinutes: alert.durationMinutes,
            language: alert.language,
            locationText: alert.locationText,
          },
          intensity: alert.intensity,
        };
        const occurrenceKey = occurrenceKeyOf(alert.key, null) ?? null;
        await snoozeInternal(
          alert.meetingId,
          options.snoozeMinutes ?? (await defaultSnoozeMinutes()),
          null,
          fallback,
          lastPrefs,
          occurrenceKey,
        );
      }
    },

    handleNotificationResponse,
    installPresentationHandler,

    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    getSnoozeChoices() {
      return snoozeChoices(prefsOrDefault().snoozeMinutes);
    },

    getActiveAlerts() {
      return [...active];
    },
  };

  return engine;
}
