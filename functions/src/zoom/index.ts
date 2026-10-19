/**
 * zoom* callables (owner: zoom-server).
 * Contract: shared/aiContract.ts (zoom* schemas, ZOOM_ERROR_CODES); design: docs/v1/ARCHITECTURE.md
 * §24; owner setup and deploy order: docs/v1/SETUP.md §12.
 *
 * Deployability rules (DO NOT break them):
 * - `zoomStatus` NEVER references the ZOOM_* secrets. It answers from the non-secret
 *   ZOOM_ENABLED param, so it always deploys and the app can always ask.
 * - The three write callables bind the ZOOM_* secrets, so they are exported ONLY while
 *   ZOOM_ENABLED is true at deploy time (`zoomWriteCallablesEnabledAtLoad()` below reads the
 *   param's env value when the CLI loads this module for discovery). While the param is false
 *   (the default) a full `firebase deploy --only functions` never validates the secrets and
 *   cannot fail on them. ONE amendment (docs/v1/ARCHITECTURE.md §27): `whatsappWebhook` also binds
 *   the ZOOM_* secrets, but ONLY while ZOOM_ENABLED is true at its load time (same
 *   `zoomWriteCallablesEnabledAtLoad()` check), and SETUP §12 orders the secrets before the
 *   flag - so a deploy still can never fail on missing ZOOM_* secrets. Beyond that pair of
 *   gated consumers, NO OTHER FUNCTION in this codebase may reference the ZOOM_* secrets.
 *
 * Module layout: this file is the Firebase shell (auth, request schemas, ZOOM_ENABLED guard,
 * dependency wiring); ./handler.ts holds the logic on injected ports, ./token.ts the S2S OAuth
 * token cache, ./api.ts the Zoom REST client, ./errors.ts the error mapping. The token manager
 * lives at module scope on purpose: Cloud Functions instances keep it between invocations, so
 * one minted token (about 1 h) serves many requests.
 */
import { onCall, type CallableOptions } from 'firebase-functions/https';

import {
  FUNCTIONS_REGION,
  ZOOM_ACCOUNT_ID,
  ZOOM_CLIENT_ID,
  ZOOM_CLIENT_SECRET,
  ZOOM_ENABLED,
  ZOOM_TUNING,
  ZOOM_USER_DAILY_LIMIT,
} from '../config';
import { adminDb } from '../firebase';
import {
  isTrustedSignInProvider,
  zoomCreateMeetingRequestSchema,
  zoomDeleteMeetingRequestSchema,
  zoomStatusRequestSchema,
  zoomSyncMeetingRequestSchema,
  type ZoomCreateMeetingResponse,
  type ZoomDeleteMeetingResponse,
  type ZoomStatusResponse,
  type ZoomSyncMeetingResponse,
} from '../shared/aiContract';
import { createZoomClient } from './api';
import { zoomError } from './errors';
import {
  firestoreZoomStore,
  handleZoomCreateMeeting,
  handleZoomDeleteMeeting,
  handleZoomSyncMeeting,
  type ZoomHandlerDeps,
} from './handler';
import { createZoomTokenManager } from './token';

export { zoomError } from './errors';

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

/** Same verified-account rule as the assistant (assistant/handler.ts): email verified or a trusted provider (Google, Apple). */
export function isVerifiedCaller(caller: ZoomCaller): boolean {
  return caller.emailVerified || isTrustedSignInProvider(caller.signInProvider);
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
 * (same param flips both; docs/v1/SETUP.md §12 orders the owner steps).
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

/** One S2S token cache per instance (survives invocations; see the header). */
const zoomTokenManager = createZoomTokenManager();

/**
 * Runtime guard: the param should always be true when these functions exist (the conditional
 * export), but a stale deployment or a manually flipped param must fail soft, not reach Zoom.
 */
function requireZoomEnabled(): void {
  if (ZOOM_ENABLED.value() !== true) {
    throw zoomError('not_configured', 'The Zoom integration is not set up.');
  }
}

/**
 * Real dependencies; built per invocation (secrets and params may only be read then). Exported
 * for the WhatsApp executor (functions/src/whatsapp/executor.ts, §27), which reuses the zoom
 * handlers for provider-zoom meetings it creates/edits/deletes - call it ONLY while
 * ZOOM_ENABLED.value() is true AND the calling function binds the ZOOM_* secrets.
 */
export function zoomDeps(): ZoomHandlerDeps {
  return {
    store: firestoreZoomStore(adminDb()),
    client: () =>
      createZoomClient({
        credentials: {
          accountId: ZOOM_ACCOUNT_ID.value(),
          clientId: ZOOM_CLIENT_ID.value(),
          clientSecret: ZOOM_CLIENT_SECRET.value(),
        },
        tokens: zoomTokenManager,
      }),
    now: () => new Date(),
    createDailyLimit: () => ZOOM_USER_DAILY_LIMIT.value(),
  };
}

function makeZoomCreateMeeting() {
  return onCall(ZOOM_WRITE_OPTIONS, (request): Promise<ZoomCreateMeetingResponse> => {
    const caller = requireVerified(request.auth);
    const parsed = zoomCreateMeetingRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw zoomError('invalid_request', 'A meetingId is required.');
    }
    requireZoomEnabled();
    return handleZoomCreateMeeting(caller.uid, parsed.data, zoomDeps());
  });
}

function makeZoomSyncMeeting() {
  return onCall(ZOOM_WRITE_OPTIONS, (request): Promise<ZoomSyncMeetingResponse> => {
    const caller = requireVerified(request.auth);
    const parsed = zoomSyncMeetingRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw zoomError('invalid_request', 'A meetingId is required.');
    }
    requireZoomEnabled();
    return handleZoomSyncMeeting(caller.uid, parsed.data, zoomDeps());
  });
}

function makeZoomDeleteMeeting() {
  return onCall(ZOOM_WRITE_OPTIONS, (request): Promise<ZoomDeleteMeetingResponse> => {
    const caller = requireVerified(request.auth);
    const parsed = zoomDeleteMeetingRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw zoomError('invalid_request', 'A meetingId or zoomMeetingId is required.');
    }
    requireZoomEnabled();
    return handleZoomDeleteMeeting(caller.uid, parsed.data, zoomDeps());
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
