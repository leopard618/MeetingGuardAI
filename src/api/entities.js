/**
 * COMPAT SHIM (stage 3 removes it): the entity API the legacy screens use, delegating to the data
 * layer (src/services/data). Shapes come from core/legacy.ts (toLegacyMeetingView /
 * toLegacyPreferencesView).
 *
 * - Every method rejects with an AppError on failure (no device-only fallback that fakes success).
 * - UserPreferences.filter always resolves with exactly one element (fixes report #19).
 * - Meeting.delete is a soft delete that syncs to every device.
 */
import {
  legacyMeetings,
  legacyNotes,
  legacyPreferences,
  legacyUser,
  unsupportedLegacyApi,
} from '../services/data/legacyFacade';

export const Meeting = {
  /** Active meetings as legacy views. sortBy: "-created_date" (default), "created_date", "date", "-date". */
  list: (sortBy = '-created_date') => legacyMeetings.list(sortBy),
  /** Equality filter on legacy view fields, e.g. Meeting.filter({ date: '2026-10-05' }). */
  filter: (criteria = {}, sortBy = '-created_date') => legacyMeetings.filter(criteria, sortBy),
  get: (id) => legacyMeetings.get(id),
  create: (meetingData) => legacyMeetings.create(meetingData),
  update: (id, updateData) => legacyMeetings.update(id, updateData),
  delete: (id) => legacyMeetings.remove(id),
  schema: () => ({
    title: { type: 'string', required: true },
    date: { type: 'string', required: true },
    time: { type: 'string', required: true },
    duration: { type: 'number', default: 60 },
    description: { type: 'string' },
    location: { type: 'object' },
    participants: { type: 'array' },
    source: { type: 'string' },
    confidence: { type: 'number' },
    preparation_tips: { type: 'array' },
  }),
};

export const UserPreferences = {
  /** Always `[preferences]` (one document per user); the criteria are ignored. */
  filter: (_criteria) => legacyPreferences.filter(),
  /** The document always exists: writes the given fields and returns the merged preferences. */
  create: (prefData) => legacyPreferences.update(prefData),
  update: (_id, updateData) => legacyPreferences.update(updateData),
  delete: async (_id) => unsupportedLegacyApi('UserPreferences.delete'),
};

export const Note = {
  list: (sortBy = '-created_date') => legacyNotes.list(sortBy),
  create: (noteData) => legacyNotes.create(noteData),
  update: (id, updateData) => legacyNotes.update(id, updateData),
  delete: (id) => legacyNotes.remove(id),
};

export const User = {
  me: () => legacyUser.me(),
  /** Sign-in is handled by the auth area (useAuth / sessionManager). */
  signIn: async (_credentials) => unsupportedLegacyApi('User.signIn'),
  signOut: async () => unsupportedLegacyApi('User.signOut'),
};

/** The old "API keys" were fake local records; there is no API key feature. */
export const ApiKey = {
  list: async () => unsupportedLegacyApi('ApiKey.list'),
  create: async (_keyData) => unsupportedLegacyApi('ApiKey.create'),
  update: async (_id, _updateData) => unsupportedLegacyApi('ApiKey.update'),
  delete: async (_id) => unsupportedLegacyApi('ApiKey.delete'),
};
