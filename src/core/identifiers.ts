/**
 * Every persistent identifier in one place: Firestore paths, AsyncStorage keys, notification
 * identifiers / channels / categories / actions, background task names, deep links, and the
 * deterministic Google Calendar event id. Pure functions only (unit-tested).
 *
 * Changing any value here is a data migration: notification ids and channel ids live on
 * devices, storage keys hold user data, Google event ids live in users' calendars.
 */
import { LOCAL_DATE_KEY_PATTERN, MEETING_ID_PATTERN } from './aiContract';
import type { AlertIntensity } from './types';

// ---------------------------------------------------------------------------------------------
// Firestore layout
// ---------------------------------------------------------------------------------------------

/**
 * users/{uid}                          UserProfile           owner read/write (never plan/role keys)
 * users/{uid}/meetings/{meetingId}     MeetingDoc            owner read/write
 * users/{uid}/notes/{noteId}           Note (without id)     owner read/write
 * users/{uid}/settings/preferences     Preferences           owner read/write
 * entitlements/{uid}                   Entitlement           owner read, server write only
 * usage/{uid}/days/{yyyy-mm-dd}        { count, updatedAt }  owner read, server write only (UTC day)
 */
export const FIRESTORE_COLLECTIONS = {
  users: 'users',
  meetings: 'meetings',
  notes: 'notes',
  settings: 'settings',
  entitlements: 'entitlements',
  usage: 'usage',
  usageDays: 'days',
} as const;

export const PREFERENCES_DOC_ID = 'preferences';

export const firestorePaths = {
  user: (uid: string): string => `users/${uid}`,
  meetings: (uid: string): string => `users/${uid}/meetings`,
  meeting: (uid: string, meetingId: string): string => `users/${uid}/meetings/${meetingId}`,
  notes: (uid: string): string => `users/${uid}/notes`,
  note: (uid: string, noteId: string): string => `users/${uid}/notes/${noteId}`,
  preferences: (uid: string): string => `users/${uid}/settings/${PREFERENCES_DOC_ID}`,
  entitlement: (uid: string): string => `entitlements/${uid}`,
  usageDays: (uid: string): string => `usage/${uid}/days`,
  usageDay: (uid: string, dayKey: string): string => `usage/${uid}/days/${dayKey}`,
} as const;

// ---------------------------------------------------------------------------------------------
// AsyncStorage keys
// ---------------------------------------------------------------------------------------------

/** Device-wide keys (not tied to a user). */
export const GLOBAL_STORAGE_KEYS = {
  /** Persisted UI language ("en" | "es"); read before sign-in. Owner: i18n. */
  language: 'mg:language',
  /** Theme mode ("system" | "light" | "dark"). Owner: i18n-nav (ThemeContext). */
  theme: 'mg:theme',
  /**
   * Random per-install key used to scope device-calendar ids as `d{key}.{rawId}` (Android ids are
   * small integers that collide across phones). Survives sign-out. Owner: calendar.
   */
  deviceCalendarKey: 'mg:device.calendarKey',
  /**
   * Handled notification responses (ids only, at most 50): snooze de-duplication across the
   * headless task, the foreground listener and cold starts. Owner: alerts.
   */
  alertResponses: 'mg:device:alerts.responses',
} as const;

/** Per-user key names; full key = `mg:{uid}:{name}`. Wiped on sign-out (prefix delete). */
export const USER_STORAGE = {
  /** Cached meetings (MeetingDoc JSON by id) incl. tombstones. Owner: data. */
  meetings: 'meetings',
  /** Pending Firestore writes. Owner: data. */
  outbox: 'outbox',
  preferences: 'preferences',
  notes: 'notes',
  profile: 'profile',
  entitlement: 'entitlement',
  /** Legacy (v1.0.9) migration marker. Owner: data. */
  migration: 'migration',
  /** Google sync state: syncToken, lastSyncAt, pending pushes. Owner: calendar. */
  googleCalendar: 'calendar.google',
  /** Device calendar sync state. Owner: calendar. */
  deviceCalendar: 'calendar.device',
  /** Outlook sync state: deltaLink, lastSyncAt, pending pushes (never tokens). Owner: calendar. */
  outlookCalendar: 'calendar.outlook',
  /** Fired/acknowledged alerts, snoozes, last reconcile. Owner: alerts. */
  alerts: 'alerts.state',
  /** Assistant conversation. Owner: ai. */
  assistantThread: 'assistant.thread',
  /** Executed AI action ids (idempotency). Owner: ai. */
  assistantExecuted: 'assistant.executed',
  /** Device-local attachment metadata (files are never uploaded). Owner: data. */
  attachments: 'attachments',
  /** Last visited onboarding step (resume marker; completion lives in Preferences). Owner: i18n-nav. */
  onboarding: 'onboarding.step',
} as const;
export type UserStorageName = (typeof USER_STORAGE)[keyof typeof USER_STORAGE];

