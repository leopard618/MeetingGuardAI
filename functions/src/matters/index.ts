/**
 * Executive assistant functions (A1; docs/v1/ARCHITECTURE.md section 36). Firebase shell only:
 * auth, secrets and wiring; the logic is in ./handlers.ts.
 *
 * Deployability (same gate as functions/src/whatsapp/index.ts): EVERY export here is
 * `undefined` unless MATTERS_ENABLED is true while this module is loaded at deploy time, and the
 * matter params and secrets (config.ts mattersParams) are DECLARED only then. firebase-functions
 * puts every declared param and secret in the deploy manifest whether a function uses it or not,
 * so with the assistant off a deploy never asks for MATTERS_POSTMARK_TOKEN,
 * MATTERS_INBOUND_PASSWORD or a MATTERS_* line. Handlers re-check MATTERS_ENABLED and
 * MATTERS_ALLOWED_UIDS at run time.
 *
 * Runtime identity: every function here runs as the service account named by the
 * MATTERS_SERVICE_ACCOUNT line in functions/.env.<projectId> (mattersServiceAccountAtLoad), so
 * the deploy grants the secrets to that account and not to the shared default compute account.
 * Without the line (or with a value that is not one service account address) they deploy under
 * the default account, as before.
 *
 * - matterDraft / matterRevise: one model call each (OPENAI_API_KEY).
 * - matterConfirm: the first email (MATTERS_POSTMARK_TOKEN).
 * - matterCancel: Firestore only.
 * - assistantInboundEmail: Postmark's inbound webhook (HTTP basic auth, user "postmark", password
 *   MATTERS_INBOUND_PASSWORD); 401 before the body is read when it does not match. Every other
 *   outcome answers 200 so Postmark does not retry what we already handled or chose to drop. A2:
 *   1 GiB, concurrency 2, the sender check (./mailCheck.ts, which loads mailauth) required lazily
 *   on the first request; no model call here.
 * - A2: matterView (callable: the open matters and one matter's cards, for the owner; no secret),
 *   matterDecide (callable: cards and commitments; MATTERS_POSTMARK_TOKEN for approved replies),
 *   matterInboundRead (onDocumentCreated on a matter's messages: the model read of a reply;
 *   OPENAI_API_KEY and MATTERS_POSTMARK_TOKEN), matterTick (every 15 minutes: end dates, follow-ups,
 *   read retries; both secrets) and matterDeliveryEvents (Postmark's bounce and spam-complaint
 *   webhook, the same basic auth as the inbound one). The logic is in ./replies.ts.
 * - A3: matterSetStatus (pause, resume) and matterChange (a change, read back and confirmed):
 *   ./manage.ts, OPENAI_API_KEY for the change draft. matterAsk (questions by voice or text, one
 *   model call): ./ask.ts. matterSpeak (MATTERS_NATURAL_VOICE, demo only: OpenAI text-to-speech).
 *   Scheduling reads the owner's meetings through the assistant's bounded reader
 *   (assistant/context.ts firestoreMeetingReader) and MATTERS_AUTO_SCHEDULE; matterDecide also books
 *   an approved time, so it reads the calendar too.
 */
import { timingSafeEqual } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/firestore';
import { onCall, onRequest, type CallableOptions } from 'firebase-functions/https';
import { onSchedule } from 'firebase-functions/scheduler';
import OpenAI from 'openai';

import {
  ASSISTANT_GLOBAL_DAILY_LIMIT,
  FUNCTIONS_REGION,
  MATTERS_TUNING,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_PRICE_IN_PER_M,
  OPENAI_PRICE_OUT_PER_M,
  OPENAI_REASONING_EFFORT,
  isMatterUserAllowed,
  mattersParams,
  parsePricePerM,
  parseReasoningEffort,
} from '../config';
import { adminDb } from '../firebase';
import { instanceOpenAiKeyProvider, withKeyRetry } from '../openaiKey';
import { AI_STATS_SHARD_COUNT, adminStatsAiShardPath } from '../admin/schemas';
import { createGlobalBudget, firestoreGlobalBudgetStore, type GlobalBudget } from '../assistant/globalBudget';
import { firestoreMeetingReader } from '../assistant/context';
import { createOpenAiClient } from '../assistant/llm';
import type {
  MatterAskResponse,
  MatterCancelResponse,
  MatterConfirmResponse,
  MatterDecideResponse,
  MatterDraftResponse,
  MatterMessageResponse,
  MatterMoveResponse,
  MatterSetStatusResponse,
  MatterSpeakResponse,
  MatterViewResponse,
} from '../shared/aiContract';
import { handleMatterAsk, handleMatterSpeak } from './ask';
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
import { handleMatterChange, handleMatterSetStatus } from './manage';
import type * as MailCheckNs from './mailCheck';
import type { SenderCheck } from './mailCheck';
import { handleDeliveryEvent, handleInboundRead, handleMatterDecide, handleMatterView, runMatterTick } from './replies';
import { firestoreMatterStore } from './store';
import { handleMatterMessage, handleMatterMove } from './write';

