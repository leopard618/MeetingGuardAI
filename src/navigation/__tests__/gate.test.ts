import { computeGate, type GateInput } from '../gate';
import {
  ONBOARDING_STEPS,
  isOnboardingStep,
  nextOnboardingStep,
  onboardingStepIndex,
  previousOnboardingStep,
} from '../routes';

const signedIn: GateInput = {
  sessionStatus: 'active',
  isAuthenticated: true,
  preferencesLoaded: true,
  preferencesFailed: false,
  onboardingCompleted: true,
};

describe('computeGate', () => {
  it.each(['initializing', 'starting', 'ending'] as const)('shows the splash while the session is %s', (sessionStatus) => {
    expect(computeGate({ ...signedIn, sessionStatus })).toBe('splash');
  });

  it('shows the auth group when signed out (even with stale preferences)', () => {
    expect(computeGate({ ...signedIn, sessionStatus: 'signed_out', isAuthenticated: false })).toBe('auth');
    expect(computeGate({ ...signedIn, isAuthenticated: false })).toBe('auth');
  });

  it('waits for the preferences before deciding on onboarding', () => {
    expect(computeGate({ ...signedIn, preferencesLoaded: false })).toBe('splash');
    expect(computeGate({ ...signedIn, preferencesLoaded: false, preferencesFailed: true })).toBe('preferences_error');
  });

  it('shows onboarding until it is completed, then the main group', () => {
    expect(computeGate({ ...signedIn, onboardingCompleted: false })).toBe('onboarding');
    expect(computeGate(signedIn)).toBe('main');
  });

  it('keeps cached preferences usable after a later sync error', () => {
    expect(computeGate({ ...signedIn, preferencesFailed: true })).toBe('main');
  });
});

describe('onboarding step order', () => {
  it('has five steps in the brief order', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'OnboardingLanguage',
      'OnboardingCalendars',
      'OnboardingAlerts',
      'OnboardingAssistant',
      'OnboardingFirstMeeting',
    ]);
    expect(onboardingStepIndex('OnboardingAlerts')).toBe(2);
  });

  it('computes next and previous steps', () => {
    expect(nextOnboardingStep('OnboardingLanguage')).toBe('OnboardingCalendars');
    expect(nextOnboardingStep('OnboardingFirstMeeting')).toBeNull();
    expect(previousOnboardingStep('OnboardingCalendars')).toBe('OnboardingLanguage');
    expect(previousOnboardingStep('OnboardingLanguage')).toBeNull();
  });

  it('validates stored step names', () => {
    expect(isOnboardingStep('OnboardingAssistant')).toBe(true);
    expect(isOnboardingStep('Dashboard')).toBe(false);
    expect(isOnboardingStep(null)).toBe(false);
  });
});
