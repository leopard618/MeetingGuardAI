/**
 * summaryCommitments (docs/v2/M11-DESIGN.md sections 2.1 to 2.9, 3.4 and 3.5; contract:
 * shared/aiContract.ts summaryCommitments* schemas, COMMITMENT_ERROR_CODES). A pure handler over
 * injected deps (db, clock, the two non-secret params, the keyring, the quota store, the global
 * budget and the model), like ./read.ts; ./commitmentsFunction.ts is the Firebase shell and loads
 * this module lazily on the first call.
 *
 * Gates exactly as summaryRead (callables.ts requireActionCaller): a verified caller
 * (unauthenticated), SUMMARIES_ENABLED (not_enabled), the pilot list (not_allowed), in that order,
 * then the request (invalid_request). The summary is read only through loadSummaryForExtraction:
 * filed or kept summaries; anything else answers not_found.
 *
 * Ops:
 * - get {summaryId}: the view in use. Never calls the model, never charges, never writes. 'none'
 *   before the first preparation ('preparing' while a lease lives), 'stale' after a content,
 *   parser or extractor change (the old decisions read-only while the text is the same; no list
 *   when the text changed, since its quotes would point into text that no longer exists).
 * - prepare {summaryId, mode}: the current view of the mode when it exists (switching views makes
 *   no model call); as_written builds the action items as written (free, no AI, no lease); ai
 *   takes the lease, charges ONE AI action per summary on its first AI preparation (consumeQuota),
 *   spends one global-budget unit per started 10,000 characters of payload, counts the call (at
 *   most COMMITMENTS_TUNING.maxModelCalls per content digest and extractor version), calls the
 *   model with the one strict tool, checks every proposal in code (commitments/verify.ts) and
 *   writes the view with update() in a transaction that still finds the summary, the same content
 *   and our lease.
 * - decide {summaryId, key, timezone, language, decisions}: commitmentsStore decideCommitments,
 *   one transaction with the tasks.
 *
 * Two entry points over ONE code path (section 4.4): handleSummaryCommitments is the callable (its
 * gates, then the request); runCommitmentsOp runs an already checked op for a caller whose gates
 * passed elsewhere. The WhatsApp worker (./whatsappCommitments.ts) uses the second one with channel
 * 'whatsapp' (decide with draft null: the defaults of section 3.4), so the app and WhatsApp share the
 * same extraction, charge, lease, task ids and idempotency.
 *
 * Refunds as the assistant does: before the model call, and on configuration, connection,
 * rate_limited and server errors, the action is given back and the stored charge cleared; a call
 * that was made still counts toward the call cap (section 2.8). A timeout, an output that does not
 * parse, a call cut by finish_reason 'length', or anything after a completion keeps the charge, so
 * the retry is free (up to the call cap): at most one action per summary either way.
 *
 * Logs: `summaries.commitments` {uid, op, mode, state, counts, ms, tokens} and reason codes. Never
 * a title, a quote, a name, a meeting title, a summary id, an anchor id or a task id. Unexpected
 * errors log errorName only (never error.message: a JSON.parse SyntaxError quotes model output,
 * and zod messages can carry values). No error leaves the handler unwrapped.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { randomBytes } from 'node:crypto';

import { HttpsError } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { COMMITMENTS_TUNING } from '../config';
import {
  COMMITMENT_ERROR_HTTPS_CODES,
  SUMMARY_LIMITS,
  summaryCommitmentsRequestSchema,
  summaryCommitmentsResponseSchema,
  usageDayKey,
  type AssistantUsage,
  type CommitmentChannel,
  type CommitmentErrorCode,
  type CommitmentErrorDetails,
  type CommitmentMode,
  type CommitmentOrigin,
  type CommitmentPreselect,
  type SummaryCommitments,
  type SummaryCommitmentsRequest,
  type SummaryCommitmentsResponse,
} from '../shared/aiContract';
import { isValidTimeZone, toLocalDateTime } from '../shared/time';
import { SealedError, type Keyring } from '../shared/sealed';
import { UpstreamError } from '../assistant/errors';
import type { GlobalBudget } from '../assistant/globalBudget';
import { safetyIdentifierFor, type LlmClient, type LlmResult } from '../assistant/llm';
import { consumeQuota, refundQuota, type QuotaDecision, type QuotaStore } from '../assistant/quota';
import { asWrittenProposals } from '../commitments/asWritten';
import { referenceDayOf } from '../commitments/due';
import { EXTRACTOR_VERSION, parserVersionInUse } from '../commitments/extraction';
import { extractionKey } from '../commitments/ids';
import { selectModelInput } from '../commitments/payload';
import { summaryPreselect } from '../commitments/preselect';
import { buildCommitmentsPrompt } from '../commitments/prompt';
import { PROPOSE_COMMITMENTS_TOOL, readProposeCall, type ProposeCallFailure } from '../commitments/tool';
import { verifyProposals, type VerifiedCommitment, type VerifyCounts } from '../commitments/verify';
import { requireActionCaller, type SummaryCallableAuth } from './callables';
import { readPreferencesTimeZone } from './candidates';
import {
  acceptedTaskIds,
  contractItemsOf,
  isCurrent,
  leaseAlive,
  nextExtraction,
  openView,
  parseExtraction,
  viewInUse,
  type MatchStamp,
  type StoredExtraction,
  type StoredView,
} from './commitmentsModel';
import {
  CommitmentDecideError,
  beginPreparation,
  commitPreparation,
  decideCommitments,
  readExistingTasks,
  readSimilarTextKeys,
  recordModelCall,
  settleFailedPreparation,
  type DecideRequestItem,
} from './commitmentsStore';
import { isPilotUid } from './gate';
import { senderDomainOrNull } from './model';
import { sliceSafe } from './sanitize';
import { loadSummaryForExtraction, type SummaryForExtraction } from './read';
import { SECTIONS_PARSER_VERSION, parseSections, type SummarySection } from './sections';

// ---------------------------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------------------------

export type CommitmentsTuning = { -readonly [K in keyof typeof COMMITMENTS_TUNING]: number };

export interface CommitmentsConfig {
  /** SUMMARIES_ENABLED.value() === true. */
  enabled: boolean;
  /** SUMMARIES_PILOT_UIDS (raw comma list). */
  pilotUids: string;
}

