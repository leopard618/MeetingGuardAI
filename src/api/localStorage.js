/**
 * COMPAT SHIM (stage 3 removes it). The v1.0.9 device-only database ("meetingguard_data") is no
 * longer used: its content is migrated into the user's account on first sign-in
 * (src/services/data migrationService). Only the calls legacy screens still make are kept.
 */
import { legacyMeetings, legacyUser, unsupportedLegacyApi } from '../services/data/legacyFacade';

function randomId() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16));
  return `${bytes.slice(0, 8).join('')}-${bytes.slice(8, 12).join('')}-4${bytes.slice(12, 15).join('')}-${Date.now().toString(16).slice(-12)}`;
}

export const localStorageAPI = {
  getData: async () => unsupportedLegacyApi('localStorageAPI.getData'),
  setData: async () => unsupportedLegacyApi('localStorageAPI.setData'),

  /** Random id made of [0-9a-f-] (valid as a document id). */
  generateId: () => randomId(),

  /** The signed-in user (legacy shape). Rejects with AppError('unauthenticated') when signed out. */
  getCurrentUser: () => legacyUser.me(),

  /**
   * Deletes every MeetingGuard meeting of the account (synced to all devices). Meetings imported
   * from Google/device calendars are kept. Resolves true when done; rejects with an AppError.
   */
  clearAllMeetings: async () => {
    await legacyMeetings.clearAll();
    return true;
  },
};