export function userStoragePrefix(uid: string): string {
  return `mg:${uid}:`;
}

export function userStorageKey(uid: string, name: UserStorageName): string {
  return `${userStoragePrefix(uid)}${name}`;
}

/** Keys written by the pre-rebuild app (v1.0.9 and HEAD 3308b9d). Removed after migration. */
export const LEGACY_STORAGE_KEYS = [
  'meetingguard_data',
  'user',
  'users',
  'current_user',
  'authToken',
  'google_access_token',
  'google_refresh_token',
  'google_token_expiry',
  'google_user_info',
  'google_calendar_tokens',
  'google_calendar_access_token',
  'google_calendar_mappings',
  'google_calendar_sync_settings',
  'google_calendar_connected',
  'google_calendar_connected_at',
  'scheduledNotifications',
  'alertSystemConfig',
  'floatingWidgetEnabled',
  'deviceId',
  // Found in git history (PKCE verifier, backend JWTs, identity copies, reconnect/logout flags).
  'google_code_verifier',
  'google_calendar_needs_reconnect',
  'google_calendar_disconnect_reason',
  'logout_reason',
  'userData',
  'authMethod',
  'auth_token',
  'refresh_token',
  'refreshToken',
  'user_data',
] as const;
/** Legacy key prefixes (e.g. alertSchedule_{meetingId}). */
export const LEGACY_STORAGE_PREFIXES = ['alertSchedule_'] as const;
/** The v1.0.9 local database (meetings, notes, userPreferences arrays). */
export const LEGACY_DATA_KEY = 'meetingguard_data';

// ---------------------------------------------------------------------------------------------
// Secure storage (expo-secure-store; keys must match [A-Za-z0-9._-]+; uids are alphanumeric)
// ---------------------------------------------------------------------------------------------

/**
 * The ONLY tokens the app persists: the Microsoft refresh token for Outlook sync (Google tokens
 * stay inside the GoogleSignin SDK and are never stored by us). Deleted on Outlook disconnect and
 * on session end. Owner: auth (src/services/auth/microsoftTokens.ts).
 */
export const SECURE_STORE_KEYS = {
  microsoftRefreshToken: (uid: string): string => `mg.ms.refresh.${uid}`,
} as const;

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

export const NOTIFICATION_ID_PREFIX = 'mg';

export type NotificationKind = 'alert' | 'followup' | 'snooze';

/**
 * `localDateKey` is present for OCCURRENCE notifications of a recurring meeting (the occurrence's
 * ORIGINAL local date in the meeting's timezone) and absent for one-off meetings.
 */
export type ParsedNotificationId =
  | { kind: 'alert'; meetingId: string; offsetMinutes: number; localDateKey?: string }
  | { kind: 'followup'; meetingId: string; localDateKey?: string }
  | { kind: 'snooze'; meetingId: string };

function assertMeetingId(meetingId: string): void {
  if (!MEETING_ID_PATTERN.test(meetingId)) {
    throw new RangeError(`Invalid meeting id for a notification identifier: ${meetingId}`);
  }
}

function assertLocalDateKey(localDateKey: string): void {
  if (!LOCAL_DATE_KEY_PATTERN.test(localDateKey)) {
    throw new RangeError(`Invalid occurrence date for a notification identifier: ${localDateKey}`);
  }
}

/** "mg:{meetingId}:{offsetMin}" - alert `offsetMinutes` before start (0 = at start). */
export function alertNotificationId(meetingId: string, offsetMinutes: number): string {
  assertMeetingId(meetingId);
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < 0) {
    throw new RangeError(`Invalid alert offset: ${offsetMinutes}`);
  }
  return `${NOTIFICATION_ID_PREFIX}:${meetingId}:${offsetMinutes}`;
}

