/**
 * Startup purge of pre-rebuild credentials (owner: data). Imported by index.js before any session.
 *
 * The old app kept plaintext tokens (Google refresh/access tokens, backend JWTs, the PKCE
 * verifier) and identity copies in AsyncStorage. Upgraded users start signed out (the auth system
 * changed), so waiting for the first successful sign-in to run the migration would leave those
 * tokens on the device (and in Android backups) indefinitely. This removes every legacy key at
 * each start except the legacy data blob (`meetingguard_data`), which the migration still needs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { KeyValueStorage } from './cache';
import { removeLegacyKeys } from './migration';

const log = createLogger('data.legacy');

/** Removes every legacy token / identity / alert key; never throws (failures are logged). */
export async function purgeLegacyCredentials(storage: Pick<KeyValueStorage, 'getAllKeys' | 'multiRemove'> = AsyncStorage): Promise<number> {
  try {
    const removed = await removeLegacyKeys(storage);
    if (removed > 0) log.info(`removed ${removed} legacy storage key(s) at startup`);
    return removed;
  } catch (error) {
    log.warn(`could not remove legacy storage keys at startup (${toAppError(error).code})`);
    return 0;
  }
}
