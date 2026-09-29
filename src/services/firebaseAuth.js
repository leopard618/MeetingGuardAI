/**
 * Compat shim (owner: auth) for the pre-rebuild Firebase auth service. Stage 3 removes it.
 *
 * Everything delegates to src/services/auth (native Google Sign-In + Firebase Auth). Nothing is
 * stored: Google access tokens come from the native SDK on demand. New code uses
 * `authService` (src/services/auth/authService.ts) or `useAuth()` instead.
 *
 * Only authService (layer L3) is imported statically: calendar-owned legacy modules import this
 * file, and the session manager (L6) imports the calendar area.
 */
import { AppError } from '../core/errors';

import { authService } from './auth/authService';
import {
  getCalendarAccessTokenOrNull,
  legacyEmailSignIn,
  legacyEmailSignUp,
  legacyErrorResult,
  legacyGoogleSignIn,
} from './auth/legacyCompat';

const firebaseAuthService = {
  /** @returns {Promise<{ success: boolean, cancelled?: boolean, user?: object, error?: string }>} */
  signInWithGoogle() {
    return legacyGoogleSignIn();
  },

  signInWithEmail(email, password) {
    return legacyEmailSignIn(email, password);
  },

  signUpWithEmail(email, password, name) {
    return legacyEmailSignUp(email, password, name);
  },

  /** Full session sign-out (alerts, calendar, local data, Google, Firebase). */
  async signOut() {
    try {
      const { sessionManager } = await import('./auth');
      await sessionManager.signOut();
      return { success: true };
    } catch (error) {
      return legacyErrorResult(error);
    }
  },

  /** The signed-in user ({ uid, email, displayName, photoURL, emailVerified, providerIds }) or null. */
  getCurrentUser() {
    return authService.currentUser;
  },

  /** Fresh Google access token with the Calendar scope, or null when Calendar is not connected. */
  getGoogleCalendarAccessToken() {
    return getCalendarAccessTokenOrNull();
  },

  /** The native Google SDK refreshes tokens itself; this returns a fresh one (or null). */
  refreshGoogleCalendarAccessToken() {
    return getCalendarAccessTokenOrNull();
  },

  /** Listener receives the signed-in user ({ uid, email, ... }) or null. */
  onAuthStateChanged(callback) {
    return authService.onAuthStateChanged(callback);
  },

  async sendPasswordReset(email) {
    try {
      await authService.sendPasswordReset(email);
      return { success: true };
    } catch (error) {
      return legacyErrorResult(error);
    }
  },

  /** Removed: exchanging an OAuth code needs the client secret, which never ships in the app. */
  async exchangeCodeForTokens() {
    throw new AppError('unsupported', 'OAuth code exchange is not available in the app');
  },
};

export default firebaseAuthService;
