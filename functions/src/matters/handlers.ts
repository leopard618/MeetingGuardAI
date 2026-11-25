/**
 * The matter* callables and the inbound webhook (A1), on injected dependencies so they are
 * tested without Firebase, OpenAI or Postmark (test/unit/mattersHandlers.test.ts).
 *
 * matterDraft   words -> a new matter in draft (the model proposes, code completes or asks)
 * matterRevise  an answer to the questions -> a new draft of the same matter
 * matterConfirm the hash of the draft the user saw -> active, then the first email, through the
 *               send check; the send is claimed in the activating transaction, so it goes out at
 *               most once; a clearly refused send can be retried with the same call, one with no
 *               clear answer (timeout) is never resent automatically
 * matterCancel  -> cancelled (idempotent; any signed-in owner, even off the tester list)
 * inbound       Postmark's inbound JSON -> the email attached to its matter (inbound.ts), only
 *               while the matter is live (acceptsInbound), stored once per provider id, with the
 *               sender check (mailCheck.ts) and the sender's role (A2); the model read happens
 *               later, in matterInboundRead (replies.ts), never in the webhook
 * A matter document that does not parse is logged as matters.unreadable and answered
 * upstream_error, never not_found.
 * Errors: HttpsError(MATTER_ERROR_HTTPS_CODES[reason], generic English, { reason }); A4: a
 * rate_limited error also says which limit ({ reason, limit }, MATTER_LIMIT_KINDS). Logs carry
 * uid, matterId and categories only, never the user's words, addresses or email text.
 *
 * A4 (docs/v2/A4-THREAT-MODEL.md): every model call checks the user's spending cap of the day
 * first (acquireGlobalBudget, cost.ts) and adds its cost afterwards (recordUsage); a draft and a
 * confirm refuse past MATTER_LIMITS.maxOpenMatters running matters; the first confirm of a matter
 * counts one matter and one email on the monthly allowance (checked before, counted once sent).
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import {
  MATTER_ERROR_HTTPS_CODES,
  isTrustedSignInProvider,
  matterCancelRequestSchema,
  matterConfirmRequestSchema,
  matterDraftRequestSchema,
  matterReviseRequestSchema,
  usageDayKey,
  type Language,
  type MatterCancelResponse,
  type MatterConfirmResponse,
  type MatterDraftResponse,
  type MatterErrorCode,
  type MatterLimitKind,
  type MatterSendOutcome,
  type MatterUnknownCause,
} from '../shared/aiContract';
import { UpstreamError } from '../assistant/errors';
import type { MeetingReader } from '../assistant/context';
import type { GlobalBudget } from '../assistant/globalBudget';
import { safetyIdentifierFor, type LlmClient } from '../assistant/llm';
import { isValidTimeZone } from '../assistant/time';
import { addModelSpend, checkSpend, SpendCapReachedError } from './cost';
import { draftMatter, type DraftResult } from './draft';
import { INACTIVE_RECIPIENT_CODE, UNCERTAIN_SEND_KINDS, bareAddress, composeFirstEmail, EmailSendError, senderFor, type EmailSender, type OutboundEmail } from './email';
import type { MailboxDeps } from './mailbox';
import { matchInbound, parseInbound, toMatterMessage } from './inbound';
import type { SenderCheck } from './mailCheck';
import {
  EMPTY_USAGE,
  MATTER_LIMITS,
  SENDING_WINDOW_MS,
  draftHash,
  isOwnDomain,
  mailboxOf,
  matterDocSchema,
  monthKeyOf,
  newReplyToken,
  withModelCall,
  type MatterDoc,
  type MatterEvent,
  type MatterMessage,
  type SenderRole,
} from './model';
import { nextActionAt } from './schedule';
import { checkSend } from './sendCheck';
import { MatterUnreadableError, type MatterStore } from './store';
import { ownerDisplayName, readBack, senderName } from './text';

export interface MatterCaller {
  uid: string;
  /** Display name from the ID token ('' when none). */
  name: string;
  email: string | null;
  emailVerified: boolean;
  signInProvider: string | null;
}

