/**
 * WhatsApp bot functions (owner: fn-bot). Design: docs/ARCHITECTURE.md §27; owner setup and
 * deploy order: docs/SETUP.md §14. Contract: shared/aiContract.ts (whatsapp* schemas,
 * WHATSAPP_ERROR_CODES).
 *
 * Deployability rules (same pattern as functions/src/zoom/index.ts - DO NOT break them):
 * - The three whatsapp* callables NEVER reference the WHATSAPP_* secrets. They answer from the
 *   non-secret WHATSAPP_ENABLED param and Firestore, so they always deploy and the app can
 *   always ask.
 * - `whatsappWebhook` binds the WHATSAPP_* secrets (plus OPENAI_API_KEY for the assistant fast
 *   path, plus the ZOOM_* secrets ONLY while ZOOM_ENABLED is true at load - see §27's amendment
 *   of the §24 binding rule), so it is exported ONLY while WHATSAPP_ENABLED is true at deploy
 *   time (`whatsappEnabledAtLoad()` reads the param's env value during CLI discovery). While
 *   the param is false (the default) a full `firebase deploy --only functions` never validates
 *   the secrets and cannot fail on them.
 *
 * Module layout: this file is the Firebase shell (auth, request schemas, WHATSAPP_ENABLED
 * guard, dependency wiring); ./webhook.ts holds the inbound pipeline on injected ports,
 * ./signature.ts the raw-body HMAC + handshake, ./link.ts the linking logic, ./session.ts the
 * Firestore state, ./executor.ts the confirmed-action executor, ./send.ts the Graph client and
 * ./messages.ts every user-visible string (EN+ES).
 */
import * as logger from 'firebase-functions/logger';
import { onCall, onRequest, type CallableOptions } from 'firebase-functions/https';

import {
  FUNCTIONS_REGION,
  OPENAI_API_KEY,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_APP_SECRET,
  WHATSAPP_DISPLAY_NUMBER,
  WHATSAPP_ENABLED,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_TUNING,
  WHATSAPP_USER_DAILY_LIMIT,
  WHATSAPP_VERIFY_TOKEN,
  ZOOM_ACCOUNT_ID,
  ZOOM_CLIENT_ID,
  ZOOM_CLIENT_SECRET,
  ZOOM_ENABLED,
} from '../config';
import { adminDb } from '../firebase';
import { buildAssistantDeps } from '../assistant';
import { runAssistant } from '../assistant/handler';
import {
  isTrustedSignInProvider,
  whatsappLinkStartRequestSchema,
  whatsappLinkStatusRequestSchema,
  whatsappUnlinkRequestSchema,
  type WhatsappLinkStartResponse,
  type WhatsappLinkStatusResponse,
  type WhatsappUnlinkResponse,
} from '../shared/aiContract';
import { zoomDeps, zoomWriteCallablesEnabledAtLoad } from '../zoom';
import { handleZoomCreateMeeting, handleZoomDeleteMeeting, handleZoomSyncMeeting } from '../zoom/handler';
import { firestoreMeetingStore, type ExecutorDeps, type ZoomHooks } from './executor';
import { firestoreLinkStore, handleLinkStart, handleLinkStatus, handleUnlink, whatsappError, type LinkDeps } from './link';
import { createGraphSender } from './send';
import { firestoreWhatsappStore } from './session';
import { SIGNATURE_HEADER, verifyHandshake, verifyWebhookSignature } from './signature';
import { processWebhookPayload, type WebhookDeps } from './webhook';

export { whatsappError } from './link';

/**
 * Whether the WHATSAPP_ENABLED param is true while this module is LOADED (CLI discovery and
 * runtime read the same env var that backs the param). Deploy-time only: handlers read
 * WHATSAPP_ENABLED.value() instead.
 */
export function whatsappEnabledAtLoad(): boolean {
  const raw = process.env.WHATSAPP_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------------------------
// Callables (no secrets, always deployed)
// ---------------------------------------------------------------------------------------------

interface WhatsappCaller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}

