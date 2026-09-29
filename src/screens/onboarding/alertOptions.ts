/** PURE helpers of the alert-preferences step (unit-tested). */
import type { AlertIntensity, AlertSoundType, Preferences, PreferencesPatch } from '../../core/types';

/** Reminder offsets offered as chips (minutes before the start). */
export const ALERT_TIME_OPTIONS: readonly number[] = [60, 30, 15, 10, 5, 0];

/** Volume steps offered (Preferences.alertVolume is 0..1). */
export const VOLUME_LEVELS: readonly number[] = [0.4, 0.6, 0.8, 1];

export interface AlertDraft {
  alertEnabled: boolean;
  alertIntensity: AlertIntensity;
  alertSoundType: AlertSoundType;
  alertVolume: number;
  vibrationEnabled: boolean;
  defaultAlertTimes: number[];
}

export function draftFromPreferences(preferences: Preferences): AlertDraft {
  return {
    alertEnabled: preferences.alertEnabled,
    alertIntensity: preferences.alertIntensity,
    alertSoundType: preferences.alertSoundType,
    // Kept as stored (the UI highlights the nearest step) so an untouched value is not rewritten.
    alertVolume: preferences.alertVolume,
    vibrationEnabled: preferences.vibrationEnabled,
    defaultAlertTimes: sortAlertTimes(preferences.defaultAlertTimes),
  };
}

/** Closest offered volume step (ties go to the louder one). */
export function nearestVolumeLevel(volume: number): number {
  let best = VOLUME_LEVELS[VOLUME_LEVELS.length - 1] ?? 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of VOLUME_LEVELS) {
    const distance = Math.abs(level - volume);
    if (distance <= bestDistance + 1e-9) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

/** Unique offsets, largest first (the storage order used by core normalizeAlertTimes). */
export function sortAlertTimes(times: readonly number[]): number[] {
  return [...new Set(times)].sort((a, b) => b - a);
}

/** Adds or removes an offset. */
export function toggleAlertTime(times: readonly number[], minutes: number): number[] {
  return times.includes(minutes) ? times.filter((value) => value !== minutes) : sortAlertTimes([...times, minutes]);
}

/** Chips to show: the offered offsets plus any custom offsets the user already has. */
export function alertTimeChoices(current: readonly number[]): number[] {
  return sortAlertTimes([...ALERT_TIME_OPTIONS, ...current]);
}

/** i18n key + options for an offset chip ("At start", "10 min before", "1 h before"). */
export function alertTimeLabel(minutes: number): { key: string; options?: Record<string, unknown> } {
  if (minutes === 0) return { key: 'onboarding:alerts.times.atStart' };
  if (minutes >= 60 && minutes % 60 === 0) {
    return { key: 'onboarding:alerts.times.hoursBefore', options: { count: minutes / 60 } };
  }
  return { key: 'onboarding:alerts.times.minutesBefore', options: { count: minutes } };
}

export function isDraftValid(draft: AlertDraft): boolean {
  return !draft.alertEnabled || draft.defaultAlertTimes.length > 0;
}

/** Only the fields that differ from the stored preferences (empty object = nothing to save). */
export function buildAlertPreferencesPatch(preferences: Preferences, draft: AlertDraft): PreferencesPatch {
  const patch: PreferencesPatch = {};
  if (draft.alertEnabled !== preferences.alertEnabled) patch.alertEnabled = draft.alertEnabled;
  if (draft.alertIntensity !== preferences.alertIntensity) patch.alertIntensity = draft.alertIntensity;
  if (draft.alertSoundType !== preferences.alertSoundType) patch.alertSoundType = draft.alertSoundType;
  if (draft.alertVolume !== preferences.alertVolume) patch.alertVolume = draft.alertVolume;
  if (draft.vibrationEnabled !== preferences.vibrationEnabled) patch.vibrationEnabled = draft.vibrationEnabled;
  const times = sortAlertTimes(draft.defaultAlertTimes);
  if (times.length > 0 && JSON.stringify(times) !== JSON.stringify(sortAlertTimes(preferences.defaultAlertTimes))) {
    patch.defaultAlertTimes = times;
  }
  return patch;
}
