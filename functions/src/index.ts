/**
 * MeetingGuard AI Cloud Functions (v2, Node 22).
 *
 * Callables (names and payloads: shared/aiContract.ts, a verbatim copy of src/core/aiContract.ts):
 * - assistant: AI assistant proposals (never mutates meetings) with a server-side daily quota.
 * - deleteAccount: deletes all of the caller's data and their Auth user.
 * - adminListUsers / adminSetUserDisabled / adminSetUserPlan / adminGetMetrics, plus the v2
 *   adminGetStats / adminGetHealth / adminRotateOpenAiKey: admin dashboard (custom claim `admin`
 *   required; src/admin, docs/ARCHITECTURE.md §21, docs/ADMIN.md §v2).
 * - zoomStatus (always deployed, no secrets) and zoomCreateMeeting / zoomSyncMeeting /
 *   zoomDeleteMeeting (deployed only while ZOOM_ENABLED=true; the ONLY functions binding the
 *   ZOOM_* secrets): server-created Zoom links (src/zoom, docs/ARCHITECTURE.md §24, SETUP §12).
 * HTTPS:
 * - revenuecatWebhook: RevenueCat -> entitlements/{uid} writer (secret Authorization header).
 * Scheduled:
 * - dailyMaintenance: purges expired meeting tombstones and old account deletion records.
 */
export { assistant } from './assistant';
export { deleteAccount } from './deleteAccount';
export { dailyMaintenance } from './maintenance';
export { revenuecatWebhook } from './revenuecat';
export {
  adminGetHealth,
  adminGetMetrics,
  adminGetStats,
  adminListUsers,
  adminRotateOpenAiKey,
  adminSetUserDisabled,
  adminSetUserPlan,
} from './admin';
// The write callables are `undefined` while ZOOM_ENABLED is false at deploy time (the loader
// skips undefined exports), so a deploy without the ZOOM_* secrets always succeeds.
export { zoomCreateMeeting, zoomDeleteMeeting, zoomStatus, zoomSyncMeeting } from './zoom';