export interface MatterDeps {
  store: MatterStore;
  llm: () => LlmClient;
  sender: () => EmailSender;
  now: () => Date;
  /** MATTERS_ENABLED at call time. */
  enabled: boolean;
  /** MATTERS_ALLOWED_UIDS. */
  allowed: (uid: string) => boolean;
  domain: string;
  fromLocalPart: string;
  dailyLimit: number;
  newToken?: () => string;
  random?: () => string;
  // ---- A2 ----
  /** MATTERS_AUTO_REPLY (default false: every reply is an approval card). */
  autoReply?: boolean;
  /** MATTERS_USER_DAILY_SENDS: assistant emails (replies, follow-ups) per user per UTC day. */
  dailySendLimit?: number;
  /** The project-wide cap on model calls (assistant/globalBudget.ts), shared with the assistant. */
  globalBudget?: GlobalBudget;
  /** Admin stats: one model call's tokens (adminStats/ai/days/{day}); failures never fail the call. */
  recordAiUsage?: (dayKey: string, tokens: { inputTokens: number; outputTokens: number }) => Promise<void>;
  // ---- A3 ----
  /** MATTERS_AUTO_SCHEDULE: new drafts book automatically (scheduling 'auto'), and the kill switch for it. */
  autoSchedule?: boolean;
  /** The owner's meetings (the assistant's bounded reader), for free times; absent = no calendar. */
  meetings?: MeetingReader;
  /** OPENAI_PRICE_IN_PER_M / OPENAI_PRICE_OUT_PER_M (USD per million tokens; 0 = unknown). */
  prices?: { inPerM: number; outPerM: number };
  /** MATTERS_NATURAL_VOICE (demo only) and the speech call behind it (MP3 bytes). */
  naturalVoice?: boolean;
  speech?: (text: string, language: Language) => Promise<Buffer>;
  // ---- A4 ----
  /** MATTERS_USER_DAILY_SPEND_CENTS: the day's spending cap per user (absent = no cap). */
  spendCapCents?: number;
  /** MATTERS_MONTHLY_*: the monthly allowance (absent = not metered). */
  monthly?: { matters: number; emails: number; voiceMinutes: number };
  /** MATTERS_RETENTION_DAYS: closed matters keep their emails this long. */
  retentionDays?: number;
  // ---- A4 part 2 ----
  /** The owner's Microsoft mailbox (mailbox.ts); absent = not set up. */
  mailbox?: MailboxDeps;
  /** Sends a mailbox matter's email through Graph (mailbox.ts createMailboxSender); used by senderFor. */
  mailboxSender?: (uid: string, address: string) => EmailSender;
}

/** The project-wide model budget is spent for today: the call never reaches OpenAI. */
export class GlobalBudgetExhaustedError extends Error {
  constructor() {
    super('The global AI budget for today is spent.');
    this.name = 'GlobalBudgetExhaustedError';
  }
}

/**
 * One unit per started block of prompt characters (the commitments pattern). A4: with a uid, the
 * user's spending cap of the day is checked first (SpendCapReachedError).
 */
export async function acquireGlobalBudget(
  deps: Pick<MatterDeps, 'globalBudget' | 'now' | 'store' | 'spendCapCents' | 'prices'>,
  chars: number,
  perUnit: number,
  uid?: string,
): Promise<void> {
  if (uid !== undefined) await checkSpend(deps, uid);
  if (!deps.globalBudget) return;
  const units = Math.max(1, Math.ceil(chars / Math.max(1, perUnit)));
  const dayKey = usageDayKey(deps.now());
  for (let unit = 0; unit < units; unit += 1) {
    if (!(await deps.globalBudget.tryAcquire(dayKey))) throw new GlobalBudgetExhaustedError();
  }
}

/**
 * Records one model call's tokens for the admin stats and (A4) its cost on the user's spend of
 * the day (matterSpend); never throws.
 */
export async function recordUsage(
  deps: Pick<MatterDeps, 'recordAiUsage' | 'now' | 'store' | 'prices'>,
  usage: { promptTokens: number; completionTokens: number } | null,
  uid: string,
): Promise<void> {
  try {
    await addModelSpend(deps, uid, usage);
  } catch (error) {
    logger.warn('matters.spend_failed', { uid, errorName: error instanceof Error ? error.name : 'unknown' });
  }
  if (!deps.recordAiUsage) return;
  try {
    await deps.recordAiUsage(usageDayKey(deps.now()), { inputTokens: usage?.promptTokens ?? 0, outputTokens: usage?.completionTokens ?? 0 });
  } catch (error) {
    logger.warn('matters.stats_failed', { uid, errorName: error instanceof Error ? error.name : 'unknown' });
  }
}

/** Characters per global-budget unit (MATTERS_TUNING.globalBudgetCharsPerUnit). */
export const BUDGET_CHARS_PER_UNIT = 10_000;

const MESSAGES: Readonly<Record<MatterErrorCode, string>> = {
  not_configured: 'The assistant is not available.',
  unauthenticated: 'Sign in with a verified account to use the assistant.',
  invalid_request: 'Invalid request.',
  not_found: 'This matter does not exist.',
  stale_draft: 'The draft changed. Review it again before confirming.',
  not_allowed: 'This email is outside what you confirmed.',
  rate_limited: 'Too many drafts today. Try again tomorrow.',
  upstream_error: 'The assistant is temporarily unavailable. Please try again.',
};

export function matterError(reason: MatterErrorCode, message: string = MESSAGES[reason]): HttpsError {
  // A4: a rate_limited error without a named limit is the daily drafts cap
  return new HttpsError(MATTER_ERROR_HTTPS_CODES[reason], message, reason === 'rate_limited' ? { reason, limit: 'drafts' } : { reason });
}