function callerOf(auth: { uid: string; token: Record<string, unknown> } | undefined): WhatsappCaller | null {
  if (!auth) return null;
  const firebaseClaims = auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  return {
    uid: auth.uid,
    emailVerified: auth.token.email_verified === true,
    signInProvider: typeof firebaseClaims?.sign_in_provider === 'string' ? firebaseClaims.sign_in_provider : null,
  };
}

/** Same verified-account rule as the assistant and zoom callables. */
function requireVerified(auth: { uid: string; token: Record<string, unknown> } | undefined): WhatsappCaller {
  const caller = callerOf(auth);
  if (!caller) throw whatsappError('unauthenticated', 'Sign in to link WhatsApp.');
  if (!(caller.emailVerified || isTrustedSignInProvider(caller.signInProvider))) {
    throw whatsappError('unauthenticated', 'Verify your email to link WhatsApp.');
  }
  return caller;
}

function requireWhatsappEnabled(): void {
  if (WHATSAPP_ENABLED.value() !== true) {
    throw whatsappError('not_configured', 'The WhatsApp bot is not set up.');
  }
}

const CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: false,
  timeoutSeconds: 10,
  memory: '256MiB',
  maxInstances: 10,
};

function linkDeps(): LinkDeps {
  return { store: firestoreLinkStore(adminDb()), now: () => new Date() };
}

/** whatsappLinkStart {} -> { code, expiresAtIso }: mints the caller's 6-digit link code. */
export const whatsappLinkStart = onCall(CALLABLE_OPTIONS, (request): Promise<WhatsappLinkStartResponse> => {
  const caller = requireVerified(request.auth);
  if (!whatsappLinkStartRequestSchema.safeParse(request.data ?? {}).success) {
    throw whatsappError('invalid_request', 'whatsappLinkStart takes no arguments.');
  }
  requireWhatsappEnabled();
  return handleLinkStart(caller.uid, linkDeps());
});

/** whatsappLinkStatus {} -> { enabled, linked, displayNumber, deepLink }. Auth only. */
export const whatsappLinkStatus = onCall(CALLABLE_OPTIONS, (request): Promise<WhatsappLinkStatusResponse> => {
  const caller = callerOf(request.auth);
  if (!caller) throw whatsappError('unauthenticated', 'Sign in first.');
  if (!whatsappLinkStatusRequestSchema.safeParse(request.data ?? {}).success) {
    throw whatsappError('invalid_request', 'whatsappLinkStatus takes no arguments.');
  }
  return handleLinkStatus(
    caller.uid,
    { enabled: WHATSAPP_ENABLED.value() === true, displayNumber: WHATSAPP_DISPLAY_NUMBER.value() },
    linkDeps(),
  );
});

/** whatsappUnlink {} -> { unlinked }: removes the caller's link, session and active code. */
export const whatsappUnlink = onCall(CALLABLE_OPTIONS, (request): Promise<WhatsappUnlinkResponse> => {
  const caller = requireVerified(request.auth);
  if (!whatsappUnlinkRequestSchema.safeParse(request.data ?? {}).success) {
    throw whatsappError('invalid_request', 'whatsappUnlink takes no arguments.');
  }
  requireWhatsappEnabled();
  return handleUnlink(caller.uid, linkDeps());
});

// ---------------------------------------------------------------------------------------------
// Webhook (binds the secrets; exported only while WHATSAPP_ENABLED at deploy time)
// ---------------------------------------------------------------------------------------------

/** Captured at load: whether the ZOOM_* secrets are bound on this deployment (see the header). */
const zoomSecretsBound = zoomWriteCallablesEnabledAtLoad();

