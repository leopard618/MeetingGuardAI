/**
 * "Verify your email" banner (owner: email-auth) - STUB rendering nothing. Design:
 * docs/ARCHITECTURE.md §25. i18n: auth:verify.* (EN+ES already present).
 *
 * Where it mounts: AssistantScreen above the thread (the assistant callable REJECTS unverified
 * accounts server-side), and the AI intro entry points that lead into the assistant. The
 * Settings account section shows the same state as a line (auth:verify.verified /
 * auth:verify.notVerified), not this banner.
 *
 * Implementation notes for the email-auth pass:
 * - Visible iff needsEmailVerification(useAuth().authUser) below.
 * - Body auth:verify.assistantBody; actions: auth:verify.resend -> useAuth().resendVerification()
 *   (success toast auth:verify.resent), auth:verify.check ("I verified") ->
 *   useAuth().refreshUser(); still unverified afterwards -> auth:verify.stillUnverified.
 * - The assistant's server error for an unverified caller (HttpsError unauthenticated) must show
 *   the SAME auth:verify.assistantBody message when needsEmailVerification() is true, so the
 *   gate reads identically on both paths.
 * - Theme colors from useTheme(); accessibility roles on both actions; render test required.
 */
import type { ReactElement } from 'react';

import type { AuthUser } from '../../core/types';

/**
 * The assistant requires `email_verified` OR sign-in provider google.com
 * (functions/src/assistant/handler.ts); mirror that rule client-side.
 */
export function needsEmailVerification(user: AuthUser | null): boolean {
  if (user === null) return false;
  return !user.emailVerified && !user.providerIds.includes('google.com');
}

export function VerifyEmailBanner(): ReactElement | null {
  return null;
}
