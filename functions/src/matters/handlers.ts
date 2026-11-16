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
 *               while the matter is live (acceptsInbound), stored once per provider id
 * A matter document that does not parse is logged as matters.unreadable and answered
 * upstream_error, never not_found.
 * Errors: HttpsError(MATTER_ERROR_HTTPS_CODES[reason], generic English, { reason }). Logs carry
 * uid, matterId and categories only, never the user's words, addresses or email text.
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
  type MatterSendOutcome,
  type MatterUnknownCause,
} from '../shared/aiContract';
import { UpstreamError } from '../assistant/errors';
import { safetyIdentifierFor, type LlmClient } from '../assistant/llm';
import { isValidTimeZone } from '../assistant/time';
import { draftMatter, type DraftResult } from './draft';
import { INACTIVE_RECIPIENT_CODE, UNCERTAIN_SEND_KINDS, bareAddress, composeFirstEmail, EmailSendError, type EmailSender, type OutboundEmail } from './email';
import { matchInbound, parseInbound, toMatterMessage } from './inbound';
import {
  MATTER_LIMITS,
  SENDING_WINDOW_MS,
  draftHash,
  isOwnDomain,
  matterDocSchema,
  newReplyToken,
  type MatterDoc,
  type MatterEvent,
  type MatterMessage,
} from './model';
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
}

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
  return new HttpsError(MATTER_ERROR_HTTPS_CODES[reason], message, { reason });
}

/** A signed-in caller with a verified account (or a trusted sign-in provider). */
function requireSignedIn(caller: MatterCaller | null): MatterCaller {
  if (!caller) throw matterError('unauthenticated');
  if (!(caller.emailVerified || isTrustedSignInProvider(caller.signInProvider))) throw matterError('unauthenticated');
  return caller;
}

/** ...and the assistant switched on for them (MATTERS_ENABLED and MATTERS_ALLOWED_UIDS). */
function requireCaller(caller: MatterCaller | null, deps: MatterDeps): MatterCaller {
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
async function readable<T>(work: () => Promise<T>): Promise<T> {
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

async function runDraft(deps: MatterDeps, uid: string, ctx: Parameters<typeof draftMatter>[1]): Promise<DraftResult> {
  try {
    return await draftMatter(deps.llm(), ctx, safetyIdentifierFor(uid));
  } catch (error) {
    if (error instanceof UpstreamError) {
      (error.kind === 'configuration' ? logger.error : logger.warn)('matters.upstream_error', { uid, kind: error.kind, status: error.status });
      throw matterError('upstream_error');
    }
    throw error;
  }
}

const event = (type: MatterEvent['type'], at: string, detail = ''): MatterEvent => ({ type, at, messageId: null, detail: detail.slice(0, MATTER_LIMITS.eventDetailChars) });

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
    draftHash: complete && doc.status === 'draft' ? draftHash(doc.mandate!, doc.firstEmail!) : null,
  };
}

function draftFields(result: DraftResult, ownerEmail: string | null, language: Language) {
  return {
    title: result.title,
    mandate: result.mandate,
    firstEmail: result.firstEmail,
    questions: result.questions,
    readBack: result.mandate ? readBack(result.mandate, ownerEmail, language) : '',
  };
}

// ---------------------------------------------------------------------------------------------
// matterDraft / matterRevise
// ---------------------------------------------------------------------------------------------

export async function handleMatterDraft(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDraftResponse> {
  const caller = requireCaller(callerIn, deps);
  const parsed = matterDraftRequestSchema.safeParse(data);
  if (!parsed.success || !isValidTimeZone(parsed.data.timeZone)) throw matterError('invalid_request');
  const request = parsed.data;
  await consumeDaily(caller.uid, deps);
  const ownerEmail = verifiedEmail(caller);
  const ownerName = ownerDisplayName(caller.name, deps.domain);
  const now = deps.now();
  const result = await runDraft(deps, caller.uid, {
    request: request.text,
    language: request.language,
    timeZone: request.timeZone,
    ownerName,
    ownerEmail,
    now,
    domain: deps.domain,
  });
  const nowIso = now.toISOString();
  const doc: MatterDoc = matterDocSchema.parse({
    status: 'draft',
    language: request.language,
    timeZone: request.timeZone,
    request: request.text,
    source: request.source,
    ownerName,
    ownerEmail,
    ...draftFields(result, ownerEmail, request.language),
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
  const result = await runDraft(deps, caller.uid, {
    request,
    language: current.language,
    timeZone: current.timeZone,
    ownerName: current.ownerName,
    ownerEmail: current.ownerEmail,
    now,
    domain: deps.domain,
  });
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
      ...draftFields(result, doc.ownerEmail, doc.language),
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
  /** This call claimed the send ('sending') and sends exactly this email. */
  | { kind: 'send'; doc: MatterDoc; email: OutboundEmail };

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

  const outcome = await deps.store.updateMatter<ConfirmOutcome>(caller.uid, matterId, (doc) => {
    if (!doc) return { result: { kind: 'not_found' } };
    const retry = doc.status === 'active' && doc.confirmedHash === hash;
    if (retry) {
      const settled = settledOutcome(doc, now);
      if (settled) return { result: settled };
    } else {
      if (doc.status !== 'draft' || !doc.mandate || !doc.firstEmail) return { result: { kind: 'stale' } };
      if (draftHash(doc.mandate, doc.firstEmail) !== hash) return { result: { kind: 'stale' } };
      if (Date.parse(doc.mandate.endsAt) <= now.getTime()) return { result: { kind: 'ended' } };
    }
    const claim = { firstSendState: 'sending' as const, firstSendClaimedAt: nowIso, firstSendUnknownCause: null, updatedAt: nowIso };
    const activation = retry ? {} : { status: 'active' as const, confirmedHash: hash, confirmedAt: nowIso };
    const next: MatterDoc = { ...doc, ...activation, ...claim };
    const email = composeFirstEmail({ matter: next, matterId, domain: deps.domain, fromLocalPart: deps.fromLocalPart, ...(deps.random ? { random: deps.random } : {}) });
    // the send check runs before anything is claimed: a refused send changes nothing
    const decision = checkSend({ matter: next, to: email.to, cc: email.cc, now, enabled: deps.enabled, domain: deps.domain });
    if (!decision.ok) return { result: { kind: 'refused', reason: decision.reason } };
    return {
      result: { kind: 'send', doc: next, email },
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
    result = await deps.sender().send(email);
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
  await deps.store.addMessage(uid, matterId, message(at, 'sent', result.providerId), event('email_sent', at, contacts), {
    indexMessageId: true,
    patch: { firstSendState: 'sent', firstSentAt: at },
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
      patch: { status: 'cancelled', endedAt: nowIso, updatedAt: nowIso },
      events: [event('status_changed', nowIso, 'cancelled')],
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

export async function handleInboundEmail(
  payload: unknown,
  deps: Pick<MatterDeps, 'store' | 'now' | 'domain'> & { markerTtlDays: number },
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
  // never indexed: the Message-ID index holds only our own outgoing ids (a sender chooses theirs).
  // The marker is created in the same batch: a retry after a failed write is processed normally,
  // a retry after a successful one is a duplicate.
  const outcome = await deps.store.addInboundMessage(match.uid, match.matterId, toMatterMessage(email, nowIso), event('email_received', nowIso, sender), marker);
  if (outcome === 'duplicate') return 'duplicate';
  logger.info('matters.inbound_stored', { uid: match.uid, matterId: match.matterId });
  return 'stored';
}