const LIMIT_MESSAGES: Readonly<Record<MatterLimitKind, string>> = {
  drafts: MESSAGES.rate_limited,
  sends: 'The assistant sent as many emails as it may today. Try again tomorrow.',
  matters: "You started this month's matters. More next month.",
  emails: "The assistant sent this month's emails. More next month.",
  voice: "This month's voice minutes are used.",
  spend: "Today's assistant limit is reached. Try again tomorrow.",
  open_matters: 'You have too many matters running. Finish or cancel one first.',
};

/** A4: a rate_limited error that names the limit (details.limit), so the app can say which one. */
export function limitError(limit: MatterLimitKind): HttpsError {
  return new HttpsError(MATTER_ERROR_HTTPS_CODES.rate_limited, LIMIT_MESSAGES[limit], { reason: 'rate_limited', limit });
}

/** A4: the user's running matters (active or paused) are at MATTER_LIMITS.maxOpenMatters. */
async function requireRoomForMatter(uid: string, deps: MatterDeps): Promise<void> {
  const open = await deps.store.listMatters(uid, ['active', 'paused']);
  if (open.length >= MATTER_LIMITS.maxOpenMatters) throw limitError('open_matters');
}

/** A signed-in caller with a verified account (or a trusted sign-in provider). */
export function requireSignedIn(caller: MatterCaller | null): MatterCaller {
  if (!caller) throw matterError('unauthenticated');
  if (!(caller.emailVerified || isTrustedSignInProvider(caller.signInProvider))) throw matterError('unauthenticated');
  return caller;
}

/** ...and the assistant switched on for them (MATTERS_ENABLED and MATTERS_ALLOWED_UIDS). */
export function requireCaller(caller: MatterCaller | null, deps: MatterDeps): MatterCaller {
  const signedIn = requireSignedIn(caller);
  if (!deps.enabled || !deps.allowed(signedIn.uid)) throw matterError('not_configured');
  return signedIn;
}

/**
 * The caller's email only when the token says it is verified (it receives the copies). A trusted
 * sign-in provider lets the caller in, but does not by itself make the email a verified one.
 */
function verifiedEmail(caller: MatterCaller): string | null {
  return caller.email && caller.emailVerified === true ? caller.email : null;
}

/** A matter that exists but does not parse is its own outcome (logged by the store), never not_found. */
export async function readable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MatterUnreadableError) throw matterError('upstream_error', 'This matter cannot be read right now.');
    throw error;
  }
}

async function consumeDaily(uid: string, deps: MatterDeps): Promise<void> {
  const now = deps.now();
  if (!(await deps.store.consumeDaily(uid, usageDayKey(now), deps.dailyLimit, now.toISOString()))) throw matterError('rate_limited');
}

export type Tokens = { promptTokens: number; completionTokens: number } | null;

export async function runDraft(deps: MatterDeps, uid: string, ctx: Parameters<typeof draftMatter>[1], onTokens?: (tokens: Tokens) => void): Promise<DraftResult> {
  try {
    // the matter model calls count against the project-wide budget and the admin stats (A2), and
    // against the user's spending cap of the day (A4)
    await acquireGlobalBudget(deps, ctx.request.length + 4000, BUDGET_CHARS_PER_UNIT, uid);
    return await draftMatter(deps.llm(), ctx, safetyIdentifierFor(uid), (usage) => {
      onTokens?.(usage);
      return recordUsage(deps, usage, uid);
    });
  } catch (error) {
    if (error instanceof SpendCapReachedError) {
      logger.warn('matters.spend_cap_reached', { uid });
      throw limitError('spend');
    }
    if (error instanceof GlobalBudgetExhaustedError) {
      logger.error('matters.global_budget_exhausted', { uid });
      throw matterError('upstream_error');
    }
    if (error instanceof UpstreamError) {
      (error.kind === 'configuration' ? logger.error : logger.warn)('matters.upstream_error', { uid, kind: error.kind, status: error.status });
      throw matterError('upstream_error');
    }
    throw error;
  }
}

export const event = (type: MatterEvent['type'], at: string, detail = ''): MatterEvent => ({ type, at, messageId: null, detail: detail.slice(0, MATTER_LIMITS.eventDetailChars) });

/** The draft as the app shows it. */
export function draftView(matterId: string, doc: MatterDoc, deps: Pick<MatterDeps, 'domain' | 'fromLocalPart'>): MatterDraftResponse {
  const complete = doc.mandate !== null && doc.firstEmail !== null;
  const email = complete
    ? composeFirstEmail({ matter: doc, matterId, domain: deps.domain, fromLocalPart: deps.fromLocalPart, random: () => 'preview' })
    : null;
  return {
    matterId,
    status: doc.status,
    title: doc.title,
    readBack: doc.readBack,
    questions: doc.questions,
    firstEmail: email ? { from: email.from, to: email.to, cc: email.cc, subject: email.subject, text: email.text } : null,
    draftHash: complete && doc.status === 'draft' ? draftHash(doc.mandate!, doc.firstEmail!, doc.scheduling, mailboxOf(doc)) : null,
    sendFrom: doc.sendFrom,
  };
}

