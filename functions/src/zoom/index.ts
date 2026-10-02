/**
 * zoom* callables (owner: zoom-server) - STUBS except zoomStatus, which is complete.
 * Contract: shared/aiContract.ts (zoom* schemas, ZOOM_ERROR_CODES); design: docs/ARCHITECTURE.md
 * §24; owner setup and deploy order: docs/SETUP.md §12.
 *
 * Deployability rules (DO NOT break them):
 * - `zoomStatus` NEVER references the ZOOM_* secrets. It answers from the non-secret
 *   ZOOM_ENABLED param, so it always deploys and the app can always ask.
 * - The three write callables bind the ZOOM_* secrets, so they are exported ONLY while
 *   ZOOM_ENABLED is true at deploy time (`zoomWriteCallablesEnabledAtLoad()` below reads the
 *   param's env value when the CLI loads this module for discovery). While the param is false
 *   (the default) a full `firebase deploy --only functions` never validates the secrets and
 *   cannot fail on them. NO OTHER FUNCTION in this codebase may reference the ZOOM_* secrets.
 *
 * Implementation notes for the zoom-server pass (replace the stub bodies, keep the shells):
 * - S2S OAuth token: POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=
 *   {ZOOM_ACCOUNT_ID} with header `Authorization: Basic base64(clientId + ":" + clientSecret)`;
 *   cache { accessToken, expiresAtMs } per instance and refresh ZOOM_TUNING.
 *   tokenSafetyWindowSeconds early; a Zoom 400 "invalid client"/4711 scope error maps to
 *   not_configured. Then api.zoom.us/v2 with `Authorization: Bearer <token>`.
 * - zoomCreateMeeting: load users/{uid}/meetings/{meetingId}; not_found when missing, tombstoned
 *   or not the caller's; invalid_request when conference?.provider !== "zoom"; short-circuit
 *   with the stored values when external.zoomMeetingId already exists (idempotent); respect a
 *   pasted link (conference.url !== null => invalid_request: paste wins). Create with
 *   POST /users/me/meetings { topic: title (<= 200 chars), type: 2, start_time: startAt as
 *   yyyy-MM-ddTHH:mm:ssZ, duration: durationMinutes, timezone }. Then, in ONE transaction,
 *   re-check the preconditions and write conference.url = join_url, conference.password =
 *   passcode ?? null, external.zoomMeetingId = String(id), updatedAt (Admin SDK bypasses the
 *   rules; the app's snapshot listener picks the change up). Daily cap: transactionally bump
 *   usage/{uid}/days/{yyyy-mm-dd UTC}.zoomCreates and reject over ZOOM_USER_DAILY_LIMIT with
 *   quota_exceeded (same doc the assistant quota uses; owner-readable, never client-writable).
 * - zoomSyncMeeting: load the doc, no-op `{ updated: false }` without external.zoomMeetingId;
 *   PATCH /meetings/{zoomMeetingId} with topic/start_time/duration/timezone; Zoom 404 => treat
 *   the link as gone (clear nothing; return { updated: false }); bump `zoomOps` (cap =
 *   ZOOM_USER_DAILY_LIMIT * ZOOM_TUNING.opsLimitMultiplier).
 * - zoomDeleteMeeting: resolve the numeric id from the request's zoomMeetingId or from the
 *   (possibly tombstoned) meeting doc; DELETE /meetings/{id}?schedule_for_reminder=false; Zoom
 *   404 counts as deleted: true; bump `zoomOps`. The uid ownership check for a bare
 *   zoomMeetingId: the id must appear in one of the CALLER's meeting docs (collection query on
 *   external.zoomMeetingId), else not_found - one user must not delete another user's meeting.
 * - Zoom REST failures: 401 after one token refresh retry => not_configured; 404 => not_found;
 *   429 => quota_exceeded; anything else => upstream_error. NEVER log meeting content: uid,
 *   meeting doc id, Zoom numeric id and error codes only.
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall, type CallableOptions } from 'firebase-functions/https';

import {
  FUNCTIONS_REGION,
  ZOOM_ACCOUNT_ID,
  ZOOM_CLIENT_ID,
  ZOOM_CLIENT_SECRET,
  ZOOM_ENABLED,
  ZOOM_TUNING,
} from '../config';
import {
  ZOOM_ERROR_HTTPS_CODES,
  zoomCreateMeetingRequestSchema,
  zoomDeleteMeetingRequestSchema,
  zoomStatusRequestSchema,
  zoomSyncMeetingRequestSchema,
  type ZoomCreateMeetingResponse,
  type ZoomDeleteMeetingResponse,
  type ZoomErrorCode,
  type ZoomStatusResponse,
  type ZoomSyncMeetingResponse,
} from '../shared/aiContract';

/** Every zoom* error carries details.reason (the app maps it to an AppError code). */
export function zoomError(reason: ZoomErrorCode, message: string): HttpsError {
  return new HttpsError(ZOOM_ERROR_HTTPS_CODES[reason], message, { reason });
}

export interface ZoomCaller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}

