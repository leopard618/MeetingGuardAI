/**
 * PURE helpers of the alert settings (onboarding step 3 and the Settings > Alerts screen;
 * unit-tested). The onboarding step edits the base AlertDraft; the settings screen also edits the
 * snooze length, post-meeting follow-ups and the 12 h / 24 h clock.
 */
import type { Preferences, PreferencesPatch } from '../../core/types';
import { buildAlertPreferencesPatch, draftFromPreferences, isDraftValid, type AlertDraft } from '../onboarding/alertOptions';

/** Snooze lengths offered (Preferences.snoozeMinutes, 1..60). */
export const SNOOZE_OPTIONS: readonly number[] = [5, 10, 15, 30];

/** Clock choices: null = automatic (device / language default). */
export const CLOCK_OPTIONS = ['auto', '12', '24'] as const;
export type ClockOption = (typeof CLOCK_OPTIONS)[number];

export interface AlertSettingsDraft extends AlertDraft {
  followUpEnabled: boolean;
  snoozeMinutes: number;
  use24HourClock: boolean | null;
}

export function settingsDraftFromPreferences(preferences: Preferences): AlertSettingsDraft {
  return {
    ...draftFromPreferences(preferences),
    followUpEnabled: preferences.followUpEnabled,
    snoozeMinutes: preferences.snoozeMinutes,
    use24HourClock: preferences.use24HourClock,
  };
}

export function clockOptionOf(use24HourClock: boolean | null): ClockOption {
  return use24HourClock === null ? 'auto' : use24HourClock ? '24' : '12';
}

export function is24HourFromOption(option: ClockOption): boolean | null {
  return option === 'auto' ? null : option === '24';
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
  if (draft.use24HourClock !== preferences.use24HourClock) patch.use24HourClock = draft.use24HourClock;
  return patch;
}