export interface CommitmentsLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

const defaultLogger: CommitmentsLogger = {
  info: (event, fields) => logger.info(event, fields),
  warn: (event, fields) => logger.warn(event, fields),
  error: (event, fields) => logger.error(event, fields),
};

export interface CommitmentsDeps {
  db: Firestore;
  now: () => Date;
  config: CommitmentsConfig;
  /** The keyring of SUMMARIES_DATA_KEY (read.ts lazyKeyring); throws SealedError for a bad value. */
  keyring: () => Keyring;
  /** The assistant's allowance store (the same counters as the assistant). */
  quota: QuotaStore;
  /** The project-wide daily cap (optional: tests run without one). */
  globalBudget?: GlobalBudget;
  /** Created only for a model call (reads the OpenAI key then). */
  llm: () => LlmClient;
  /** OPENAI_MODEL (stored with the view; never a secret). */
  model: () => string | null;
  /** Admin stats after a completion; isolated, never fails or refunds the request. */
  recordAiUsage?: (dayKey: string, tokens: { inputTokens: number; outputTokens: number }) => Promise<void>;
  /** Test seams. */
  logger?: CommitmentsLogger;
  tuning?: Partial<CommitmentsTuning>;
  nonce?: () => string;
  newLeaseId?: () => string;
}

interface Ctx {
  uid: string;
  db: Firestore;
  now: Date;
  keyring: () => Keyring;
  tuning: CommitmentsTuning;
  log: CommitmentsLogger;
  deps: CommitmentsDeps;
  /** The token's display name (the Auth display name), or null. */
  tokenName: string | null;
  /** Where the caller asks from: the app's callable, or the WhatsApp worker. */
  channel: CommitmentChannel;
}

/**
 * Who asks, once that entry point's own gates passed: the callable's requireActionCaller, or the
 * WhatsApp worker's (the link, Auth, the switch and the pilot list).
 */
export interface CommitmentsCaller {
  uid: string;
  /** The Auth display name (the ID token's name claim, or the Auth record's), or null. */
  tokenName: string | null;
  channel: CommitmentChannel;
}

/** One checked op (the callable's request, or the WhatsApp worker's). */
export type CommitmentsOp =
  | { op: 'get'; summaryId: string }
  | { op: 'prepare'; summaryId: string; mode: CommitmentMode }
  | {
      op: 'decide';
      summaryId: string;
      key: string;
      /** The device zone (app, already checked); null on WhatsApp. */
      requestZone: string | null;
      /** The origin line's language. */
      language: string | null;
      /** draft null on accept: the defaults of section 3.4 (WhatsApp). */
      decisions: DecideRequestItem[];
    };

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

const MESSAGES = {
  invalidRequest: 'The suggested tasks request is not valid.',
  notFound: 'That summary was not found.',
  upstream: 'Suggested tasks are not available right now. Try again, or show the action items as written.',
  cap: 'Suggested tasks could not be prepared for this summary. Show the action items as written instead.',
  quota: 'Your AI allowance is used up. The action items as written are still available.',
  stale: 'This summary changed. Load the suggested tasks again.',
  notEnabled: 'Meeting summaries are not enabled.',
  notAllowed: 'Meeting summaries are not available for this account yet.',
} as const;

