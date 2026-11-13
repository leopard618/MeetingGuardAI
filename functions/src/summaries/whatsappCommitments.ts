/**
 * The summaryWhatsApp worker (docs/v2/M11-DESIGN.md sections 4.1, 4.3 and 4.4; section 15 findings
 * 4, 10, 12 and 25). A pure handler over injected deps; ./whatsappFunction.ts is the HTTPS shell and
 * loads this module lazily (through ./whatsappRuntime.ts) on the first request.
 *
 * Why a worker: the data key and the AI call stay in a function that runs as the summaries service
 * account. The webhook calls it with its own ID token (Cloud Run checks the invoker) and never holds
 * the data key; it gets back the text to send and the ids of the offer to store.
 *
 * Every request:
 * 1. The uid comes from whatsappLinks/{phone} only, never from the request. Then Firebase Auth (the
 *    account exists, is not disabled, and is verified by the callables' rule: a verified email or a
 *    trusted sign-in provider), SUMMARIES_ENABLED and the pilot list.
 * 2. op 'offer' (the user wrote "commitments" or "compromisos"): the newest filed or kept summary
 *    received in the last 14 days with open suggestions or none prepared. It NEVER starts an AI
 *    preparation (finding 4): an existing list is offered as it is (an AI list the app prepared
 *    included), else the action items as written are prepared (free, no OpenAI) and the message
 *    carries the AI notice. At most 20 lists per summary per UTC day (extraction.offers {day, n}).
 * 3. op 'reply': the offer must be live and made for this uid (uidTag). AI (only while the offer
 *    offers it) runs prepare in mode 'ai': the same charge, cap and lease as the app. Numbers, ALL,
 *    DROP and NONE run decide with channel 'whatsapp' and no draft (the defaults of section 3.4).
 *    Numbers are the suggestions' stable numbers, mapped through the offer's own anchors.
 * The app's code path does the work (./commitmentsHandler.ts runCommitmentsOp), so the app and
 * WhatsApp share one extraction, one charge, one lease and one set of deterministic task ids.
 *
 * Logs: one `summaries.whatsapp` line per call {uid, op, kind, outcome, ms, counts}. Never a phone
 * number, a title, a quote, a name, a summary id or an anchor id; errors log errorName only.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { randomBytes } from 'node:crypto';

import { HttpsError } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

import { SUMMARY_WHATSAPP_TUNING } from '../config';
import {
  commitmentErrorDetailsSchema,
  isTrustedSignInProvider,
  summaryIdSchema,
  usageDayKey,
  type AssistantUsage,
  type CommitmentErrorCode,
  type Language,
  type SummaryCommitmentsResponse,
} from '../shared/aiContract';
import { EXTRACTOR_VERSION, extractionListFactsOf, EXTRACTION_LIST_FIELDS, parserVersionInUse } from '../commitments/extraction';
import { extractionKey } from '../commitments/ids';
import { chooseTaskZone } from '../commitments/taskDoc';
import { WHATSAPP_LINKS_COLLECTION } from '../whatsapp/session';
import { readPreferencesTimeZone } from './candidates';
import { runCommitmentsOp, type CommitmentsDeps, type CommitmentsLogger, type CommitmentsOp } from './commitmentsHandler';
import { parseExtraction } from './commitmentsModel';
import { fitExtraction } from './commitmentsStore';
import { isPilotUid, PILOT_UID_PATTERN } from './gate';
import { parseSummaryRecord, summaryDocPath } from './model';
import { summariesCollection } from './store';
import { renderOffer, renderResult, quotaText, workerTexts } from './whatsappRender';
import {
  summaryWhatsAppRequestSchema,
  summaryWhatsAppResponseSchema,
  uidTagOf,
  type SummaryOffer,
  type SummaryOfferAi,
  type SummarySelection,
  type SummaryWhatsAppOutcome,
  type SummaryWhatsAppRequest,
  type SummaryWhatsAppResponse,
} from './whatsappProtocol';

// ---------------------------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------------------------

export type SummaryWhatsAppTuning = { -readonly [K in keyof typeof SUMMARY_WHATSAPP_TUNING]: number };

/** What the worker needs from Firebase Auth about the linked uid. */
export interface WorkerAuthUser {
  exists: boolean;
  disabled: boolean;
  /** A verified email, or a trusted sign-in provider (the callables' isVerifiedCaller rule). */
  verified: boolean;
  /** The Auth display name (the owner "You" check), or null. Content: never logged. */
  displayName: string | null;
}

