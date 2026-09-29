/**
 * Compat shim (owner: auth) for the pre-rebuild Google token manager. Stage 3 removes it.
 *
 * Tokens are no longer stored or refreshed by the app: the native Google Sign-In SDK issues fresh
 * access tokens on demand (authService.getGoogleAccessToken). New code uses authService directly.
 */
import { authService } from '../services/auth/authService';
import { getCalendarAccessTokenOrNull } from '../services/auth/legacyCompat';

class GoogleTokenManager {
  /**
   * Google access token with the Calendar scope, or null when Calendar is not connected.
   * Other failures (offline, Google errors) reject with an AppError.
   */
  getValidAccessToken() {
    return getCalendarAccessTokenOrNull();
  }

  /** Whether the Calendar scope is granted on this device. */
  hasValidAccess() {
    return authService.hasCalendarScope();
  }

  /** After a 401 from a Google API: drop the cached token so the next request gets a new one. */
  invalidateToken(token) {
    return authService.invalidateGoogleAccessToken(token);
  }
}

export const googleTokenManager = new GoogleTokenManager();
export default googleTokenManager;