/** Every summaryCommitments error carries details.reason (and usage for quota_exceeded). */
export function commitmentError(reason: CommitmentErrorCode, message: string, usage?: AssistantUsage): HttpsError {
  const details: CommitmentErrorDetails = usage === undefined ? { reason } : { reason, usage };
  return new HttpsError(COMMITMENT_ERROR_HTTPS_CODES[reason], message, details);
}

/** Upstream failures where OpenAI did no billable work (the assistant's list, handler.ts). */
const REFUNDABLE_UPSTREAM: ReadonlySet<UpstreamError['kind']> = new Set<UpstreamError['kind']>(['configuration', 'connection', 'rate_limited', 'server']);

class GlobalBudgetExhaustedError extends Error {
  constructor() {
    super('Global AI budget exhausted');
    this.name = 'GlobalBudgetExhaustedError';
  }
}

/** The model answered with something that cannot be read: no refund, the retry is free. */
class ModelOutputError extends Error {
  constructor(readonly reason: ProposeCallFailure) {
    super(`Model output not usable: ${reason}`);
    this.name = 'ModelOutputError';
  }
}

/** The summary went away (or another preparation took over) between the lease and the call. */
class PreparationGoneError extends Error {
  constructor(readonly reason: 'gone' | 'lost') {
    super(`Preparation ${reason}`);
    this.name = 'PreparationGoneError';
  }
}

// ---------------------------------------------------------------------------------------------
// The summary as the ops see it
// ---------------------------------------------------------------------------------------------

interface Loaded {
  summary: SummaryForExtraction;
  ref: { uid: string; summaryId: string };
  sections: SummarySection[];
  parserInUse: number;
  stamp: { contentDigest: string; parserVersion: number };
  preselect: CommitmentPreselect;
  matchStamp: MatchStamp;
  meetingZone: string | null;
  origin: CommitmentOrigin;
}

function validZoneOrNull(zone: string | null | undefined): string | null {
  return typeof zone === 'string' && zone.length > 0 && isValidTimeZone(zone) ? zone : null;
}

function localDateOf(startAt: string, zone: string | null): string | null {
  const ms = Date.parse(startAt);
  if (!Number.isFinite(ms)) return null;
  return toLocalDateTime(ms, zone ?? 'UTC').date;
}

async function load(ctx: Ctx, summaryId: string): Promise<Loaded> {
  const summary = await loadSummaryForExtraction(ctx.uid, summaryId, { db: ctx.db, keyring: ctx.keyring });
  if (summary === null) throw commitmentError('not_found', MESSAGES.notFound);
  const context = summary.context;
  const stored = context.parserVersion;
  const sections = stored < SECTIONS_PARSER_VERSION ? parseSections(summary.text).sections : summary.sections;
  const match = context.match;
  const snapshot = context.meetingSnapshot;
  const meetingZone = validZoneOrNull(snapshot?.timezone);
  const meetingDate = snapshot === null ? null : localDateOf(snapshot.startAt, meetingZone);
  const localDate = match?.occurrenceDate ?? meetingDate ?? context.summaryDate;
  const title = snapshot === null ? null : sliceSafe(snapshot.title.trim(), SUMMARY_LIMITS.maxTitleChars).trim();
  return {
    summary,
    ref: { uid: ctx.uid, summaryId },
    sections,
    parserInUse: parserVersionInUse(stored),
    stamp: { contentDigest: summary.contentDigest, parserVersion: stored },
    preselect: summaryPreselect(context, context.possibleInstruction),
    matchStamp: { meetingId: match?.meetingId ?? null, occurrenceDate: match?.occurrenceDate ?? null },
    meetingZone,
    origin: {
      meetingId: match?.meetingId ?? null,
      meetingTitle: title === null || title.length === 0 ? null : title,
      occurrenceDate: match?.occurrenceDate ?? null,
      localDate: localDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : null,
      tier: context.tier,
      senderDomain: senderDomainOrNull(context.senderDomain),
      forwardedBy: context.tier === 'user_forwarded' ? summary.forwardedBy : null,
    },
  };
}

async function userNamesOf(ctx: Ctx): Promise<(string | null)[]> {
  const names: (string | null)[] = [ctx.tokenName];
  try {
    const [snapshot] = await ctx.db.getAll(ctx.db.doc(`users/${ctx.uid}`), { fieldMask: ['displayName'] });
    const value = snapshot?.exists ? (snapshot.get('displayName') as unknown) : null;
    names.push(typeof value === 'string' ? value : null);
  } catch (error) {
    ctx.log.warn('summaries.commitments.profile_unread', { uid: ctx.uid, errorName: errorName(error) });
  }
  return names;
}

