/**
 * Outlook calendar sync over Microsoft Graph (owner: calendar/outlook pass).
 *
 * ARCHITECT STUB: the contract is `OutlookCalendarService` in src/core/contracts.ts and
 * docs/ARCHITECTURE.md §17. Until the implementation lands, `isConfigured()` is false (the
 * CalendarSync screen hides the Outlook section) and every other method throws
 * AppError('not_implemented'), so nothing upstream can mistake this for a working provider.
 *
 * Implementation outline (see §17 for the full spec):
 * - connect(): expo-auth-session PKCE against MICROSOFT_OAUTH.authority(env tenant), scopes
 *   MICROSOFT_OAUTH.scopes, redirect `meetingguardai://${MS_AUTH_REDIRECT_PATH}`; store ONLY the
 *   refresh token via src/services/auth/microsoftTokens.ts (expo-secure-store).
 * - pull: GET /me/calendarView/delta over CALENDAR_SYNC_WINDOW with the deltaLink persisted in
 *   USER_STORAGE.outlookCalendar; results -> meetingRepository.upsertExternal('outlook').
 * - push: POST/PATCH/DELETE /me/events with transactionId "mgev-" + meeting.id; Teams links via
 *   isOnlineMeeting + onlineMeetingProvider "teamsForBusiness".
 * - status: engine registers this provider only when isConfigured(); CalendarStatus.outlook.
 */
import type { CalendarPullResult, OutlookCalendarService, OutlookConnectResult } from '../../../core/contracts';
import { notImplemented } from '../../../core/errors';
import type { Meeting } from '../../../core/types';

export const outlookCalendarService: OutlookCalendarService = {
  isConfigured(): boolean {
    // Real implementation: env.msalClientId !== null (EXPO_PUBLIC_MSAL_CLIENT_ID).
    return false;
  },
  isConnected(): Promise<boolean> {
    return Promise.resolve(false);
  },
  connect(): Promise<OutlookConnectResult> {
    return Promise.reject(notImplementedError('outlookCalendarService.connect'));
  },
  disconnect(): Promise<void> {
    return Promise.reject(notImplementedError('outlookCalendarService.disconnect'));
  },
  pushMeeting(_meeting: Meeting): Promise<Meeting> {
    return Promise.reject(notImplementedError('outlookCalendarService.pushMeeting'));
  },
  removeMeeting(_meeting: Meeting): Promise<void> {
    return Promise.reject(notImplementedError('outlookCalendarService.removeMeeting'));
  },
  pullChanges(): Promise<CalendarPullResult> {
    return Promise.reject(notImplementedError('outlookCalendarService.pullChanges'));
  },
};

function notImplementedError(name: string): Error {
  try {
    notImplemented(name);
  } catch (error) {
    return error as Error;
  }
  // Unreachable: notImplemented always throws.
  return new Error(name);
}
