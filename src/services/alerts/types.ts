/**
 * Alerts-area types (owner: alerts). Type-only module.
 *
 * Extends the contracts in src/core/contracts.ts in a backward-compatible way:
 * - StoredAlertData = AlertNotificationData + { fireAt, title, language, durationMinutes } so a
 *   snooze can be rendered from the notification alone (headless, no data session) and the fire
 *   time is known without relying on platform-specific trigger serialization.
 * - ActiveAlertView = ActiveAlert + display snapshot (what AlertHost needs even when the meeting
 *   was deleted after the alert fired).
 * - Ports: the engine talks to Expo / React Native / data / i18n only through these interfaces
 *   (engineCore.ts is unit-tested with fakes; engine.ts wires the real implementations).
 */
import type {
  ActiveAlert,
  AlertNotificationData,
  AlertPermissionStatus,
  FormatOptions,
  MeetingRange,
  TranslateFn,
  Unsubscribe,
} from '../../core/contracts';
import type { AndroidChannelId, NotificationKind } from '../../core/identifiers';
import type { AlertIntensity, AlertSoundType, Language, Meeting, Preferences } from '../../core/types';

export type { AlertIntensity, AlertSoundType, Language, Meeting, NotificationKind, Preferences };

// ---------------------------------------------------------------------------------------------
// Notification payload + render output
// ---------------------------------------------------------------------------------------------

export interface StoredAlertData extends AlertNotificationData {
  /** UTC ISO fire time. */
  fireAt: string;
  /** Meeting title (already visible in the notification text). */
  title: string;
  /** Meeting language (voice readout). */
  language: Language;
  durationMinutes: number;
}

export type InterruptionLevelName = 'passive' | 'active' | 'timeSensitive';
export type AndroidPriorityName = 'max' | 'high' | 'default';

/** Platform-neutral description of one scheduled notification (mapped to Expo by the adapter). */
export interface AlertNotificationSpec {
  identifier: string;
  kind: NotificationKind;
  meetingId: string;
  fireAt: string;
  intensity: AlertIntensity;
  channelId: AndroidChannelId;
  /** Notification category (action buttons); null = no actions. */
  categoryId: string | null;
  title: string;
  body: string;
  /** Sound file name ("meeting_alarm.wav") or "default". */
  sound: string;
  interruptionLevel: InterruptionLevelName;
  androidPriority: AndroidPriorityName;
  /** Pre-Android-8 vibration pattern (channels own it on 8+); [] = no vibration. */
  vibrate: number[];
  /** Android: cannot be swiped away (MAX and MEDIUM alerts: "minimizable, not dismissible"). */
  sticky: boolean;
  data: StoredAlertData;
}

/** content.data of the refill reminder (REFILL_NOTIFICATION_ID; not tied to a meeting). */
export interface RefillNotificationData {
  v: 1;
  kind: 'refill';
  fireAt: string;
  hash: string;
}

/** The "open Meeting Guard to keep your alerts up to date" notification. */
export interface RefillNotificationSpec extends Omit<AlertNotificationSpec, 'kind' | 'meetingId' | 'intensity' | 'data'> {
  kind: 'refill';
  data: RefillNotificationData;
}

/** content.data of a task reminder ("mgtask:{taskId}"; owner: taskReminders, not the engine). */
export interface TaskReminderData {
  v: 1;
  kind: 'task';
  taskId: string;
  fireAt: string;
  /** Task title at schedule time (a changed title reschedules the notification). */
  title: string;
}

/** A task reminder (V2 Stage 1; scheduled by src/services/alerts/taskReminders.ts). */
export interface TaskReminderSpec extends Omit<AlertNotificationSpec, 'kind' | 'meetingId' | 'intensity' | 'data'> {
  kind: 'task';
  taskId: string;
  data: TaskReminderData;
}

/**
 * content.data of a daily briefing ("mgbrief:{localDateKey}"; owner: briefing.ts, not the engine).
 * Deliberately carries NO `alertType` key and no `type: 'persistent'`: diff.isLegacyNotification
 * treats either of those as a stale pre-V2 notification and cancels it on every reconcile.
 */
export interface BriefingData {
  v: 1;
  kind: 'briefing';
  /** The day this briefing is about, in the device zone. */
  localDateKey: string;
  fireAt: string;
  /** Hash of everything visible: a changed body reschedules, an unchanged one is kept. */
  hash: string;
}

/** The optional daily agenda notification (V2 Stage 1, week 4; src/services/alerts/briefing.ts). */
export interface BriefingSpec extends Omit<AlertNotificationSpec, 'kind' | 'meetingId' | 'intensity' | 'data'> {
  kind: 'briefing';
  localDateKey: string;
  data: BriefingData;
}

/**
 * content.data of the ongoing status notification ("mgstatus:1"; owner: statusNotification.ts).
 * Like the briefing it must carry no `alertType` and no `type: "persistent"`, or the engine
 * would treat it as a stale pre-V2 notification and cancel it on every reconcile.
 */
export interface StatusNotificationData {
  v: 1;
  kind: 'status';
  hash: string;
}

/**
 * The ongoing "alerts are on" notification. It is PRESENTED, not scheduled, so it has no
 * fireAt and never enters the ScheduledSpec union.
 */