async function preferencesZoneOf(ctx: Ctx): Promise<string | null> {
  try {
    return await readPreferencesTimeZone(ctx.db, ctx.uid);
  } catch (error) {
    ctx.log.warn('summaries.commitments.preferences_unread', { uid: ctx.uid, errorName: errorName(error) });
    return null;
  }
}

function sameStamp(a: MatchStamp, b: MatchStamp): boolean {
  return a.meetingId === b.meetingId && a.occurrenceDate === b.occurrenceDate;
}

/** The suggestions of one view in the contract shape. */
async function commitmentsOf(
  ctx: Ctx,
  loaded: Loaded,
  extraction: StoredExtraction,
  view: StoredView,
  mode: CommitmentMode,
  current: boolean,
  overdueZone: string | null,
): Promise<SummaryCommitments> {
  const sealed = openView(ctx.keyring(), loaded.ref, view);
  const existing = await readExistingTasks(ctx.db, ctx.uid, acceptedTaskIds(view, extraction.decisions));
  const preselect: CommitmentPreselect = current ? loaded.preselect : { allowed: false, selectAll: false, reason: loaded.preselect.reason };
  return {
    key: view.key,
    mode,
    preparedAt: view.preparedAt,
    preselect,
    origin: loaded.origin,
    truncated: view.truncated,
    meetingChanged: !sameStamp(view.matchStamp, loaded.matchStamp),
    items: contractItemsOf({
      view,
      sealed,
      decisions: extraction.decisions,
      text: loaded.summary.text,
      sections: loaded.sections,
      preselect,
      minConfidence: ctx.tuning.preselectMinConfidence,
      meetingZone: loaded.meetingZone,
      overdueZone,
      existingTasks: existing,
      now: ctx.now,
      current,
    }),
  };
}

/** What get (and a prepare that found a current view) answers. */
async function answerOf(ctx: Ctx, loaded: Loaded, extraction: StoredExtraction | null, op: 'get' | 'prepare'): Promise<SummaryCommitmentsResponse> {
  const view = viewInUse(extraction);
  if (extraction === null || view === null || extraction.mode === null) {
    return { op, state: leaseAlive(extraction, ctx.now) ? 'preparing' : 'none', commitments: null };
  }
  const overdueZone = loaded.meetingZone ?? (await preferencesZoneOf(ctx));
  if (!isCurrent(extraction, loaded.stamp)) {
    // Stale: the old decisions read-only while the text is the same; none when the text changed.
    const sameText = extraction.contentDigest === loaded.stamp.contentDigest;
    return {
      op,
      state: 'stale',
      commitments: sameText ? await commitmentsOf(ctx, loaded, extraction, view, extraction.mode, false, overdueZone) : null,
    };
  }
  return { op, state: view.state, commitments: await commitmentsOf(ctx, loaded, extraction, view, extraction.mode, true, overdueZone) };
}

// ---------------------------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------------------------

interface OpResult {
  response: SummaryCommitmentsResponse;
  logFields: Record<string, unknown>;
}

function countsFields(counts: VerifyCounts | null): Record<string, unknown> {
  if (counts === null) return {};
  return {
    proposed: counts.proposed,
    kept: counts.kept,
    dropped: counts.dropped,
    cleared: counts.cleared,
    titleFallbacks: counts.titleFallbacks,
    ownerReplaced: counts.ownerReplaced,
  };
}

async function runGet(ctx: Ctx, summaryId: string): Promise<OpResult> {
  const loaded = await load(ctx, summaryId);
  const response = await answerOf(ctx, loaded, parseExtraction(loaded.summary.extraction), 'get');
  return { response, logFields: { mode: response.commitments?.mode ?? null, items: response.commitments?.items.length ?? 0 } };
}

function newLeaseId(ctx: Ctx): string {
  // 16 random bytes as hex (no content).
  return ctx.deps.newLeaseId ? ctx.deps.newLeaseId() : randomBytes(16).toString('hex');
}

function keyOf(loaded: Loaded, mode: CommitmentMode): string {
  return extractionKey({ contentDigest: loaded.stamp.contentDigest, parserVersion: loaded.parserInUse, extractorVersion: EXTRACTOR_VERSION, mode });
}

