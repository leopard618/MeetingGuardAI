/**
 * Alert-area constants (owner: alerts). Pure values only: no Expo / React Native imports.
 * Persistent identifiers shared with other areas live in src/core/identifiers.ts; the values here
 * are private to the alerts area (sounds, vibration patterns, timings, extra action ids).
 */
import type { AlertIntensity, NotificationKind } from './types';
import { GLOBAL_STORAGE_KEYS, NOTIFICATION_ACTIONS } from '../../core/identifiers';

// ---------------------------------------------------------------------------------------------
// Sounds (assets/sounds/*.wav, registered in app.config.js expo-notifications "sounds")
// ---------------------------------------------------------------------------------------------

/** MAX alarm: looped in-app, played once by the OS (MAX channel / iOS content.sound). */
export const ALARM_SOUND_FILE = 'meeting_alarm.wav';
/** Softer chime for MEDIUM and LIGHT. */
export const CHIME_SOUND_FILE = 'meeting_chime.wav';

/** Notification sound per intensity (Android < 8 and iOS use content.sound; Android 8+ the channel). */
export function notificationSoundFor(kind: NotificationKind, intensity: AlertIntensity): string {
  if (kind === 'followup') return 'default';
  return intensity === 'max' ? ALARM_SOUND_FILE : CHIME_SOUND_FILE;
}

// ---------------------------------------------------------------------------------------------
// Vibration patterns (ms: [wait, vibrate, wait, vibrate, ...])
// ---------------------------------------------------------------------------------------------

export const CHANNEL_VIBRATION = {
  max: [0, 1000, 400, 1000, 400, 1000, 400, 1500],
  medium: [0, 450, 250, 450],
  light: [0, 250],
  followup: [0, 200],
} as const satisfies Record<AlertIntensity | 'followup', readonly number[]>;

/** In-app MAX vibration (repeated until the alert is handled). */
export const IN_APP_MAX_VIBRATION = [0, 800, 400, 800, 400, 800, 1400] as const;
/** In-app MEDIUM vibration (played once). */
export const IN_APP_MEDIUM_VIBRATION = [0, 400, 250, 400] as const;

// ---------------------------------------------------------------------------------------------
// Timings
// ---------------------------------------------------------------------------------------------

/** Debounce for event-driven reconciles (bursts of meetings:changed). */
export const RECONCILE_DEBOUNCE_MS = 400;
/** Notifications due sooner than this are not handed to the OS (the in-app timer covers them). */
export const MIN_SCHEDULE_LEAD_MS = 2_000;
/** A planned alert this close to a pending snooze of the same meeting is a duplicate (dropped). */
export const SNOOZE_DEDUPE_WINDOW_MS = 2 * 60_000;
/** Fired/acknowledged registry retention. */
export const REGISTRY_RETENTION_MS = 48 * 60 * 60_000;
/** Delivered MAX/MEDIUM notifications still in the tray are re-shown in-app within this window. */
export const PRESENTED_RESHOW_WINDOW_MS = 20 * 60_000;
/** Delivered notifications for meetings that ended this long ago are removed from the tray. */
export const PRESENTED_CLEANUP_AFTER_END_MS = 30 * 60_000;
/** Wait after "app became active" before sweeping the tray (lets a tap response arrive first). */
export const FOREGROUND_SWEEP_DELAY_MS = 800;
/** Largest delay accepted by setTimeout (2^31 - 1 ms). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** MAX: auto-snooze countdown when nobody reacts. */
export const MAX_AUTO_SNOOZE_SECONDS = 60;
/** MAX: volume ramps from alertVolume * RAMP_START_FACTOR to alertVolume over this time. */
export const ALARM_RAMP_DURATION_MS = 20_000;
export const ALARM_RAMP_START_FACTOR = 0.4;
export const ALARM_RAMP_STEP_MS = 1_000;
/** MAX: voice readout delay after the alarm starts, repeat interval and max repetitions. */
export const VOICE_FIRST_DELAY_MS = 1_500;
export const VOICE_REPEAT_MS = 30_000;
export const VOICE_MAX_REPEATS = 3;
/** Alarm volume while the voice is speaking (ducking), as a fraction of the current volume. */
export const VOICE_DUCK_FACTOR = 0.25;
/** LIGHT: can be dismissed after this delay; auto-hides after LIGHT_AUTO_HIDE_MS. */
export const LIGHT_DISMISS_AFTER_MS = 3_000;
export const LIGHT_AUTO_HIDE_MS = 12_000;
/** Chime clip length used to release one-shot players. */
export const CHIME_RELEASE_AFTER_MS = 4_000;

// ---------------------------------------------------------------------------------------------
// Snooze actions
// ---------------------------------------------------------------------------------------------

/**
 * Notification actions of the alert category:
 *   NOTIFICATION_ACTIONS.snooze ('mg-snooze')      -> Preferences.snoozeMinutes
 *   'mg-snooze-<minutes>'                          -> a second, longer snooze (minutes encoded in the id)
 * The minutes are encoded so a tap is exact even if preferences changed after the category was
 * registered (categories are re-registered on every start / language / snooze preference change).
 */
export const SNOOZE_ACTION_PREFIX = `${NOTIFICATION_ACTIONS.snooze}-`;

export function snoozeActionId(minutes: number | null): string {
  return minutes === null ? NOTIFICATION_ACTIONS.snooze : `${SNOOZE_ACTION_PREFIX}${minutes}`;
}

/** null = not a snooze action; { minutes: null } = default snooze length. */
export function parseSnoozeAction(actionIdentifier: string): { minutes: number | null } | null {
  if (actionIdentifier === NOTIFICATION_ACTIONS.snooze) return { minutes: null };
  if (!actionIdentifier.startsWith(SNOOZE_ACTION_PREFIX)) return null;
  const raw = actionIdentifier.slice(SNOOZE_ACTION_PREFIX.length);
  if (!/^\d{1,3}$/.test(raw)) return null;
  const minutes = Number(raw);
  return minutes >= 1 && minutes <= 120 ? { minutes } : null;
}

/** Snooze choices offered by the MAX modal and the notification buttons: [default, longer]. */
export function snoozeChoices(defaultMinutes: number): [number, number] {
  const base = Math.min(60, Math.max(1, Math.round(defaultMinutes)));
  const longer = base < 10 ? 10 : Math.min(60, base * 2);
  return [base, longer === base ? Math.min(120, base + 5) : longer];
}

// ---------------------------------------------------------------------------------------------
// Device-level storage (not tied to a user)
// ---------------------------------------------------------------------------------------------

/** Handled notification responses (snooze de-duplication across headless/foreground runs). */
export const HANDLED_RESPONSES_STORAGE_KEY = GLOBAL_STORAGE_KEYS.alertResponses;
export const HANDLED_RESPONSES_MAX = 50;

// ---------------------------------------------------------------------------------------------
// Legacy (pre-rebuild) notification artefacts removed on start
// ---------------------------------------------------------------------------------------------

export const LEGACY_CHANNEL_IDS = ['meeting-alerts', 'urgent-meeting-alerts', 'persistent-meeting'] as const;
export const LEGACY_PERSISTENT_NOTIFICATION_ID = 'persistent-meeting-notification';