/** Zoom reuse hooks for the executor, or undefined while Zoom is off (then links stay null). */
function zoomHooks(): ZoomHooks | undefined {
  if (!zoomSecretsBound || ZOOM_ENABLED.value() !== true) return undefined;
  return {
    async ensureLink(uid, meetingId) {
      await handleZoomCreateMeeting(uid, { meetingId }, zoomDeps());
    },
    async sync(uid, meetingId) {
      await handleZoomSyncMeeting(uid, { meetingId }, zoomDeps());
    },
    async remove(uid, meetingId, zoomMeetingId) {
      await handleZoomDeleteMeeting(uid, { meetingId, zoomMeetingId }, zoomDeps());
    },
  };
}

function webhookDeps(): WebhookDeps {
  const db = adminDb();
  const executor: ExecutorDeps = { store: firestoreMeetingStore(db), now: () => new Date() };
  const hooks = zoomHooks();
  if (hooks) executor.zoom = hooks;
  return {
    store: firestoreWhatsappStore(db),
    sender: createGraphSender({
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID.value(),
      accessToken: WHATSAPP_ACCESS_TOKEN.value(),
    }),
    assistant: (uid, request) => runAssistant(uid, request, buildAssistantDeps(db, uid)),
    executor,
    dailyLimit: WHATSAPP_USER_DAILY_LIMIT.value(),
    displayNumber: WHATSAPP_DISPLAY_NUMBER.value().replace(/[^0-9]/g, ''),
    now: () => new Date(),
  };
}

function makeWhatsappWebhook() {
  return onRequest(
    {
      region: FUNCTIONS_REGION,
      secrets: [
        WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_APP_SECRET,
        WHATSAPP_VERIFY_TOKEN,
        // The assistant bridge's fast path (instanceOpenAiKeyProvider env binding; the Secret
        // Manager REST fallback exists, but binding is free here: this function only deploys
        // while WHATSAPP_ENABLED is true, which per SETUP §14 implies the secret exists).
        OPENAI_API_KEY,
        // §24 amendment (§27): referenced ONLY while ZOOM_ENABLED is true at load, which per
        // SETUP §12 implies the ZOOM_* secrets exist - a deploy can still never fail on them.
        ...(zoomSecretsBound ? [ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET] : []),
      ],
      timeoutSeconds: WHATSAPP_TUNING.functionTimeoutSeconds,
      memory: WHATSAPP_TUNING.memory,
      cpu: WHATSAPP_TUNING.cpu,
      concurrency: WHATSAPP_TUNING.concurrency,
      maxInstances: WHATSAPP_TUNING.maxInstances,
    },
    async (req, res) => {
      // Stale deployment or a manually flipped param: fail soft, never reach Meta or OpenAI.
      if (WHATSAPP_ENABLED.value() !== true) {
        res.status(404).send('Not configured');
        return;
      }
      if (req.method === 'GET') {
        const result = verifyHandshake(req.query as Record<string, unknown>, WHATSAPP_VERIFY_TOKEN.value());
        if (result.status !== 200) logger.warn('whatsapp.handshake_rejected', {});
        res.status(result.status).send(result.body);
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }
      // Signature FIRST, over the raw bytes (req.rawBody; §27). Reject = 401, no payload logging.
      if (!verifyWebhookSignature(req.rawBody, req.headers[SIGNATURE_HEADER], WHATSAPP_APP_SECRET.value())) {
        logger.warn('whatsapp.signature_rejected', { hasBody: Boolean(req.rawBody && req.rawBody.length > 0) });
        res.status(401).send('Unauthorized');
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(req.rawBody.toString('utf8'));
      } catch {
        res.status(200).send('ignored');
        return;
      }
      await processWebhookPayload(payload, webhookDeps());
      res.status(200).send('ok');
    },
  );
}

/**
 * Exported only while WHATSAPP_ENABLED is true at deploy time, so the default deploy never
 * references the secrets (undefined exports are skipped by the functions loader). Flipping the
 * param to false again makes the next deploy OFFER to delete the function - accept it.
 */
export const whatsappWebhook = whatsappEnabledAtLoad() ? makeWhatsappWebhook() : undefined;
