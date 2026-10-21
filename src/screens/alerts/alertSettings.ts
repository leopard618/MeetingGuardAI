/**
 * PURE helpers of the alert settings (onboarding step 3 and the Settings > Alerts screen;
 * unit-tested). The onboarding step edits the base AlertDraft; the settings screen also edits the
 * snooze length and post-meeting follow-ups. (The 12 h / 24 h clock is in Settings > Time format.)
 */
import { DEFAULT_BRIEFING_TIME, localTimeSchema, type Preferences, type PreferencesPatch } from '../../core/types';
import { buildAlertPreferencesPatch, draftFromPreferences, isDraftValid, type AlertDraft } from '../onboarding/alertOptions';

/** Snooze lengths offered (Preferences.snoozeMinutes, 1..60). */
export const SNOOZE_OPTIONS: readonly number[] = [5, 10, 15, 30];

export interface AlertSettingsDraft extends AlertDraft {
  followUpEnabled: boolean;
  snoozeMinutes: number;
  briefingEnabled: boolean;
  /** Local time of day "HH:mm"; only meaningful while briefingEnabled. */
  briefingTime: string;
  statusNotificationEnabled: boolean;
  /** Android: fire the briefing full-screen instead of as a notification. */
  briefingFullScreen: boolean;
}

export function settingsDraftFromPreferences(preferences: Preferences): AlertSettingsDraft {
  return {
    ...draftFromPreferences(preferences),
    followUpEnabled: preferences.followUpEnabled,
    snoozeMinutes: preferences.snoozeMinutes,
    briefingEnabled: preferences.briefingEnabled,
    briefingTime: preferences.briefingTime,
    statusNotificationEnabled: preferences.statusNotificationEnabled,
    briefingFullScreen: preferences.briefingFullScreen,
  };
}

/**
 * Initial value for the briefing time picker: today at that local wall-clock time. The picker
 * reads the local hour and minute off the Date, so only those two fields matter. An unparseable
 * stored value falls back to the default rather than showing the current time.
 */
export function briefingTimeToDate(time: string, now: Date = new Date()): Date {
  const usable = localTimeSchema.safeParse(time).success ? time : DEFAULT_BRIEFING_TIME;
  const [hours, minutes] = usable.split(':');
  const date = new Date(now.getTime());
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date;
}

/** Snooze choices to show: the offered ones plus the stored value when it is custom. */
export function snoozeChoices(current: number): number[] {
  return [...new Set([...SNOOZE_OPTIONS, current])].filter((value) => value >= 1 && value <= 60).sort((a, b) => a - b);
}

export function isSettingsDraftValid(draft: AlertSettingsDraft): boolean {
  if (!isDraftValid(draft)) return false;
  if (!Number.isInteger(draft.snoozeMinutes) || draft.snoozeMinutes < 1 || draft.snoozeMinutes > 60) return false;
  // An unparseable time would schedule nothing at all, so it must never reach the preferences.
  return localTimeSchema.safeParse(draft.briefingTime).success;
}

/** Only the fields that differ from the stored preferences (empty object = nothing to save). */
export function buildAlertSettingsPatch(preferences: Preferences, draft: AlertSettingsDraft): PreferencesPatch {
  const patch = buildAlertPreferencesPatch(preferences, draft);
  if (draft.followUpEnabled !== preferences.followUpEnabled) patch.followUpEnabled = draft.followUpEnabled;
  if (draft.snoozeMinutes !== preferences.snoozeMinutes) patch.snoozeMinutes = draft.snoozeMinutes;
  if (draft.briefingEnabled !== preferences.briefingEnabled) patch.briefingEnabled = draft.briefingEnabled;
  if (draft.briefingTime !== preferences.briefingTime) patch.briefingTime = draft.briefingTime;
  if (draft.statusNotificationEnabled !== preferences.statusNotificationEnabled) {
    patch.statusNotificationEnabled = draft.statusNotificationEnabled;
  }
  if (draft.briefingFullScreen !== preferences.briefingFullScreen) patch.briefingFullScreen = draft.briefingFullScreen;
  return patch;
}
