import { createDefaultPreferences } from '../../../core/types';
import { buildAlertSettingsPatch, isSettingsDraftValid, settingsDraftFromPreferences, snoozeChoices } from '../alertSettings';

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
    };
    expect(buildAlertSettingsPatch(prefs, draft)).toEqual({
      alertEnabled: false,
      alertSoundType: 'voice_only',
      vibrationEnabled: false,
      defaultAlertTimes: [30, 0],
      followUpEnabled: false,
      snoozeMinutes: 15,
    });
  });

  it('offers the stored snooze length', () => {
    expect(snoozeChoices(7)).toEqual([5, 7, 10, 15, 30]);
  });

  it('leaves the clock to Settings > Time format', () => {
    expect(buildAlertSettingsPatch({ ...prefs, use24HourClock: true }, settingsDraftFromPreferences(prefs))).toEqual({});
  });

  it('needs a reminder time while alerts are on and a valid snooze length', () => {
    const draft = settingsDraftFromPreferences(prefs);
    expect(isSettingsDraftValid({ ...draft, defaultAlertTimes: [] })).toBe(false);
    expect(isSettingsDraftValid({ ...draft, alertEnabled: false, defaultAlertTimes: [] })).toBe(true);
    expect(isSettingsDraftValid({ ...draft, snoozeMinutes: 0 })).toBe(false);
  });
});
