/**
 * A2: replies, cards, follow-ups and bounces (docs/v1/ARCHITECTURE.md section 36), on the same
 * injected dependencies as handlers.ts, so they are tested without Firebase, OpenAI or Postmark.
 *
 * handleInboundRead  matterInboundRead (onDocumentCreated on a matter's messages): one model read
 *                    of a contact's reply; the code turns it into cards, proposed commitments, a
 *                    stop, or a reply draft (sent automatically only when everything allows it)
 * handleMatterDecide matterDecide: approve or decline a card (approving a reply_draft sends exactly
 *                    the hashed draft, claimed once like matterConfirm), accept or drop a commitment
 *                    (accept writes an ordinary task in the same transaction)
 * runMatterTick      matterTick (every 15 minutes): ends matters at their end date, sends due
 *                    follow-ups (a fixed template, in working hours, claimed once), retries stale
 *                    and failed reads
 * handleDeliveryEvent matterDeliveryEvents: Postmark's bounce and spam-complaint webhook
 * A3 scheduling     a reply that asks for times gets free times from the calendar (availability.ts),
 *                   in a fixed template; a reply that picks or proposes a time is read by code
 *                   (scheduling.ts), checked against the mandate and the calendar, then booked
 *                   (scheduling 'auto', a trusted sender, MATTERS_AUTO_SCHEDULE on) or turned into a
 *                   time_proposal card the owner books with one tap. bookSlot re-checks the calendar
 *                   right before booking; the meeting id comes from the matter and is created with
 *                   create() in the same transaction as matter.booking, so a matter books at most one
 *                   meeting and sends at most one confirmation, whatever is retried.
 *
 * Who may move a matter forward (decided by code, never by the model):
 * - a mandate contact: read by the model; an automatic reply only when the sender is trusted
 *   (mailCheck.ts), MATTERS_AUTO_REPLY is on, the content guard finds nothing and the caps allow;
 * - the owner's own address (any verdict): stored and shown, never acted on (the owner instructs
 *   only in the app, so a forged "it's me, send the contract" does nothing);
 * - anyone else: stored, one new_person card, never answered;
 * - an automatic reply (out of office, bulk): stored, never answered, never resets the clock;
 * - our own domain: ignored by the webhook.
 * Every send goes through checkSend with requireFirstSent (handlers.ts, sendCheck.ts).
 * Logs carry uid, matterId, categories and counts only.
 */
import * as logger from 'firebase-functions/logger';

import {
  matterDecideRequestSchema,
  matterViewRequestSchema,
  usageDayKey,
  type MatterApprovalReason,
  type MatterDecideResponse,
  type MatterSendOutcome,
  type MatterViewResponse,
} from '../shared/aiContract';
import { createHash } from 'node:crypto';

import { isValidTimeZone, toLocalDateTime } from '../shared/time';
import { UpstreamError } from '../assistant/errors';
import { safetyIdentifierFor } from '../assistant/llm';
import { buildCommitmentTaskDoc, defaultSchedule } from '../commitments/taskDoc';
import {
  BUDGET_CHARS_PER_UNIT,
  GlobalBudgetExhaustedError,
  acquireGlobalBudget,
  event,
  matterError,
  readable,
  recordUndeliverable,
  recordUsage,
  requireCaller,
  requireSignedIn,
  type MatterCaller,
  type MatterDeps,
} from './handlers';
import { INACTIVE_RECIPIENT_CODE, UNCERTAIN_SEND_KINDS, EmailSendError, composeMatterEmail, fromAddress, newMessageId, type OutboundEmail } from './email';
import { guardReply } from './guard';
import { threadSafeId } from './inbound';
import {
  MATTER_LIMITS,
  MAX_READ_ATTEMPTS,
  READ_STALE_MS,
  SENDING_WINDOW_MS,
  draftEmailHash,
  proposalIdFor,
  replyAddressFor,
  type DailyCounts,
  type MatterApproval,
  type MatterDoc,
  type MatterEvent,
  type MatterMessage,
  type MatterProposal,
  type MatterUsage,
  type Slot,
  type StoredMessage,
  withModelCall,
} from './model';
import { autoSendDecision, decideRead, parseAssessment, readDataChars, readRequest, type CardSpec, type ProposalSpec, type SchedulingIntent } from './read';
import { readClockTimes } from '../commitments/due';
import { allowedRanges, fitSlot, loadBusy, offerSlots, searchBounds, type SlotFit, type TimeRange } from './availability';
import { readRangeOf, resolvePick } from './scheduling';
import { followUpDueAt, inWorkingHours, nextActionAt, nextWorkingSlot } from './schedule';
import { checkSend } from './sendCheck';
import type { CardUpdate } from './store';
import { confirmationText, followUpText, formatInstant, matterTaskOrigin, meetingOrigin, meetingTitle, offerTimesText, quoteBelow, replySubject, senderName } from './text';

/** Per matter and UTC day (section 4.7 of the A2 plan). */
export const MATTER_CAPS = { readsPerDay: 10, autoRepliesPerDay: 3, exchangesPerDay: 6 } as const;
/** The default MATTERS_USER_DAILY_SENDS. */
export const DEFAULT_DAILY_SENDS = 30;
/** A refused or failed follow-up is looked at again after this long. */
const RETRY_LATER_MS = 60 * 60_000;
/** Messages of the thread the model sees (newest last; threadText cuts them to a budget). */
export const THREAD_MESSAGES = 30;

const iso = (ms: number) => new Date(ms).toISOString();

/** Today's counters of a matter (fresh ones on a new UTC day). */
export function countsFor(current: DailyCounts | null, dayKey: string): DailyCounts {
  return current && current.day === dayKey ? { ...current } : { day: dayKey, reads: 0, autoReplies: 0, exchanges: 0, capCard: false };
}

export function cardDoc(spec: Pick<MatterApproval, 'kind' | 'reason' | 'quote'> & Partial<MatterApproval>, nowIso: string): MatterApproval {
  return {
    status: 'pending',
    from: null,
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
    offers: [],
    ...spec,
    slot: spec.slot ?? null,
  };
}

function senderLabel(message: StoredMessage): string {
  return message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email;
}

/** The mandate contact an email came from (by its From address only). */
function contactOf(matter: MatterDoc, address: string) {
  const wanted = address.trim().toLowerCase();
  return matter.mandate?.contacts.find((c) => c.email.toLowerCase() === wanted) ?? null;
}

// ---------------------------------------------------------------------------------------------
// matterInboundRead
// ---------------------------------------------------------------------------------------------

export interface MessageRef {
  uid: string;
  matterId: string;
  messageId: string;
}

/**
 * Reads one stored inbound email (see the module comment). Idempotent: the read is claimed in a
 * transaction (readState 'reading'), so a trigger that fires twice reads once. A failed read is
 * marked 'failed' and matterTick retries it (retry: true), up to MAX_READ_ATTEMPTS in all; after
 * that the reply becomes an 'unclear' card.
 */
export async function handleInboundRead(ref: MessageRef, deps: MatterDeps, options: { retry?: boolean } = {}): Promise<string> {
  const { uid, matterId, messageId } = ref;
  const now = deps.now();
  const nowIso = now.toISOString();
  const claim = await deps.store.claimRead(uid, matterId, messageId, {
    nowIso,
    retry: options.retry === true,
    staleBeforeIso: iso(now.getTime() - READ_STALE_MS),
    maxAttempts: MAX_READ_ATTEMPTS,
  });
  if (claim.state === 'exhausted') return giveUp(ref, deps);
  if (claim.state !== 'claimed') return claim.state;
  try {
    return await readClaimed(ref, claim.message, deps);
  } catch (error) {
    const kind = error instanceof UpstreamError ? error.kind : error instanceof GlobalBudgetExhaustedError ? 'global_budget' : error instanceof Error ? error.name : 'unknown';
    logger.warn('matters.read_failed', { uid, matterId, kind, attempt: claim.attempts });
    if (claim.attempts >= MAX_READ_ATTEMPTS) return giveUp(ref, deps);
    // matterTick retries it once its queue entry is older than READ_STALE_MS
    await deps.store.updateMatter(uid, matterId, () => ({
      result: null,
      message: { id: messageId, patch: { readState: 'failed', readOutcome: 'failed' } },
      readQueue: { messageId, doc: { uid, matterId, messageId, claimedAt: nowIso, attempts: claim.attempts } },
    }));
    return 'failed';
  }
}

