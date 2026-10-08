/**
 * DATA area public API (owner: data). Other areas import ONLY from this barrel.
 *
 * Contract: src/core/contracts.ts (DATA section); design: docs/ARCHITECTURE.md §3, §4, §9.
 * - Firestore is the source of truth (users/{uid}/meetings|notes|settings/preferences, users/{uid},
 *   entitlements/{uid} read-only); the app keeps a per-user AsyncStorage cache and a durable
 *   outbox because the React Native Firestore SDK only has a memory cache.
 * - Local writes resolve after they are durable on the device and emit `meetings:changed` /
 *   `preferences:changed`; Firestore gets them in the background (last-writer-wins on updatedAt).
 * - Headless code (background tasks) uses getCachedUpcoming / getCached, or a 'headless' session.
 */
export {
  attachmentStore,
  dataEngine,
  dataService,
  meetingRepository,
  migrationService,
  notesRepository,
  preferencesRepository,
  userRepository,
} from './instance';
export { DataProvider, useEntitlement, useMeeting, useMeetings, useNotes, usePreferences, useSyncState } from './react';
export { filterMeetings, type DataSnapshot, type DataStatus } from './engine';
export type { AttachmentCategory, AttachmentRecord, AttachmentStore } from './attachments';
export { ATTACHMENT_CATEGORIES } from './attachments';
export type { ExternalUpsertResultWithInvalid } from './externalUpsert';