async function writeView(
  ctx: Ctx,
  loaded: Loaded,
  mode: CommitmentMode,
  verified: readonly VerifiedCommitment[],
  leaseId: string | null,
  truncated: boolean,
): ReturnType<typeof commitPreparation> {
  const similarTextKeys = await readSimilarTextKeys(ctx.db, loaded.ref, loaded.matchStamp.meetingId).catch((error: unknown) => {
    ctx.log.warn('summaries.commitments.similar_unread', { uid: ctx.uid, errorName: errorName(error) });
    return new Set<string>();
  });
  return commitPreparation(ctx.db, {
    ref: loaded.ref,
    contentDigest: loaded.stamp.contentDigest,
    leaseId,
    build: (previous) =>
      nextExtraction({
        keyring: ctx.keyring(),
        ref: loaded.ref,
        text: loaded.summary.text,
        summary: loaded.stamp,
        previous,
        mode,
        key: keyOf(loaded, mode),
        verified,
        meetingId: loaded.matchStamp.meetingId,
        now: ctx.now,
        model: mode === 'ai' ? ctx.deps.model() : null,
        truncated,
        matchStamp: loaded.matchStamp,
        preselect: loaded.preselect,
        similarTextKeys,
        leaseId,
      }),
  });
}

async function runPrepare(ctx: Ctx, summaryId: string, mode: CommitmentMode): Promise<OpResult> {
  let loaded = await load(ctx, summaryId);
  const leaseId = newLeaseId(ctx);
  let begin = await beginPreparation(ctx.db, {
    ref: loaded.ref,
    mode,
    contentDigest: loaded.stamp.contentDigest,
    leaseId,
    leaseSeconds: ctx.tuning.leaseSeconds,
    maxModelCalls: ctx.tuning.maxModelCalls,
    now: ctx.now,
  });
  if (begin.kind === 'changed') {
    // An upgrade in place landed between the read and the transaction: read it once more.
    loaded = await load(ctx, summaryId);
    begin = await beginPreparation(ctx.db, {
      ref: loaded.ref,
      mode,
      contentDigest: loaded.stamp.contentDigest,
      leaseId,
      leaseSeconds: ctx.tuning.leaseSeconds,
      maxModelCalls: ctx.tuning.maxModelCalls,
      now: ctx.now,
    });
  }
  switch (begin.kind) {
    case 'not_found':
      throw commitmentError('not_found', MESSAGES.notFound);
    case 'changed':
    case 'too_large':
      ctx.log.warn('summaries.commitments.not_prepared', { uid: ctx.uid, mode, reason: begin.kind });
      throw commitmentError('upstream_error', MESSAGES.upstream);
    case 'preparing':
      return { response: { op: 'prepare', state: 'preparing', commitments: null }, logFields: { mode, outcome: 'preparing' } };
    case 'cap':
      ctx.log.info('summaries.commitments.call_cap', { uid: ctx.uid, mode });
      throw commitmentError('upstream_error', MESSAGES.cap);
    case 'ready': {
      const response = await answerOf(ctx, loaded, begin.extraction, 'prepare');
      return { response, logFields: { mode, outcome: 'reused', items: response.commitments?.items.length ?? 0 } };
    }
    case 'build':
      return prepareAsWritten(ctx, loaded);
    case 'leased':
      return prepareWithAi(ctx, loaded, begin.extraction, leaseId);
  }
}

async function referenceOf(ctx: Ctx, loaded: Loaded) {
  const context = loaded.summary.context;
  // The preferences zone is needed only when the meeting's own start and zone cannot be used.
  const preferencesTimeZone = loaded.meetingZone === null ? await preferencesZoneOf(ctx) : null;
  return referenceDayOf({
    meetingSnapshot: context.meetingSnapshot === null ? null : { startAt: context.meetingSnapshot.startAt, timezone: context.meetingSnapshot.timezone },
    summaryDate: context.summaryDate,
    anchorAt: context.anchorAt,
    receivedAt: context.receivedAt,
    preferencesTimeZone,
  });
}

async function finishWrite(ctx: Ctx, loaded: Loaded, mode: CommitmentMode, result: Awaited<ReturnType<typeof commitPreparation>>, extra: Record<string, unknown>, usage?: AssistantUsage): Promise<OpResult> {
  switch (result.kind) {
    case 'written': {
      const response = await answerOf(ctx, loaded, result.extraction, 'prepare');
      if (usage !== undefined) response.usage = usage;
      return { response, logFields: { mode, outcome: 'prepared', items: response.commitments?.items.length ?? 0, carried: result.carried, similar: result.similar, ...extra } };
    }
    case 'not_found':
      throw commitmentError('not_found', MESSAGES.notFound);
    case 'changed':
      return { response: { op: 'prepare', state: 'stale', commitments: null, ...(usage === undefined ? {} : { usage }) }, logFields: { mode, outcome: 'discarded_changed', ...extra } };
    case 'lost':
      return { response: { op: 'prepare', state: 'preparing', commitments: null, ...(usage === undefined ? {} : { usage }) }, logFields: { mode, outcome: 'discarded_lease', ...extra } };
    case 'too_large':
      ctx.log.error('summaries.commitments.failed', { uid: ctx.uid, op: 'prepare', mode, reason: 'too_large' });
      throw commitmentError('upstream_error', MESSAGES.upstream);
  }
}

