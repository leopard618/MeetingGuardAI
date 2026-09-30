/**
 * Microsoft refresh-token storage for Outlook sync (owner: auth; NEW FILE, no session code).
 *
 * ARCHITECT STUB: the real implementation wraps expo-secure-store (REQUESTED from the integrator;
 * not installed yet) under the keys in SECURE_STORE_KEYS. Contract:
 * - Only the REFRESH token is ever persisted (access tokens stay in memory in the outlook
 *   service). Keys are per uid, so switching accounts never leaks a token across users.
 * - clearMicrosoftToken(uid) runs on Outlook disconnect and on session end (sessionCleanup).
 * - SecureStore can throw on some devices (keystore unavailable): callers treat a failed read as
 *   "not connected" (AppError('calendar_not_connected')), never as success.
 * - This module is L3 (like authService): no imports from the auth barrel, data or calendar.
 */
import { notImplemented } from '../../core/errors';

/** Persists the refresh token for `uid` (expo-secure-store, SECURE_STORE_KEYS.microsoftRefreshToken). */
export function saveMicrosoftRefreshToken(_uid: string, _refreshToken: string): Promise<void> {
  return Promise.reject(stub('saveMicrosoftRefreshToken'));
}

/** The stored refresh token, or null when absent (= Outlook not connected on this device). */
export function getMicrosoftRefreshToken(_uid: string): Promise<string | null> {
  return Promise.reject(stub('getMicrosoftRefreshToken'));
}

/** Deletes the stored token (disconnect, sign-out, account deletion). Idempotent. */
export function clearMicrosoftToken(_uid: string): Promise<void> {
  return Promise.reject(stub('clearMicrosoftToken'));
}

function stub(name: string): Error {
  try {
    notImplemented(`microsoftTokens.${name}`);
  } catch (error) {
    return error as Error;
  }
  return new Error(name);
}
