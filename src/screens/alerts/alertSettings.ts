/**
 * PURE helpers of the alert settings (onboarding step 3 and the Settings > Alerts screen;
 * unit-tested). The onboarding step edits the base AlertDraft; the settings screen also edits the
 * snooze length and post-meeting follow-ups. (The 12 h / 24 h clock is in Settings > Time format.)
 */
import type { Preferences, PreferencesPatch } from '../../core/types';
import { buildAlertPreferencesPatch, draftFromPreferences, isDraftValid, type AlertDraft } from '../onboarding/alertOptions';

/** Snooze lengths offered (Preferences.snoozeMinutes, 1..60). */
export const SNOOZE_OPTIONS: readonly number[] = [5, 10, 15, 30];

export interface AlertSettingsDraft extends AlertDraft {
  followUpEnabled: boolean;
  snoozeMinutes: number;
}

export function settingsDraftFromPreferences(preferences: Preferences): AlertSettingsDraft {
  return {
    ...draftFromPreferences(preferences),
    followUpEnabled: preferences.followUpEnabled,
    snoozeMinutes: preferences.snoozeMinutes,
  };
}

/** Snooze choices to show: the offered ones plus the stored value when it is custom. */
export function snoozeChoices(current: number): number[] {
  return [...new Set([...SNOOZE_OPTIONS, current])].filter((value) => value >= 1 && value <= 60).sort((a, b) => a - b);
}

export function isSettingsDraftValid(draft: AlertSettingsDraft): boolean {
  return isDraftValid(draft) && Number.isInteger(draft.snoozeMinutes) && draft.snoozeMinutes >= 1 && draft.snoozeMinutes <= 60;
}

/** Only the fields that differ from the stored preferences (empty object = nothing to save). */
export function buildAlertSettingsPatch(preferences: Preferences, draft: AlertSettingsDraft): PreferencesPatch {
  const patch = buildAlertPreferencesPatch(preferences, draft);
  if (draft.followUpEnabled !== preferences.followUpEnabled) patch.followUpEnabled = draft.followUpEnabled;
  if (draft.snoozeMinutes !== preferences.snoozeMinutes) patch.snoozeMinutes = draft.snoozeMinutes;
  return patch;
}