/** After the last attempt: an 'unclear' card, so the owner still sees the reply. */
async function giveUp(ref: MessageRef, deps: MatterDeps): Promise<string> {
  const nowIso = deps.now().toISOString();
  const message = await deps.store.getMessage(ref.uid, ref.matterId, ref.messageId);
  const cardId = deps.store.newDocId();
  await deps.store.updateMatter(ref.uid, ref.matterId, (doc) => ({
    result: null,
    message: { id: ref.messageId, patch: { readState: 'done', readOutcome: 'read_failed' } },
    readQueue: { messageId: ref.messageId, doc: null },
    ...(doc
      ? {
          patch: { pendingApprovals: doc.pendingApprovals + 1, updatedAt: nowIso },
          cards: [{ id: cardId, doc: cardDoc({ kind: 'unclear', reason: 'read_failed', quote: null, from: message ? senderLabel(message) : null, sourceMessageId: ref.messageId }, nowIso) }],
          events: [event('approval_requested', nowIso, 'unclear')],
        }
      : {}),
  }));
  logger.error('matters.read_given_up', { uid: ref.uid, matterId: ref.matterId });
  return 'read_failed';
}

/** Marks the message finished without a model read (and, optionally, adds cards). */
async function finishWithout(ref: MessageRef, deps: MatterDeps, outcome: string, state: 'done' | 'skipped', cards: CardSpec[] = [], from: string | null = null): Promise<string> {
  const nowIso = deps.now().toISOString();
  const ids = cards.map(() => deps.store.newDocId());
  await deps.store.updateMatter(ref.uid, ref.matterId, (doc) => ({
    result: null,
    message: { id: ref.messageId, patch: { readState: state, readOutcome: outcome } },
    readQueue: { messageId: ref.messageId, doc: null },
    ...(doc && cards.length
      ? {
          patch: { pendingApprovals: doc.pendingApprovals + cards.length, updatedAt: nowIso },
          cards: cards.map((spec, i) => ({ id: ids[i]!, doc: cardDoc({ ...spec, slot: spec.slot ?? null, from, sourceMessageId: ref.messageId }, nowIso) })),
          events: cards.map((spec) => event('approval_requested', nowIso, spec.kind)),
        }
      : { events: [event('reply_not_acted_on', nowIso, outcome)] }),
  }));
  logger.info('matters.read_skipped', { uid: ref.uid, matterId: ref.matterId, outcome });
  return outcome;
}

