/**
 * Executive assistant functions (A1; docs/v1/ARCHITECTURE.md section 36). Firebase shell only:
 * auth, secrets and wiring; the logic is in ./handlers.ts.
 *
 * Deployability (same pattern as functions/src/whatsapp/index.ts): EVERY export here is
 * `undefined` unless MATTERS_ENABLED is true while this module is loaded at deploy time, so the
 * default deploy never references POSTMARK_SERVER_TOKEN or MATTERS_INBOUND_PASSWORD and cannot
 * fail on them. Handlers re-check MATTERS_ENABLED.value() and MATTERS_ALLOWED_UIDS at run time.
 *
 * - matterDraft / matterRevise: one model call each (OPENAI_API_KEY).
 * - matterConfirm: the first email (POSTMARK_SERVER_TOKEN).
 * - matterCancel: Firestore only.
 * - assistantInboundEmail: Postmark's inbound webhook (HTTP basic auth, user "postmark", password
 *   MATTERS_INBOUND_PASSWORD); 401 before the body is read when it does not match. Every other
 *   outcome answers 200 so Postmark does not retry what we already handled or chose to drop.
 */
import { timingSafeEqual } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onCall, onRequest, type CallableOptions } from 'firebase-functions/https';

import {
  FUNCTIONS_REGION,
  MATTERS_ALLOWED_UIDS,
  MATTERS_ENABLED,
  MATTERS_INBOUND_PASSWORD,
  MATTERS_MAIL_DOMAIN,
  MATTERS_TUNING,
  MATTERS_USER_DAILY_LIMIT,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  POSTMARK_SERVER_TOKEN,
  isMatterUserAllowed,
  parseReasoningEffort,
} from '../config';
import { adminDb } from '../firebase';
import { instanceOpenAiKeyProvider, withKeyRetry } from '../openaiKey';
import { createOpenAiClient } from '../assistant/llm';
import type { MatterCancelResponse, MatterConfirmResponse, MatterDraftResponse } from '../shared/aiContract';
import { createPostmarkSender, EmailSendError } from './email';
import {
  handleInboundEmail,
  handleMatterCancel,
  handleMatterConfirm,
  handleMatterDraft,
  handleMatterRevise,
  type MatterCaller,
  type MatterDeps,
} from './handlers';
import { firestoreMatterStore } from './store';

/** Whether MATTERS_ENABLED is true while this module is LOADED (deploy-time gate). */
export function mattersEnabledAtLoad(): boolean {
  const raw = process.env.MATTERS_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

function callerOf(auth: { uid: string; token: Record<string, unknown> } | undefined): MatterCaller | null {
  if (!auth) return null;
  const firebaseClaims = auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  return {
    uid: auth.uid,
    name: typeof auth.token.name === 'string' ? auth.token.name : '',
    email: typeof auth.token.email === 'string' ? auth.token.email : null,
    emailVerified: auth.token.email_verified === true,
    signInProvider: typeof firebaseClaims?.sign_in_provider === 'string' ? firebaseClaims.sign_in_provider : null,
  };
}

function deps(): MatterDeps {
  return {
    store: firestoreMatterStore(adminDb()),
    llm: () => {
      const reasoningEffort = parseReasoningEffort(OPENAI_REASONING_EFFORT.value());
      const model = OPENAI_MODEL.value();
      return withKeyRetry(instanceOpenAiKeyProvider(), (apiKey) => createOpenAiClient({ apiKey, model, reasoningEffort }));
    },
    sender: () => {
      try {
        return createPostmarkSender({
          token: POSTMARK_SERVER_TOKEN.value(),
          messageStream: MATTERS_TUNING.messageStream,
          timeoutMs: MATTERS_TUNING.postmarkTimeoutMs,
        });
      } catch (error) {
        throw new EmailSendError('configuration', null, { cause: error });
      }
    },
    now: () => new Date(),
    enabled: MATTERS_ENABLED.value() === true,
    allowed: (uid) => isMatterUserAllowed(MATTERS_ALLOWED_UIDS.value(), uid),
    domain: MATTERS_MAIL_DOMAIN.value(),
    fromLocalPart: MATTERS_TUNING.fromLocalPart,
    dailyLimit: MATTERS_USER_DAILY_LIMIT.value(),
  };
}

const CALLABLE_BASE: CallableOptions = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: false,
  timeoutSeconds: MATTERS_TUNING.functionTimeoutSeconds,
  memory: MATTERS_TUNING.memory,
  cpu: MATTERS_TUNING.cpu,
  concurrency: MATTERS_TUNING.concurrency,
  maxInstances: MATTERS_TUNING.maxInstances,
};

function makeCallables() {
  return {
    matterDraft: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterDraftResponse> =>
      handleMatterDraft(callerOf(request.auth), request.data, deps()),
    ),
    matterRevise: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterDraftResponse> =>
      handleMatterRevise(callerOf(request.auth), request.data, deps()),
    ),
    matterConfirm: onCall({ ...CALLABLE_BASE, secrets: [POSTMARK_SERVER_TOKEN] }, (request): Promise<MatterConfirmResponse> =>
      handleMatterConfirm(callerOf(request.auth), request.data, deps()),
    ),
    matterCancel: onCall(CALLABLE_BASE, (request): Promise<MatterCancelResponse> => handleMatterCancel(callerOf(request.auth), request.data, deps())),
  };
}

/** HTTP basic auth "postmark:<password>", compared in constant time. */
export function isInboundAuthorized(header: unknown, password: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Basic ') || password.length === 0) return false;
  const given = Buffer.from(header.slice('Basic '.length).trim(), 'base64');
  const expected = Buffer.from(`postmark:${password}`, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function makeInboundWebhook() {
  return onRequest(
    {
      region: FUNCTIONS_REGION,
      secrets: [MATTERS_INBOUND_PASSWORD],
      timeoutSeconds: 30,
      memory: '256MiB',
      maxInstances: MATTERS_TUNING.maxInstances,
    },
    async (req, res) => {
      if (MATTERS_ENABLED.value() !== true) {
        res.status(404).send('Not configured');
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }
      if (!isInboundAuthorized(req.headers.authorization, MATTERS_INBOUND_PASSWORD.value())) {
        logger.warn('matters.inbound_unauthorized', {});
        res.status(401).send('Unauthorized');
        return;
      }
      if (!req.rawBody || req.rawBody.length > MATTERS_TUNING.maxInboundBytes) {
        res.status(200).send('ignored');
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(req.rawBody.toString('utf8'));
      } catch {
        res.status(200).send('ignored');
        return;
      }
      const outcome = await handleInboundEmail(payload, {
        store: firestoreMatterStore(adminDb()),
        now: () => new Date(),
        domain: MATTERS_MAIL_DOMAIN.value(),
        markerTtlDays: MATTERS_TUNING.inboundMarkerTtlDays,
      });
      res.status(200).send(outcome);
    },
  );
}

const enabledAtLoad = mattersEnabledAtLoad();
const callables = enabledAtLoad ? makeCallables() : undefined;

/** Exported only while MATTERS_ENABLED is true at deploy time (see the header). */
export const matterDraft = callables?.matterDraft;
export const matterRevise = callables?.matterRevise;
export const matterConfirm = callables?.matterConfirm;
export const matterCancel = callables?.matterCancel;
export const assistantInboundEmail = enabledAtLoad ? makeInboundWebhook() : undefined;
