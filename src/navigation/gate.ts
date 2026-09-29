/**
 * PURE app gate: which screen group the root navigator shows.
 *
 *   configuration missing        -> handled before any provider (App.js: NotConfiguredScreen)
 *   session initializing/starting/ending            -> 'splash'
 *   signed out                                      -> 'auth'      (Landing, Privacy, Terms)
 *   signed in, preferences not known yet            -> 'splash'    ('preferences_error' on failure)
 *   signed in, !preferences.onboardingCompleted     -> 'onboarding'
 *   signed in, onboarding completed                 -> 'main'
 *
 * The gate follows the SESSION status (not `isLoading`), so the Landing screen stays mounted while
 * a sign-in call is running.
 */
import type { SessionStatus } from '../core/contracts';

export type AppGate = 'splash' | 'auth' | 'onboarding' | 'main' | 'preferences_error';

export interface GateInput {
  sessionStatus: SessionStatus;
  isAuthenticated: boolean;
  preferencesLoaded: boolean;
  preferencesFailed: boolean;
  onboardingCompleted: boolean;
}

export function computeGate(input: GateInput): AppGate {
  switch (input.sessionStatus) {
    case 'initializing':
    case 'starting':
    case 'ending':
      return 'splash';
    case 'signed_out':
      return 'auth';
    case 'active':
      if (!input.isAuthenticated) return 'auth';
      if (!input.preferencesLoaded) return input.preferencesFailed ? 'preferences_error' : 'splash';
      return input.onboardingCompleted ? 'main' : 'onboarding';
    default: {
      const exhaustive: never = input.sessionStatus;
      return exhaustive;
    }
  }
}