export interface WorkerAuthUsers {
  /** exists false for a deleted user; rejects only on a real Auth failure. */
  getUser(uid: string): Promise<WorkerAuthUser>;
}

export interface SummaryWhatsAppDeps {
  db: Firestore;
  now: () => Date;
  /** SUMMARIES_ENABLED.value() === true and SUMMARIES_PILOT_UIDS, read per request. */
  config: { enabled: boolean; pilotUids: string };
  authUsers: WorkerAuthUsers;
  /** The commitments deps (the keyring, the quota, the model), built on first use. */
  commitments: () => CommitmentsDeps;
  logger?: CommitmentsLogger;
  /** Test seams. */
  newOfferId?: () => string;
  tuning?: Partial<SummaryWhatsAppTuning>;
}

export interface WorkerAnswer {
  status: number;
  /** The JSON answer for 200; a fixed text otherwise. */
  body: SummaryWhatsAppResponse | string;
}

const defaultLogger: CommitmentsLogger = {
  info: (event, fields) => logger.info(event, fields),
  warn: (event, fields) => logger.warn(event, fields),
  error: (event, fields) => logger.error(event, fields),
};

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** firebase-admin Auth as WorkerAuthUsers: auth/user-not-found is a missing user, anything else rejects. */
export function firebaseWorkerAuthUsers(auth: Pick<Auth, 'getUser'>): WorkerAuthUsers {
  return {
    async getUser(uid) {
      try {
        const record = await auth.getUser(uid);
        const providers = (record.providerData ?? []).map((entry) => entry.providerId);
        return {
          exists: true,
          disabled: record.disabled === true,
          verified: record.emailVerified === true || providers.some((provider) => isTrustedSignInProvider(provider)),
          displayName: typeof record.displayName === 'string' && record.displayName.length > 0 ? record.displayName : null,
        };
      } catch (error) {
        if (errorCode(error) === 'auth/user-not-found') return { exists: false, disabled: false, verified: false, displayName: null };
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Reads and the offers counter
// ---------------------------------------------------------------------------------------------

/** The uid of whatsappLinks/{phone}, or null. */
async function linkedUid(db: Firestore, phoneE164: string): Promise<string | null> {
  const snapshot = await db.doc(`${WHATSAPP_LINKS_COLLECTION}/${phoneE164}`).get();
  if (!snapshot.exists) return null;
  const uid = (snapshot.data() as Record<string, unknown> | undefined)?.uid;
  return typeof uid === 'string' && PILOT_UID_PATTERN.test(uid) ? uid : null;
}

/** The fields the offer's pick reads (never the sealed blobs). */
export const OFFER_PICK_FIELDS = [
  'status',
  'receivedAt',
  'contentDigest',
  'parserVersion',
  'match.meetingSnapshot.timezone',
  ...EXTRACTION_LIST_FIELDS,
  'extraction.mode',
  'extraction.views.ai.key',
  'extraction.views.ai.state',
  'extraction.views.as_written.key',
  'extraction.views.as_written.state',
] as const;

/** One view of the extraction as the pick sees it: none (absent or not current), ready (it has lines) or empty. */
export type PickedViewState = 'none' | 'ready' | 'empty';

export interface PickedSummary {
  summaryId: string;
  /** The meeting's zone as filed (the default reminder's fallback zone on WhatsApp), or null. */
  meetingZone: string | null;
  /** The current AI list (whichever view is in use). */
  ai: PickedViewState;
  /** The current list of the action items as written (whichever view is in use). */
  asWritten: PickedViewState;
  /** The view in use, or null before the first preparation. */
  mode: 'ai' | 'as_written' | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function viewStateOf(extraction: Record<string, unknown> | null, mode: 'ai' | 'as_written', expectedKey: string | null): PickedViewState {
  const view = asRecord(asRecord(extraction?.views)?.[mode]);
  if (view === null || expectedKey === null || view.key !== expectedKey) return 'none';
  return view.state === 'ready' ? 'ready' : 'empty';
}

/**
 * The newest filed or kept summary received within the window with open suggestions or none
 * prepared. A view in use that found nothing still offers the other one while it is not empty
 * too: the items as written offer AI (or the AI list already made), and an AI list that found
 * nothing offers the items as written, so an empty AI answer never hides the summary for good.
 */
export async function pickOfferSummary(db: Firestore, uid: string, now: Date, tuning: Pick<SummaryWhatsAppTuning, 'offerWindowDays' | 'offerScanLimit'>): Promise<PickedSummary | null> {
  const snapshot = await summariesCollection(db, uid)
    .where('status', 'in', ['matched', 'kept'])
    .orderBy('receivedAt', 'desc')
    .select(...OFFER_PICK_FIELDS)
    .limit(tuning.offerScanLimit)
    .get();
  const cutoff = now.getTime() - tuning.offerWindowDays * 86_400_000;
  for (const document of snapshot.docs) {
    const data = asRecord(document.data()) ?? {};
    if (data.status !== 'matched' && data.status !== 'kept') continue;
    const received = typeof data.receivedAt === 'string' ? Date.parse(data.receivedAt) : NaN;
    if (!Number.isFinite(received) || received < cutoff) continue;
    if (!summaryIdSchema.safeParse(document.id).success) continue;
    const contentDigest = typeof data.contentDigest === 'string' ? data.contentDigest : '';
    const parserVersion = typeof data.parserVersion === 'number' ? data.parserVersion : 0;
    const extraction = asRecord(data.extraction);
    const facts = extractionListFactsOf(extraction, { contentDigest, parserVersion });
    const current = facts !== null && facts.state !== 'stale';
    const expected = (mode: 'ai' | 'as_written'): string | null =>
      current && contentDigest.length > 0 ? extractionKey({ contentDigest, parserVersion: parserVersionInUse(parserVersion), extractorVersion: EXTRACTOR_VERSION, mode }) : null;
    const ai = viewStateOf(extraction, 'ai', expected('ai'));
    const asWritten = viewStateOf(extraction, 'as_written', expected('as_written'));
    const mode = extraction?.mode === 'ai' || extraction?.mode === 'as_written' ? extraction.mode : null;
    const eligible =
      facts === null ||
      facts.state === 'stale' ||
      facts.open > 0 ||
      (facts.state === 'empty' && mode === 'as_written' && ai !== 'empty') ||
      (facts.state === 'empty' && mode === 'ai' && asWritten !== 'empty');
    if (!eligible) continue;
    const zone = asRecord(asRecord(data.match)?.meetingSnapshot)?.timezone;
    return { summaryId: document.id, meetingZone: typeof zone === 'string' && zone.length > 0 ? zone : null, ai, asWritten, mode };
  }
  return null;
}

/** The meeting's zone as filed, for an offer made from a reply (one masked read). */
async function meetingZoneOf(db: Firestore, uid: string, summaryId: string): Promise<string | null> {
  const [snapshot] = await db.getAll(db.doc(summaryDocPath(uid, summaryId)), { fieldMask: ['match.meetingSnapshot.timezone'] });
  const zone = snapshot?.exists ? (snapshot.get('match.meetingSnapshot.timezone') as unknown) : null;
  return typeof zone === 'string' && zone.length > 0 ? zone : null;
}

export type OfferCount = 'counted' | 'capped' | 'no_extraction' | 'not_found';

function offersOf(extraction: Record<string, unknown>, day: string): number {
  const offers = asRecord(extraction.offers);
  const n = offers?.n;
  return offers?.day === day && typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Counts one list answered for this summary today (extraction.offers {day, n}, kept through every
 * extraction write because the stored shape is loose), or 'capped' at the daily bound. The M11 write
 * rule: tx.update() of the top-level field inside a transaction that found the summary filed or kept,
 * so a deleted summary is never recreated.
 */
export function countOffer(db: Firestore, uid: string, summaryId: string, now: Date, maxPerDay: number): Promise<OfferCount> {
  return db.runTransaction(async (tx): Promise<OfferCount> => {
    const ref = db.doc(summaryDocPath(uid, summaryId));
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return 'not_found';
    const data = (snapshot.data() ?? {}) as Record<string, unknown>;
    const record = parseSummaryRecord(data);
    if (record === null || record.kind !== 'summary' || (record.doc.status !== 'matched' && record.doc.status !== 'kept')) return 'not_found';
    const extraction = parseExtraction(record.doc.extraction);
    if (extraction === null) return 'no_extraction';
    const day = usageDayKey(now);
    const n = offersOf(extraction, day);
    if (n >= maxPerDay) return 'capped';
    const next = fitExtraction(ref.path, data, { ...extraction, offers: { day, n: n + 1 } });
    // A document at the size bound is still answered; only the counter is not written then.
    if (next !== null) tx.update(ref, { extraction: next });
    return 'counted';
  });
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

interface Ctx {
  uid: string;
  tokenName: string | null;
  language: Language;
  now: Date;
  deps: SummaryWhatsAppDeps;
  tuning: SummaryWhatsAppTuning;
  /** Logged counts and codes of this call. */
  fields: Record<string, unknown>;
}

const KEEP = { action: 'keep' } as const;
const CLEAR = { action: 'clear' } as const;

function answerOf(outcome: SummaryWhatsAppOutcome, text: string, offer: SummaryWhatsAppResponse['offer'], buttons: SummaryWhatsAppResponse['buttons'] = null): SummaryWhatsAppResponse {
  return { outcome, text, buttons, offer };
}

function reasonOf(error: HttpsError): CommitmentErrorCode | null {
  const parsed = commitmentErrorDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.reason : null;
}

function usageOf(error: HttpsError): AssistantUsage | null {
  const parsed = commitmentErrorDetailsSchema.safeParse(error.details);
  return parsed.success ? (parsed.data.usage ?? null) : null;
}

class CommitmentsRefused extends Error {
  constructor(
    readonly reason: CommitmentErrorCode | null,
    readonly usage: AssistantUsage | null,
  ) {
    super(`refused: ${reason ?? 'unknown'}`);
    this.name = 'CommitmentsRefused';
  }
}

async function run(ctx: Ctx, op: CommitmentsOp): Promise<SummaryCommitmentsResponse> {
  try {
    return await runCommitmentsOp({ uid: ctx.uid, tokenName: ctx.tokenName, channel: 'whatsapp' }, op, ctx.deps.commitments());
  } catch (error) {
    if (error instanceof HttpsError) throw new CommitmentsRefused(reasonOf(error), usageOf(error));
    throw error;
  }
}

function newOfferIds(ctx: Ctx, summaryId: string): { offerId: string; uidTag: string; summaryId: string; expiresAt: string } {
  const offerId = ctx.deps.newOfferId ? ctx.deps.newOfferId() : randomBytes(8).toString('hex');
  return {
    offerId,
    uidTag: uidTagOf(ctx.uid),
    summaryId,
    expiresAt: new Date(ctx.now.getTime() + ctx.tuning.offerTtlMinutes * 60_000).toISOString(),
  };
}

async function reminderZoneKnown(ctx: Ctx, meetingZone: string | null): Promise<boolean> {
  let preferencesZone: string | null = null;
  try {
    preferencesZone = await readPreferencesTimeZone(ctx.deps.db, ctx.uid);
  } catch (error) {
    ctx.fields.preferences = errorName(error);
  }
  return chooseTaskZone({ channel: 'whatsapp', statedTime: false, meetingZone, requestZone: null, preferencesZone }).zone !== null;
}

function listAnswer(ctx: Ctx, response: SummaryCommitmentsResponse, ai: SummaryOfferAi, zoneKnown: boolean, summaryId: string): SummaryWhatsAppResponse {
  const commitments = response.commitments;
  if (commitments === null) return answerOf('unavailable', workerTexts(ctx.language).unavailable, KEEP);
  const rendered = renderOffer({
    language: ctx.language,
    commitments,
    ai,
    reminderZoneKnown: zoneKnown,
    offer: newOfferIds(ctx, summaryId),
    maxLineChars: ctx.tuning.maxLineChars,
  });
  Object.assign(ctx.fields, { mode: commitments.mode, ai, ...rendered.counts });
  if (rendered.offer === null) return answerOf('nothing_to_offer', rendered.text, KEEP);
  return answerOf('offered', rendered.text, { action: 'set', offer: rendered.offer }, rendered.buttons);
}

async function runOffer(ctx: Ctx): Promise<SummaryWhatsAppResponse> {
  const texts = workerTexts(ctx.language);
  const picked = await pickOfferSummary(ctx.deps.db, ctx.uid, ctx.now, ctx.tuning);
  if (picked === null) return answerOf('no_summary', texts.noSummary, KEEP);
  let count = await countOffer(ctx.deps.db, ctx.uid, picked.summaryId, ctx.now, ctx.tuning.maxOffersPerSummaryPerDay);
  if (count === 'not_found') return answerOf('no_summary', texts.noSummary, KEEP);
  if (count === 'capped') return answerOf('offer_cap', texts.offerCap, KEEP);

  let response = await run(ctx, { op: 'get', summaryId: picked.summaryId });
  let preparedNow = false;
  let aiFoundNothing = false;
  if (response.state === 'none' || response.state === 'stale') {
    // Never AI here (finding 4): the items as written, free and without OpenAI.
    response = await run(ctx, { op: 'prepare', summaryId: picked.summaryId, mode: 'as_written' });
    preparedNow = true;
  } else if (response.state === 'empty' && response.commitments?.mode === 'ai') {
    // The AI list in use found nothing: the items as written instead (free; the kept view or a new one).
    response = await run(ctx, { op: 'prepare', summaryId: picked.summaryId, mode: 'as_written' });
    aiFoundNothing = true;
  }
  if (response.state === 'preparing' || response.state === 'stale' || response.state === 'none') return answerOf('preparing', texts.preparing, KEEP);
  if (count === 'no_extraction') {
    count = await countOffer(ctx.deps.db, ctx.uid, picked.summaryId, ctx.now, ctx.tuning.maxOffersPerSummaryPerDay);
    if (count === 'capped') return answerOf('offer_cap', texts.offerCap, KEEP);
  }
  const mode = response.commitments?.mode ?? 'as_written';
  // The reply AI: offered while no current AI list exists, 'prepared' (free) while one has lines,
  // and not at all once the AI list found nothing (it would show an empty list).
  const ai: SummaryOfferAi =
    mode === 'ai' || aiFoundNothing ? 'none' : preparedNow ? 'offered' : picked.ai === 'ready' ? 'prepared' : picked.ai === 'empty' ? 'none' : 'offered';
  return listAnswer(ctx, response, ai, await reminderZoneKnown(ctx, picked.meetingZone), picked.summaryId);
}

/** Puts the items as written back in use after an AI list that found nothing (free, no model call). */
async function restoreAsWritten(ctx: Ctx, summaryId: string): Promise<void> {
  try {
    await run(ctx, { op: 'prepare', summaryId, mode: 'as_written' });
  } catch (error) {
    if (!(error instanceof CommitmentsRefused)) throw error;
    ctx.fields.restore = error.reason;
  }
}

async function runAi(ctx: Ctx, offer: SummaryOffer): Promise<SummaryWhatsAppResponse> {
  const texts = workerTexts(ctx.language);
  if (offer.ai === 'none') return answerOf('ai_unavailable', texts.aiUnavailable, KEEP);
  const count = await countOffer(ctx.deps.db, ctx.uid, offer.summaryId, ctx.now, ctx.tuning.maxOffersPerSummaryPerDay);
  if (count === 'not_found') return answerOf('not_found', texts.notFound, CLEAR);
  if (count === 'capped') return answerOf('offer_cap', texts.offerCap, KEEP);
  let response: SummaryCommitmentsResponse;
  try {
    response = await run(ctx, { op: 'prepare', summaryId: offer.summaryId, mode: 'ai' });
  } catch (error) {
    if (!(error instanceof CommitmentsRefused)) throw error;
    ctx.fields.reason = error.reason;
    if (error.reason === 'quota_exceeded') return answerOf('quota_exceeded', quotaText(ctx.language, error.usage), KEEP);
    if (error.reason === 'not_found') return answerOf('not_found', texts.notFound, CLEAR);
    if (error.reason === 'stale') return answerOf('stale', texts.stale, CLEAR);
    return answerOf('ai_unavailable', texts.aiUnavailable, KEEP);
  }
  if (response.state === 'preparing') return answerOf('preparing', texts.preparing, KEEP);
  if (response.state === 'stale' || response.state === 'none') return answerOf('stale', texts.stale, CLEAR);
  const commitments = response.commitments;
  if (commitments === null) return answerOf('ai_unavailable', texts.aiUnavailable, KEEP);
  // Nothing survived: the items as written go back in use, so a later "commitments" still offers
  // them, and stay pickable from this offer (decide accepts either current view's key); the offer
  // no longer takes the reply AI, which would only show the empty list again.
  if (commitments.items.length === 0) {
    await restoreAsWritten(ctx, offer.summaryId);
    return answerOf('ai_empty', texts.aiEmpty, { action: 'refresh', offer: { ...offer, ai: 'none' } });
  }
  return listAnswer(ctx, response, 'none', await reminderZoneKnown(ctx, await meetingZoneOf(ctx.deps.db, ctx.uid, offer.summaryId)), offer.summaryId);
}

function uniqueNumbers(numbers: readonly number[]): number[] {
  return [...new Set(numbers)];
}

async function runReply(ctx: Ctx, offer: SummaryOffer, selection: Exclude<SummarySelection, { kind: 'ai' }>): Promise<SummaryWhatsAppResponse> {
  const texts = workerTexts(ctx.language);
  const decision: 'accept' | 'drop' = selection.kind === 'all' || selection.kind === 'numbers' ? 'accept' : 'drop';
  const numbers =
    selection.kind === 'all' ? offer.marked : selection.kind === 'none' ? offer.open : uniqueNumbers(selection.numbers);
  if (selection.kind === 'all' && numbers.length === 0) return answerOf('nothing_marked', texts.nothingMarked, KEEP);
  if (selection.kind === 'none' && numbers.length === 0) return answerOf('decided', texts.nothingToChange, KEEP);
  const anchors = new Map(offer.anchors.map((entry) => [entry.n, entry.a]));
  const requested: { n: number; anchorId: string; decision: 'accept' | 'drop' }[] = [];
  const unknown: number[] = [];
  for (const n of numbers) {
    const anchorId = anchors.get(n);
    if (anchorId === undefined) unknown.push(n);
    else requested.push({ n, anchorId, decision });
  }
  ctx.fields.requested = requested.length;
  ctx.fields.unknown = unknown.length;
  if (requested.length === 0) return answerOf('unknown_numbers', texts.unknownNumbers, KEEP);

  let response: SummaryCommitmentsResponse;
  try {
    response = await run(ctx, {
      op: 'decide',
      summaryId: offer.summaryId,
      key: offer.key,
      requestZone: null,
      language: ctx.language,
      decisions: requested.map((entry) => ({ anchorId: entry.anchorId, decision: entry.decision, draft: null })),
    });
  } catch (error) {
    if (!(error instanceof CommitmentsRefused)) throw error;
    ctx.fields.reason = error.reason;
    if (error.reason === 'stale') return answerOf('stale', texts.stale, CLEAR);
    if (error.reason === 'not_found') return answerOf('not_found', texts.notFound, CLEAR);
    if (error.reason === 'invalid_request') return answerOf('unavailable', texts.decideFailed, KEEP);
    return answerOf('unavailable', texts.unavailable, KEEP);
  }
  const items = response.commitments?.items ?? [];
  const rendered = renderResult({ language: ctx.language, requested, results: response.results ?? [], items, unknown });
  Object.assign(ctx.fields, rendered.counts);
  // The stored offer follows what is still open (same id, same numbers, same expiry).
  const status = new Map(items.map((item) => [item.anchorId, item.status]));
  const open = offer.anchors.filter((entry) => status.get(entry.a) === 'open').map((entry) => entry.n);
  const refreshed: SummaryOffer = { ...offer, open, marked: offer.marked.filter((n) => open.includes(n)) };
  return answerOf('decided', rendered.text, { action: 'refresh', offer: refreshed });
}

// ---------------------------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------------------------

interface Gate {
  uid: string | null;
  tokenName: string | null;
  refused: SummaryWhatsAppOutcome | null;
}

async function gateOf(request: SummaryWhatsAppRequest, deps: SummaryWhatsAppDeps): Promise<Gate> {
  if (deps.config.enabled !== true) return { uid: null, tokenName: null, refused: 'not_enabled' };
  const uid = await linkedUid(deps.db, request.phoneE164);
  if (uid === null) return { uid: null, tokenName: null, refused: 'not_linked' };
  const user = await deps.authUsers.getUser(uid);
  if (!user.exists || user.disabled || !user.verified) return { uid, tokenName: null, refused: 'not_allowed' };
  if (!isPilotUid(uid, deps.config.pilotUids)) return { uid, tokenName: null, refused: 'not_allowed' };
  return { uid, tokenName: user.displayName, refused: null };
}

/** One worker request (see the module comment). Never throws; answers 400 for a request it cannot read. */
export async function handleSummaryWhatsApp(body: unknown, deps: SummaryWhatsAppDeps): Promise<WorkerAnswer> {
  const log = deps.logger ?? defaultLogger;
  const startedAt = Date.now();
  const parsed = summaryWhatsAppRequestSchema.safeParse(body);
  if (!parsed.success) {
    log.warn('summaries.whatsapp', { uid: null, op: null, outcome: 'bad_request', issues: parsed.error.issues.length });
    return { status: 400, body: 'Bad Request' };
  }
  const request = parsed.data;
  const language: Language = request.language;
  const texts = workerTexts(language);
  const tuning: SummaryWhatsAppTuning = { ...SUMMARY_WHATSAPP_TUNING, ...deps.tuning };
  const fields: Record<string, unknown> = {};
  const kind = request.op === 'reply' ? request.selection.kind : null;
  let uid: string | null = null;
  let response: SummaryWhatsAppResponse;
  try {
    const gate = await gateOf(request, deps);
    uid = gate.uid;
    if (gate.refused !== null || gate.uid === null) {
      response = answerOf(gate.refused ?? 'not_allowed', gate.refused === 'not_enabled' ? texts.unavailable : texts.notAllowed, request.op === 'reply' ? CLEAR : KEEP);
    } else {
      const ctx: Ctx = { uid: gate.uid, tokenName: gate.tokenName, language, now: deps.now(), deps, tuning, fields };
      if (request.op === 'offer') {
        response = await runOffer(ctx);
      } else if (request.offer.uidTag !== uidTagOf(gate.uid)) {
        response = answerOf('wrong_account', texts.expired, CLEAR);
      } else if (!(Date.parse(request.offer.expiresAt) > ctx.now.getTime())) {
        response = answerOf('expired', texts.expired, CLEAR);
      } else if (request.selection.kind === 'ai') {
        response = await runAi(ctx, request.offer);
      } else {
        response = await runReply(ctx, request.offer, request.selection);
      }
    }
  } catch (error) {
    if (error instanceof CommitmentsRefused) {
      fields.reason = error.reason;
      response = error.reason === 'not_found' ? answerOf('not_found', texts.notFound, request.op === 'reply' ? CLEAR : KEEP) : answerOf('unavailable', texts.unavailable, KEEP);
    } else {
      fields.errorName = errorName(error);
      log.error('summaries.whatsapp.failed', { uid, op: request.op, errorName: errorName(error) });
      response = answerOf('unavailable', texts.unavailable, KEEP);
    }
  }
  const checked = summaryWhatsAppResponseSchema.safeParse(response);
  if (!checked.success) {
    log.error('summaries.whatsapp.failed', { uid, op: request.op, reason: 'response_invalid', issues: checked.error.issues.length });
    const fallback = answerOf('unavailable', texts.unavailable, KEEP);
    log.info('summaries.whatsapp', { uid, op: request.op, kind, outcome: fallback.outcome, ms: Date.now() - startedAt });
    return { status: 200, body: fallback };
  }
  log.info('summaries.whatsapp', { uid, op: request.op, kind, outcome: checked.data.outcome, offer: checked.data.offer.action, ...fields, ms: Date.now() - startedAt });
  return { status: 200, body: checked.data };
}
