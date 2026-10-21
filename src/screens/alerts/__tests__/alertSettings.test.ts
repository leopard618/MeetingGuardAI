import { createDefaultPreferences } from '../../../core/types';
import {
  briefingTimeToDate,
  buildAlertSettingsPatch,
  isSettingsDraftValid,
  settingsDraftFromPreferences,
  snoozeChoices,
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

describe('daily briefing settings', () => {
  it('round-trips the briefing switch and time', () => {
    const draft = settingsDraftFromPreferences(prefs);
    expect(draft).toMatchObject({ briefingEnabled: false, briefingTime: '08:00' });
    expect(buildAlertSettingsPatch(prefs, { ...draft, briefingEnabled: true, briefingTime: '07:15' })).toEqual({
      briefingEnabled: true,
      briefingTime: '07:15',
    });
  });

  it('round-trips the full-screen briefing switch', () => {
    const draft = settingsDraftFromPreferences(prefs);
    expect(draft.briefingFullScreen).toBe(false);
    expect(buildAlertSettingsPatch(prefs, { ...draft, briefingFullScreen: true })).toEqual({ briefingFullScreen: true });
  });

  it('refuses a time that would schedule nothing', () => {
    const draft = settingsDraftFromPreferences(prefs);
    expect(isSettingsDraftValid({ ...draft, briefingTime: '7:15' })).toBe(false);
    expect(isSettingsDraftValid({ ...draft, briefingTime: '24:00' })).toBe(false);
    expect(isSettingsDraftValid({ ...draft, briefingTime: '' })).toBe(false);
    expect(isSettingsDraftValid({ ...draft, briefingTime: '23:59' })).toBe(true);
  });

  it('starts the picker at the stored wall-clock time, whatever the date', () => {
    const date = briefingTimeToDate('07:15', new Date('2026-10-05T22:00:00.000Z'));
    expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([7, 15, 0]);
  });

  it('falls back to the default when the stored time is unusable', () => {
    const date = briefingTimeToDate('nonsense', new Date('2026-10-05T22:00:00.000Z'));
    expect([date.getHours(), date.getMinutes()]).toEqual([8, 0]);
  });
});