async function prepareAsWritten(ctx: Ctx, loaded: Loaded): Promise<OpResult> {
  const reference = await referenceOf(ctx, loaded);
  const verified = asWrittenProposals({
    text: loaded.summary.text,
    sections: loaded.sections,
    referenceDay: reference.day,
    userNames: await userNamesOf(ctx),
  });
  const result = await writeView(ctx, loaded, 'as_written', verified, null, loaded.summary.context.truncated);
  return finishWrite(ctx, loaded, 'as_written', result, { kept: verified.length });
}

async function prepareWithAi(ctx: Ctx, loaded: Loaded, leased: StoredExtraction, leaseId: string): Promise<OpResult> {
  const { uid } = ctx;
  const contentDigest = loaded.stamp.contentDigest;
  let quota: QuotaDecision | null = null;
  let callRecorded = false;
  let llmStarted = false;
  let settled = false;
  try {
    if (leased.charge === null) {
      quota = await consumeQuota(ctx.deps.quota, uid, ctx.now);
      if (!quota.entitlementValid) ctx.log.warn('summaries.commitments.entitlement_invalid', { uid });
      if (!quota.allowed) {
        const usage = quota.usage;
        quota = null;
        ctx.log.info('summaries.commitments.quota_exceeded', { uid, plan: usage.plan, limit: usage.limit, period: usage.period ?? null });
        throw commitmentError('quota_exceeded', MESSAGES.quota, usage);
      }
    }

    const reference = await referenceOf(ctx, loaded);
    const context = loaded.summary.context;
    const input = selectModelInput(
      loaded.summary.text,
      loaded.sections,
      { maxItems: ctx.tuning.maxModelItems, maxChars: ctx.tuning.maxModelTextChars },
      context.truncated,
    );
    const prompt = buildCommitmentsPrompt({
      input,
      reference,
      meetingTitle: loaded.origin.meetingTitle,
      language: context.language,
      ...(ctx.deps.nonce ? { nonce: ctx.deps.nonce() } : {}),
    });

    // The project-wide cap counts requests: one unit per started block of payload characters.
    const dayKey = quota?.dayKey ?? usageDayKey(ctx.now);
    const units = Math.max(1, Math.ceil(prompt.dataChars / Math.max(1, ctx.tuning.globalBudgetCharsPerUnit)));
    if (ctx.deps.globalBudget) {
      for (let unit = 0; unit < units; unit += 1) {
        if (!(await ctx.deps.globalBudget.tryAcquire(dayKey))) {
          ctx.log.error('summaries.commitments.global_budget_exhausted', { uid, day: dayKey, units });
          throw new GlobalBudgetExhaustedError();
        }
      }
    }

    const charge = quota === null ? null : { at: ctx.now.toISOString(), dayKey: quota.dayKey, charges: quota.charges };
    const recorded = await recordModelCall(ctx.db, { ref: loaded.ref, leaseId, contentDigest, charge, now: ctx.now });
    if (recorded !== 'ok') throw new PreparationGoneError(recorded);
    callRecorded = true;

    const llm = ctx.deps.llm();
    llmStarted = true;
    const startedAt = Date.now();
    const completion: LlmResult = await llm.complete({
      messages: prompt.messages,
      tools: [PROPOSE_COMMITMENTS_TOOL],
      toolChoice: 'required',
      safetyIdentifier: safetyIdentifierFor(uid),
    });
    const modelMs = Date.now() - startedAt;
    if (ctx.deps.recordAiUsage) {
      try {
        await ctx.deps.recordAiUsage(dayKey, {
          inputTokens: completion.usage?.promptTokens ?? 0,
          outputTokens: completion.usage?.completionTokens ?? 0,
        });
      } catch (statsError) {
        ctx.log.warn('summaries.commitments.stats_failed', { uid, errorName: errorName(statsError) });
      }
    }
    const tokens = {
      promptTokens: completion.usage?.promptTokens ?? null,
      completionTokens: completion.usage?.completionTokens ?? null,
      finishReason: typeof completion.finishReason === 'string' ? completion.finishReason.slice(0, 40) : null,
      modelMs,
      units,
      inputItems: input.items.length,
      inputProse: input.prose.length,
      inputChars: input.chars,
    };
    const read = readProposeCall(completion);
    if (read.kind === 'failed') {
      ctx.log.warn('summaries.commitments.output_unusable', { uid, reason: read.reason, ...tokens });
      throw new ModelOutputError(read.reason);
    }
    const proposals = read.kind === 'proposals' ? read.proposals : [];
    const verifiedResult = verifyProposals({
      text: loaded.summary.text,
      sections: loaded.sections,
      input,
      proposals,
      referenceDay: reference.day,
      language: context.language,
      userNames: await userNamesOf(ctx),
    });
    const result = await writeView(ctx, loaded, 'ai', verifiedResult.commitments, leaseId, input.truncated);
    if (result.kind !== 'written') {
      // Discarded (deleted, changed, lease lost or too large): only our lease is released.
      settled = true;
      await settle(ctx, loaded, leaseId, false, false);
    }
    return await finishWrite(
      ctx,
      loaded,
      'ai',
      result,
      {
        ...countsFields(verifiedResult.counts),
        empty: read.kind === 'empty' ? read.reason : null,
        extraCalls: read.kind === 'proposals' ? read.extraCalls : 0,
        charged: quota !== null,
        ...tokens,
      },
      quota?.usage,
    );
  } catch (error) {
    const refundable = !llmStarted || (error instanceof UpstreamError && REFUNDABLE_UPSTREAM.has(error.kind));
    if (quota !== null && refundable) {
      try {
        await refundQuota(ctx.deps.quota, uid, quota, ctx.deps.now());
      } catch (refundError) {
        ctx.log.warn('summaries.commitments.refund_failed', { uid, errorName: errorName(refundError) });
      }
    }
    // Section 2.8: every model call counts toward the cap, also one the action is refunded for (a
    // connection reset can come after OpenAI did the work, and a loop of failing calls would
    // otherwise be unbounded); a refund gives back the action and clears the charge only.
    if (!settled) await settle(ctx, loaded, leaseId, false, quota !== null && callRecorded && refundable);
    if (error instanceof HttpsError) throw error;
    if (error instanceof GlobalBudgetExhaustedError) throw commitmentError('upstream_error', MESSAGES.upstream);
    if (error instanceof PreparationGoneError) {
      if (error.reason === 'gone') throw commitmentError('not_found', MESSAGES.notFound);
      throw commitmentError('upstream_error', MESSAGES.upstream);
    }
    if (error instanceof ModelOutputError) throw commitmentError('upstream_error', MESSAGES.upstream);
    if (error instanceof UpstreamError) {
      const fields = { uid, kind: error.kind, status: error.status, refunded: quota !== null && refundable };
      if (error.kind === 'configuration' || error.kind === 'bad_request') ctx.log.error('summaries.commitments.upstream_failed', fields);
      else ctx.log.warn('summaries.commitments.upstream_failed', fields);
      throw commitmentError('upstream_error', MESSAGES.upstream);
    }
    throw error;
  }
}

