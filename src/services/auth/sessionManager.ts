/**
 * Session orchestration (owner: auth) - layer L6: wires the real services into the session core.
 *
 * May import data, authService, calendar and alerts. The start/end order is documented on
 * SessionManager in src/core/contracts.ts, in docs/ARCHITECTURE.md and in ./sessionCore.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { appEvents } from '../../core/events';
import { LEGACY_STORAGE_KEYS } from '../../core/identifiers';
import { createLogger } from '../../core/logger';
import { alertEngine } from '../alerts';
import { calendarSyncEngine } from '../calendar';
import { dataService, userRepository } from '../data';

import { authService } from './authService';
import { registerSessionCleanup, sessionCleanupRegistry } from './sessionCleanup';
import { createSessionManager, type SessionManagerImpl } from './sessionCore';

type LegacyStorageKey = (typeof LEGACY_STORAGE_KEYS)[number];

/**
 * Plaintext credentials written by the pre-rebuild app. The data migration deletes every legacy
 * key after importing; these are also removed on every sign-out so no token outlives a session
 * (the legacy data blob and identity keys stay for the migration).
 */
export const LEGACY_CREDENTIAL_KEYS = [
  'authToken',
  'google_access_token',
  'google_refresh_token',
  'google_token_expiry',
  'google_calendar_tokens',
  'google_calendar_access_token',
] as const satisfies readonly LegacyStorageKey[];

registerSessionCleanup('auth:legacy-credentials', async () => {
  await AsyncStorage.multiRemove([...LEGACY_CREDENTIAL_KEYS]);
});

export const sessionManager: SessionManagerImpl = createSessionManager({
  auth: authService,
  data: dataService,
  userRepository,
  calendar: calendarSyncEngine,
  alerts: alertEngine,
  events: appEvents,
  runCleanups: (context) => sessionCleanupRegistry.run(context),
  logger: createLogger('session'),
});