/** A3: a drafted change of a running matter as the app shows it (matterChange). */
export function changeView(matterId: string, doc: MatterDoc): MatterDraftResponse {
  const change = doc.pendingChange;
  return {
    matterId,
    status: doc.status,
    title: doc.title,
    readBack: change?.readBack ?? doc.readBack,
    questions: change?.questions ?? [],
    firstEmail: null,
    draftHash: change?.hash ?? null,
  };
}

/** A3: whether a new draft books automatically (MATTERS_AUTO_SCHEDULE, and only with a meeting). */
export function schedulingFor(mandate: MatterDoc['mandate'], deps: Pick<MatterDeps, 'autoSchedule'>): MatterDoc['scheduling'] {
  return deps.autoSchedule === true && mandate?.meeting ? 'auto' : 'ask';
}

function draftFields(result: DraftResult, ownerEmail: string | null, language: Language, scheduling: MatterDoc['scheduling'], mailbox: string | null = null) {
  return {
    title: result.title,
    mandate: result.mandate,
    firstEmail: result.firstEmail,
    questions: result.questions,
    readBack: result.mandate ? readBack(result.mandate, ownerEmail, language, scheduling, mailbox) : '',
    scheduling,
    // A4 part 2: where the emails go out from (fixed with the draft; part of its hash)
    sendFrom: mailbox ? ('mailbox' as const) : ('assistant' as const),
    mailboxAddress: mailbox,
  };
}