async function readClaimed(ref: MessageRef, message: StoredMessage, deps: MatterDeps): Promise<string> {
  const { uid, matterId, messageId } = ref;
  const now = deps.now();
  const nowIso = now.toISOString();
  const matter = await deps.store.getMatter(uid, matterId);
  if (!matter || matter.status !== 'active' || !matter.mandate) return finishWithout(ref, deps, 'not_active', 'skipped');
  if (message.autoReply) return finishWithout(ref, deps, 'auto_reply', 'skipped');
  if (message.senderRole === 'owner') return finishWithout(ref, deps, 'owner', 'skipped');
  const contact = message.senderRole === 'contact' ? contactOf(matter, message.from.email) : null;
  if (!contact) return finishWithout(ref, deps, 'new_person', 'done', [{ kind: 'new_person', reason: 'new_person', quote: null }], senderLabel(message));

  // a newer email of the contact: older reply drafts are out of context
  await deps.store.expireReplyDrafts(uid, matterId, nowIso);

  // the day's caps, counted in a transaction: model reads per matter, and a loop guard
  const dayKey = usageDayKey(now);
  const capCardId = deps.store.newDocId();
  const gate = await deps.store.updateMatter<'ok' | 'capped' | 'loop' | 'gone'>(uid, matterId, (doc) => {
    if (!doc || doc.status !== 'active') return { result: 'gone' };
    const counts = countsFor(doc.dailyCounts, dayKey);
    counts.exchanges += 1;
    const blocked = counts.exchanges > MATTER_CAPS.exchangesPerDay ? 'loop' : counts.reads >= MATTER_CAPS.readsPerDay ? 'capped' : null;
    if (!blocked) {
      counts.reads += 1;
      return { result: 'ok', patch: { dailyCounts: counts } };
    }
    // one card a day says it; the replies are kept, unread
    const first = !counts.capCard;
    counts.capCard = true;
    return {
      result: blocked,
      patch: { dailyCounts: counts, ...(first ? { pendingApprovals: doc.pendingApprovals + 1 } : {}) },
      ...(first
        ? {
            cards: [{ id: capCardId, doc: cardDoc({ kind: 'many_replies', reason: blocked === 'loop' ? 'loop' : 'cap_reached', quote: null, sourceMessageId: messageId }, nowIso) }],
            events: [event('approval_requested', nowIso, 'many_replies')],
          }
        : {}),
    };
  });
  if (gate === 'gone') return finishWithout(ref, deps, 'not_active', 'skipped');
  if (gate !== 'ok') return finishWithout(ref, deps, gate, 'done');

  const thread = (await deps.store.listMessages(uid, matterId, THREAD_MESSAGES)).filter((m) => m.id !== messageId);
  const request = readRequest({ matter, thread, newEmail: message, contactName: contact.name, now }, safetyIdentifierFor(uid));
  await acquireGlobalBudget(deps, readDataChars(request.messages), BUDGET_CHARS_PER_UNIT);
  const completion = await deps.llm().complete(request);
  await recordUsage(deps, completion.usage, uid);
  const call = completion.toolCalls.find((c) => c.name === 'assess_reply');
  let args: unknown = null;
  if (call) {
    try {
      args = JSON.parse(call.arguments);
    } catch {
      args = null;
    }
  }
  const decision = decideRead({ assessment: parseAssessment(args), matter, email: message, contactName: contact.name });

  // a reply draft: composed, guarded and checked by code
  let reply: { card: MatterApproval; cardId: string; auto: boolean } | null = null;
  if (decision.replyBody) {
    reply = await prepareReply({ uid, matterId, messageId, matter, message, contactEmail: contact.email, body: decision.replyBody, deps, dayKey });
  }
  // A3: the calendar. Free times go out like a reply draft (the same card, caps and send check);
  // a time to book is booked after this read is finished and stored (bookSlot)
  let toBook: Slot | null = null;
  if (decision.scheduling) {
    const plan = await planScheduling({ uid, matterId, messageId, matter, message, contact, intent: decision.scheduling, deps, dayKey });
    if (plan.kind === 'offer') reply = plan.reply;
    else if (plan.kind === 'card') decision.cards.push(plan.card);
    else toBook = plan.slot;
  }

  const cardIds = decision.cards.map(() => deps.store.newDocId());
  const from = senderLabel(message);
  const finished = await deps.store.updateMatter<'finished' | 'gone'>(uid, matterId, (doc) => {
    const done = { message: { id: messageId, patch: { readState: 'done' as const, readOutcome: decision.outcome } }, readQueue: { messageId, doc: null } };
    if (!doc || doc.status !== 'active') return { result: 'gone', ...done };
    const cards: { id: string; doc: MatterApproval }[] = decision.cards.map((spec, i) => ({ id: cardIds[i]!, doc: cardDoc({ ...spec, slot: spec.slot ?? null, from, sourceMessageId: messageId }, nowIso) }));
    if (reply) cards.push({ id: reply.cardId, doc: reply.card });
    const proposals = decision.proposals.map((spec, i) => ({ id: proposalIdFor(matterId, messageId, i), doc: proposalDoc(spec, messageId, nowIso) }));
    const pending = cards.filter((c) => c.doc.status === 'pending').length;
    const events: MatterEvent[] = [event('reply_read', nowIso, decision.outcome)];
    if (proposals.length) events.push(event('commitment_proposed', nowIso, String(proposals.length)));
    if (reply && reply.card.offers.length) events.push(event('times_offered', nowIso, String(reply.card.offers.length)));
    for (const card of cards) if (card.doc.status === 'pending') events.push(event('approval_requested', nowIso, card.doc.kind));
    // A3: the read's model call counts on the matter's usage (its cost)
    const patch: Partial<MatterDoc> = { pendingApprovals: doc.pendingApprovals + pending, updatedAt: nowIso, usage: withModelCall(doc.usage, completion.usage) };
    if (reply?.auto) {
      const counts = countsFor(doc.dailyCounts, dayKey);
      counts.autoReplies += 1;
      patch.dailyCounts = counts;
    }
    if (decision.stop) {
      Object.assign(patch, { status: 'done', stopReason: 'contact_asked', endedAt: nowIso, followUpClaim: null });
      events.push(event('status_changed', nowIso, 'contact_asked'));
    }
    return { result: 'finished', ...done, patch, cards, proposals, events, ...(decision.stop ? { schedule: { nextActionAt: null } } : {}) };
  });
  logger.info('matters.reply_read', {
    uid,
    matterId,
    outcome: decision.outcome,
    cards: decision.cards.length + (reply ? 1 : 0),
    proposals: decision.proposals.length,
    modelCommitments: decision.modelCommitments,
    auto: reply?.auto ?? false,
    stop: decision.stop,
    scheduling: decision.scheduling?.kind ?? null,
    book: toBook !== null,
  });
  if (finished === 'finished' && reply?.auto) {
    // the read is finished and stored: whatever happens now must never make it read (and answer)
    // again, so a failure here is logged and the card keeps its claim (never sent twice)
    try {
      const fresh = await deps.store.getMatter(uid, matterId);
      if (fresh) await sendCard(uid, matterId, reply.cardId, reply.card, fresh, deps);
    } catch (error) {
      logger.error('matters.auto_reply_record_failed', { uid, matterId, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  if (finished === 'finished' && toBook) {
    // the same rule: the read is stored, so a failed booking is a card, never a second read
    let booked: BookResult;
    try {
      booked = await bookSlot({ uid, matterId, slot: toBook, by: 'auto', contactEmail: contact.email, deps });
    } catch (error) {
      logger.error('matters.auto_booking_failed', { uid, matterId, errorName: error instanceof Error ? error.name : 'unknown' });
      booked = 'failed';
    }
    if (booked !== 'booked' && booked !== 'already') await bookingCard(uid, matterId, messageId, toBook, booked, from, deps);
  }
  return decision.outcome;
}

// ---------------------------------------------------------------------------------------------
// A3: scheduling
// ---------------------------------------------------------------------------------------------

type SchedulePlan =
  | { kind: 'offer'; reply: { card: MatterApproval; cardId: string; auto: boolean } }
  | { kind: 'card'; card: CardSpec }
  | { kind: 'book'; slot: Slot };

/** Whether this matter may book (and offer) on its own right now. */
function autoScheduling(matter: MatterDoc, deps: MatterDeps): boolean {
  return matter.scheduling === 'auto' && deps.autoSchedule === true;
}

/** What a reply that asks for times, or picks one, leads to (see the module comment). */
async function planScheduling(input: {
  uid: string;
  matterId: string;
  messageId: string;
  matter: MatterDoc;
  message: StoredMessage;
  contact: { name: string; email: string };
  intent: SchedulingIntent;
  deps: MatterDeps;
  dayKey: string;
}): Promise<SchedulePlan> {
  const { matter, message, deps, intent } = input;
  const mandate = matter.mandate!;
  const meeting = mandate.meeting!;
  const zone = mandate.timeZone;
  const quote = intent.kind === 'pick' ? intent.quote : null;
  if (!deps.meetings) return { kind: 'card', card: { kind: 'time_proposal', reason: 'no_free_time', quote } };
  const now = deps.now();
  const { fromMs, toMs } = searchBounds(now, mandate.endsAt);
  const busy = await loadBusy(deps.meetings, input.uid, fromMs, toMs);
  const allowed = allowedRanges(meeting, zone, fromMs, toMs);
  // free times to offer, kept to when the contact would like to meet (readRange), if they said
  const offer = async (range: TimeRange | null): Promise<SchedulePlan> => {
    const { slots, nearest } = offerSlots({ busy, allowed, durationMinutes: meeting.durationMinutes, zone, count: MATTER_LIMITS.maxOfferedSlots, range, fromMs, toMs });
    if (slots.length === 0) return { kind: 'card', card: { kind: 'time_proposal', reason: 'no_free_time', quote: null } };
    const body = offerTimesText({ contactName: input.contact.name, ownerName: matter.ownerName, slots, durationMinutes: meeting.durationMinutes, timeZone: zone, language: mandate.language, nearest });
    const reply = await prepareReply({ ...input, contactEmail: input.contact.email, body, autoAllowed: autoScheduling(matter, deps), offers: slots });
    return { kind: 'offer', reply };
  };
  if (intent.kind === 'offer') return offer(readRangeOf([intent.words, intent.quote], message.at, zone));
  const slot = resolvePick({ words: intent.words, choice: intent.choice, offered: matter.offeredSlots, emailAt: message.at, zone, durationMinutes: meeting.durationMinutes });
  if (!slot) {
    // a day without a clock time ("Tuesday works", "next week is fine"): free times that day
    const texts = [intent.words, intent.quote];
    const noClock = texts.every((text) => !text || readClockTimes(text).length === 0);
    const range = intent.choice === null && !matter.booking && noClock ? readRangeOf(texts, message.at, zone) : null;
    if (range) return offer(range);
    return { kind: 'card', card: { kind: 'time_proposal', reason: 'unclear_time', quote } };
  }
  if (matter.booking) return { kind: 'card', card: { kind: 'time_proposal', reason: 'other', quote, slot } };
  const fit = fitSlot(slot, { busy, allowed, fromMs, endsAtMs: Date.parse(mandate.endsAt) });
  if (fit !== 'ok') return { kind: 'card', card: { kind: 'time_proposal', reason: fit, quote, slot } };
  if (!autoScheduling(matter, deps)) return { kind: 'card', card: { kind: 'time_proposal', reason: 'ask_before_booking', quote, slot } };
  if (message.auth?.verdict !== 'trusted') return { kind: 'card', card: { kind: 'time_proposal', reason: 'unverified_sender', quote, slot } };
  return { kind: 'book', slot };
}

export type BookResult = 'booked' | 'already' | 'not_active' | 'no_calendar' | 'failed' | Exclude<SlotFit, 'ok'>;

/** The card when an automatic booking could not happen: the owner sees the time and decides. */
async function bookingCard(uid: string, matterId: string, messageId: string, slot: Slot, result: BookResult, from: string, deps: MatterDeps): Promise<void> {
  const nowIso = deps.now().toISOString();
  const reason: MatterApprovalReason = result === 'slot_busy' || result === 'after_end' || result === 'outside_windows' ? result : 'other';
  const cardId = deps.store.newDocId();
  await deps.store.updateMatter(uid, matterId, (doc) => {
    if (!doc || doc.status !== 'active') return { result: null };
    return {
      result: null,
      patch: { pendingApprovals: doc.pendingApprovals + 1, updatedAt: nowIso },
      cards: [{ id: cardId, doc: cardDoc({ kind: 'time_proposal', reason, quote: null, slot, from, sourceMessageId: messageId }, nowIso) }],
      events: [event('booking_refused', nowIso, result), event('approval_requested', nowIso, 'time_proposal')],
    };
  });
}

/** The booked meeting's id: one per matter, so a retried booking can never create a second one. */
export function meetingIdFor(matterId: string): string {
  return `mtm_${createHash('sha256').update(`${matterId}:meeting`).digest('hex').slice(0, 24)}`;
}

/**
 * The source of a booked meeting. 'ai_chat' is one the rules and the app already accept, so the
 * owner can edit or move the meeting like any other; an own 'assistant' source needs a rules
 * deploy first.
 */
export const BOOKED_MEETING_SOURCE = 'ai_chat';

const DAY_MS = 86_400_000;

/**
 * Books one time for the matter (A3): re-reads the matter and the calendar right before booking,
 * then, in ONE transaction, creates the meeting (create(): never a second one), links the matter's
 * accepted tasks to it, sets matter.booking, and adds the confirmation email (claimed, so sent once)
 * and a goal_reached card. 'auto' keeps the mandate's windows and bounds; 'owner' (the owner
 * approved a time_proposal card) only needs the time to be free and in the future.
 * pushPending: the app pushes the meeting to Google Calendar and Outlook (ARCHITECTURE section 32).
 */
export async function bookSlot(input: { uid: string; matterId: string; slot: Slot; by: 'auto' | 'owner'; contactEmail: string | null; deps: MatterDeps }): Promise<BookResult> {
  const { uid, matterId, slot, by, deps } = input;
  const now = deps.now();
  const nowIso = now.toISOString();
  const matter = await deps.store.getMatter(uid, matterId);
  const mandate = matter?.mandate;
  if (!matter || matter.status !== 'active' || !mandate?.meeting) return 'not_active';
  if (matter.booking) return 'already';
  if (!deps.meetings) return 'no_calendar';
  const zone = mandate.timeZone;
  const start = Date.parse(slot.start);
  const end = Date.parse(slot.end);
  // the calendar again, right before booking (it may have changed since the reply was read)
  const busy = await loadBusy(deps.meetings, uid, start - DAY_MS, end + DAY_MS);
  const fit =
    by === 'auto'
      ? (() => {
          const { fromMs } = searchBounds(now, mandate.endsAt);
          const endsAtMs = Date.parse(mandate.endsAt);
          return fitSlot(slot, { busy, allowed: allowedRanges(mandate.meeting!, zone, fromMs, endsAtMs), fromMs, endsAtMs });
        })()
      : fitSlot(slot, { busy, allowed: [{ start: now.getTime(), end: Number.MAX_SAFE_INTEGER }], fromMs: now.getTime(), endsAtMs: Number.MAX_SAFE_INTEGER });
  if (fit !== 'ok') return fit;

  const wanted = input.contactEmail?.trim().toLowerCase() ?? '';
  const contact = mandate.contacts.find((c) => c.email.toLowerCase() === wanted) ?? mandate.contacts[0]!;
  const meetingId = meetingIdFor(matterId);
  const local = toLocalDateTime(new Date(start), zone);
  const meeting: Record<string, unknown> = {
    userId: uid,
    title: meetingTitle(matter.title, contact.name),
    description: meetingOrigin({ title: matter.title, contactName: contact.name, language: matter.language }),
    startAt: new Date(start).toISOString(),
    durationMinutes: Math.max(1, Math.round((end - start) / 60_000)),
    timezone: zone,
    allDay: false,
    date: local.date,
    time: local.time,
    location: null,
    conference: null,
    participants: [{ email: contact.email.toLowerCase(), name: contact.name, status: null }],
    source: BOOKED_MEETING_SOURCE,
    confidence: null,
    language: matter.language,
    preparationTips: [],
    customAlertTimes: null,
    alertIntensity: null,
    notes: null,
    status: 'scheduled',
    external: {},
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    pushPending: true,
  };

  // the confirmation: a fixed template, threaded under the contact's last email, through the send check
  const thread = await deps.store.listMessages(uid, matterId, THREAD_MESSAGES);
  const theirs = [...thread].reverse().find((m) => m.direction === 'inbound' && m.senderRole === 'contact') ?? null;
  const theirId = theirs ? threadSafeId(theirs.rfcMessageId) : null;
  const references = theirs ? [...new Set([...theirs.references.map(threadSafeId).filter((id): id is string => id !== null), ...(theirId ? [theirId] : [])])].slice(-20) : [];
  const threading = { inReplyTo: theirId, references };
  const to = [contact.email];
  const cc = mandate.copyOwner === 'cc' && matter.ownerEmail ? [matter.ownerEmail] : [];
  const composed = composeMatterEmail({
    matter,
    matterId,
    uid,
    domain: deps.domain,
    fromLocalPart: deps.fromLocalPart,
    to,
    cc,
    subject: replySubject(theirs?.subject || matter.firstEmail?.subject || matter.title),
    body: confirmationText({ contactName: contact.name, ownerName: matter.ownerName, slot: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, timeZone: zone, language: mandate.language }),
    inReplyTo: threading.inReplyTo,
    references: threading.references,
  });
  const draft = { to, cc, subject: composed.subject.slice(0, MATTER_LIMITS.subjectChars), text: composed.text.slice(0, MATTER_LIMITS.bodyChars) };
  const check = checkSend({ matter, to, cc, now, enabled: deps.enabled, domain: deps.domain, requireFirstSent: true });
  const claim = check.ok && (await deps.store.consumeDailySend(uid, usageDayKey(now), deps.dailySendLimit ?? DEFAULT_DAILY_SENDS, nowIso));
  const confirmId = deps.store.newDocId();
  const confirmation = cardDoc(
    {
      kind: 'reply_draft',
      status: claim ? 'approved' : 'pending',
      reason: claim ? null : check.ok ? 'cap_reached' : 'other',
      quote: null,
      from: `${contact.name} <${contact.email}>`,
      draft,
      draftHash: draftEmailHash(draft, threading),
      threading,
      auto: claim && by === 'auto',
      sendState: claim ? 'sending' : 'none',
      sendClaimedAt: claim ? nowIso : null,
      decidedAt: claim ? nowIso : null,
      sourceMessageId: null,
    },
    nowIso,
  );
  const goalId = deps.store.newDocId();
  const goal = cardDoc({ kind: 'goal_reached', reason: null, quote: null, from: null }, nowIso);
  const accepted = await deps.store.listProposals(uid, matterId, 'accepted');
  const taskIds = accepted.map((p) => p.doc.taskId).filter((id): id is string => typeof id === 'string');

  const outcome = await deps.store.bookMeeting<'booked' | 'already' | 'not_active'>(uid, matterId, { meetingId, meeting, taskIds }, (doc, exists, existingTasks) => {
    if (!doc || doc.status !== 'active') return { result: 'not_active' };
    if (doc.booking || exists) return { result: 'already' };
    const booking = { meetingId, start: new Date(start).toISOString(), end: new Date(end).toISOString(), bookedAt: nowIso, by };
    const next: MatterDoc = { ...doc, booking };
    return {
      result: 'booked',
      createMeeting: true,
      linkTasks: [...existingTasks],
      patch: { booking, offeredSlots: [], pendingApprovals: doc.pendingApprovals + 1 + (claim ? 0 : 1), updatedAt: nowIso },
      events: [event('meeting_booked', nowIso, `${formatInstant(booking.start, zone, matter.language)} (${zone})`)],
      cards: [
        { id: confirmId, doc: confirmation },
        { id: goalId, doc: goal },
      ],
      schedule: { nextActionAt: nextActionAt(next) },
    };
  });
  if (outcome !== 'booked') return outcome;
  logger.info('matters.meeting_booked', { uid, matterId, by, confirmation: claim });
  if (claim) {
    try {
      const fresh = await deps.store.getMatter(uid, matterId);
      if (fresh) await sendCard(uid, matterId, confirmId, confirmation, fresh, deps);
    } catch (error) {
      // the claim stays 'sending': never sent twice
      logger.error('matters.confirmation_record_failed', { uid, matterId, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return 'booked';
}

function proposalDoc(spec: ProposalSpec, messageId: string, nowIso: string): MatterProposal {
  return {
    quote: spec.quote,
    title: spec.title,
    owner: spec.owner,
    due: spec.due,
    status: 'open',
    taskId: null,
    sourceMessageId: messageId,
    createdAt: nowIso,
    updatedAt: nowIso,
    decidedAt: null,
  };
}

/** The draft as it would be sent: To the contact's mandate address only (never the inbound Reply-To). */
async function prepareReply(input: {
  uid: string;
  matterId: string;
  messageId: string;
  matter: MatterDoc;
  message: StoredMessage;
  contactEmail: string;
  body: string;
  deps: MatterDeps;
  dayKey: string;
  /** A3: whether this draft may go out on its own at all (default MATTERS_AUTO_REPLY). */
  autoAllowed?: boolean;
  /** A3: the free times this draft offers. */
  offers?: Slot[];
}): Promise<{ card: MatterApproval; cardId: string; auto: boolean }> {
  const { matter, message, deps } = input;
  const mandate = matter.mandate!;
  const nowIso = deps.now().toISOString();
  const to = [input.contactEmail];
  const cc = mandate.copyOwner === 'cc' && matter.ownerEmail ? [matter.ownerEmail] : [];
  const theirId = threadSafeId(message.rfcMessageId);
  const references = [...new Set([...message.references.map(threadSafeId).filter((id): id is string => id !== null), ...(theirId ? [theirId] : [])])].slice(-20);
  const threading = { inReplyTo: theirId, references };
  const composed = composeMatterEmail({
    matter,
    matterId: input.matterId,
    uid: input.uid,
    domain: deps.domain,
    fromLocalPart: deps.fromLocalPart,
    to,
    cc,
    subject: replySubject(message.subject || matter.firstEmail?.subject || matter.title),
    body: input.body.slice(0, MATTER_LIMITS.replyChars * 2),
    inReplyTo: threading.inReplyTo,
    references: threading.references,
  });
  const draft = { to, cc, subject: composed.subject.slice(0, MATTER_LIMITS.subjectChars), text: composed.text.slice(0, MATTER_LIMITS.bodyChars) };
  const guardFlags = guardReply({ text: input.body, allowedAddresses: [...mandate.contacts.map((c) => c.email), ...(matter.ownerEmail ? [matter.ownerEmail] : [])] });
  const check = checkSend({ matter, to, cc, now: deps.now(), enabled: deps.enabled, domain: deps.domain, requireFirstSent: true });
  const counts = countsFor(matter.dailyCounts, input.dayKey);
  let decision = autoSendDecision({
    autoReplyEnabled: input.autoAllowed ?? deps.autoReply === true,
    verdict: message.auth?.verdict ?? null,
    guardFlags,
    autoRepliesLeft: MATTER_CAPS.autoRepliesPerDay - counts.autoReplies,
  });
  if (decision.auto && !check.ok) decision = { auto: false, reason: 'other' };
  // the per-user send cap is spent only for a send that will happen
  if (decision.auto && !(await deps.store.consumeDailySend(input.uid, input.dayKey, deps.dailySendLimit ?? DEFAULT_DAILY_SENDS, nowIso))) {
    decision = { auto: false, reason: 'cap_reached' };
  }
  const auto = decision.auto;
  const card = cardDoc(
    {
      kind: 'reply_draft',
      status: auto ? 'approved' : 'pending',
      reason: auto ? null : (decision as { reason: MatterApprovalReason }).reason,
      quote: null,
      from: senderLabel(message),
      draft,
      draftHash: draftEmailHash(draft, threading),
      threading,
      guardFlags,
      auto,
      sendState: auto ? 'sending' : 'none',
      sendClaimedAt: auto ? nowIso : null,
      decidedAt: auto ? nowIso : null,
      sourceMessageId: input.messageId,
      offers: input.offers ?? [],
    },
    nowIso,
  );
  return { card, cardId: deps.store.newDocId(), auto };
}

/** The outbound email of an approved reply_draft card: exactly its draft, with a new Message-ID. */
function cardEmail(uid: string, matterId: string, card: MatterApproval, matter: MatterDoc, deps: MatterDeps): OutboundEmail {
  const language = matter.mandate!.language;
  return {
    from: `"${senderName(matter.ownerName, language)}" <${fromAddress(deps.domain, deps.fromLocalPart)}>`,
    to: card.draft!.to,
    cc: card.draft!.cc,
    replyTo: replyAddressFor(matter.replyToken, deps.domain),
    subject: card.draft!.subject,
    text: card.draft!.text,
    messageId: newMessageId(matterId, deps.domain, deps.random),
    inReplyTo: card.threading?.inReplyTo ?? null,
    references: card.threading?.references ?? [],
    metadata: { matterId, uid },
  };
}

function outboundMessage(email: OutboundEmail, at: string, status: 'sent' | 'sending' | 'test', providerId: string | null, ownerName: string, language: 'en' | 'es'): MatterMessage {
  return {
    direction: 'outbound',
    status,
    rfcMessageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references.slice(-MATTER_LIMITS.maxReferences),
    from: { name: senderName(ownerName, language), email: email.from.replace(/^.*<([^>]+)>$/, '$1') },
    to: email.to,
    cc: email.cc,
    subject: email.subject.slice(0, MATTER_LIMITS.subjectChars),
    text: email.text.slice(0, MATTER_LIMITS.bodyChars),
    at,
    providerId,
    auth: null,
  };
}

/** A3: an email that offers free times makes them the matter's offered times once it goes out. */
function offered(card: MatterApproval): Partial<MatterDoc> {
  return card.offers.length ? { offeredSlots: card.offers } : {};
}

/**
 * Sends a claimed reply_draft card (sendState 'sending') and records the result: 'sent' (the
 * follow-up clock restarts), 'unknown' (it may have gone out: never resent), 'failed' (a clear
 * refusal: the owner may approve again).
 */
export async function sendCard(uid: string, matterId: string, cardId: string, card: MatterApproval, matter: MatterDoc, deps: MatterDeps): Promise<MatterSendOutcome> {
  const email = cardEmail(uid, matterId, card, matter, deps);
  const language = matter.mandate!.language;
  const contacts = email.to.join(', ');
  let result: { providerId: string; test?: boolean };
  try {
    result = await deps.sender().send(email);
  } catch (error) {
    if (!(error instanceof EmailSendError)) throw error; // the claim stays 'sending': never resent
    (error.kind === 'configuration' ? logger.error : logger.warn)('matters.reply_send_failed', { uid, matterId, kind: error.kind, code: error.code });
    const at = deps.now().toISOString();
    if (UNCERTAIN_SEND_KINDS.has(error.kind)) {
      await deps.store.addMessage(uid, matterId, outboundMessage(email, at, 'sending', null, matter.ownerName, language), event('email_unconfirmed', at, contacts), {
        indexMessageId: true,
        patch: { lastOutboundAt: at, ...offered(card) },
        card: { id: cardId, patch: { sendState: 'unknown', sendOutcome: 'unknown' } },
        schedule: { nextActionAt: nextActionAt({ ...matter, lastOutboundAt: at }) },
      });
      if (error.code === INACTIVE_RECIPIENT_CODE && email.to.length === 1) await recordUndeliverable(deps, uid, matterId, email.to, 'inactive');
      return 'unknown';
    }
    await deps.store.updateCard(uid, matterId, cardId, () => ({
      result: null,
      card: { sendState: 'failed', sendOutcome: 'failed', sendClaimedAt: null, updatedAt: at },
      events: [event('email_failed', at, error.kind)],
    }));
    return 'failed';
  }
  const at = deps.now().toISOString();
  const status = result.test ? 'test' : 'sent';
  await deps.store.addMessage(uid, matterId, outboundMessage(email, at, status, result.providerId, matter.ownerName, language), event('reply_sent', at, contacts), {
    indexMessageId: true,
    patch: { lastOutboundAt: at, ...offered(card) },
    card: { id: cardId, patch: { sendState: 'sent', sendOutcome: 'sent' } },
    schedule: { nextActionAt: nextActionAt({ ...matter, lastOutboundAt: at }) },
  });
  logger.info('matters.reply_sent', { uid, matterId, auto: card.auto });
  return 'sent';
}

// ---------------------------------------------------------------------------------------------
// matterDecide
// ---------------------------------------------------------------------------------------------

/** time_proposal reasons whose approval books the time (slot_busy, no_meeting and the rest are information). */
const BOOKABLE_ON_APPROVE = new Set<MatterApproval['reason']>(['ask_before_booking', 'unverified_sender', 'outside_windows', 'after_end', null]);

type CardOutcome =
  | { kind: 'not_found' }
  | { kind: 'stale' }
  | { kind: 'invalid'; message: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'done'; status: MatterApproval['status']; outcome: MatterSendOutcome | null; matterStatus: MatterDoc['status'] }
  | { kind: 'send'; card: MatterApproval; matter: MatterDoc };

/** Where an approved reply_draft stands when this call does not send it. */
function settledCard(card: MatterApproval, now: Date): MatterSendOutcome | null {
  if (card.sendState === 'sent') return 'sent';
  if (card.sendState === 'unknown') return 'unknown';
  if (card.sendState === 'sending') {
    const claimed = card.sendClaimedAt ? Date.parse(card.sendClaimedAt) : NaN;
    return Number.isFinite(claimed) && now.getTime() - claimed < SENDING_WINDOW_MS ? 'sending' : 'unknown';
  }
  return null; // 'none' or 'failed': this call claims it
}

export function handleMatterDecide(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDecideResponse> {
  return readable(() => decide(callerIn, data, deps));
}

async function decide(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDecideResponse> {
  const parsed = matterDecideRequestSchema.safeParse(data);
  // declining a card and dropping a commitment only need a signed-in owner (like cancel)
  const gentle = parsed.success && (parsed.data.action === 'decline' || parsed.data.action === 'drop');
  const caller = gentle ? requireSignedIn(callerIn) : requireCaller(callerIn, deps);
  if (!parsed.success) throw matterError('invalid_request');
  const request = parsed.data;
  if (request.target === 'proposal') {
    if (request.action !== 'accept' && request.action !== 'drop') throw matterError('invalid_request');
    return decideProposal(caller, request, deps);
  }
  if (request.action !== 'approve' && request.action !== 'decline') throw matterError('invalid_request');
  return decideCard(caller, request, deps);
}

async function decideCard(
  caller: MatterCaller,
  request: { matterId: string; id: string; action: string; draftHash?: string | undefined },
  deps: MatterDeps,
): Promise<MatterDecideResponse> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const { matterId, id } = request;
  const approve = request.action === 'approve';
  if (approve) {
    // A3: approving a time_proposal card with a bookable time books it first (bookSlot re-checks
    // the calendar); the card is marked approved below only when the meeting is booked
    const peek = await deps.store.getCard(caller.uid, matterId, id);
    if (peek && peek.kind === 'time_proposal' && peek.status === 'pending' && peek.slot && BOOKABLE_ON_APPROVE.has(peek.reason)) {
      const contactEmail = peek.from?.match(/<([^>]+)>$/)?.[1] ?? peek.from;
      const booked = await bookSlot({ uid: caller.uid, matterId, slot: peek.slot, by: 'owner', contactEmail, deps });
      if (booked === 'slot_busy') throw matterError('not_allowed', 'This time is no longer free in your calendar.');
      if (booked === 'not_active') throw matterError('not_allowed', 'This matter is not active.');
      if (booked !== 'booked' && booked !== 'already') throw matterError('not_allowed', 'This time cannot be booked.');
    }
  }
  const outcome = await deps.store.updateCard<CardOutcome>(caller.uid, matterId, id, (matter, card): CardUpdate<CardOutcome> => {
    if (!matter || !card) return { result: { kind: 'not_found' } };
    const done = (status: MatterApproval['status'], sendOutcome: MatterSendOutcome | null = null, matterStatus = matter.status): CardOutcome => ({ kind: 'done', status, outcome: sendOutcome, matterStatus });
    const leavesPending = card.status === 'pending' ? { pendingApprovals: Math.max(0, matter.pendingApprovals - 1), updatedAt: nowIso } : undefined;
    if (!approve) {
      if (card.status !== 'pending') return { result: done(card.status, card.sendOutcome) };
      return { result: done('declined'), card: { status: 'declined', decidedAt: nowIso, updatedAt: nowIso }, patch: leavesPending, events: [event('approval_decided', nowIso, `${card.kind} declined`)] };
    }
    if (card.kind === 'reply_draft') {
      if (card.status === 'expired') return { result: { kind: 'stale' } };
      if (card.status === 'declined') return { result: { kind: 'invalid', message: 'This reply was declined.' } };
      if (card.status === 'approved') {
        const settled = settledCard(card, now);
        if (settled) return { result: done('approved', settled) };
      } else if (!request.draftHash || request.draftHash !== card.draftHash) {
        return { result: { kind: 'stale' } };
      }
      if (!card.draft) return { result: { kind: 'invalid', message: 'This card has no draft.' } };
      const check = checkSend({ matter, to: card.draft.to, cc: card.draft.cc, now, enabled: deps.enabled, domain: deps.domain, requireFirstSent: true });
      if (!check.ok) return { result: { kind: 'refused', reason: check.reason } };
      const claimed: MatterApproval = { ...card, status: 'approved', sendState: 'sending', sendClaimedAt: nowIso, decidedAt: card.decidedAt ?? nowIso, updatedAt: nowIso };
      return {
        result: { kind: 'send', card: claimed, matter },
        card: { status: 'approved', sendState: 'sending', sendClaimedAt: nowIso, decidedAt: claimed.decidedAt, updatedAt: nowIso },
        patch: leavesPending,
        events: card.status === 'pending' ? [event('approval_decided', nowIso, 'reply_draft approved')] : [],
      };
    }
    if (card.status !== 'pending') return { result: done(card.status) };
    if (card.kind === 'goal_reached' && matter.status === 'active') {
      // the owner confirms the goal is reached: the matter is done and follow-ups stop
      return {
        result: done('approved', null, 'done'),
        card: { status: 'approved', decidedAt: nowIso, updatedAt: nowIso },
        patch: { ...leavesPending, status: 'done', stopReason: 'goal_reached', endedAt: nowIso, followUpClaim: null, updatedAt: nowIso },
        events: [event('approval_decided', nowIso, 'goal_reached approved'), event('status_changed', nowIso, 'goal_reached')],
        schedule: { nextActionAt: null },
      };
    }
    // the other cards are information: approving means "seen, fine"
    return { result: done('approved'), card: { status: 'approved', decidedAt: nowIso, updatedAt: nowIso }, patch: leavesPending, events: [event('approval_decided', nowIso, `${card.kind} approved`)] };
  });
  if (outcome.kind === 'not_found') throw matterError('not_found');
  if (outcome.kind === 'stale') throw matterError('stale_draft', 'This reply is out of date. Check the matter again.');
  if (outcome.kind === 'invalid') throw matterError('invalid_request', outcome.message);
  if (outcome.kind === 'refused') {
    logger.warn('matters.send_refused', { uid: caller.uid, matterId, reason: outcome.reason });
    throw matterError('not_allowed');
  }
  if (outcome.kind === 'done') return { matterId, id, status: outcome.status, outcome: outcome.outcome, taskId: null, matterStatus: outcome.matterStatus };
  // the per-user cap: a send over it is released (the owner may approve again tomorrow)
  if (!(await deps.store.consumeDailySend(caller.uid, usageDayKey(now), deps.dailySendLimit ?? DEFAULT_DAILY_SENDS, nowIso))) {
    await deps.store.updateCard(caller.uid, matterId, id, () => ({ result: null, card: { sendState: 'failed', sendOutcome: 'failed', sendClaimedAt: null, updatedAt: nowIso } }));
    throw matterError('rate_limited', 'Too many emails today. Try again tomorrow.');
  }
  const sent = await sendCard(caller.uid, matterId, id, outcome.card, outcome.matter, deps);
  return { matterId, id, status: 'approved', outcome: sent, taskId: null, matterStatus: outcome.matter.status };
}

type ProposalOutcome =
  | { kind: 'not_found' }
  | { kind: 'invalid'; message: string }
  | { kind: 'done'; status: MatterProposal['status']; taskId: string | null; matterStatus: MatterDoc['status'] };

async function decideProposal(
  caller: MatterCaller,
  request: { matterId: string; id: string; action: string; timeZone?: string | undefined },
  deps: MatterDeps,
): Promise<MatterDecideResponse> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const { matterId, id } = request;
  const outcome = await deps.store.decideProposal<ProposalOutcome>(caller.uid, matterId, id, (matter, proposal, taskExists) => {
    if (!matter || !proposal || !matter.mandate) return { result: { kind: 'not_found' } };
    const done = (status: MatterProposal['status'], taskId: string | null): ProposalOutcome => ({ kind: 'done', status, taskId, matterStatus: matter.status });
    if (request.action === 'drop') {
      if (proposal.status === 'accepted') return { result: { kind: 'invalid', message: 'This commitment is already in your tasks.' } };
      if (proposal.status === 'dropped') return { result: done('dropped', null) };
      return { result: done('dropped', null), proposal: { status: 'dropped', decidedAt: nowIso, updatedAt: nowIso }, events: [event('commitment_decided', nowIso, 'dropped')] };
    }
    if (proposal.status === 'accepted') return { result: done('accepted', proposal.taskId) };
    const zone = request.timeZone && isValidTimeZone(request.timeZone) ? request.timeZone : matter.mandate.timeZone;
    const schedule = defaultSchedule({ due: proposal.due ? { date: proposal.due.date, time: proposal.due.time } : null, zone, now });
    const contactName = proposal.owner && !proposal.owner.isUser ? proposal.owner.name : matter.mandate.contacts[0]?.name ?? '';
    const built = buildCommitmentTaskDoc({
      uid: caller.uid,
      title: proposal.title,
      description: matterTaskOrigin({ contactName, title: matter.title, language: matter.language }),
      dueDate: schedule.dueDate,
      dueTime: schedule.dueTime,
      timezone: zone,
      reminderMinutesBefore: schedule.reminderMinutesBefore,
      // A3: a commitment accepted after the meeting was booked is linked to it
      meetingId: matter.booking?.meetingId ?? null,
      owner: proposal.owner ? { name: proposal.owner.name, isUser: proposal.owner.isUser } : null,
      now,
    });
    if (!built.ok) return { result: { kind: 'invalid', message: 'This commitment cannot become a task.' } };
    return {
      result: done('accepted', id),
      proposal: { status: 'accepted', taskId: id, decidedAt: nowIso, updatedAt: nowIso },
      // the task id is the commitment's id: accepting twice never makes two tasks
      ...(taskExists ? {} : { task: { id, doc: built.doc as unknown as Record<string, unknown> } }),
      events: [event('commitment_decided', nowIso, 'accepted')],
    };
  });
  if (outcome.kind === 'not_found') throw matterError('not_found');
  if (outcome.kind === 'invalid') throw matterError('invalid_request', outcome.message);
  return { matterId, id, status: outcome.status, outcome: null, taskId: outcome.taskId, matterStatus: outcome.matterStatus };
}

// ---------------------------------------------------------------------------------------------
// matterView
// ---------------------------------------------------------------------------------------------

type ViewItem = NonNullable<MatterViewResponse['matters']>[number];

function viewItem(matterId: string, doc: MatterDoc): ViewItem {
  return {
    matterId,
    status: doc.status,
    title: doc.title,
    updatedAt: doc.updatedAt,
    stopReason: doc.stopReason,
    pendingApprovals: doc.pendingApprovals,
    meeting: doc.booking ? { start: doc.booking.start, end: doc.booking.end } : null,
    contacts: doc.mandate?.contacts.map((c) => c.name) ?? [],
  };
}

/** A3: estimated prices (display only): Postmark per email, and the natural voice per character. */
export const COST_RATES = { emailUsd: 0.0015, speechUsdPerMinute: 0.015, speechCharsPerMinute: 900 } as const;

/** A matter's estimated cost in USD; null when the model price is not configured. */
export function costUsd(usage: MatterUsage, prices: { inPerM: number; outPerM: number } | undefined): number | null {
  if (!prices || (prices.inPerM <= 0 && prices.outPerM <= 0)) return null;
  const model = (usage.inputTokens * prices.inPerM + usage.outputTokens * prices.outPerM) / 1_000_000;
  const speech = (usage.speechChars / COST_RATES.speechCharsPerMinute) * COST_RATES.speechUsdPerMinute;
  return Math.round((model + usage.emails * COST_RATES.emailUsd + speech) * 1_000_000) / 1_000_000;
}

/** The timeline lines the matter page shows (newest first). */
const TIMELINE_EVENTS = 50;

const newestFirst = <T extends { createdAt: string }>(list: T[]): T[] => list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/**
 * What the app shows (A2), read here for the signed-in owner only: the open matters, or one
 * matter with its pending cards and open commitments. Only the fields the app shows are sent
 * (never the mandate's internals or the email thread). Off the tester list too, like cancel: an
 * owner can always see and stop their own matters.
 */
export function handleMatterView(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterViewResponse> {
  return readable(async () => {
    const caller = requireSignedIn(callerIn);
    const parsed = matterViewRequestSchema.safeParse(data ?? {});
    if (!parsed.success) throw matterError('invalid_request');
    const { matterId } = parsed.data;
    if (!matterId) {
      const matters = await deps.store.listMatters(caller.uid, ['active', 'paused']);
      return { matters: matters.map(({ id, doc }) => viewItem(id, doc)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), page: null };
    }
    const doc = await deps.store.getMatter(caller.uid, matterId);
    if (!doc) return { matters: null, page: null };
    const [cards, proposals, events] = await Promise.all([
      deps.store.listCards(caller.uid, matterId, 'pending'),
      deps.store.listProposals(caller.uid, matterId, 'open'),
      deps.store.listEvents(caller.uid, matterId, TIMELINE_EVENTS),
    ]);
    return {
      matters: null,
      page: {
        matter: viewItem(matterId, doc),
        approvals: newestFirst(
          cards.map(({ id, doc: card }) => ({
            id,
            kind: card.kind,
            status: card.status,
            reason: card.reason,
            quote: card.quote,
            from: card.from,
            draft: card.draft,
            draftHash: card.draftHash,
            guardFlags: card.guardFlags,
            sendOutcome: card.sendOutcome,
            auto: card.auto,
            createdAt: card.createdAt,
            slot: card.slot,
          })),
        ),
        proposals: newestFirst(
          proposals.map(({ id, doc: p }) => ({ id, quote: p.quote, title: p.title, owner: p.owner, due: p.due, status: p.status, taskId: p.taskId, createdAt: p.createdAt })),
        ),
        events: events.map((e) => ({ type: e.type, at: e.at, detail: e.detail })),
        usage: { ...doc.usage, costUsd: costUsd(doc.usage, deps.prices) },
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// matterTick
// ---------------------------------------------------------------------------------------------

type TickPlan =
  | { kind: 'none' }
  | { kind: 'ended' }
  | { kind: 'follow_up'; number: number; doc: MatterDoc; to: string[]; cc: string[] };

export interface TickResult {
  schedules: number;
  ended: number;
  followUps: number;
  reads: number;
}

/** One run of matterTick (see the module comment). */
export async function runMatterTick(deps: MatterDeps, batch = { schedules: 50, reads: 20 }): Promise<TickResult> {
  const now = deps.now();
  const result: TickResult = { schedules: 0, ended: 0, followUps: 0, reads: 0 };
  for (const entry of await deps.store.dueSchedules(now.toISOString(), batch.schedules)) {
    result.schedules += 1;
    try {
      const done = await processSchedule(entry.uid, entry.matterId, deps);
      if (done === 'ended') result.ended += 1;
      if (done === 'follow_up') result.followUps += 1;
    } catch (error) {
      logger.error('matters.tick_failed', { uid: entry.uid, matterId: entry.matterId, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  for (const entry of await deps.store.dueReads(iso(now.getTime() - READ_STALE_MS), batch.reads)) {
    result.reads += 1;
    try {
      await handleInboundRead({ uid: entry.uid, matterId: entry.matterId, messageId: entry.messageId }, deps, { retry: true });
    } catch (error) {
      logger.error('matters.tick_read_failed', { uid: entry.uid, matterId: entry.matterId, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return result;
}

async function processSchedule(uid: string, matterId: string, deps: MatterDeps): Promise<'ended' | 'follow_up' | 'none'> {
  const now = deps.now();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const plan = await deps.store.updateMatter<TickPlan>(uid, matterId, (doc) => {
    if (!doc || doc.status !== 'active' || !doc.mandate) return { result: { kind: 'none' }, schedule: { nextActionAt: null } };
    const end = Date.parse(doc.mandate.endsAt);
    if (nowMs >= end) {
      return {
        result: { kind: 'ended' },
        patch: { status: 'done', stopReason: 'ended', endedAt: nowIso, followUpClaim: null, updatedAt: nowIso },
        events: [event('status_changed', nowIso, 'ended')],
        schedule: { nextActionAt: null },
      };
    }
    let current = doc;
    let patch: Partial<MatterDoc> = {};
    if (doc.followUpClaim) {
      const claimed = Date.parse(doc.followUpClaim.claimedAt);
      if (nowMs - claimed < SENDING_WINDOW_MS) return { result: { kind: 'none' } }; // being sent right now
      // the claiming run died after claiming: it may have gone out, so it counts (never twice)
      patch = { followUpsSent: doc.followUpClaim.number, followUpClaim: null, lastOutboundAt: doc.followUpClaim.claimedAt };
      current = { ...doc, ...patch };
    }
    const later = (at: number) => ({ result: { kind: 'none' as const }, ...(Object.keys(patch).length ? { patch } : {}), schedule: { nextActionAt: iso(Math.min(at, end)) } });
    const due = followUpDueAt(current);
    if (due === null) return later(end);
    if (nowMs < due) return later(due);
    const zone = current.mandate!.timeZone;
    if (!inWorkingHours(now, zone)) return later(nextWorkingSlot(now, zone).getTime());
    const bounced = new Set(current.bouncedRecipients.map((a) => a.toLowerCase()));
    const to = current.mandate!.contacts.map((c) => c.email).filter((e) => !bounced.has(e.toLowerCase()));
    if (to.length === 0) return later(end);
    const cc = current.mandate!.copyOwner === 'cc' && current.ownerEmail ? [current.ownerEmail] : [];
    const check = checkSend({ matter: current, to, cc, now, enabled: deps.enabled, domain: deps.domain, requireFirstSent: true });
    if (!check.ok) return later(check.reason === 'switched_off' ? nowMs + RETRY_LATER_MS : end);
    const number = current.followUpsSent + 1;
    return {
      result: { kind: 'follow_up', number, doc: current, to, cc },
      patch: { ...patch, followUpClaim: { number, claimedAt: nowIso }, updatedAt: nowIso },
    };
  });
  if (plan.kind === 'ended') {
    logger.info('matters.ended', { uid, matterId });
    return 'ended';
  }
  if (plan.kind !== 'follow_up') return 'none';
  await sendFollowUp(uid, matterId, plan, deps);
  return 'follow_up';
}

async function sendFollowUp(uid: string, matterId: string, plan: Extract<TickPlan, { kind: 'follow_up' }>, deps: MatterDeps): Promise<void> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const doc = plan.doc;
  const mandate = doc.mandate!;
  const release = (nextMs: number, events: MatterEvent[] = []) =>
    deps.store.updateMatter(uid, matterId, () => ({
      result: null,
      patch: { followUpClaim: null, updatedAt: nowIso },
      events,
      schedule: { nextActionAt: iso(Math.min(nextMs, Date.parse(mandate.endsAt))) },
    }));
  if (!(await deps.store.consumeDailySend(uid, usageDayKey(now), deps.dailySendLimit ?? DEFAULT_DAILY_SENDS, nowIso))) {
    logger.warn('matters.follow_up_capped', { uid, matterId });
    await release(nextWorkingSlot(new Date(now.getTime() + 12 * 3_600_000), mandate.timeZone).getTime());
    return;
  }
  const thread = await deps.store.listMessages(uid, matterId, THREAD_MESSAGES);
  const lastOurs = [...thread].reverse().find((m) => m.direction === 'outbound' && (m.status === 'sent' || m.status === 'sending'));
  const email = composeMatterEmail({
    matter: doc,
    matterId,
    uid,
    domain: deps.domain,
    fromLocalPart: deps.fromLocalPart,
    to: plan.to,
    cc: plan.cc,
    subject: replySubject(lastOurs?.subject ?? doc.firstEmail?.subject ?? doc.title),
    body: followUpText(doc.title, mandate.language),
    ...(lastOurs ? { quoted: quoteBelow(lastOurs.text) } : {}),
    inReplyTo: lastOurs?.rfcMessageId ?? null,
    references: lastOurs ? [...lastOurs.references, lastOurs.rfcMessageId].slice(-20) : [],
    ...(deps.random ? { random: deps.random } : {}),
  });
  const recordSent = async (status: 'sent' | 'sending' | 'test', providerId: string | null, eventType: MatterEvent['type']) => {
    const at = deps.now().toISOString();
    const next: MatterDoc = { ...doc, followUpsSent: plan.number, followUpClaim: null, lastOutboundAt: at };
    await deps.store.addMessage(uid, matterId, outboundMessage(email, at, status, providerId, doc.ownerName, mandate.language), event(eventType, at, `${plan.number}`), {
      indexMessageId: true,
      patch: { followUpsSent: plan.number, followUpClaim: null, lastOutboundAt: at },
      schedule: { nextActionAt: nextActionAt(next) },
    });
  };
  try {
    const result = await deps.sender().send(email);
    await recordSent(result.test ? 'test' : 'sent', result.providerId, 'follow_up_sent');
    logger.info('matters.follow_up_sent', { uid, matterId, number: plan.number });
  } catch (error) {
    if (!(error instanceof EmailSendError)) throw error; // the claim stays: the next tick counts it
    (error.kind === 'configuration' ? logger.error : logger.warn)('matters.follow_up_failed', { uid, matterId, kind: error.kind, code: error.code });
    if (UNCERTAIN_SEND_KINDS.has(error.kind)) {
      // it may have gone out: counted, never sent twice
      await recordSent('sending', null, 'email_unconfirmed');
      if (error.code === INACTIVE_RECIPIENT_CODE && email.to.length === 1) await recordUndeliverable(deps, uid, matterId, email.to, 'inactive');
      return;
    }
    await release(now.getTime() + RETRY_LATER_MS, [event('email_failed', nowIso, error.kind)]);
  }
}

// ---------------------------------------------------------------------------------------------
// matterDeliveryEvents
// ---------------------------------------------------------------------------------------------

/** Postmark bounce types after which an address never receives mail again. */
const HARD_BOUNCE_TYPES = new Set(['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated']);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type DeliveryOutcome = 'recorded' | 'unchanged' | 'stopped' | 'ignored' | 'unmatched';

/**
 * One Postmark delivery event (bounce or spam complaint) for an email we sent. The matter comes
 * from the Metadata we sent with it ({ matterId, uid }); anything else is ignored. A hard bounce
 * (or an inactive address) is recorded like a 406 at send time (recordUndeliverable); a spam
 * complaint stops the matter.
 */
export async function handleDeliveryEvent(payload: unknown, deps: Pick<MatterDeps, 'store' | 'now'>): Promise<DeliveryOutcome> {
  const root = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  if (!root) return 'ignored';
  const metadata = typeof root.Metadata === 'object' && root.Metadata !== null ? (root.Metadata as Record<string, unknown>) : {};
  const uid = typeof metadata.uid === 'string' && ID_PATTERN.test(metadata.uid) ? metadata.uid : null;
  const matterId = typeof metadata.matterId === 'string' && ID_PATTERN.test(metadata.matterId) ? metadata.matterId : null;
  if (!uid || !matterId) return 'unmatched';
  const recordType = typeof root.RecordType === 'string' ? root.RecordType : '';
  const recipient = typeof root.Email === 'string' ? root.Email.trim() : '';
  if (recordType === 'Bounce') {
    const type = typeof root.Type === 'string' ? root.Type : '';
    if (!HARD_BOUNCE_TYPES.has(type) && root.Inactive !== true) {
      logger.info('matters.soft_bounce', { uid, matterId, type: type.slice(0, 40) });
      return 'ignored';
    }
    const recorded = await recordUndeliverable(deps, uid, matterId, recipient ? [recipient] : [], 'bounce');
    logger.info('matters.bounce', { uid, matterId, outcome: recorded });
    return recorded === 'not_found' ? 'unmatched' : recorded;
  }
  if (recordType === 'SpamComplaint') {
    const nowIso = deps.now().toISOString();
    const stopped = await deps.store.updateMatter(uid, matterId, (doc) => {
      if (!doc) return { result: 'unmatched' as const };
      if (doc.status !== 'active' && doc.status !== 'paused') return { result: 'unchanged' as const };
      return {
        result: 'stopped' as const,
        patch: { status: 'done', stopReason: 'complaint', endedAt: nowIso, followUpClaim: null, updatedAt: nowIso },
        events: [event('spam_complaint', nowIso), event('status_changed', nowIso, 'complaint')],
        schedule: { nextActionAt: null },
      };
    });
    logger.warn('matters.spam_complaint', { uid, matterId, outcome: stopped });
    return stopped;
  }
  return 'ignored';
}
