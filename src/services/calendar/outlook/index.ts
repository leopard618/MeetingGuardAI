/**
 * Outlook calendar sync over Microsoft Graph (owner: calendar/outlook).
 *
 * Contract: `OutlookCalendarService` in src/core/contracts.ts and docs/v1/ARCHITECTURE.md §17.
 * - Auth: expo-auth-session PKCE against MICROSOFT_OAUTH.authority(EXPO_PUBLIC_MSAL_TENANT),
 *   redirect `meetingguardai://auth/microsoft`. ONLY the refresh token is persisted
 *   (src/services/auth/microsoftTokens.ts, expo-secure-store); access tokens stay in memory.
 * - Pull: /me/calendarView/delta with the deltaLink persisted in mg:{uid}:calendar.outlook;
 *   410 => full re-delta. Push: create with transactionId "mgev-"+id, patch, delete; Teams links
 *   on create. Write-backs use origin 'calendar_outlook' (never re-pushed).
 * - `isConfigured()` is false without EXPO_PUBLIC_MSAL_CLIENT_ID: the CalendarSync screen hides
 *   the Outlook card and the engine skips the provider entirely.
 * - Session end (sign-out / account deletion) deletes the stored refresh token (cleanup hook).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { env } from '../../../config/env';
import type { OutlookCalendarService } from '../../../core/contracts';
import { toAppError } from '../../../core/errors';
import { appEvents } from '../../../core/events';
import { createLogger } from '../../../core/logger';
import { calendarPushHold } from '../../../core/pushHold';
import { getDeviceTimeZone } from '../../../core/time';
import { t } from '../../../i18n';
import { clearMicrosoftToken, getMicrosoftRefreshToken, saveMicrosoftRefreshToken } from '../../auth/microsoftTokens';
import { registerSessionCleanup } from '../../auth/authService';
import { dataService, meetingRepository } from '../../data';
import { createUserStateStore } from '../stateStore';
import { calendarStatusStore } from '../status';
import { createMicrosoftAuthPort } from './authAdapter';
import { createOutlookGraphApi } from './api';
import { createOutlookCalendarService, type OutlookCalendarServiceInternal } from './service';
import { defaultOutlookSyncState, OUTLOOK_STATE_NAME, outlookSyncStateSchema } from './state';
import { createMicrosoftTokenManager } from './tokenManager';

const log = createLogger('calendar');

const getUid = (): string | null => dataService.getActiveUid();
const now = (): Date => new Date();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The one Microsoft token manager of the app (refresh token in secure store, access token in
 * memory). Shared with the Microsoft To Do sync (src/services/tasks/todo), which runs on the
 * same account and consent.
 */
export const microsoftTokenManager = createMicrosoftTokenManager({
  clientId: env.msal.clientId ?? '',
  tenant: env.msal.tenant,
  store: {
    get: getMicrosoftRefreshToken,
    save: saveMicrosoftRefreshToken,
    clear: clearMicrosoftToken,
  },
  getUid,
  onDisconnected: () => {
    // The stored consent is gone (invalid_grant): show "not connected" until the user reconnects.
    calendarStatusStore.patchOutlook({ connected: false, enabled: false, accountEmail: null, lastError: 'calendar_not_connected' });
    calendarStatusStore.patchTodo({ connected: false, lastError: 'calendar_not_connected' });
  },
});
const tokenManager = microsoftTokenManager;

/** Internal service with the engine hooks (the barrel registers it with the sync engine). */
export const outlookInternal: OutlookCalendarServiceInternal = createOutlookCalendarService({
  api: createOutlookGraphApi({
    tokens: {
      getToken: () => tokenManager.getAccessToken(),
      invalidate: (token) => tokenManager.invalidateAccessToken(token),
    },
  }),
  meetings: meetingRepository,
  state: createUserStateStore({
    kv: AsyncStorage,
    name: OUTLOOK_STATE_NAME,
    getUid,
    schema: outlookSyncStateSchema,
    defaults: defaultOutlookSyncState,
  }),
  tokens: tokenManager,
  auth: createMicrosoftAuthPort(),
  status: calendarStatusStore,
  events: appEvents,
  getUid,
  now,
  sleep,
  defaultTimeZone: getDeviceTimeZone,
  untitledTitle: () => t('calendar:outlook.untitledEvent'),
  holdPush: calendarPushHold.isHeld,
  config: { clientId: env.msal.clientId, tenant: env.msal.tenant },
});

/** Contract object (OutlookCalendarService); the extra engine hooks stay internal. */
export const outlookCalendarService: OutlookCalendarService = {
  isConfigured: outlookInternal.isConfigured,
  isConnected: outlookInternal.isConnected,
  connect: outlookInternal.connect,
  disconnect: outlookInternal.disconnect,
  pushMeeting: outlookInternal.pushMeeting,
  removeMeeting: outlookInternal.removeMeeting,
  pullChanges: outlookInternal.pullChanges,
};

// The Microsoft refresh token is the only token the app persists: delete it whenever the session
// ends (sign-out, auth lost, account deletion). Runs before the data layer wipes mg:{uid}:*.
registerSessionCleanup('outlook.tokens', async ({ uid }) => {
  tokenManager.dropMemory();
  try {
    await clearMicrosoftToken(uid);
  } catch (error) {
    log.warn('Could not clear the Microsoft token on session end', toAppError(error).code);
  }
});

export type { OutlookCalendarServiceInternal } from './service';
