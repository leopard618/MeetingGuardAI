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
 * inbound       Postmark's inbound JSON -> the email attached to its matter (inbound.ts)
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
} from '../shared/aiContract';
import { UpstreamError } from '../assistant/errors';
import { safetyIdentifierFor, type LlmClient } from '../assistant/llm';
import { isValidTimeZone } from '../assistant/time';
import { draftMatter, type DraftResult } from './draft';
import { UNCERTAIN_SEND_KINDS, bareAddress, composeFirstEmail, EmailSendError, type EmailSender, type OutboundEmail } from './email';
import { matchInbound, parseInbound, toMatterMessage } from './inbound';
import { MATTER_LIMITS, draftHash, isOwnDomain, matterDocSchema, newReplyToken, type MatterDoc, type MatterEvent, type MatterMessage } from './model';
import { checkSend } from './sendCheck';
import type { MatterStore } from './store';
import { readBack, senderName } from './text';

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

/** The caller's email only when it is verified (it receives the copies). */
function verifiedEmail(caller: MatterCaller): string | null {
  if (!caller.email) return null;
  return caller.emailVerified || isTrustedSignInProvider(caller.signInProvider) ? caller.email : null;
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
  const ownerName = caller.name.trim().slice(0, MATTER_LIMITS.nameChars);
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
  await deps.store.createMatter(caller.uid, matterId, doc, event('created', nowIso));
  logger.info('matters.drafted', { uid: caller.uid, matterId, complete: doc.mandate !== null, questions: doc.questions.length });
  return draftView(matterId, doc, deps);
}

export async function handleMatterRevise(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDraftResponse> {
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
  const updated = await deps.store.updateMatter<MatterDoc | 'not_found' | 'not_draft'>(caller.uid, matterId, (doc) => {
    if (!doc) return { result: 'not_found' };
    if (doc.status !== 'draft') return { result: 'not_draft' };
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
  /** Nothing for this call to send: the first email went out, or its fate is unknown. */
  | { kind: 'settled'; outcome: MatterSendOutcome }
  /** This call claimed the send ('sending') and sends exactly this email. */
  | { kind: 'send'; doc: MatterDoc; email: OutboundEmail };

/**
 * Activates the confirmed draft and sends its first email, at most once.
 * The send is CLAIMED in the same transaction that activates the matter (firstSendState
 * 'sending'), so of two overlapping confirms only one sends; the other answers 'unknown'. After the
 * call to the provider the state becomes 'sent', 'failed' (a clear refusal: the same confirm may
 * claim it again) or 'unknown' (timeout and the like: never sent again automatically). A call that
 * dies after claiming leaves 'sending', which also never sends again.
 */
export async function handleMatterConfirm(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterConfirmResponse> {
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
      if (doc.firstSentAt || doc.firstSendState === 'sent') return { result: { kind: 'settled', outcome: 'sent' } };
      // only a clear refusal is claimed again; 'sending', 'unknown' and an active matter without
      // a state (written before firstSendState existed) may have gone out
      if (doc.firstSendState !== 'failed') return { result: { kind: 'settled', outcome: 'unknown' } };
    } else {
      if (doc.status !== 'draft' || !doc.mandate || !doc.firstEmail) return { result: { kind: 'stale' } };
      if (draftHash(doc.mandate, doc.firstEmail) !== hash) return { result: { kind: 'stale' } };
      if (Date.parse(doc.mandate.endsAt) <= now.getTime()) return { result: { kind: 'ended' } };
    }
    const claim = { firstSendState: 'sending' as const, firstSendClaimedAt: nowIso, updatedAt: nowIso };
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
  if (outcome.kind === 'settled') return { matterId, status: 'active', outcome: outcome.outcome };
  return { matterId, status: 'active', outcome: await sendFirstEmail(caller.uid, matterId, outcome.doc, outcome.email, deps) };
}

/** Sends the claimed first email and records the result on the matter. */
async function sendFirstEmail(uid: string, matterId: string, doc: MatterDoc, email: OutboundEmail, deps: MatterDeps): Promise<MatterSendOutcome> {
  const contacts = doc.mandate!.contacts.map((c) => c.name).join(', ');
  const message = (at: string, status: 'sent' | 'sending', providerId: string | null): MatterMessage => ({
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
  let providerId: string;
  try {
    ({ providerId } = await deps.sender().send(email));
  } catch (error) {
    if (!(error instanceof EmailSendError)) throw error; // the claim stays 'sending': never resent
    (error.kind === 'configuration' ? logger.error : logger.warn)('matters.send_failed', { uid, matterId, kind: error.kind, code: error.code });
    const at = deps.now().toISOString();
    if (UNCERTAIN_SEND_KINDS.has(error.kind)) {
      // it may have gone out: keep it, unconfirmed, with its Message-ID so a reply still threads
      await deps.store.addMessage(uid, matterId, message(at, 'sending', null), event('email_unconfirmed', at, contacts), {
        indexMessageId: true,
        patch: { firstSendState: 'unknown' },
      });
      return 'unknown';
    }
    await deps.store.updateMatter(uid, matterId, () => ({
      result: null,
      patch: { firstSendState: 'failed', firstSendClaimedAt: null, updatedAt: at },
      events: [event('email_failed', at, error.kind)],
    }));
    return 'failed';
  }
  const at = deps.now().toISOString();
  await deps.store.addMessage(uid, matterId, message(at, 'sent', providerId), event('email_sent', at, contacts), {
    indexMessageId: true,
    patch: { firstSendState: 'sent', firstSentAt: at },
  });
  logger.info('matters.first_email_sent', { uid, matterId });
  return 'sent';
}

// ---------------------------------------------------------------------------------------------
// matterCancel
// ---------------------------------------------------------------------------------------------

export async function handleMatterCancel(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterCancelResponse> {
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
  const expiresAt = new Date(now.getTime() + deps.markerTtlDays * 86_400_000).toISOString();
  if (!(await deps.store.claimInbound(email.providerId, nowIso, expiresAt))) return 'duplicate';
  try {
    const match = await matchInbound(email, deps.domain, deps.store);
    const matter = match ? await deps.store.getMatter(match.uid, match.matterId) : null;
    if (!match || !matter) {
      logger.info('matters.inbound_unmatched', { providerId: email.providerId });
      return 'unmatched';
    }
    const sender = email.from.name ? `${email.from.name} <${email.from.email}>` : email.from.email;
    // never indexed: the Message-ID index holds only our own outgoing ids (a sender chooses theirs)
    await deps.store.addMessage(match.uid, match.matterId, toMatterMessage(email, nowIso), event('email_received', nowIso, sender), { indexMessageId: false });
    logger.info('matters.inbound_stored', { uid: match.uid, matterId: match.matterId });
    return 'stored';
  } catch (error) {
    // let the provider's retry through (the webhook answers 500 for a thrown error)
    await deps.store.releaseInbound(email.providerId).catch(() => undefined);
    throw error;
  }
}
