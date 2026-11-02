/**
 * Result shapes of the sign-in actions exposed by useAuth() (owner: auth). PURE (unit-tested).
 * Screens read `success` / `cancelled` / `error` (a localized message) and, when they need to
 * branch, the machine-readable `errorCode` / `errorReason`.
 */
import type { SignInActionResult } from '../../core/contracts';
import type { AppErrorCode } from '../../core/errors';
import type { AuthUser } from '../../core/types';

import type { AuthErrorReason } from './authErrors';

/** SignInActionResult plus machine-readable error fields. */
export interface AuthActionResult extends SignInActionResult {
  errorCode?: AppErrorCode;
  errorReason?: AuthErrorReason | null;
}

export function authSuccess(user: AuthUser): AuthActionResult {
  return { success: true, user };
}

export function authCancelled(): AuthActionResult {
  return { success: false, cancelled: true };
}

export function authFailure(message: string, code: AppErrorCode, reason: AuthErrorReason | null): AuthActionResult {
  return { success: false, error: message, errorCode: code, errorReason: reason };
}

/**
 * Signed in through the microsoftSignIn callable (docs/v1/ARCHITECTURE.md section 31): a
 * custom-token session has no providerData, so an empty provider list is the Microsoft case.
 */
export function signedInWithMicrosoft(user: Pick<AuthUser, 'providerIds'> | null): boolean {
  return user !== null && user.providerIds.length === 0;
}

/** Same identity fields (used to decide whether a same-uid auth event changed the profile). */
export function sameIdentity(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.uid === b.uid &&
    a.email === b.email &&
    a.displayName === b.displayName &&
    a.photoURL === b.photoURL &&
    a.emailVerified === b.emailVerified &&
    a.providerIds.length === b.providerIds.length &&
    a.providerIds.every((id, index) => b.providerIds[index] === id)
  );
}