function callerOf(auth: { uid: string; token: Record<string, unknown> } | undefined): ZoomCaller | null {
  if (!auth) return null;
  const firebaseClaims = auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  return {
    uid: auth.uid,
    emailVerified: auth.token.email_verified === true,
    signInProvider: typeof firebaseClaims?.sign_in_provider === 'string' ? firebaseClaims.sign_in_provider : null,
  };
}

/** Same verified-account rule as the assistant (assistant/handler.ts). */
export function isVerifiedCaller(caller: ZoomCaller): boolean {
  return caller.emailVerified || caller.signInProvider === 'google.com';
}

/** Write callables require auth AND a verified account; zoomStatus requires auth only. */
function requireVerified(auth: { uid: string; token: Record<string, unknown> } | undefined): ZoomCaller {
  const caller = callerOf(auth);
  if (!caller) throw zoomError('unauthenticated', 'Sign in to use Zoom links.');
  if (!isVerifiedCaller(caller)) throw zoomError('unauthenticated', 'Verify your email to use Zoom links.');
  return caller;
}

/**
 * Whether the ZOOM_ENABLED param is true while this module is LOADED (CLI discovery and
 * runtime read the same env var that backs the param). Deploy-time only: handlers read
 * ZOOM_ENABLED.value() instead.
 */
export function zoomWriteCallablesEnabledAtLoad(): boolean {
  const raw = process.env.ZOOM_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

/**
 * `zoomStatus` {} -> { configured }: is the server-side Zoom integration set up? Always
 * deployed, no secrets (see the header). The app caches the answer per session
 * (src/services/zoom). `configured: true` implies the write callables were deployed with it
 * (same param flips both; docs/SETUP.md §12 orders the owner steps).
 */
export const zoomStatus = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: false,
    timeoutSeconds: 10,
    memory: ZOOM_TUNING.memory,
    maxInstances: ZOOM_TUNING.maxInstances,
  },
  (request): ZoomStatusResponse => {
    const caller = callerOf(request.auth);
    if (!caller) throw zoomError('unauthenticated', 'Sign in first.');
    if (!zoomStatusRequestSchema.safeParse(request.data ?? {}).success) {
      throw zoomError('invalid_request', 'zoomStatus takes no arguments.');
    }
    return { configured: ZOOM_ENABLED.value() === true };
  },
);

/** Shared runtime options of the three write callables (the ONLY place the secrets are bound). */
const ZOOM_WRITE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  secrets: [ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET],
  enforceAppCheck: false,
  timeoutSeconds: ZOOM_TUNING.functionTimeoutSeconds,
  memory: ZOOM_TUNING.memory,
  maxInstances: ZOOM_TUNING.maxInstances,
};

/** STUB body shared by the write callables until the zoom-server pass lands. */
function stubNotImplemented(caller: ZoomCaller, callable: string): never {
  if (ZOOM_ENABLED.value() !== true) {
    throw zoomError('not_configured', 'The Zoom integration is not set up.');
  }
  logger.warn('zoom.not_implemented', { uid: caller.uid, callable });
  throw zoomError('upstream_error', `${callable} is not implemented yet.`);
}

function makeZoomCreateMeeting() {
  return onCall(ZOOM_WRITE_OPTIONS, (request): Promise<ZoomCreateMeetingResponse> => {
    const caller = requireVerified(request.auth);
    if (!zoomCreateMeetingRequestSchema.safeParse(request.data).success) {
      throw zoomError('invalid_request', 'A meetingId is required.');
    }
    return stubNotImplemented(caller, 'zoomCreateMeeting');
  });
}

function makeZoomSyncMeeting() {
  return onCall(ZOOM_WRITE_OPTIONS, (request): Promise<ZoomSyncMeetingResponse> => {
    const caller = requireVerified(request.auth);
    if (!zoomSyncMeetingRequestSchema.safeParse(request.data).success) {
      throw zoomError('invalid_request', 'A meetingId is required.');
    }
    return stubNotImplemented(caller, 'zoomSyncMeeting');
  });
}

function makeZoomDeleteMeeting() {
  return onCall(ZOOM_WRITE_OPTIONS, (request): Promise<ZoomDeleteMeetingResponse> => {
    const caller = requireVerified(request.auth);
    if (!zoomDeleteMeetingRequestSchema.safeParse(request.data).success) {
      throw zoomError('invalid_request', 'A meetingId or zoomMeetingId is required.');
    }
    return stubNotImplemented(caller, 'zoomDeleteMeeting');
  });
}

/**
 * Exported only while ZOOM_ENABLED is true at deploy time, so the default deploy never
 * references the secrets (undefined exports are skipped by the functions loader). Flipping the
 * param to false again makes the next deploy OFFER to delete the three functions - accept it.
 */
const writeCallablesEnabled = zoomWriteCallablesEnabledAtLoad();
export const zoomCreateMeeting = writeCallablesEnabled ? makeZoomCreateMeeting() : undefined;
export const zoomSyncMeeting = writeCallablesEnabled ? makeZoomSyncMeeting() : undefined;
export const zoomDeleteMeeting = writeCallablesEnabled ? makeZoomDeleteMeeting() : undefined;