export interface StatusNotificationSpec {
  identifier: string;
  channelId: string;
  title: string;
  body: string;
  data: StatusNotificationData;
}
/** Anything the engine hands to the OS. */
export type ScheduledSpec = AlertNotificationSpec | RefillNotificationSpec | TaskReminderSpec | BriefingSpec;

/** Meeting fields needed to render notification text. */
export interface MeetingSummary {
  id: string;
  title: string;
  startAt: string;
  durationMinutes: number;
  language: Language;
  /** Address or conference provider label; null when unknown. */
  locationText: string | null;
}

export interface AlertTextDeps {
  t: TranslateFn;
  formatTime(value: string, options: FormatOptions): string;
  /** UI language (notification text). */
  language: Language;
  /** Device time zone (times are shown in the user's current zone). */
  timeZone: string;
  use24Hour: boolean | null;
  /** Preferences.vibrationEnabled: picks the no-vibration channel and an empty pattern when false. */
  vibrationEnabled: boolean;
}

// ---------------------------------------------------------------------------------------------
// Active alerts (AlertHost)
// ---------------------------------------------------------------------------------------------

export interface AlertPresentationPrefs {
  soundType: AlertSoundType;
  volume: number;
  vibrationEnabled: boolean;
  snoozeMinutes: number;
  use24HourClock: boolean | null;
}

export interface ActiveAlertView extends ActiveAlert {
  /** Meeting snapshot (from the meeting, or from the notification when the meeting is gone). */
  title: string;
  startAt: string;
  durationMinutes: number;
  language: Language;
  /** Real join URL (conference.url ?? location.virtualUrl); null when none is known. */
  joinUrl: string | null;
  locationText: string | null;
  prefs: AlertPresentationPrefs;
}

export type ResolveAction = 'acknowledge' | 'snooze' | 'open';

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

export interface IncomingNotification {
  identifier: string;
  /** Delivery time (ms since epoch). */
  date: number;
  /** content.data (already parsed when the platform delivers dataString). */
  data: unknown;
}

export interface IncomingResponse {
  actionIdentifier: string;
  notification: IncomingNotification;
}

export interface NotificationPresentation {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

export interface ScheduledNotificationRecord {
  identifier: string;
  data: unknown;
  /** Trigger time when the platform exposes it (ms since epoch). */
  triggerDate: number | null;
}

export interface PresentedNotificationRecord {
  identifier: string;
  data: unknown;
  date: number;
}

export interface RawPermission {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
  /** iOS provisional authorization. */
  provisional: boolean;
}

export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  importance: 'max' | 'high' | 'default' | 'low';
  /** Sound file name, "default" or null (silent). */
  sound: string | null;
  vibrationPattern: number[];
  bypassDnd: boolean;
  lockscreenPublic: boolean;
  /** Play on the alarm stream (MAX). */
  alarmUsage: boolean;
}

export interface CategoryActionSpec {
  id: string;
  title: string;
  opensApp: boolean;
}

export interface CategorySpec {
  id: string;
  actions: CategoryActionSpec[];
}

export interface NotificationsPort {
  readonly platform: 'ios' | 'android' | 'other';
  /** Foreground presentation decision (installed once, synchronous decision). */
  setPresentationHandler(decide: (notification: IncomingNotification) => NotificationPresentation): void;
  setChannels(channels: readonly ChannelSpec[]): Promise<void>;
  deleteChannels(ids: readonly string[]): Promise<void>;
  setCategories(categories: readonly CategorySpec[]): Promise<void>;
  getPermission(): Promise<RawPermission>;
  requestPermission(): Promise<RawPermission>;
  getScheduled(): Promise<ScheduledNotificationRecord[]>;
  schedule(spec: ScheduledSpec): Promise<void>;
  /** Shows an ongoing notification right now (no trigger); replaces one with the same id. */
  present(spec: StatusNotificationSpec): Promise<void>;
  cancel(identifier: string): Promise<void>;
  getPresented(): Promise<PresentedNotificationRecord[]>;
  dismiss(identifier: string): Promise<void>;
  addReceivedListener(listener: (notification: IncomingNotification) => void): Unsubscribe;
  addResponseListener(listener: (response: IncomingResponse) => void): Unsubscribe;
  /** Cold start: the response that launched the app (not cleared: navigation reads it too). */
  getLastResponse(): IncomingResponse | null;
}

/** Data access used by the engine (backed by src/services/data). */
export interface AlertDataPort {
  getActiveUid(): string | null;
  listMeetings(range: MeetingRange): Promise<Meeting[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  getPreferences(): Promise<Preferences>;
  getCachedUpcoming(uid: string, options: { horizonDays: number; now: Date }): Promise<Meeting[]>;
  getCachedPreferences(uid: string): Promise<Preferences | null>;
}

export interface AlertI18nPort {
  t: TranslateFn;
  getLanguage(): Language;
  formatTime(value: string, options: FormatOptions): string;
}

export interface AlertSettingsPort {
  /** Android 12+ only; false elsewhere. */
  readonly exactAlarmSettingsAvailable: boolean;
  openExactAlarmSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  /** Android 8+: the system page of one notification channel ("Override Do Not Disturb" lives there). */
  openChannelSettings(channelId: string): Promise<void>;
}

export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStatePort {
  current(): AppStateName;
  subscribe(listener: (state: AppStateName) => void): Unsubscribe;
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface FeedbackPort {
  /** Stops every sound, voice and vibration started for alerts. */
  stopAll(): void;
}

export interface TimerPort {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type { AlertPermissionStatus };
