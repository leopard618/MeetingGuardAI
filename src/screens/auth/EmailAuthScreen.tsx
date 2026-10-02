/**
 * Email/password sign-in and account creation (owner: email-auth) - STUB rendering nothing.
 * Route "EmailAuth" in the Auth stack, reached from Landing's "Continue with email" button.
 * Design: docs/ARCHITECTURE.md §25. i18n namespace: auth (auth:emailAuth.*, auth:verify.*).
 *
 * Implementation notes for the email-auth pass:
 * - Mode toggle sign-in / create-account; email + password fields (secureTextEntry with a
 *   show/hide toggle, textContentType/autoComplete autofill hints, keyboard-safe via ScreenBody),
 *   optional name field on create; submit through useAuth().signInWithEmail / signUpWithEmail
 *   (they return AuthActionResult with a localized message - never throw).
 * - Inline forgot-password flow: useAuth().sendPasswordReset + auth:emailAuth.resetSent state.
 * - After create: auth:emailAuth.verificationSent note (the verification email is sent by the
 *   service, non-blocking); navigation proceeds like any sign-in (the session gate switches).
 * - Bad credentials always show the ONE generic auth:errors.invalidCredentials message
 *   (authErrors.ts maps invalid-credential/user-not-found/wrong-password together, no account
 *   enumeration); auth/operation-not-allowed shows auth:errors.providerDisabled (owner hint:
 *   enable the provider, docs/SETUP.md §13).
 */
import type { ReactElement } from 'react';

export function EmailAuthScreen(): ReactElement | null {
  return null;
}
