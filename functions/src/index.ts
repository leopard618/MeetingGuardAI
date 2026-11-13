/**
 * Meeting Guard AI Cloud Functions (v2, Node 22).
 *
 * Callables (names and payloads: shared/aiContract.ts, a verbatim copy of src/core/aiContract.ts):
 * - assistant: AI assistant proposals (never mutates meetings) with a server-side daily quota.
 * - deleteAccount: deletes all of the caller's data and their Auth user.
 * - microsoftSignIn: Sign in with Microsoft (unauthenticated by design): verifies a Microsoft
 *   id_token and answers with a Firebase custom token (src/microsoftSignIn.ts,
 *   docs/v1/ARCHITECTURE.md §31; MICROSOFT_CLIENT_ID param, empty = disabled).
 * - adminListUsers / adminSetUserDisabled / adminSetUserPlan / adminGetMetrics, plus the v2
 *   adminGetStats / adminGetHealth / adminRotateOpenAiKey / adminGetRevenue: admin dashboard (custom claim `admin`
 *   required; src/admin, docs/v1/ARCHITECTURE.md §21, docs/v1/ADMIN.md §v2).
 * - zoomStatus (always deployed, no secrets) and zoomCreateMeeting / zoomSyncMeeting /
 *   zoomDeleteMeeting (deployed only while ZOOM_ENABLED=true; the ONLY functions binding the
 *   ZOOM_* secrets, except the gated whatsappWebhook - §27): server-created Zoom links
 *   (src/zoom, docs/v1/ARCHITECTURE.md §24, SETUP §12).
 * - whatsappLinkStart / whatsappLinkStatus / whatsappUnlink (always deployed, no secrets):
 *   WhatsApp account linking (src/whatsapp, docs/v1/ARCHITECTURE.md §27, SETUP §14).
 * - summaryStatus / summaryAction (always deployed, no secrets; summaryAction never decrypts):
 *   meeting summaries status, private address, mailboxes and filing (src/summaries,
 *   docs/v2/M10-DESIGN.md section 4; SUMMARIES_ENABLED plus the SUMMARIES_PILOT_UIDS pilot list).
 * - summaryRead: meeting summary lists and the full view (deployed only while
 *   SUMMARIES_ENABLED=true; binds SUMMARIES_DATA_KEY only; src/summaries/read.ts).
 * - adminReconcileEntitlement (deployed only while REVENUECAT_RECONCILE_ENABLED=true; the ONLY
 *   function binding REVENUECAT_SECRET_KEY): heals entitlements/{uid} against the RevenueCat
 *   REST API (src/revenuecat/reconcile.ts, docs/v1/ARCHITECTURE.md §20).
 * HTTPS:
 * - revenuecatWebhook: RevenueCat -> entitlements/{uid} writer (secret Authorization header).
 * - whatsappWebhook: the WhatsApp bot (deployed only while WHATSAPP_ENABLED=true; the ONLY
 *   function binding the WHATSAPP_* secrets).
 * - summaryInbound: notetaker summary emails forwarded through Postmark (deployed only while
 *   SUMMARIES_ENABLED=true; binds SUMMARIES_WEBHOOK_AUTH and SUMMARIES_DATA_KEY, the callables
 *   bind neither; src/summaries, docs/v2/M10-DESIGN.md section 4).
 * Scheduled:
 * - dailyMaintenance: purges expired meeting tombstones, old account deletion records and
 *   expired WhatsApp bot state.
 */
export { assistant } from './assistant';
export { deleteAccount } from './deleteAccount';
export { microsoftSignIn } from './microsoftSignIn';
export { dailyMaintenance } from './maintenance';
export { revenuecatWebhook } from './revenuecat';
// Same gating pattern as zoom/whatsapp: undefined while REVENUECAT_RECONCILE_ENABLED is false at
// deploy time, so a deploy without the REVENUECAT_SECRET_KEY secret always succeeds.
export { adminReconcileEntitlement } from './revenuecat/reconcile';
export {
  adminGetHealth,
  adminGetMetrics,
  adminGetRevenue,
  adminGetStats,
  adminListUsers,
  adminRotateOpenAiKey,
  adminSetUserDisabled,
  adminSetUserPlan,
} from './admin';
// The write callables are `undefined` while ZOOM_ENABLED is false at deploy time (the loader
// skips undefined exports), so a deploy without the ZOOM_* secrets always succeeds.
export { zoomCreateMeeting, zoomDeleteMeeting, zoomStatus, zoomSyncMeeting } from './zoom';
// Same gating pattern: whatsappWebhook is `undefined` while WHATSAPP_ENABLED is false at deploy
// time, so a deploy without the WHATSAPP_* secrets always succeeds; the callables bind none.
export { whatsappLinkStart, whatsappLinkStatus, whatsappUnlink, whatsappWebhook } from './whatsapp';
// Same gating pattern: summaryInbound and summaryRead are `undefined` while SUMMARIES_ENABLED is
// false at deploy time, so a deploy without the SUMMARIES_* secrets always succeeds; the callables
// bind none.
export { summaryAction, summaryInbound, summaryRead, summaryStatus } from './summaries';
// M11: summaryCommitments is `undefined` unless SUMMARIES_ENABLED is true AND the
// SUMMARIES_SERVICE_ACCOUNT line is set at deploy time (binds SUMMARIES_DATA_KEY and OPENAI_API_KEY;
// src/summaries/commitmentsFunction.ts, docs/v2/M11-DESIGN.md section 2.1).
export { summaryCommitments } from './summaries';
// M11: summaryWhatsApp (the WhatsApp worker) is `undefined` unless SUMMARIES_ENABLED and
// WHATSAPP_ENABLED are true AND the summaries service account and SUMMARIES_WHATSAPP_INVOKER are set
// and differ at deploy time (src/summaries/whatsappFunction.ts, docs/v2/M11-DESIGN.md section 4.3).
export { summaryWhatsApp } from './summaries';
// Executive assistant (ARCHITECTURE section 36): every export is `undefined` while MATTERS_ENABLED
// is false at deploy time, and its params and secrets are not even declared then (config.ts
// mattersParams), so a deploy without the POSTMARK / inbound secrets never asks for them.
export { assistantInboundEmail, matterCancel, matterConfirm, matterDraft, matterRevise } from './matters';
