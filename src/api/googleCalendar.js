/**
 * COMPAT SHIM (owner: calendar; stage 3 deletes it). Google Calendar now syncs through
 * src/services/calendar: Google events are imported into the meetings list (source "google") and
 * MeetingGuard meetings are pushed automatically. Tokens never leave the auth service.
 *
 * Kept exports (default object) for the stage-3 screens that still import this module:
 * - initialize / checkCalendarAccess / hasValidAuth: real connection state (false without a session).
 * - isAvailable: synchronous snapshot of the calendar status.
 * - getCalendarInfo / getConnectionStatus / getLastSyncTime / reconnect: real status and connect.
 * - Separate Google event lists and manual event writes no longer exist: those methods reject
 *   with AppError('unsupported') (callers already treat them as failures; nothing fakes success).
 */
import { AppError } from '../core/errors';
import { calendarSyncEngine, googleCalendarService } from '../services/calendar';
import { isGoogleCalendarConnectedOrFalse } from '../services/calendar/legacyCompat';

const EVENTS_MOVED =
  'Google Calendar events are part of the meetings list (source "google") and sync automatically';

function unsupported(name) {
  return Promise.reject(new AppError('unsupported', `googleCalendar.${name}: ${EVENTS_MOVED}`));
}

async function connectionInfo() {
  const connected = await isGoogleCalendarConnectedOrFalse();
  const google = calendarSyncEngine.getStatus().google;
  return {
    isAuthenticated: connected,
    isInitialized: connected,
    isConnected: connected,
    calendarId: connected ? 'primary' : null,
    lastSyncAt: google.lastSyncAt,
    lastError: google.lastError,
  };
}

const googleCalendarShim = {
  initialize: () => isGoogleCalendarConnectedOrFalse(),
  checkCalendarAccess: () => isGoogleCalendarConnectedOrFalse(),
  hasValidAuth: () => isGoogleCalendarConnectedOrFalse(),
  isAvailable: () => calendarSyncEngine.getStatus().google.connected,
  getCalendarInfo: () => connectionInfo(),
  getConnectionStatus: () => connectionInfo(),
  getLastSyncTime: async () => calendarSyncEngine.getStatus().google.lastSyncAt,
  async reconnect() {
    const result = await googleCalendarService.connect();
    return { success: result.status === 'connected', cancelled: result.status === 'cancelled', status: result.status };
  },
  getTodayMeetings: () => unsupported('getTodayMeetings'),
  getUpcomingMeetings: () => unsupported('getUpcomingMeetings'),
  getEvents: () => unsupported('getEvents'),
  checkAvailability: () => unsupported('checkAvailability'),
  createEvent: () => unsupported('createEvent'),
  updateEvent: () => unsupported('updateEvent'),
  deleteEvent: () => unsupported('deleteEvent'),
  createMeeting: () => unsupported('createMeeting'),
  updateMeeting: () => unsupported('updateMeeting'),
  deleteMeeting: () => unsupported('deleteMeeting'),
};

export default googleCalendarShim;