type MailCheckModule = typeof MailCheckNs;
let mailCheckModule: MailCheckModule | null = null;

/**
 * The sender check, required on the first inbound request: it loads mailauth, which no deploy-time
 * module may load (test/unit/genericModules.test.ts). require, not import(), for the reason in
 * summaries/inboundFunction.ts (CommonJS build); a failed require is retried on the next request.
 */
function loadMailCheck(): SenderCheck {
  if (mailCheckModule === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see above.
    mailCheckModule = require('./mailCheck') as MailCheckModule;
  }
  return mailCheckModule.checkSender;
}

/** One per instance (its short cache keeps the check cheap); the assistant's daily cap. */
let globalBudget: GlobalBudget | null = null;
function instanceGlobalBudget(): GlobalBudget {
  if (globalBudget === null) {
    globalBudget = createGlobalBudget(firestoreGlobalBudgetStore(adminDb()), { limit: () => ASSISTANT_GLOBAL_DAILY_LIMIT.value() });
  }
  return globalBudget;
}

/** Whether MATTERS_ENABLED is true while this module is LOADED (deploy-time gate). */
export function mattersEnabledAtLoad(): boolean {
  const raw = process.env.MATTERS_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

/** A service account address ("name@project.iam.gserviceaccount.com") or the "name@" shorthand. */
const SERVICE_ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,99}@(?:(?:[a-z0-9-]+\.)+gserviceaccount\.com)?$/i;

/**
 * The MATTERS_SERVICE_ACCOUNT value while this module is LOADED: a PLAIN KEY in
 * functions/.env.<projectId>, read at deploy time (CLI discovery) and load time, never at request
 * time, and deliberately not a declared param (firebase-tools resolves declared params after
 * discovery; the same reasoning as summaries/gate.ts summariesServiceAccountAtLoad). Trimmed; the
 * "name@" shorthand is expanded with GCLOUD_PROJECT, because the CLI grants the secrets to the
 * value as written. Null when unset, blank or not one service account address (never "public",
 * a user or a group). Never logged.
 */
export function mattersServiceAccountAtLoad(): string | null {
  const raw = process.env.MATTERS_SERVICE_ACCOUNT;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  const project = process.env.GCLOUD_PROJECT?.trim() ?? '';
  const shorthand = value.length > 1 && value.indexOf('@') === value.length - 1;
  const expanded = shorthand && project.length > 0 ? `${value}${project}.iam.gserviceaccount.com` : value;
  return SERVICE_ACCOUNT_RE.test(expanded) ? expanded : null;
}

/** The runtime identity option of every matter function (empty: the default account). */
function runtimeIdentity(): { serviceAccount?: string } {
  const serviceAccount = mattersServiceAccountAtLoad();
  return serviceAccount !== null ? { serviceAccount } : {};
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
  const params = mattersParams();
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
          token: params.MATTERS_POSTMARK_TOKEN.value(),
          messageStream: MATTERS_TUNING.messageStream,
          timeoutMs: MATTERS_TUNING.postmarkTimeoutMs,
        });
      } catch (error) {
        throw new EmailSendError('configuration', null, { cause: error });
      }
    },
    now: () => new Date(),
    enabled: params.MATTERS_ENABLED.value() === true,
    allowed: (uid) => isMatterUserAllowed(params.MATTERS_ALLOWED_UIDS.value(), uid),
    domain: params.MATTERS_MAIL_DOMAIN.value(),
    fromLocalPart: MATTERS_TUNING.fromLocalPart,
    dailyLimit: params.MATTERS_USER_DAILY_LIMIT.value(),
    autoReply: params.MATTERS_AUTO_REPLY.value() === true,
    dailySendLimit: params.MATTERS_USER_DAILY_SENDS.value(),
    globalBudget: instanceGlobalBudget(),
    // A3
    autoSchedule: params.MATTERS_AUTO_SCHEDULE.value() === true,
    meetings: firestoreMeetingReader(adminDb()),
    prices: { inPerM: parsePricePerM(OPENAI_PRICE_IN_PER_M.value()), outPerM: parsePricePerM(OPENAI_PRICE_OUT_PER_M.value()) },
    naturalVoice: params.MATTERS_NATURAL_VOICE.value() === true,
    speech: async (text, language) => {
      const { key } = await instanceOpenAiKeyProvider().get();
      const client = new OpenAI({ apiKey: key, timeout: MATTERS_TUNING.speechTimeoutMs, maxRetries: 0 });
      const response = await client.audio.speech.create({
        model: MATTERS_TUNING.speechModel,
        voice: MATTERS_TUNING.speechVoice,
        input: text,
        response_format: 'mp3',
        instructions: language === 'es' ? 'Speak natural, friendly Spanish from Spain, at a calm pace.' : 'Speak in a natural, friendly tone, at a calm pace.',
      });
      return Buffer.from(await response.arrayBuffer());
    },
    // the assistant's admin stats: one merge-set with increments on a random shard
    recordAiUsage: async (dayKey, tokens) => {
      const shard = Math.floor(Math.random() * AI_STATS_SHARD_COUNT);
      await adminDb()
        .doc(adminStatsAiShardPath(dayKey, shard))
        .set(
          {
            requests: FieldValue.increment(1),
            inputTokens: FieldValue.increment(tokens.inputTokens),
            outputTokens: FieldValue.increment(tokens.outputTokens),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
    },
  };
}

