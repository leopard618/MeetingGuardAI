import AsyncStorage from '@react-native-async-storage/async-storage';

import { createDefaultPreferences } from '../../../core/types';
import {
  ALERT_TIME_OPTIONS,
  alertTimeChoices,
  alertTimeLabel,
  buildAlertPreferencesPatch,
  draftFromPreferences,
  isDraftValid,
  nearestVolumeLevel,
  toggleAlertTime,
} from '../alertOptions';
import { clearOnboardingStep, loadOnboardingStep, onboardingStepKey, saveOnboardingStep } from '../progress';

const prefs = createDefaultPreferences({ language: 'en', timezone: 'UTC' });

describe('alert time helpers', () => {
  it('toggles offsets and keeps them unique, largest first', () => {
    expect(toggleAlertTime([15, 5, 0], 30)).toEqual([30, 15, 5, 0]);
    expect(toggleAlertTime([30, 15, 5, 0], 15)).toEqual([30, 5, 0]);
  });

  it('offers the standard chips plus custom offsets', () => {
    expect(alertTimeChoices([20])).toEqual([60, 30, 20, 15, 10, 5, 0]);
    expect(alertTimeChoices([])).toEqual([...ALERT_TIME_OPTIONS]);
  });

  it('labels offsets', () => {
    expect(alertTimeLabel(0)).toEqual({ key: 'onboarding:alerts.times.atStart' });
    expect(alertTimeLabel(10)).toEqual({ key: 'onboarding:alerts.times.minutesBefore', options: { count: 10 } });
    expect(alertTimeLabel(120)).toEqual({ key: 'onboarding:alerts.times.hoursBefore', options: { count: 2 } });
    expect(alertTimeLabel(90)).toEqual({ key: 'onboarding:alerts.times.minutesBefore', options: { count: 90 } });
  });
});

describe('volume', () => {
  it.each([
    [0, 0.4],
    [0.5, 0.6],
    [0.7, 0.8],
    [0.75, 0.8],
    [1, 1],
  ])('%p -> %p', (volume, expected) => {
    expect(nearestVolumeLevel(volume)).toBe(expected);
  });
});

describe('alert preferences patch', () => {
  it('is empty when nothing changed (an untouched volume is not rewritten)', () => {
    const custom = { ...prefs, alertVolume: 0.75 };
    expect(buildAlertPreferencesPatch(custom, draftFromPreferences(custom))).toEqual({});
  });

  it('contains only the changed fields', () => {
    const draft = { ...draftFromPreferences(prefs), alertIntensity: 'light' as const, defaultAlertTimes: [30, 0] };
    expect(buildAlertPreferencesPatch(prefs, draft)).toEqual({ alertIntensity: 'light', defaultAlertTimes: [30, 0] });
  });

  it('requires at least one reminder while alerts are on', () => {
    const draft = { ...draftFromPreferences(prefs), defaultAlertTimes: [] };
    expect(isDraftValid(draft)).toBe(false);
    expect(isDraftValid({ ...draft, alertEnabled: false })).toBe(true);
    expect(buildAlertPreferencesPatch(prefs, { ...draft, alertEnabled: false })).toEqual({ alertEnabled: false });
  });
});

describe('onboarding progress storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('stores the step inside the per-user prefix (wiped on sign-out)', async () => {
    expect(onboardingStepKey('u1')).toBe('mg:u1:onboarding.step');
    await saveOnboardingStep('u1', 'OnboardingAlerts');
    expect(await loadOnboardingStep('u1')).toBe('OnboardingAlerts');
    expect(await loadOnboardingStep('u2')).toBeNull();
    await clearOnboardingStep('u1');
    expect(await loadOnboardingStep('u1')).toBeNull();
  });

  it('ignores unknown stored values', async () => {
    await AsyncStorage.setItem('mg:u1:onboarding.step', 'Dashboard');
    expect(await loadOnboardingStep('u1')).toBeNull();
  });
});
