/**
 * Helpers shared by the auth area's legacy shims (src/services/firebaseAuth.js,
 * src/api/googleTokenManager.js, src/api/manualLoginGoogleCalendarService.js). Layer L3: imports
 * only authService, i18n and core, so calendar-owned legacy modules can use the shims without
 * pulling in the session manager. Stage 3 deletes the shims and this file.
 */
import { toAppError } from '../../core/errors';
import { t } from '../../i18n';

import { authErrorMessageKey, getAuthErrorReason } from './authErrors';
import { authService } from './authService';
import { legacyCancelled, legacyFailure, legacySuccess, type AuthActionResult } from './legacyView';

/**
 * A Google access token with the Calendar scope, or null when there is no Google account on the
 * device or the Calendar scope was never granted (the legacy "not connected" signal).
 * Any other failure (offline, Google error) is thrown as an AppError.
 */
export async function getCalendarAccessTokenOrNull(): Promise<string | null> {
  try {
    return await authService.getGoogleAccessToken({ requireCalendar: true });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'google_not_signed_in' || appError.code === 'calendar_scope_missing') return null;
    throw appError;
  }
}

/** Localized, user-presentable message for an auth/calendar error. */
export function legacyErrorMessage(error: unknown): string {
  return t(authErrorMessageKey(error));
}

/** Converts a thrown error into the legacy `{ success: false, error }` shape (cancel is not an error). */
export function legacyErrorResult(error: unknown): AuthActionResult {
  const appError = toAppError(error);
  if (appError.code === 'cancelled') return legacyCancelled();
  return legacyFailure(legacyErrorMessage(appError), appError.code, getAuthErrorReason(appError));
}

export async function legacyGoogleSignIn(): Promise<AuthActionResult> {
  try {
    const result = await authService.signInWithGoogle();
    return result.status === 'success' ? legacySuccess(result.user) : legacyCancelled();
  } catch (error) {
    return legacyErrorResult(error);
  }
}

export async function legacyEmailSignIn(email: string, password: string): Promise<AuthActionResult> {
  try {
    return legacySuccess(await authService.signInWithEmail(email, password));
  } catch (error) {
    return legacyErrorResult(error);
  }
}

export async function legacyEmailSignUp(email: string, password: string, name: string): Promise<AuthActionResult> {
  try {
    return legacySuccess(await authService.signUpWithEmail(email, password, name));
  } catch (error) {
    return legacyErrorResult(error);
  }
}
