/**
 * COMPAT SHIM (owner: calendar; stage 3 deletes it). Sync is orchestrated by
 * calendarSyncEngine (src/services/calendar), started by the session manager; local changes are
 * pushed automatically and alerts react to data events, so there is nothing to initialize here.
 *
 * Kept exports (default object): setCallbacks (no-op), initialize, syncEventToGoogle,
 * deleteEventFromBoth, forceSync, getSyncStatus, getSyncStatistics, updateSyncSettings (rejects).
 */
import { AppError } from '../core/errors';
import { calendarSyncEngine, googleCalendarService } from '../services/calendar';
import { isGoogleCalendarConnectedOrFalse, toLegacySyncResult } from '../services/calendar/legacyCompat';
import { meetingRepository } from '../services/data';

function statusSnapshot() {
  const { google, device } = calendarSyncEngine.getStatus();
  return {
    isEnabled: google.enabled,
    isConnected: google.connected,
    isSyncing: google.syncing || device.syncing,
    lastSync: google.lastSyncAt,
    lastError: google.lastError,
    device: {
      isEnabled: device.enabled,
      permission: device.permission,
      lastSync: device.lastSyncAt,
      lastError: device.lastError,
    },
  };
}

const calendarSyncManagerShim = {
  /** Screens and alerts are driven by `meetings:changed` now; nothing to register. */
  setCallbacks() {},

  /** Resolves to the real Google connection state (the engine itself is started by the session). */
  initialize: () => isGoogleCalendarConnectedOrFalse(),

  /** Pushes one meeting now. Rejects with AppError (e.g. calendar_not_connected, not_found). */
  async syncEventToGoogle(meetingId) {
    const meeting = await meetingRepository.get(meetingId);
    if (!meeting) throw new AppError('not_found', 'Meeting not found', { details: { meetingId } });
    const updated = await googleCalendarService.pushMeeting(meeting);
    return { success: true, googleEventId: updated.external.googleEventId };
  },

  /** Deletes the meeting; the sync engine removes it from Google / the device calendar. */
  async deleteEventFromBoth(meetingId) {
    await meetingRepository.remove(meetingId, { origin: 'user' });
    return { success: true };
  },

  async forceSync() {
    return toLegacySyncResult(await calendarSyncEngine.syncNow({ reason: 'manual' }));
  },

  getSyncStatus: async () => statusSnapshot(),
  getSyncStatistics: async () => statusSnapshot(),

  updateSyncSettings() {
    return Promise.reject(
      new AppError('unsupported', 'Calendar sync settings live in Preferences (googleCalendarSyncEnabled) and the Calendar sync screen'),
    );
  },
};

export default calendarSyncManagerShim;