function callableBase(): CallableOptions {
  return {
    region: FUNCTIONS_REGION,
    enforceAppCheck: false,
    timeoutSeconds: MATTERS_TUNING.functionTimeoutSeconds,
    memory: MATTERS_TUNING.memory,
    cpu: MATTERS_TUNING.cpu,
    concurrency: MATTERS_TUNING.concurrency,
    maxInstances: MATTERS_TUNING.maxInstances,
    ...runtimeIdentity(),
  };
}

function makeCallables() {
  const { MATTERS_POSTMARK_TOKEN } = mattersParams();
  const CALLABLE_BASE = callableBase();
  return {
    matterDraft: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterDraftResponse> =>
      handleMatterDraft(callerOf(request.auth), request.data, deps()),
    ),
    matterRevise: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterDraftResponse> =>
      handleMatterRevise(callerOf(request.auth), request.data, deps()),
    ),
    matterConfirm: onCall({ ...CALLABLE_BASE, secrets: [MATTERS_POSTMARK_TOKEN] }, (request): Promise<MatterConfirmResponse> =>
      handleMatterConfirm(callerOf(request.auth), request.data, deps()),
    ),
    matterCancel: onCall(CALLABLE_BASE, (request): Promise<MatterCancelResponse> => handleMatterCancel(callerOf(request.auth), request.data, deps())),
    matterDecide: onCall({ ...CALLABLE_BASE, secrets: [MATTERS_POSTMARK_TOKEN] }, (request): Promise<MatterDecideResponse> =>
      handleMatterDecide(callerOf(request.auth), request.data, deps()),
    ),
    // the app's open matters and matter page, read for the owner (no client rule needed)
    matterView: onCall(CALLABLE_BASE, (request): Promise<MatterViewResponse> => handleMatterView(callerOf(request.auth), request.data, deps())),
    // A3
    matterSetStatus: onCall(CALLABLE_BASE, (request): Promise<MatterSetStatusResponse> => handleMatterSetStatus(callerOf(request.auth), request.data, deps())),
    matterChange: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterDraftResponse> =>
      handleMatterChange(callerOf(request.auth), request.data, deps()),
    ),
    matterAsk: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterAskResponse> => handleMatterAsk(callerOf(request.auth), request.data, deps())),
    matterSpeak: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterSpeakResponse> =>
      handleMatterSpeak(callerOf(request.auth), request.data, deps()),
    ),
    // A3 feedback: write to the contact now, move the booked meeting (each only makes a card the owner sends)
    matterMessage: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterMessageResponse> =>
      handleMatterMessage(callerOf(request.auth), request.data, deps()),
    ),
    matterMove: onCall({ ...CALLABLE_BASE, secrets: [OPENAI_API_KEY] }, (request): Promise<MatterMoveResponse> => handleMatterMove(callerOf(request.auth), request.data, deps())),
  };
}

/** A2: the model read of each stored reply (the webhook never calls the model). */
function makeInboundRead() {
  const { MATTERS_POSTMARK_TOKEN } = mattersParams();
  return onDocumentCreated(
    {
      document: 'users/{uid}/matters/{matterId}/messages/{messageId}',
      region: FUNCTIONS_REGION,
      secrets: [OPENAI_API_KEY, MATTERS_POSTMARK_TOKEN],
      timeoutSeconds: MATTERS_TUNING.readTimeoutSeconds,
      memory: MATTERS_TUNING.memory,
      maxInstances: MATTERS_TUNING.maxInstances,
      // no platform retry: the readState claim and matterTick's retries cover a failed read
      retry: false,
      ...runtimeIdentity(),
    },
    async (event) => {
      const { uid, matterId, messageId } = event.params;
      if (!uid || !matterId || !messageId) return;
      // outbound messages and mail kept only finish at once (claimRead), without a model call
      if (event.data?.get('direction') !== 'inbound') return;
      await handleInboundRead({ uid, matterId, messageId }, deps());
    },
  );
}

