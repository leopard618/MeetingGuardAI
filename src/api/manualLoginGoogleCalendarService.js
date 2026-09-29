/**
 * Compat shim (owner: auth) for the pre-rebuild "connect Google Calendar" service used by
 * Dashboard and GoogleCalendarConnectionPrompt. Stage 3 removes it.
 *
 * Connecting now means: incremental Calendar consent through native Google Sign-In, enabling sync
 * and the first import - all done by the calendar area's googleCalendarService. Nothing is stored
 * here and there is no backend involved.
 */
import { t } from '../i18n';
import { googleCalendarService } from '../services/calendar';
import { getCalendarAccessTokenOrNull, legacyErrorResult } from '../services/auth/legacyCompat';

class ManualLoginGoogleCalendarService {
  async initialize() {
    return true;
  }

  /**
   * @returns {Promise<{ success: boolean, cancelled?: boolean, message?: string, error?: string }>}
   */
  async connectGoogleCalendar() {
    try {
      if (await googleCalendarService.isConnected()) {
        return { success: true, message: t('auth:calendar.alreadyConnected') };
      }
      const result = await googleCalendarService.connect();
      switch (result.status) {
        case 'connected':
          return { success: true, message: t('auth:calendar.connected'), initialSync: result.initialSync };
        case 'cancelled':
          return { success: false, cancelled: true, error: t('auth:calendar.cancelled') };
        case 'scope_denied':
        default:
          return { success: false, error: t('auth:calendar.scopeDenied') };
      }
    } catch (error) {
      return legacyErrorResult(error);
    }
  }

  /** Google Calendar sync is connected (scope granted and sync enabled). Rejects on failure. */
  isConnected() {
    return googleCalendarService.isConnected();
  }

  async disconnect() {
    try {
      await googleCalendarService.disconnect();
      return { success: true, message: t('auth:calendar.disconnected') };
    } catch (error) {
      return legacyErrorResult(error);
    }
  }

  /** Google access token with the Calendar scope, or null when Calendar is not connected. */
  getAccessToken() {
    return getCalendarAccessTokenOrNull();
  }
}

export const manualLoginGoogleCalendarService = new ManualLoginGoogleCalendarService();
export default manualLoginGoogleCalendarService;