/** Releases our lease after a failure (never fails the answer). */
async function settle(ctx: Ctx, loaded: Loaded, leaseId: string, uncountCall: boolean, clearCharge: boolean): Promise<void> {
  try {
    await settleFailedPreparation(ctx.db, { ref: loaded.ref, leaseId, contentDigest: loaded.stamp.contentDigest, uncountCall, clearCharge, now: ctx.deps.now() });
  } catch (error) {
    ctx.log.warn('summaries.commitments.settle_failed', { uid: ctx.uid, errorName: errorName(error) });
  }
}

async function runDecide(ctx: Ctx, request: Extract<CommitmentsOp, { op: 'decide' }>): Promise<OpResult> {
  const loaded = await load(ctx, request.summaryId);
  const preferencesZone = await preferencesZoneOf(ctx);
  const result = await decideCommitments(ctx.db, {
    ref: loaded.ref,
    key: request.key,
    contentDigest: loaded.stamp.contentDigest,
    channel: ctx.channel,
    requestZone: request.requestZone,
    preferencesZone,
    language: request.language,
    decisions: request.decisions,
    keyring: ctx.keyring(),
    now: ctx.now,
  });
  if (result.kind === 'not_found') throw commitmentError('not_found', MESSAGES.notFound);
  if (result.kind === 'stale') throw commitmentError('stale', MESSAGES.stale);
  const mode: CommitmentMode = result.extraction.views.ai?.key === result.view.key ? 'ai' : 'as_written';
  const view = result.extraction.views[mode] ?? result.view;
  const commitments = await commitmentsOf(ctx, loaded, result.extraction, view, mode, true, loaded.meetingZone ?? preferencesZone);
  const outcomes: Record<string, number> = {};
  for (const entry of result.results) outcomes[entry.outcome] = (outcomes[entry.outcome] ?? 0) + 1;
  return {
    response: { op: 'decide', state: view.state, commitments, results: result.results },
    logFields: { mode, decisions: request.decisions.length, outcomes, added: result.added, removed: result.removed },
  };
}

