/**
 * COMPAT SHIM (stage 3 removes it). Firestore access now lives in the data layer
 * (src/services/data): offline cache, outbox, validated documents, last-writer-wins. This module
 * keeps the old method names for legacy callers and delegates to it.
 *
 * - saveUser() is gone on purpose: it wrote `plan: 'free'` on every sign-in (report #7). Profiles
 *   are written by userRepository.ensureProfile (identity fields only); plans are server-owned.
 * - getUser() returns the profile plus the effective plan read from entitlements/{uid}.
 */
import { AppError } from '../core/errors';
import { dataService } from './data';
import { legacyMeetings, legacyPreferences, legacyUser, unsupportedLegacyApi } from './data/legacyFacade';

function requireUid() {
  const uid = dataService.getActiveUid();
  if (!uid) throw new AppError('unauthenticated', 'Nobody is signed in');
  return uid;
}

function sortKeyFrom(options) {
  if (options.sortBy === 'date') return 'date';
  if (options.sortBy === '-date') return '-date';
  return options.sortBy ?? '-created_date';
}

const firestoreService = {
  getCurrentUserId: () => requireUid(),

  async getUser(userId) {
    const uid = requireUid();
    if (userId !== undefined && userId !== uid) {
      throw new AppError('permission_denied', 'Only the signed-in user can be read');
    }
    return legacyUser.me();
  },

  saveUser: async () => unsupportedLegacyApi('firestoreService.saveUser'),

  /** options: { startDate?, endDate? (local "YYYY-MM-DD", inclusive), sortBy?, limit? } */
  async getMeetings(options = {}) {
    let views = await legacyMeetings.list(sortKeyFrom(options));
    if (options.startDate) views = views.filter((view) => view.date >= options.startDate);
    if (options.endDate) views = views.filter((view) => view.date <= options.endDate);
    if (typeof options.limit === 'number' && options.limit >= 0) views = views.slice(0, options.limit);
    return views;
  },

  getMeeting: (meetingId) => legacyMeetings.get(meetingId),
  createMeeting: (meetingData) => legacyMeetings.create(meetingData),
  updateMeeting: (meetingId, meetingData) => legacyMeetings.update(meetingId, meetingData),

  async deleteMeeting(meetingId) {
    await legacyMeetings.remove(meetingId);
    return true;
  },

  /** Live legacy views; returns the unsubscribe function. */
  subscribeToMeetings(callback, options = {}) {
    requireUid();
    const sortBy = sortKeyFrom(options);
    return legacyMeetings.subscribe((views) => {
      const sorted = [...views];
      if (sortBy === '-created_date') sorted.sort((a, b) => (a.created_date < b.created_date ? 1 : -1));
      callback(sorted);
    });
  },

  getUserPreferences: () => legacyPreferences.get(),
  updateUserPreferences: (preferences) => legacyPreferences.update(preferences),
};

export default firestoreService;