/** "mg:{meetingId}:{localDateKey}:{offsetMin}" - alert for ONE occurrence of a recurring meeting. */
export function occurrenceAlertNotificationId(meetingId: string, localDateKey: string, offsetMinutes: number): string {
  assertMeetingId(meetingId);
  assertLocalDateKey(localDateKey);
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < 0) {
    throw new RangeError(`Invalid alert offset: ${offsetMinutes}`);
  }
  return `${NOTIFICATION_ID_PREFIX}:${meetingId}:${localDateKey}:${offsetMinutes}`;
}

/** "mg:{meetingId}:followup" - post-meeting follow-up (end + FOLLOW_UP_DELAY_MINUTES). */
export function followUpNotificationId(meetingId: string): string {
  assertMeetingId(meetingId);
  return `${NOTIFICATION_ID_PREFIX}:${meetingId}:followup`;
}

/** "mg:{meetingId}:{localDateKey}:followup" - follow-up of ONE occurrence of a recurring meeting. */
export function occurrenceFollowUpNotificationId(meetingId: string, localDateKey: string): string {
  assertMeetingId(meetingId);
  assertLocalDateKey(localDateKey);
  return `${NOTIFICATION_ID_PREFIX}:${meetingId}:${localDateKey}:followup`;
}

/**
 * "mg:{meetingId}:snooze" - at most one pending snooze per meeting (re-snooze replaces it; for a
 * recurring meeting the one slot covers whichever occurrence was snoozed last).
 */
export function snoozeNotificationId(meetingId: string): string {
  assertMeetingId(meetingId);
  return `${NOTIFICATION_ID_PREFIX}:${meetingId}:snooze`;
}

export function parseNotificationId(identifier: string): ParsedNotificationId | null {
  const parts = identifier.split(':');
  if (parts[0] !== NOTIFICATION_ID_PREFIX) return null;
  const meetingId = parts[1] ?? '';
  if (!MEETING_ID_PATTERN.test(meetingId)) return null;
  if (parts.length === 3) {
    const tail = parts[2] ?? '';
    if (tail === 'followup') return { kind: 'followup', meetingId };
    if (tail === 'snooze') return { kind: 'snooze', meetingId };
    if (/^\d{1,5}$/.test(tail)) return { kind: 'alert', meetingId, offsetMinutes: Number(tail) };
    return null;
  }
  if (parts.length === 4) {
    const localDateKey = parts[2] ?? '';
    if (!LOCAL_DATE_KEY_PATTERN.test(localDateKey)) return null;
    const tail = parts[3] ?? '';
    if (tail === 'followup') return { kind: 'followup', meetingId, localDateKey };
    if (/^\d{1,5}$/.test(tail)) return { kind: 'alert', meetingId, offsetMinutes: Number(tail), localDateKey };
    return null;
  }
  return null;
}

export function isMeetingGuardNotificationId(identifier: string): boolean {
  return parseNotificationId(identifier) !== null;
}

/**
 * Android channels (immutable once created: change sound / vibration / lock-screen visibility =>
 * bump the version). Every channel exists twice: with vibration, and without it
 * (Preferences.vibrationEnabled false), because an app cannot change a channel's vibration.
 * v2: lock-screen visibility PRIVATE (the user's "hide sensitive content" setting applies) and
 * the no-vibration variants.
 */
export const ANDROID_CHANNELS = {
  max: 'mg-alert-max-v2',
  medium: 'mg-alert-medium-v2',
  light: 'mg-alert-light-v2',
  followup: 'mg-followup-v2',
  maxNoVibration: 'mg-alert-max-novib-v2',
  mediumNoVibration: 'mg-alert-medium-novib-v2',
  lightNoVibration: 'mg-alert-light-novib-v2',
  followupNoVibration: 'mg-followup-novib-v2',
} as const;
export type AndroidChannelId = (typeof ANDROID_CHANNELS)[keyof typeof ANDROID_CHANNELS];
export type AndroidChannelKind = AlertIntensity | 'followup';