/** A2: end dates, follow-ups and read retries, every 15 minutes. */
function makeTick() {
  const { MATTERS_POSTMARK_TOKEN } = mattersParams();
  return onSchedule(
    {
      schedule: 'every 15 minutes',
      timeZone: 'Etc/UTC',
      region: FUNCTIONS_REGION,
      secrets: [OPENAI_API_KEY, MATTERS_POSTMARK_TOKEN],
      timeoutSeconds: MATTERS_TUNING.tickTimeoutSeconds,
      memory: MATTERS_TUNING.memory,
      maxInstances: 1,
      retryCount: 0,
      ...runtimeIdentity(),
    },
    async () => {
      if (mattersParams().MATTERS_ENABLED.value() !== true) return;
      const result = await runMatterTick(deps(), { schedules: MATTERS_TUNING.tickBatch, reads: MATTERS_TUNING.tickReadBatch });
      logger.info('matters.tick', { ...result });
    },
  );
}

/** A2: Postmark's outbound webhook (Bounce, SpamComplaint), with the inbound webhook's basic auth. */
function makeDeliveryEvents() {
  const { MATTERS_ENABLED, MATTERS_INBOUND_PASSWORD } = mattersParams();
  return onRequest(
    {
      region: FUNCTIONS_REGION,
      secrets: [MATTERS_INBOUND_PASSWORD],
      timeoutSeconds: 30,
      memory: '256MiB',
      maxInstances: MATTERS_TUNING.maxInstances,
      ...runtimeIdentity(),
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
        logger.warn('matters.delivery_unauthorized', {});
        res.status(401).send('Unauthorized');
        return;
      }
      const outcome = await handleDeliveryEvent(req.body, { store: firestoreMatterStore(adminDb()), now: () => new Date() });
      res.status(200).send(outcome);
    },
  );
}

/** HTTP basic auth "postmark:<password>", compared in constant time. */
export function isInboundAuthorized(header: unknown, password: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Basic ') || password.length === 0) return false;
  const given = Buffer.from(header.slice('Basic '.length).trim(), 'base64');
  const expected = Buffer.from(`postmark:${password}`, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Postmark's MessageID from a payload too large to parse as a whole (it is near the start). */
export function providerIdOf(rawBody: Buffer): string | null {
  const match = /"MessageID"\s*:\s*"([A-Za-z0-9-]{1,128})"/.exec(rawBody.subarray(0, 64 * 1024).toString('utf8'));
  return match?.[1] ?? null;
}

function makeInboundWebhook() {
  const { MATTERS_ENABLED, MATTERS_INBOUND_PASSWORD, MATTERS_MAIL_DOMAIN } = mattersParams();
  return onRequest(
    {
      region: FUNCTIONS_REGION,
      secrets: [MATTERS_INBOUND_PASSWORD],
      timeoutSeconds: MATTERS_TUNING.inboundTimeoutSeconds,
      memory: MATTERS_TUNING.inboundMemory,
      concurrency: MATTERS_TUNING.inboundConcurrency,
      maxInstances: MATTERS_TUNING.maxInstances,
      ...runtimeIdentity(),
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
      if (!req.rawBody) {
        res.status(200).send('ignored');
        return;
      }
      if (req.rawBody.length > MATTERS_TUNING.maxInboundBytes) {
        // answered 200 (Postmark would only send it again), but never dropped without a trace
        logger.warn('matters.inbound_too_large', { providerId: providerIdOf(req.rawBody), sizeMiB: Math.ceil(req.rawBody.length / (1024 * 1024)) });
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
        checkSender: loadMailCheck(),
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
export const matterDecide = callables?.matterDecide;
export const matterView = callables?.matterView;
export const matterSetStatus = callables?.matterSetStatus;
export const matterChange = callables?.matterChange;
export const matterAsk = callables?.matterAsk;
export const matterSpeak = callables?.matterSpeak;
export const matterMessage = callables?.matterMessage;
export const matterMove = callables?.matterMove;
export const assistantInboundEmail = enabledAtLoad ? makeInboundWebhook() : undefined;
export const matterInboundRead = enabledAtLoad ? makeInboundRead() : undefined;
export const matterTick = enabledAtLoad ? makeTick() : undefined;
export const matterDeliveryEvents = enabledAtLoad ? makeDeliveryEvents() : undefined;
