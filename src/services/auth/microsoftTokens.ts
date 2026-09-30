/**
 * Microsoft refresh-token storage for Outlook sync (owner: auth; L3, no session code).
 *
 * The ONLY token the app ever persists (SECURE_STORE_KEYS): the Microsoft refresh token, in
 * expo-secure-store (Android Keystore / iOS Keychain), keyed per uid so switching accounts never
 * leaks a token across users. Access tokens stay in memory in the outlook service.
 *
 * - clearMicrosoftToken(uid) runs on Outlook disconnect and on session end (the outlook wiring
 *   registers a session-cleanup hook).
 * - SecureStore can throw on some devices (keystore unavailable). A failed READ throws
 *   AppError('calendar_not_connected'): callers treat it as "not connected", never as success.
 * - This module is L3 (like authService): no imports from the auth barrel, data or calendar.
 */
import * as SecureStore from 'expo-secure-store';

import { AppError } from '../../core/errors';
import { SECURE_STORE_KEYS } from '../../core/identifiers';
import { createLogger } from '../../core/logger';

const log = createLogger('auth');

/** Readable after the first unlock so background syncs work; never migrated to another device. */
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** Persists the refresh token for `uid` (expo-secure-store, SECURE_STORE_KEYS.microsoftRefreshToken). */
export async function saveMicrosoftRefreshToken(uid: string, refreshToken: string): Promise<void> {
  if (refreshToken.length === 0) throw new AppError('invalid_input', 'Empty Microsoft refresh token');
  try {
    await SecureStore.setItemAsync(SECURE_STORE_KEYS.microsoftRefreshToken(uid), refreshToken, STORE_OPTIONS);
  } catch (error) {
    // Without a stored refresh token the connection cannot survive a restart: fail the connect.
    log.warn('Could not store the Microsoft refresh token');
    throw new AppError('calendar_not_connected', 'Secure storage is unavailable on this device', { cause: error });
  }
}

/** The stored refresh token, or null when absent (= Outlook not connected on this device). */
export async function getMicrosoftRefreshToken(uid: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_STORE_KEYS.microsoftRefreshToken(uid), STORE_OPTIONS);
  } catch (error) {
    // Never treat an unreadable keystore as "connected" or as "cleanly disconnected".
    throw new AppError('calendar_not_connected', 'Secure storage could not be read', { cause: error });
  }
}

/** Deletes the stored token (disconnect, sign-out, account deletion). Idempotent. */
export async function clearMicrosoftToken(uid: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_STORE_KEYS.microsoftRefreshToken(uid), STORE_OPTIONS);
  } catch (error) {
    // Deleting a missing/unreadable entry must not block sign-out; log and continue.
    log.warn('Could not delete the Microsoft refresh token', { name: (error as Error)?.name });
  }
}