/** Channels of earlier versions (deleted at start; their pending notifications are rescheduled). */
export const SUPERSEDED_ANDROID_CHANNELS = [
  'mg-alert-max-v1',
  'mg-alert-medium-v1',
  'mg-alert-light-v1',
  'mg-followup-v1',
] as const;

/** Channel of an alert (or follow-up) given the vibration preference (default: vibration on). */
export function channelFor(kind: AndroidChannelKind, vibrationEnabled = true): AndroidChannelId {
  switch (kind) {
    case 'max':
      return vibrationEnabled ? ANDROID_CHANNELS.max : ANDROID_CHANNELS.maxNoVibration;
    case 'medium':
      return vibrationEnabled ? ANDROID_CHANNELS.medium : ANDROID_CHANNELS.mediumNoVibration;
    case 'light':
      return vibrationEnabled ? ANDROID_CHANNELS.light : ANDROID_CHANNELS.lightNoVibration;
    default:
      return vibrationEnabled ? ANDROID_CHANNELS.followup : ANDROID_CHANNELS.followupNoVibration;
  }
}

export function channelForIntensity(intensity: AlertIntensity, vibrationEnabled = true): AndroidChannelId {
  return channelFor(intensity, vibrationEnabled);
}

/** Notification categories (registered at every startup with localized button titles). */
export const NOTIFICATION_CATEGORIES = {
  /** Meeting alerts: actions open + snooze. */
  alert: 'mg-alert',
  /** Post-meeting follow-up: action assistant. */
  followup: 'mg-followup',
} as const;

export const NOTIFICATION_ACTIONS = {
  /** Opens the meeting (opensAppToForeground: true). */
  open: 'mg-open',
  /**
   * Snoozes by Preferences.snoozeMinutes (opensAppToForeground: false; Android background task).
   * The alert category also carries a second, longer snooze `mg-snooze-<minutes>` (minutes encoded
   * in the id so a tap is exact even if preferences changed after registration); anything starting
   * with `mg-snooze` is a snooze and must never be routed by navigation.
   */
  snooze: 'mg-snooze',
  /** Opens the assistant in follow-up mode (opensAppToForeground: true). */
  assistant: 'mg-assistant',
} as const;

/**
 * "Open MeetingGuard to keep your alerts up to date": scheduled when the budget cut real alerts,
 * so the user refreshes the window before it runs out. Not tied to a meeting (never parsed by
 * parseNotificationId); the alert engine manages it explicitly.
 */
export const REFILL_NOTIFICATION_ID = `${NOTIFICATION_ID_PREFIX}:refill`;

/** Budget of pending MeetingGuard notifications (iOS keeps 64; stay well below). */
export const ALERT_NOTIFICATION_BUDGET = 60;
/** How far ahead alerts are scheduled. */
export const ALERT_HORIZON_DAYS = 14;
/** Follow-up fires this many minutes after the meeting ends. */
export const FOLLOW_UP_DELAY_MINUTES = 5;

// ---------------------------------------------------------------------------------------------
// Background tasks (TaskManager.defineTask at module scope in src/services/alerts/tasks.ts)
// ---------------------------------------------------------------------------------------------

export const BACKGROUND_TASKS = {
  /** expo-background-task: reconcile alerts + pull calendars. */
  refresh: 'mg-background-refresh',
  /** expo-notifications registerTaskAsync: action taps while the app is not in foreground (Android). */
  notificationResponse: 'mg-notification-response',
} as const;

/** expo-background-task minimumInterval in minutes (OS minimum 15). */
export const BACKGROUND_REFRESH_INTERVAL_MINUTES = 60;

// ---------------------------------------------------------------------------------------------
// Deep links (scheme from app.config.js)
// ---------------------------------------------------------------------------------------------

export const APP_SCHEME = 'meetingguardai';
export const DEEP_LINK_PREFIX = `${APP_SCHEME}://`;

/**
 * OAuth redirect path for the Microsoft/Outlook PKCE flow (expo-auth-session):
 * `meetingguardai://auth/microsoft`. Handled by expo-auth-session's pending session, never by
 * navigation (parseDeepLink returns 'unknown' for it, which openDeepLink ignores). This exact URI
 * must be registered on the Azure app registration (docs/SETUP.md §10).
 */
export const MS_AUTH_REDIRECT_PATH = 'auth/microsoft';

