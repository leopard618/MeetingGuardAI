/**
 * Mappers from the auth domain to the legacy shapes stage-3 screens still read (owner: auth).
 * PURE (unit-tested). Stage 3 migrates the screens and removes these.
 */
import type { LegacyAuthUserView, LegacySignInResult } from '../../core/contracts';
import type { AppErrorCode } from '../../core/errors';
import type { AuthUser } from '../../core/types';

import type { AuthErrorReason } from './authErrors';

/** `user` object of useAuth(): user.id / user.email / user.name / user.picture plus the new names. */
export function toLegacyAuthUserView(user: AuthUser): LegacyAuthUserView {
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email,
    name: user.displayName,
    displayName: user.displayName,
    picture: user.photoURL,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
    providerIds: [...user.providerIds],
  };
}

/**
 * LegacySignInResult plus machine-readable error fields (backward-compatible extension: screens
 * that only read `success` / `error` keep working).
 */
export interface AuthActionResult extends LegacySignInResult {
  errorCode?: AppErrorCode;
  errorReason?: AuthErrorReason | null;
}

export function legacySuccess(user: AuthUser): AuthActionResult {
  return { success: true, user: toLegacyAuthUserView(user) };
}

export function legacyCancelled(): AuthActionResult {
  return { success: false, cancelled: true };
}

export function legacyFailure(message: string, code: AppErrorCode, reason: AuthErrorReason | null): AuthActionResult {
  return { success: false, error: message, errorCode: code, errorReason: reason };
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
