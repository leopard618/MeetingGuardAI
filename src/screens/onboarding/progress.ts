/**
 * Resumable onboarding: the last visited step is stored per user in AsyncStorage under
 * `mg:{uid}:onboarding.step` (inside the user prefix, so sign-out wipes it with the rest of the
 * user's local data). Completion itself is Preferences.onboardingCompleted (synced).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { toAppError } from '../../core/errors';
import { USER_STORAGE, userStorageKey } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { isOnboardingStep, type OnboardingStep } from '../../navigation/routes';

const log = createLogger('onboarding');

/** Storage name of the resume marker. */
export const ONBOARDING_STEP_STORAGE_NAME = USER_STORAGE.onboarding;

export function onboardingStepKey(uid: string): string {
  return userStorageKey(uid, USER_STORAGE.onboarding);
}

/** The stored step, or null (none stored, invalid value). Throws AppError when storage fails. */
export async function loadOnboardingStep(uid: string): Promise<OnboardingStep | null> {
  try {
    const value = await AsyncStorage.getItem(onboardingStepKey(uid));
    return isOnboardingStep(value) ? value : null;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function saveOnboardingStep(uid: string, step: OnboardingStep): Promise<void> {
  try {
    await AsyncStorage.setItem(onboardingStepKey(uid), step);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function clearOnboardingStep(uid: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(onboardingStepKey(uid));
  } catch (error) {
    throw toAppError(error);
  }
}

export interface OnboardingResume {
  /** false while the stored step is being read. */
  loaded: boolean;
  /** Step to resume at (null = start from the first step). */
  step: OnboardingStep | null;
}

/** Reads the resume step for `uid` (pass null when onboarding is not shown). */
export function useOnboardingResume(uid: string | null): OnboardingResume {
  const [result, setResult] = useState<{ uid: string; step: OnboardingStep | null } | null>(null);

  useEffect(() => {
    if (uid === null) return undefined;
    let active = true;
    loadOnboardingStep(uid).then(
      (step) => {
        if (active) setResult({ uid, step });
      },
      (error: unknown) => {
        // Resuming is a convenience: start from the first step rather than blocking the user.
        log.warn('could not read the onboarding progress; starting from the first step', toAppError(error).code);
        if (active) setResult({ uid, step: null });
      },
    );
    return () => {
      active = false;
    };
  }, [uid]);

  if (uid === null) return { loaded: true, step: null };
  return result !== null && result.uid === uid ? { loaded: true, step: result.step } : { loaded: false, step: null };
}