/** React Navigation linking paths (navigation/linking.ts must use exactly these). */
export const LINKING_PATHS = {
  /** -> route "MeetingDetails" { meetingId } */
  meeting: 'meeting/:meetingId',
  /** -> route "AIChat" { followup?: string } */
  assistant: 'assistant',
} as const;

export function meetingDeepLink(meetingId: string): string {
  assertMeetingId(meetingId);
  return `${DEEP_LINK_PREFIX}meeting/${meetingId}`;
}

export function assistantDeepLink(options: { followUpMeetingId?: string | null } = {}): string {
  const id = options.followUpMeetingId;
  if (id === undefined || id === null) return `${DEEP_LINK_PREFIX}assistant`;
  assertMeetingId(id);
  return `${DEEP_LINK_PREFIX}assistant?followup=${id}`;
}

export type ParsedDeepLink =
  | { type: 'meeting'; meetingId: string }
  | { type: 'assistant'; followUpMeetingId: string | null }
  | { type: 'unknown' };

export function parseDeepLink(url: string): ParsedDeepLink {
  if (typeof url !== 'string' || !url.startsWith(DEEP_LINK_PREFIX)) return { type: 'unknown' };
  const rest = url.slice(DEEP_LINK_PREFIX.length);
  const [pathPart = '', queryPart = ''] = rest.split('?', 2);
  const segments = pathPart.split('/').filter((segment) => segment.length > 0);

  if (segments[0] === 'meeting' && segments.length === 2) {
    const meetingId = safeDecode(segments[1] ?? '');
    return meetingId !== null && MEETING_ID_PATTERN.test(meetingId) ? { type: 'meeting', meetingId } : { type: 'unknown' };
  }
  if (segments[0] === 'assistant' && segments.length === 1) {
    let followUpMeetingId: string | null = null;
    for (const pair of queryPart.split('&')) {
      const [key, value = ''] = pair.split('=', 2);
      if (key === 'followup') {
        const decoded = safeDecode(value);
        followUpMeetingId = decoded !== null && MEETING_ID_PATTERN.test(decoded) ? decoded : null;
      }
    }
    return { type: 'assistant', followUpMeetingId };
  }
  return { type: 'unknown' };
}

/** decodeURIComponent that returns null for malformed input ("%ZZ", "%E0") instead of throwing. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Google Calendar deterministic event ids
// ---------------------------------------------------------------------------------------------

/**
 * Google accepts client-chosen event ids made of base32hex characters [a-v0-9], length 5-1024.
 * MeetingGuard meetings pushed to Google use `mgev` + base32hex(meetingId) (>= 6 chars): inserts are idempotent
 * across retries and devices (a second insert returns 409 instead of creating a duplicate), and a
 * pulled event can be matched back to its meeting even before the id was stored.
 */
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';
const GOOGLE_EVENT_ID_PREFIX = 'mgev';

export function googleEventIdForMeeting(meetingId: string): string {
  assertMeetingId(meetingId);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < meetingId.length; i += 1) {
    value = (value << 8) | meetingId.charCodeAt(i);
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return `${GOOGLE_EVENT_ID_PREFIX}${out}`;
}

/** Inverse of googleEventIdForMeeting; null for events not created by MeetingGuard. */
export function meetingIdFromGoogleEventId(eventId: string): string | null {
  if (!eventId.startsWith(GOOGLE_EVENT_ID_PREFIX)) return null;
  const body = eventId.slice(GOOGLE_EVENT_ID_PREFIX.length);
  if (body.length === 0 || !/^[0-9a-v]+$/.test(body)) return null;
  let bits = 0;
  let value = 0;
  let out = '';
  for (const char of body) {
    value = (value << 5) | BASE32HEX.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out += String.fromCharCode((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  if (value !== 0) return null;
  return MEETING_ID_PATTERN.test(out) && googleEventIdForMeeting(out) === eventId ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Calendar sync windows
// ---------------------------------------------------------------------------------------------

export const CALENDAR_SYNC_WINDOW = {
  /** Past events imported on a full sync. */
  pastDays: 30,
  /**
   * Future events imported on a full sync. 180 (not 365): with singleEvents=true every daily
   * series becomes one meeting document per occurrence (~130 working days in 180 days).
   */
  futureDays: 180,
} as const;