/** A4 part 2: a new draft sends from the owner's connected mailbox, when there is one. */
async function defaultMailbox(uid: string, deps: MatterDeps): Promise<string | null> {
  if (!deps.mailbox?.available) return null;
  try {
    return (await deps.mailbox.store.get(uid))?.address ?? null;
  } catch (error) {
    logger.warn('matters.mailbox_read_failed', { uid, errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// matterDraft / matterRevise
// ---------------------------------------------------------------------------------------------

export async function handleMatterDraft(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDraftResponse> {
  const caller = requireCaller(callerIn, deps);
  const parsed = matterDraftRequestSchema.safeParse(data);
  if (!parsed.success || !isValidTimeZone(parsed.data.timeZone)) throw matterError('invalid_request');
  const request = parsed.data;
  await requireRoomForMatter(caller.uid, deps);
  await consumeDaily(caller.uid, deps);
  const ownerEmail = verifiedEmail(caller);
  const ownerName = ownerDisplayName(caller.name, deps.domain);
  const mailbox = await defaultMailbox(caller.uid, deps);
  const now = deps.now();
  let tokens: Tokens = null;
  const result = await runDraft(
    deps,
    caller.uid,
    {
      request: request.text,
      language: request.language,
      timeZone: request.timeZone,
      ownerName,
      ownerEmail,
      now,
      domain: deps.domain,
    },
    (t) => {
      tokens = t;
    },
  );
  const nowIso = now.toISOString();
  const doc: MatterDoc = matterDocSchema.parse({
    status: 'draft',
    language: request.language,
    timeZone: request.timeZone,
    request: request.text,
    source: request.source,
    ownerName,
    ownerEmail,
    ...draftFields(result, ownerEmail, request.language, schedulingFor(result.mandate, deps), mailbox),
    usage: withModelCall(EMPTY_USAGE, tokens),
    mandateVersion: 1,
    confirmedHash: null,
    confirmedAt: null,
    firstSentAt: null,
    replyToken: (deps.newToken ?? newReplyToken)(),
    createdAt: nowIso,
    updatedAt: nowIso,
    endedAt: null,
  });
  const matterId = deps.store.newMatterId();
  if (!(await deps.store.createMatter(caller.uid, matterId, doc, event('created', nowIso)))) {
    // the account is being deleted (accountDeletions/{uid}): nothing was written
    logger.warn('matters.draft_after_deletion', { uid: caller.uid });
    throw matterError('unauthenticated');
  }
  logger.info('matters.drafted', { uid: caller.uid, matterId, complete: doc.mandate !== null, questions: doc.questions.length });
  return draftView(matterId, doc, deps);
}

export function handleMatterRevise(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDraftResponse> {
  return readable(() => reviseMatter(callerIn, data, deps));
}

async function reviseMatter(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDraftResponse> {
  const caller = requireCaller(callerIn, deps);
  const parsed = matterReviseRequestSchema.safeParse(data);
  if (!parsed.success) throw matterError('invalid_request');
  const { matterId, answer } = parsed.data;
  const current = await deps.store.getMatter(caller.uid, matterId);
  if (!current) throw matterError('not_found');
  if (current.status !== 'draft') throw matterError('invalid_request', 'Only a draft can be changed.');
  const request = `${current.request}\n${answer}`;
  if (request.length > MATTER_LIMITS.requestChars) throw matterError('invalid_request', 'This matter has too many changes. Start a new one.');
  await consumeDaily(caller.uid, deps);
  const now = deps.now();
  let tokens: Tokens = null;
  const result = await runDraft(
    deps,
    caller.uid,
    {
      request,
      language: current.language,
      timeZone: current.timeZone,
      ownerName: current.ownerName,
      ownerEmail: current.ownerEmail,
      now,
      domain: deps.domain,
    },
    (t) => {
      tokens = t;
    },
  );
  const nowIso = now.toISOString();
  const updated = await deps.store.updateMatter<MatterDoc | 'not_found' | 'not_draft' | 'stale'>(caller.uid, matterId, (doc) => {
    if (!doc) return { result: 'not_found' };
    if (doc.status !== 'draft') return { result: 'not_draft' };
    // another revise finished while the model was drafting this one: its request (with that
    // answer) is newer than the one this draft was made from, so writing ours would lose it
    if (doc.mandateVersion !== current.mandateVersion) return { result: 'stale' };
    const next: MatterDoc = matterDocSchema.parse({
      ...doc,
      request,
      ...draftFields(result, doc.ownerEmail, doc.language, schedulingFor(result.mandate, deps), mailboxOf(doc)),
      usage: withModelCall(doc.usage, tokens),
      mandateVersion: doc.mandateVersion + 1,
      updatedAt: nowIso,
    });
    return {
      result: next,
      patch: next,
      events: next.mandate ? [event('mandate_drafted', nowIso)] : [],
    };
  });
  if (updated === 'not_found') throw matterError('not_found');
  if (updated === 'not_draft') throw matterError('invalid_request', 'Only a draft can be changed.');
  if (updated === 'stale') throw matterError('stale_draft');
  return draftView(matterId, updated, deps);
}

// ---------------------------------------------------------------------------------------------
// matterConfirm
// ---------------------------------------------------------------------------------------------

type ConfirmOutcome =
  | { kind: 'not_found' }
  | { kind: 'stale' }
  | { kind: 'ended' }
  | { kind: 'refused'; reason: string }
  /** Nothing for this call to send: the first email went out, is going out, or its fate is unknown. */
  | { kind: 'settled'; outcome: MatterSendOutcome; unknownCause: MatterUnknownCause | null }
  /** This call claimed the send ('sending') and sends exactly this email; first: it activated the matter. */
  | { kind: 'send'; doc: MatterDoc; email: OutboundEmail; first: boolean };

/** What a confirm on an active matter answers when it does not send (see handleMatterConfirm). */
function settledOutcome(doc: MatterDoc, now: Date): ConfirmOutcome | null {
  const settled = (outcome: MatterSendOutcome, unknownCause: MatterUnknownCause | null = null): ConfirmOutcome => ({ kind: 'settled', outcome, unknownCause });
  // a test-token send was accepted by Postmark (and delivered to nobody): the app shows it as sent
  if (doc.firstSentAt || doc.firstSendState === 'sent' || doc.firstSendState === 'test') return settled('sent');
  if (doc.firstSendState === 'failed') return null; // a clear refusal: this confirm claims it again
  if (doc.firstSendState === 'sending') {
    const claimedAt = doc.firstSendClaimedAt ? Date.parse(doc.firstSendClaimedAt) : NaN;
    // another call is sending it right now: "check again" (never a second send); after the
    // window that call has died, and the send may or may not have gone out
    if (Number.isFinite(claimedAt) && now.getTime() - claimedAt < SENDING_WINDOW_MS) return settled('sending');
    return settled('unknown');
  }
  // 'unknown', and an active matter without a state (written before firstSendState existed)
  return settled('unknown', doc.firstSendState === 'unknown' ? doc.firstSendUnknownCause : null);
}

/**
 * Activates the confirmed draft and sends its first email, at most once.
 * The send is CLAIMED in the same transaction that activates the matter (firstSendState
 * 'sending'), so of two overlapping confirms only one sends; the other answers 'sending' (or
 * 'unknown' once the claim is older than SENDING_WINDOW_MS). After the call to the provider the
 * state becomes 'sent', 'test' (Postmark's test token: accepted, delivered to nobody, no
 * firstSentAt), 'failed' (a clear refusal: the same confirm may claim it again) or 'unknown'
 * (timeout, Postmark 406 and the like: never sent again automatically). A call that dies after
 * claiming leaves 'sending', which also never sends again.
 */
export function handleMatterConfirm(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterConfirmResponse> {
  return readable(() => confirmMatter(callerIn, data, deps));
}

async function confirmMatter(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterConfirmResponse> {
  const caller = requireCaller(callerIn, deps);
  const parsed = matterConfirmRequestSchema.safeParse(data);
  if (!parsed.success) throw matterError('invalid_request');
  const { matterId, draftHash: hash } = parsed.data;
  const now = deps.now();
  const nowIso = now.toISOString();

  // A4: activating a draft needs room for one more running matter and the month's allowance (a
  // matter and its first email); checked here, counted once the matter is active
  const before = await deps.store.getMatter(caller.uid, matterId);
  if (before?.status === 'draft') {
    await requireRoomForMatter(caller.uid, deps);
    if (deps.monthly) {
      const used = await deps.store.getMonthly(caller.uid, monthKeyOf(now));
      if (used.matters >= deps.monthly.matters) throw limitError('matters');
      if (used.emails >= deps.monthly.emails) throw limitError('emails');
    }
  }

  const outcome = await deps.store.updateMatter<ConfirmOutcome>(caller.uid, matterId, (doc) => {
    if (!doc) return { result: { kind: 'not_found' } };
    const retry = doc.status === 'active' && doc.confirmedHash === hash;
    if (retry) {
      const settled = settledOutcome(doc, now);
      if (settled) return { result: settled };
    } else {
      if (doc.status !== 'draft' || !doc.mandate || !doc.firstEmail) return { result: { kind: 'stale' } };
      if (draftHash(doc.mandate, doc.firstEmail, doc.scheduling, mailboxOf(doc)) !== hash) return { result: { kind: 'stale' } };
      if (Date.parse(doc.mandate.endsAt) <= now.getTime()) return { result: { kind: 'ended' } };
    }
    const claim = { firstSendState: 'sending' as const, firstSendClaimedAt: nowIso, firstSendUnknownCause: null, updatedAt: nowIso };
    const activation = retry ? {} : { status: 'active' as const, confirmedHash: hash, confirmedAt: nowIso };
    const next: MatterDoc = { ...doc, ...activation, ...claim };
    const email = composeFirstEmail({ matter: next, matterId, uid: caller.uid, domain: deps.domain, fromLocalPart: deps.fromLocalPart, ...(deps.random ? { random: deps.random } : {}) });
    // the send check runs before anything is claimed: a refused send changes nothing
    const decision = checkSend({ matter: next, to: email.to, cc: email.cc, now, enabled: deps.enabled, domain: deps.domain });
    if (!decision.ok) return { result: { kind: 'refused', reason: decision.reason } };
    return {
      result: { kind: 'send', doc: next, email, first: !retry },
      patch: { ...activation, ...claim },
      events: retry ? [] : [event('mandate_confirmed', nowIso)],
    };
  });
  if (outcome.kind === 'not_found') throw matterError('not_found');
  if (outcome.kind === 'stale') throw matterError('stale_draft');
  if (outcome.kind === 'ended') throw matterError('not_allowed', 'The end date of this matter has passed.');
  if (outcome.kind === 'refused') {
    logger.warn('matters.send_refused', { uid: caller.uid, matterId, reason: outcome.reason });
    throw matterError('not_allowed');
  }
  if (outcome.kind === 'settled') return confirmResponse(matterId, outcome.outcome, outcome.unknownCause);
  if (outcome.first && deps.monthly) {
    // A4: counted without a limit (checked above); a counter that fails never stops the send
    await deps.store.consumeMonthly(caller.uid, monthKeyOf(now), { matters: 1, emails: 1 }, {}, nowIso).catch((error: unknown) => {
      logger.warn('matters.allowance_count_failed', { uid: caller.uid, errorName: error instanceof Error ? error.name : 'unknown' });
    });
  }
  const sent = await sendFirstEmail(caller.uid, matterId, outcome.doc, outcome.email, deps);
  return confirmResponse(matterId, sent.outcome, sent.unknownCause);
}

function confirmResponse(matterId: string, outcome: MatterSendOutcome, unknownCause: MatterUnknownCause | null): MatterConfirmResponse {
  return { matterId, status: 'active', outcome, ...(outcome === 'unknown' && unknownCause ? { unknownCause } : {}) };
}

/** Sends the claimed first email and records the result on the matter. */
async function sendFirstEmail(
  uid: string,
  matterId: string,
  doc: MatterDoc,
  email: OutboundEmail,
  deps: MatterDeps,
): Promise<{ outcome: MatterSendOutcome; unknownCause: MatterUnknownCause | null }> {
  const contacts = doc.mandate!.contacts.map((c) => c.name).join(', ');
  const message = (at: string, status: 'sent' | 'sending' | 'test', providerId: string | null): MatterMessage => ({
    direction: 'outbound',
    status,
    rfcMessageId: email.messageId,
    inReplyTo: null,
    references: [],
    from: { name: senderName(doc.ownerName, doc.mandate!.language), email: bareAddress(email.from) },
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    text: email.text.slice(0, MATTER_LIMITS.bodyChars),
    at,
    providerId,
    auth: null,
  });
  let result: { providerId: string; test?: boolean };
  try {
    // A4 part 2: a mailbox matter goes out through the owner's mailbox, never another address
    result = await senderFor(deps, uid, doc).send(email);
  } catch (error) {
    if (!(error instanceof EmailSendError)) throw error; // the claim stays 'sending': never resent
    (error.kind === 'configuration' ? logger.error : logger.warn)('matters.send_failed', { uid, matterId, kind: error.kind, code: error.code });
    const at = deps.now().toISOString();
    if (UNCERTAIN_SEND_KINDS.has(error.kind)) {
      // it may have gone out: keep it, unconfirmed, with its Message-ID so a reply still threads
      const unknownCause: MatterUnknownCause | null = error.code === INACTIVE_RECIPIENT_CODE ? 'inactive_recipient' : null;
      await deps.store.addMessage(uid, matterId, message(at, 'sending', null), event('email_unconfirmed', at, contacts), {
        indexMessageId: true,
        patch: { firstSendState: 'unknown', firstSendUnknownCause: unknownCause },
      });
      // Postmark 406 to a single contact: that address is inactive, handled like a hard bounce (A2)
      if (unknownCause === 'inactive_recipient' && email.to.length === 1) await recordUndeliverable(deps, uid, matterId, email.to, 'inactive');
      return { outcome: 'unknown', unknownCause };
    }
    await deps.store.updateMatter(uid, matterId, () => ({
      result: null,
      patch: { firstSendState: 'failed', firstSendClaimedAt: null, updatedAt: at },
      events: [event('email_failed', at, error.kind)],
    }));
    return { outcome: 'failed', unknownCause: null };
  }
  const at = deps.now().toISOString();
  if (result.test) {
    // Postmark's test token: accepted, delivered to nobody. No firstSentAt, so nothing (follow-ups,
    // replies) ever builds on an email the contact never got. Boolean-only log line.
    logger.warn('matters.test_token_send', { uid, matterId, test: true });
    await deps.store.addMessage(uid, matterId, message(at, 'test', result.providerId), event('email_test', at, contacts), {
      indexMessageId: true,
      patch: { firstSendState: 'test' },
    });
    return { outcome: 'sent', unknownCause: null };
  }
  const sentDoc: MatterDoc = { ...doc, firstSendState: 'sent', firstSentAt: at, lastOutboundAt: at };
  await deps.store.addMessage(uid, matterId, message(at, 'sent', result.providerId), event('email_sent', at, contacts), {
    indexMessageId: true,
    patch: { firstSendState: 'sent', firstSentAt: at, lastOutboundAt: at },
    // A2: the first follow-up (or the end date) is when matterTick looks at the matter next
    schedule: { nextActionAt: nextActionAt(sentDoc) },
  });
  logger.info('matters.first_email_sent', { uid, matterId });
  return { outcome: 'sent', unknownCause: null };
}

// ---------------------------------------------------------------------------------------------
// matterCancel
// ---------------------------------------------------------------------------------------------

export function handleMatterCancel(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterCancelResponse> {
  return readable(() => cancelMatter(callerIn, data, deps));
}

async function cancelMatter(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterCancelResponse> {
  // the owner can always stop their own matter: not tied to the switch or the tester list (a
  // tester taken off MATTERS_ALLOWED_UIDS, the practical kill switch, can still cancel)
  const caller = requireSignedIn(callerIn);
  const parsed = matterCancelRequestSchema.safeParse(data);
  if (!parsed.success) throw matterError('invalid_request');
  const { matterId } = parsed.data;
  const nowIso = deps.now().toISOString();
  const found = await deps.store.updateMatter(caller.uid, matterId, (doc) => {
    if (!doc) return { result: false };
    if (doc.status === 'cancelled' || doc.status === 'done') return { result: true };
    return {
      result: true,
      patch: { status: 'cancelled', endedAt: nowIso, updatedAt: nowIso, stopReason: 'user' },
      events: [event('status_changed', nowIso, 'cancelled')],
      schedule: { nextActionAt: null },
    };
  });
  if (!found) throw matterError('not_found');
  return { matterId, status: 'cancelled' };
}

// ---------------------------------------------------------------------------------------------
// Inbound webhook
// ---------------------------------------------------------------------------------------------

export type InboundOutcome = 'stored' | 'duplicate' | 'unmatched' | 'ignored';

/** Replies to a matter that ended are still kept for this long (shown, never acted on). */
export const INBOUND_AFTER_END_DAYS = 7;

/**
 * Whether an inbound email is stored for this matter: while it is active or paused, and up to
 * INBOUND_AFTER_END_DAYS after it ended (kept only; A2 acts on replies to active matters only).
 * Never for a draft: nothing was sent, so nobody can be replying.
 */
export function acceptsInbound(matter: MatterDoc, now: Date): boolean {
  if (matter.status === 'active' || matter.status === 'paused') return true;
  if (matter.status !== 'done' && matter.status !== 'cancelled') return false;
  const ended = matter.endedAt ? Date.parse(matter.endedAt) : NaN;
  return Number.isFinite(ended) && now.getTime() - ended <= INBOUND_AFTER_END_DAYS * 86_400_000;
}

/** Who wrote an inbound email, by its From address (never by a Reply-To). */
export function senderRoleOf(from: string, matter: MatterDoc): SenderRole {
  const address = from.trim().toLowerCase();
  if (matter.mandate?.contacts.some((c) => c.email.toLowerCase() === address)) return 'contact';
  if (matter.ownerEmail && matter.ownerEmail.toLowerCase() === address) return 'owner';
  return 'other';
}

/**
 * An address that bounced hard or is inactive at Postmark (bounce webhook, or a 406 at send time):
 * recorded on the matter (never emailed again), one bounce card and one timeline event. Only
 * mandate contacts are recorded (the owner's copy bouncing changes nothing for the contacts).
 */
export async function recordUndeliverable(
  deps: Pick<MatterDeps, 'store' | 'now'>,
  uid: string,
  matterId: string,
  recipients: readonly string[],
  cause: 'bounce' | 'inactive',
): Promise<'recorded' | 'unchanged' | 'not_found'> {
  const nowIso = deps.now().toISOString();
  const cardId = deps.store.newDocId();
  return deps.store.updateMatter(uid, matterId, (doc) => {
    if (!doc || !doc.mandate) return { result: 'not_found' as const };
    const known = new Set(doc.bouncedRecipients.map((a) => a.toLowerCase()));
    const contacts = new Map(doc.mandate.contacts.map((c) => [c.email.toLowerCase(), c]));
    const fresh = recipients.map((r) => r.trim().toLowerCase()).filter((r) => contacts.has(r) && !known.has(r));
    if (fresh.length === 0) return { result: 'unchanged' as const };
    const names = fresh.map((r) => contacts.get(r)!.name).join(', ');
    return {
      result: 'recorded' as const,
      patch: { bouncedRecipients: [...doc.bouncedRecipients, ...fresh], pendingApprovals: doc.pendingApprovals + 1, updatedAt: nowIso },
      events: [event('email_bounced', nowIso, `${names} (${cause})`)],
      cards: [
        {
          id: cardId,
          doc: {
            kind: 'bounce',
            status: 'pending',
            reason: null,
            quote: null,
            from: fresh.join(', '),
            draft: null,
            draftHash: null,
            threading: null,
            guardFlags: [],
            sendOutcome: null,
            sendState: 'none',
            sendClaimedAt: null,
            auto: false,
            sourceMessageId: null,
            createdAt: nowIso,
            updatedAt: nowIso,
            decidedAt: null,
            slot: null,
            offers: [],
          },
        },
      ],
    };
  });
}

export async function handleInboundEmail(
  payload: unknown,
  deps: Pick<MatterDeps, 'store' | 'now' | 'domain'> & { markerTtlDays: number; checkSender?: SenderCheck },
): Promise<InboundOutcome> {
  const email = parseInbound(payload);
  if (!email) return 'ignored';
  // mail from our own domain is never a contact's reply (a loop, or a forged sender)
  if (isOwnDomain(email.from.email, deps.domain)) {
    logger.warn('matters.inbound_own_domain', { providerId: email.providerId });
    return 'ignored';
  }
  const now = deps.now();
  const nowIso = now.toISOString();
  const marker = { providerId: email.providerId, receivedAt: nowIso, expiresAt: new Date(now.getTime() + deps.markerTtlDays * 86_400_000).toISOString() };
  const match = await matchInbound(email, deps.domain, deps.store);
  const matter = match ? await deps.store.getMatter(match.uid, match.matterId) : null;
  if (!match || !matter || !acceptsInbound(matter, now)) {
    // marked, so Postmark's retries of the same email are recognised; nothing else is kept
    if (!(await deps.store.markInbound(marker))) return 'duplicate';
    logger.info('matters.inbound_unmatched', { providerId: email.providerId, reason: !match || !matter ? 'no_matter' : 'not_live' });
    return 'unmatched';
  }
  const sender = email.from.name ? `${email.from.name} <${email.from.email}>` : email.from.email;
  const senderRole = senderRoleOf(email.from.email, matter);
  // A2: the sender check from the raw email (DKIM aligned with From); only contacts and the owner
  // get the priority DNS budget
  const auth = deps.checkSender
    ? await deps.checkSender({ raw: email.raw, from: email.from.email, spf: email.spf, priority: senderRole !== 'other', now })
    : null;
  // only an active matter's mail is read by the model (matterInboundRead); the rest is kept only
  const readState = matter.status === 'active' ? 'none' : 'skipped';
  // a contact's own email (not an automatic reply) stops the follow-up clock
  const patch = senderRole === 'contact' && !email.autoReply ? { lastInboundAt: nowIso } : undefined;
  // never indexed: the Message-ID index holds only our own outgoing ids (a sender chooses theirs).
  // The marker is created in the same batch: a retry after a failed write is processed normally,
  // a retry after a successful one is a duplicate.
  const outcome = await deps.store.addInboundMessage(
    match.uid,
    match.matterId,
    toMatterMessage(email, nowIso, { auth, senderRole, readState }),
    event('email_received', nowIso, sender),
    marker,
    patch,
  );
  if (outcome === 'duplicate') return 'duplicate';
  logger.info('matters.inbound_stored', {
    uid: match.uid,
    matterId: match.matterId,
    role: senderRole,
    verdict: auth?.verdict ?? null,
    autoReply: email.autoReply,
    attachments: email.attachments.length,
  });
  return 'stored';
}
