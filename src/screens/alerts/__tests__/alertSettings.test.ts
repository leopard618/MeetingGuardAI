import { createDefaultPreferences } from '../../../core/types';
import {
  buildAlertSettingsPatch,
  clockOptionOf,
  isSettingsDraftValid,
  settingsDraftFromPreferences,
  snoozeChoices,
  is24HourFromOption,
} from '../alertSettings';

const prefs = createDefaultPreferences({ language: 'en', timezone: 'UTC' });

describe('alert settings model', () => {
  it('saves nothing when nothing changed', () => {
    expect(buildAlertSettingsPatch(prefs, settingsDraftFromPreferences(prefs))).toEqual({});
  });

  it('patches every alert preference the settings screen edits', () => {
    const draft = {
      ...settingsDraftFromPreferences(prefs),
      alertEnabled: false,
      alertSoundType: 'voice_only' as const,
      vibrationEnabled: false,
      defaultAlertTimes: [30, 0],
      followUpEnabled: false,
      snoozeMinutes: 15,
      use24HourClock: true,
    };
    expect(buildAlertSettingsPatch(prefs, draft)).toEqual({
      alertEnabled: false,
      alertSoundType: 'voice_only',
      vibrationEnabled: false,
      defaultAlertTimes: [30, 0],
      followUpEnabled: false,
      snoozeMinutes: 15,
      use24HourClock: true,
    });
  });

  it('maps the clock choice and offers the stored snooze length', () => {
    expect(clockOptionOf(null)).toBe('auto');
    expect(clockOptionOf(false)).toBe('12');
    expect(is24HourFromOption('24')).toBe(true);
    expect(is24HourFromOption('auto')).toBeNull();
    expect(snoozeChoices(7)).toEqual([5, 7, 10, 15, 30]);
  });

  it('needs a reminder time while alerts are on and a valid snooze length', () => {
    const draft = settingsDraftFromPreferences(prefs);
    expect(isSettingsDraftValid({ ...draft, defaultAlertTimes: [] })).toBe(false);
    expect(isSettingsDraftValid({ ...draft, alertEnabled: false, defaultAlertTimes: [] })).toBe(true);
    expect(isSettingsDraftValid({ ...draft, snoozeMinutes: 0 })).toBe(false);
  });
});