// ---------------------------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------------------------

/** summaryCommitments {op: 'get' | 'prepare' | 'decide', ...} -> SummaryCommitmentsResponse (see the module comment). */
export async function handleSummaryCommitments(auth: SummaryCallableAuth, data: unknown, deps: CommitmentsDeps): Promise<SummaryCommitmentsResponse> {
  const caller = requireActionCaller(auth, deps.config);
  const parsed = summaryCommitmentsRequestSchema.safeParse(data ?? {});
  if (!parsed.success) throw commitmentError('invalid_request', MESSAGES.invalidRequest);
  const request: SummaryCommitmentsRequest = parsed.data;
  const tokenName = typeof auth?.token?.name === 'string' ? (auth.token.name as string) : null;
  const op: CommitmentsOp =
    request.op === 'decide'
      ? {
          op: 'decide',
          summaryId: request.summaryId,
          key: request.key,
          // Section 3.4: "the request's zone if valid". A well-formed name this server's ICU does not
          // know falls back (preferences, then the meeting), it never refuses the whole call.
          requestZone: isValidTimeZone(request.timezone) ? request.timezone : null,
          language: request.language,
          decisions: request.decisions.map((decision) => ({
            anchorId: decision.anchorId,
            decision: decision.decision,
            draft: decision.decision === 'accept' ? decision.draft : null,
          })),
        }
      : request;
  return runCommitmentsOp({ uid: caller.uid, tokenName, channel: 'app' }, op, deps);
}

/**
 * One checked op for a caller whose entry point already ran its gates (the callable above, or the
 * WhatsApp worker). The switch and the pilot list are checked again here, so no entry point can
 * reach the summary without them. Every failure leaves as a commitmentError (see the module comment).
 */
export async function runCommitmentsOp(caller: CommitmentsCaller, requested: CommitmentsOp, deps: CommitmentsDeps): Promise<SummaryCommitmentsResponse> {
  if (deps.config.enabled !== true) throw commitmentError('not_enabled', MESSAGES.notEnabled);
  if (!isPilotUid(caller.uid, deps.config.pilotUids)) throw commitmentError('not_allowed', MESSAGES.notAllowed);
  // A zone this server does not know is no zone (section 3.4 falls back), never a refusal.
  const op: CommitmentsOp =
    requested.op === 'decide' && requested.requestZone !== null && !isValidTimeZone(requested.requestZone) ? { ...requested, requestZone: null } : requested;
  let keyring: Keyring | null = null;
  const ctx: Ctx = {
    uid: caller.uid,
    db: deps.db,
    now: deps.now(),
    keyring: () => {
      if (keyring === null) keyring = deps.keyring();
      return keyring;
    },
    tuning: { ...COMMITMENTS_TUNING, ...deps.tuning },
    log: deps.logger ?? defaultLogger,
    deps,
    tokenName: caller.tokenName,
    channel: caller.channel,
  };
  const startedAt = Date.now();
  const base = { uid: caller.uid, op: op.op, channel: caller.channel };
  try {
    const result =
      op.op === 'get'
        ? await runGet(ctx, op.summaryId)
        : op.op === 'prepare'
          ? await runPrepare(ctx, op.summaryId, op.mode)
          : await runDecide(ctx, op);
    const checked = summaryCommitmentsResponseSchema.safeParse(result.response);
    if (!checked.success) {
      ctx.log.error('summaries.commitments.failed', { ...base, reason: 'response_invalid', issues: checked.error.issues.length });
      throw commitmentError('upstream_error', MESSAGES.upstream);
    }
    ctx.log.info('summaries.commitments', { ...base, state: checked.data.state, ...result.logFields, ms: Date.now() - startedAt });
    return checked.data;
  } catch (error) {
    if (error instanceof HttpsError) {
      const reason = (error.details as { reason?: unknown } | undefined)?.reason;
      ctx.log.info('summaries.commitments.refused', { ...base, reason: typeof reason === 'string' ? reason : error.code, ms: Date.now() - startedAt });
      throw error;
    }
    if (error instanceof CommitmentDecideError) {
      ctx.log.info('summaries.commitments.refused', { ...base, reason: 'invalid_request', detail: error.reason });
      throw commitmentError('invalid_request', MESSAGES.invalidRequest);
    }
    if (error instanceof SealedError) {
      if (error.reason.startsWith('keyring_')) ctx.log.error('summaries.setup_alarm', { reason: 'data_key_invalid', detail: error.reason });
      ctx.log.error('summaries.commitments.failed', { ...base, reason: error.reason });
    } else {
      ctx.log.error('summaries.commitments.failed', { ...base, errorName: errorName(error) });
    }
    throw commitmentError('upstream_error', MESSAGES.upstream);
  }
}
