/**
 * Firestore access of the matters module, behind a small port so the handlers are tested with
 * an in-memory fake (test/unit/mattersFakes.ts). Layout: model.ts.
 *
 * A2: updateMatter's decision may also create approval cards and proposed commitments, patch one
 * message, set or delete the matter's schedule (matterSchedule) and its read queue entry
 * (matterReadQueue), all in the same transaction as the matter. Cards and commitments have their
 * own transactions for matterDecide (updateCard, decideProposal; the accepted task is created in
 * the same transaction as the commitment's status).
 *
 * A4: every patch that closes a matter (it carries endedAt) also writes matterRetention/{matterId}
 * in the same transaction or batch, so the emails are deleted MATTERS_RETENTION_DAYS later
 * (purgeMatter). The day's spend (matterSpend) and the monthly allowance (usage/{uid}/months)
 * are counted here too; deleteMatter removes a matter with everything that points at it.
 */
import * as logger from 'firebase-functions/logger';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { ACCOUNT_DELETIONS_COLLECTION } from '../maintenance/core';

import {
  INBOUND_EMAILS_COLLECTION,
  MATTER_ADDRESSES_COLLECTION,
  MATTER_APPROVALS_SUBCOLLECTION,
  MATTER_EVENTS_SUBCOLLECTION,
  MATTER_MESSAGES_SUBCOLLECTION,
  MATTER_MESSAGE_IDS_COLLECTION,
  MATTER_PROPOSALS_SUBCOLLECTION,
  MATTER_READ_QUEUE_COLLECTION,
  MATTER_RETENTION_COLLECTION,
  MATTER_SCHEDULE_COLLECTION,
  MATTER_SPEND_COLLECTION,
  EMPTY_MONTHLY,
  MONTHLY_FIELDS,
  endedAtOf,
  matterRetentionSchema,
  matterSpendId,
  usageMonthPath,
  type MatterRetention,
  type MatterSpendDelta,
  type MonthlyCounts,
  type MonthlyField,
  matterApprovalReadSchema,
  matterDocReadSchema,
  matterMessageReadSchema,
  matterPath,
  matterProposalReadSchema,
  matterReadQueueSchema,
  matterScheduleSchema,
  messageIdKey,
  readQueueId,
  type MatterApproval,
  type MatterDoc,
  type MatterEvent,
  type MatterMessage,
  type MatterProposal,
  type MatterReadQueue,
  type MatterSchedule,
  type MatterUsage,
  type StoredMessage,
  matterEventSchema,
} from './model';

export interface MatterLookup {
  uid: string;
  matterId: string;
}

/**
 * What a transactional update decides: write a patch (and events), or leave the matter alone. A2:
 * it may also create cards and proposals, patch one message, set (or delete, with null) the
 * matter's schedule and one read queue entry; all in the same transaction.
 */
export type MatterUpdate<T> = {
  result: T;
  patch?: Partial<MatterDoc>;
  events?: MatterEvent[];
  cards?: { id: string; doc: MatterApproval }[];
  proposals?: { id: string; doc: MatterProposal }[];
  message?: { id: string; patch: Partial<StoredMessage> };
  schedule?: { nextActionAt: string | null };
  readQueue?: { messageId: string; doc: MatterReadQueue | null };
};

export interface AddMessageOptions {
  indexMessageId?: boolean;
  patch?: Partial<MatterDoc>;
  /** A2: the approval card that sent this email, patched in the same batch. */
  card?: { id: string; patch: Partial<MatterApproval> };
  /** A2: the matter's next schedule (null deletes it), in the same batch. */
  schedule?: { nextActionAt: string | null };
}

export type StoredMessageWithId = StoredMessage & { id: string };

/** What updateCard decides about one card (and the matter it belongs to). */
export type CardUpdate<T> = {
  result: T;
  card?: Partial<MatterApproval>;
  patch?: Partial<MatterDoc>;
  events?: MatterEvent[];
  schedule?: { nextActionAt: string | null };
};

/** What decideProposal decides: the commitment's new fields and, on accept, the task to create. */
export type ProposalUpdate<T> = {
  result: T;
  proposal?: Partial<MatterProposal>;
  task?: { id: string; doc: Record<string, unknown> };
  events?: MatterEvent[];
};

/**
 * A3: what bookMeeting decides. createMeeting: create users/{uid}/meetings/{meetingId} (create(),
 * so a second booking of the same matter fails instead of overwriting) and point the tasks in
 * linkTasks at it, in the same transaction as the matter's patch, events, cards and schedule.
 */
export type BookingUpdate<T> = MatterUpdate<T> & { createMeeting?: boolean; linkTasks?: string[] };

/**
 * A3 feedback: what moveMeeting decides. meetingPatch: the booked meeting's new fields (its time, with
 * pushPending so the app pushes it to Google Calendar and Outlook), written in the same
 * transaction as the matter's patch, events, cards and schedule.
 */
export type MoveUpdate<T> = MatterUpdate<T> & { meetingPatch?: Record<string, unknown> };

/** The outcome of claiming a read (claimRead). */
export type ReadClaim =
  | { state: 'claimed'; message: StoredMessage; attempts: number }
  | { state: 'missing' | 'not_inbound' | 'busy' | 'finished' | 'exhausted'; attempts: number };

/** The inbound dedupe marker inboundEmails/{providerId}, written with create(). */
export interface InboundMarker {
  providerId: string;
  receivedAt: string;
  expiresAt: string;
}

/**
 * A matter document exists but does not parse (a damaged or hand-edited document). Never reported
 * as not_found: it is logged as its own outcome (matters.unreadable).
 */
export class MatterUnreadableError extends Error {
  constructor(
    readonly uid: string,
    readonly matterId: string,
    /** The failing field paths (names only, never values). */
    readonly fields: string[],
  ) {
    super('The matter document cannot be read.');
    this.name = 'MatterUnreadableError';
  }
}

export interface MatterStore {
  newMatterId(): string;
  /**
   * The matter, its first event and its reply address (matterAddresses/{token}), in one
   * transaction that first checks accountDeletions/{uid}: false (nothing written) when the account
   * is being deleted, so a draft racing a deletion never outlives it.
   */
  createMatter(uid: string, matterId: string, doc: MatterDoc, event: MatterEvent): Promise<boolean>;
  /** The matter, or null when missing; throws MatterUnreadableError when it does not parse. */
  getMatter(uid: string, matterId: string): Promise<MatterDoc | null>;
  /** Reads and updates one matter in a transaction. */
  updateMatter<T>(uid: string, matterId: string, decide: (doc: MatterDoc | null) => MatterUpdate<T>): Promise<T>;
  /**
   * Stores an email of the matter and its event in one batch; resolves the message id.
   * indexMessageId: also index its Message-ID (matterMessageIds, with create()). Only for our own
   * outgoing emails; never for inbound ones. patch: fields of the matter written in the same batch.
   */
  addMessage(uid: string, matterId: string, message: MatterMessage, event: MatterEvent, options?: AddMessageOptions): Promise<string>;
  /**
   * An inbound email: the message, its event and the dedupe marker (create()) in ONE batch.
   * 'duplicate' when the marker exists (this provider id was stored before): nothing is written.
   * When the batch fails for any other reason nothing is written either, so the provider's retry
   * is processed normally (there is no claim to release).
   */
  addInboundMessage(
    uid: string,
    matterId: string,
    message: MatterMessage,
    event: MatterEvent,
    marker: InboundMarker,
    patch?: Partial<MatterDoc>,
  ): Promise<'stored' | 'duplicate'>;
  /** The dedupe marker alone, for mail that is not stored (unmatched); false = seen before. */
  markInbound(marker: InboundMarker): Promise<boolean>;
  findByToken(token: string): Promise<MatterLookup | null>;
  findByMessageKey(key: string): Promise<MatterLookup | null>;
  /** Counts one draft or revision on usage/{uid}/days/{day}.matterDrafts; false = over the cap. */
  consumeDaily(uid: string, dayKey: string, limit: number, nowIso: string): Promise<boolean>;

  // ---- A2 ----
  newDocId(): string;
  getMessage(uid: string, matterId: string, messageId: string): Promise<StoredMessage | null>;
  /** The matter's last `limit` emails, oldest first. */
  listMessages(uid: string, matterId: string, limit: number): Promise<StoredMessageWithId[]>;
  /**
   * Claims the model read of an inbound message (readState 'reading', readAttempts + 1) and writes
   * its read queue entry, in one transaction. retry: a 'failed' read, or a 'reading' claim older
   * than staleBeforeIso, may be claimed again (matterTick); otherwise only 'none' is.
   */
  claimRead(uid: string, matterId: string, messageId: string, input: { nowIso: string; retry: boolean; staleBeforeIso: string; maxAttempts: number }): Promise<ReadClaim>;
  /** Pending reply_draft cards become expired (a newer email arrived); resolves how many. */
  expireReplyDrafts(uid: string, matterId: string, nowIso: string): Promise<number>;
  getCard(uid: string, matterId: string, cardId: string): Promise<MatterApproval | null>;
  /** One card and its matter in a transaction. */
  updateCard<T>(uid: string, matterId: string, cardId: string, decide: (matter: MatterDoc | null, card: MatterApproval | null) => CardUpdate<T>): Promise<T>;
  /** One proposed commitment, its matter and its task (users/{uid}/tasks/{proposal id}) in a transaction. */
  decideProposal<T>(
    uid: string,
    matterId: string,
    proposalId: string,
    decide: (matter: MatterDoc | null, proposal: MatterProposal | null, taskExists: boolean) => ProposalUpdate<T>,
  ): Promise<T>;
  /** matterSchedule entries due at or before `nowIso` (oldest first). */
  dueSchedules(nowIso: string, limit: number): Promise<MatterSchedule[]>;
  /** matterReadQueue entries claimed at or before `beforeIso`: stale or failed reads to retry. */
  dueReads(beforeIso: string, limit: number): Promise<MatterReadQueue[]>;
  /** Counts one assistant email on usage/{uid}/days/{day}.matterSends; false = over the cap. */
  consumeDailySend(uid: string, dayKey: string, limit: number, nowIso: string): Promise<boolean>;
  /** matterView: the user's matters with one of these statuses (a document that does not parse is left out). */
  listMatters(uid: string, statuses: readonly MatterDoc['status'][]): Promise<{ id: string; doc: MatterDoc }[]>;
  /** matterView: a matter's cards with this status. */
  listCards(uid: string, matterId: string, status: MatterApproval['status']): Promise<{ id: string; doc: MatterApproval }[]>;
  /** matterView: a matter's proposed commitments with this status. */
  listProposals(uid: string, matterId: string, status: MatterProposal['status']): Promise<{ id: string; doc: MatterProposal }[]>;

  // ---- A3 ----
  /** The matter's timeline, newest first (an event that does not parse is left out). */
  listEvents(uid: string, matterId: string, limit: number): Promise<MatterEvent[]>;
  /**
   * Books the matter's meeting: reads the matter, whether the meeting document exists and which of
   * `taskIds` exist, then writes what `decide` says, all in one transaction.
   */
  bookMeeting<T>(
    uid: string,
    matterId: string,
    input: { meetingId: string; meeting: Record<string, unknown>; taskIds: readonly string[] },
    decide: (matter: MatterDoc | null, meetingExists: boolean, existingTasks: readonly string[]) => BookingUpdate<T>,
  ): Promise<T>;
  /**
   * A3 feedback: moves the booked meeting: reads the matter and users/{uid}/meetings/{meetingId} (null when
   * missing), then writes what `decide` says, all in one transaction.
   */
  moveMeeting<T>(uid: string, matterId: string, meetingId: string, decide: (matter: MatterDoc | null, meeting: Record<string, unknown> | null) => MoveUpdate<T>): Promise<T>;
  /** Adds to the matter's usage counters (field increments; no transaction). */
  addUsage(uid: string, matterId: string, delta: Partial<MatterUsage>): Promise<void>;

  // ---- A4 ----
  /** The user's assistant cost that UTC day in micro-dollars (matterSpend/{day}_{uid}.micros; 0 when none). */
  getSpend(uid: string, dayKey: string): Promise<number>;
  /** Adds to matterSpend/{day}_{uid} (field increments; no transaction). */
  addSpend(uid: string, dayKey: string, delta: MatterSpendDelta, nowIso: string): Promise<void>;
  /** usage/{uid}/days/{day}: drafts (matterDrafts) and emails (matterSends) counted that day. */
  getDaily(uid: string, dayKey: string): Promise<{ drafts: number; sends: number }>;
  /** usage/{uid}/months/{month}: the allowance counters (zeros when none). */
  getMonthly(uid: string, monthKey: string): Promise<MonthlyCounts>;
  /**
   * Adds `amounts` to the month's counters in a transaction, only when every one of them stays
   * within its limit (a limit left out is not checked). Resolves the first field that would go
   * over (nothing counted), or null when counted.
   */
  consumeMonthly(uid: string, monthKey: string, amounts: Partial<MonthlyCounts>, limits: Partial<MonthlyCounts>, nowIso: string): Promise<MonthlyField | null>;
  /**
   * One assistant email: the day's send cap (usage/{uid}/days/{day}.matterSends) and the month's
   * emails (usage/{uid}/months/{month}.emails; monthlyLimit null = not checked) in ONE transaction.
   */
  consumeSend(uid: string, dayKey: string, dailyLimit: number, monthKey: string, monthlyLimit: number | null, nowIso: string): Promise<'ok' | 'daily' | 'monthly'>;
  /** matterRetention entries of matters that closed at or before `beforeIso` (oldest first). */
  dueRetention(beforeIso: string, limit: number): Promise<MatterRetention[]>;
  /**
   * Deletes the email texts of a closed matter: its messages and proposals, the text on its cards
   * (draft, quote, sender), its first email, and the lookups that point at it; the matter, its
   * cards and its timeline stay. Removes the retention entry. 'gone': no matter; 'not_ended': it
   * runs again (nothing deleted).
   */
  purgeMatter(uid: string, matterId: string, nowIso: string): Promise<'purged' | 'gone' | 'not_ended'>;
  /** Deletes the matter with every subcollection and every document that points at it; false when missing. */
  deleteMatter(uid: string, matterId: string): Promise<boolean>;
}

/** Reads tolerate fields this version does not know (matterDocReadSchema); a real mismatch throws. */
function parseMatter(uid: string, matterId: string, data: unknown): MatterDoc {
  const parsed = matterDocReadSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'))].slice(0, 10);
  logger.error('matters.unreadable', { uid, matterId, fields });
  throw new MatterUnreadableError(uid, matterId, fields);
}

function parseMessage(data: unknown): StoredMessage | null {
  const parsed = matterMessageReadSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function parseCard(data: unknown): MatterApproval | null {
  const parsed = matterApprovalReadSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function parseProposal(data: unknown): MatterProposal | null {
  const parsed = matterProposalReadSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function asLookup(data: unknown): MatterLookup | null {
  const d = data as { uid?: unknown; matterId?: unknown } | undefined;
  return d && typeof d.uid === 'string' && typeof d.matterId === 'string' ? { uid: d.uid, matterId: d.matterId } : null;
}

const isAlreadyExists = (error: unknown) => (error as { code?: unknown })?.code === 6 || (error as { code?: unknown })?.code === 'already-exists';

export function firestoreMatterStore(db: Firestore): MatterStore {
  const matterRef = (uid: string, matterId: string) => db.doc(matterPath(uid, matterId));
  return {
    newMatterId() {
      return db.collection('_').doc().id;
    },
    async createMatter(uid, matterId, doc, event) {
      const ref = matterRef(uid, matterId);
      const deletion = db.collection(ACCOUNT_DELETIONS_COLLECTION).doc(uid);
      return db.runTransaction(async (tx) => {
        if ((await tx.get(deletion)).exists) return false;
        tx.create(ref, doc);
        tx.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
        tx.create(db.collection(MATTER_ADDRESSES_COLLECTION).doc(doc.replyToken), { uid, matterId, createdAt: doc.createdAt });
        return true;
      });
    },
    async getMatter(uid, matterId) {
      const snapshot = await matterRef(uid, matterId).get();
      return snapshot.exists ? parseMatter(uid, matterId, snapshot.data()) : null;
    },
    async updateMatter(uid, matterId, decide) {
      const ref = matterRef(uid, matterId);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const outcome = decide(snapshot.exists ? parseMatter(uid, matterId, snapshot.data()) : null);
        if (outcome.patch) tx.update(ref, outcome.patch);
        if (outcome.patch && snapshot.exists) markEnded(tx, uid, matterId, outcome.patch);
        for (const event of outcome.events ?? []) tx.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
        for (const card of outcome.cards ?? []) tx.create(ref.collection(MATTER_APPROVALS_SUBCOLLECTION).doc(card.id), card.doc);
        for (const proposal of outcome.proposals ?? []) tx.create(ref.collection(MATTER_PROPOSALS_SUBCOLLECTION).doc(proposal.id), proposal.doc);
        if (outcome.message) tx.update(ref.collection(MATTER_MESSAGES_SUBCOLLECTION).doc(outcome.message.id), outcome.message.patch);
        if (outcome.schedule) writeSchedule(tx, uid, matterId, outcome.schedule.nextActionAt);
        if (outcome.readQueue) {
          const queueRef = db.collection(MATTER_READ_QUEUE_COLLECTION).doc(readQueueId(matterId, outcome.readQueue.messageId));
          if (outcome.readQueue.doc) tx.set(queueRef, matterReadQueueSchema.parse(outcome.readQueue.doc));
          else tx.delete(queueRef);
        }
        return outcome.result;
      });
    },
    async addMessage(uid, matterId, message, event, options = {}) {
      const ref = matterRef(uid, matterId);
      const messageRef = ref.collection(MATTER_MESSAGES_SUBCOLLECTION).doc();
      const batch = db.batch();
      batch.create(messageRef, message);
      batch.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), { ...event, messageId: messageRef.id });
      if (options.indexMessageId) {
        // create(): an id that is already indexed fails the batch instead of being re-pointed
        batch.create(db.collection(MATTER_MESSAGE_IDS_COLLECTION).doc(messageIdKey(message.rfcMessageId)), { uid, matterId, createdAt: message.at });
      }
      // A3: every email we send counts on the matter's usage (its cost)
      const counted = message.direction === 'outbound' ? { 'usage.emails': FieldValue.increment(1) } : {};
      batch.update(ref, { ...options.patch, ...counted, updatedAt: message.at });
      markEnded(batch, uid, matterId, options.patch);
      if (options.card) batch.update(ref.collection(MATTER_APPROVALS_SUBCOLLECTION).doc(options.card.id), { ...options.card.patch, updatedAt: message.at });
      if (options.schedule) writeSchedule(batch, uid, matterId, options.schedule.nextActionAt);
      await batch.commit();
      return messageRef.id;
    },
    async findByToken(token) {
      const snapshot = await db.collection(MATTER_ADDRESSES_COLLECTION).doc(token).get();
      return snapshot.exists ? asLookup(snapshot.data()) : null;
    },
    async findByMessageKey(key) {
      const snapshot = await db.collection(MATTER_MESSAGE_IDS_COLLECTION).doc(key).get();
      return snapshot.exists ? asLookup(snapshot.data()) : null;
    },
    async addInboundMessage(uid, matterId, message, event, marker, patch) {
      const ref = matterRef(uid, matterId);
      const messageRef = ref.collection(MATTER_MESSAGES_SUBCOLLECTION).doc();
      const batch = db.batch();
      // create(): a provider id seen before fails the whole batch, so a retry never stores twice
      batch.create(db.collection(INBOUND_EMAILS_COLLECTION).doc(marker.providerId), { receivedAt: marker.receivedAt, expiresAt: marker.expiresAt });
      batch.create(messageRef, message);
      batch.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), { ...event, messageId: messageRef.id });
      batch.update(ref, { ...patch, updatedAt: message.at });
      markEnded(batch, uid, matterId, patch);
      try {
        await batch.commit();
        return 'stored';
      } catch (error) {
        if (isAlreadyExists(error)) return 'duplicate';
        throw error;
      }
    },
    async markInbound(marker) {
      try {
        await db.collection(INBOUND_EMAILS_COLLECTION).doc(marker.providerId).create({ receivedAt: marker.receivedAt, expiresAt: marker.expiresAt });
        return true;
      } catch (error) {
        if (isAlreadyExists(error)) return false;
        throw error;
      }
    },
    async consumeDaily(uid, dayKey, limit, nowIso) {
      return consumeCounter(uid, dayKey, 'matterDrafts', limit, nowIso);
    },
    newDocId() {
      return db.collection('_').doc().id;
    },
    async getMessage(uid, matterId, messageId) {
      const snapshot = await matterRef(uid, matterId).collection(MATTER_MESSAGES_SUBCOLLECTION).doc(messageId).get();
      return snapshot.exists ? parseMessage(snapshot.data()) : null;
    },
    async listMessages(uid, matterId, limit) {
      const snapshot = await matterRef(uid, matterId).collection(MATTER_MESSAGES_SUBCOLLECTION).orderBy('at', 'desc').limit(limit).get();
      const out: StoredMessageWithId[] = [];
      for (const doc of snapshot.docs) {
        const message = parseMessage(doc.data());
        if (message) out.push({ ...message, id: doc.id });
      }
      return out.reverse();
    },
    async claimRead(uid, matterId, messageId, input) {
      const messageRef = matterRef(uid, matterId).collection(MATTER_MESSAGES_SUBCOLLECTION).doc(messageId);
      const queueRef = db.collection(MATTER_READ_QUEUE_COLLECTION).doc(readQueueId(matterId, messageId));
      return db.runTransaction(async (tx): Promise<ReadClaim> => {
        const snapshot = await tx.get(messageRef);
        const message = snapshot.exists ? parseMessage(snapshot.data()) : null;
        if (!message) return { state: 'missing', attempts: 0 };
        const decision = readClaimDecision(message, input);
        if (decision.state !== 'claimed') {
          if (decision.state === 'finished') tx.delete(queueRef);
          return { state: decision.state, attempts: decision.attempts };
        }
        tx.update(messageRef, { readState: 'reading', readAttempts: decision.attempts, readClaimedAt: input.nowIso });
        tx.set(queueRef, { uid, matterId, messageId, claimedAt: input.nowIso, attempts: decision.attempts });
        return { state: 'claimed', message, attempts: decision.attempts };
      });
    },
    async expireReplyDrafts(uid, matterId, nowIso) {
      const ref = matterRef(uid, matterId);
      return db.runTransaction(async (tx) => {
        const pending = await tx.get(ref.collection(MATTER_APPROVALS_SUBCOLLECTION).where('status', '==', 'pending'));
        const drafts = pending.docs.filter((doc) => doc.get('kind') === 'reply_draft');
        if (drafts.length === 0) return 0;
        const matter = await tx.get(ref);
        for (const doc of drafts) tx.update(doc.ref, { status: 'expired', updatedAt: nowIso, decidedAt: nowIso });
        if (matter.exists) tx.update(ref, { pendingApprovals: FieldValue.increment(-drafts.length), updatedAt: nowIso });
        return drafts.length;
      });
    },
    async getCard(uid, matterId, cardId) {
      const snapshot = await matterRef(uid, matterId).collection(MATTER_APPROVALS_SUBCOLLECTION).doc(cardId).get();
      return snapshot.exists ? parseCard(snapshot.data()) : null;
    },
    async updateCard(uid, matterId, cardId, decide) {
      const ref = matterRef(uid, matterId);
      const cardRef = ref.collection(MATTER_APPROVALS_SUBCOLLECTION).doc(cardId);
      return db.runTransaction(async (tx) => {
        const [matterSnap, cardSnap] = await Promise.all([tx.get(ref), tx.get(cardRef)]);
        const matter = matterSnap.exists ? parseMatter(uid, matterId, matterSnap.data()) : null;
        const outcome = decide(matter, cardSnap.exists ? parseCard(cardSnap.data()) : null);
        if (outcome.card) tx.update(cardRef, outcome.card);
        if (outcome.patch && matter) tx.update(ref, outcome.patch);
        if (outcome.patch && matter) markEnded(tx, uid, matterId, outcome.patch);
        for (const event of outcome.events ?? []) tx.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
        if (outcome.schedule) writeSchedule(tx, uid, matterId, outcome.schedule.nextActionAt);
        return outcome.result;
      });
    },
    async decideProposal(uid, matterId, proposalId, decide) {
      const ref = matterRef(uid, matterId);
      const proposalRef = ref.collection(MATTER_PROPOSALS_SUBCOLLECTION).doc(proposalId);
      const taskRef = db.doc(`users/${uid}/tasks/${proposalId}`);
      return db.runTransaction(async (tx) => {
        const [matterSnap, proposalSnap, taskSnap] = await Promise.all([tx.get(ref), tx.get(proposalRef), tx.get(taskRef)]);
        const matter = matterSnap.exists ? parseMatter(uid, matterId, matterSnap.data()) : null;
        const outcome = decide(matter, proposalSnap.exists ? parseProposal(proposalSnap.data()) : null, taskSnap.exists);
        if (outcome.proposal) tx.update(proposalRef, outcome.proposal);
        if (outcome.task) tx.create(db.doc(`users/${uid}/tasks/${outcome.task.id}`), outcome.task.doc);
        for (const event of outcome.events ?? []) tx.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
        return outcome.result;
      });
    },
    async dueSchedules(nowIso, limit) {
      const snapshot = await db.collection(MATTER_SCHEDULE_COLLECTION).where('nextActionAt', '<=', nowIso).orderBy('nextActionAt').limit(limit).get();
      return snapshot.docs.map((doc) => matterScheduleSchema.safeParse(doc.data())).flatMap((p) => (p.success ? [p.data] : []));
    },
    async dueReads(beforeIso, limit) {
      const snapshot = await db.collection(MATTER_READ_QUEUE_COLLECTION).where('claimedAt', '<=', beforeIso).orderBy('claimedAt').limit(limit).get();
      return snapshot.docs.map((doc) => matterReadQueueSchema.safeParse(doc.data())).flatMap((p) => (p.success ? [p.data] : []));
    },
    async consumeDailySend(uid, dayKey, limit, nowIso) {
      return consumeCounter(uid, dayKey, 'matterSends', limit, nowIso);
    },
    async listMatters(uid, statuses) {
      const snapshot = await db.collection(`users/${uid}/matters`).where('status', 'in', [...statuses]).get();
      return snapshot.docs.flatMap((doc) => {
        const parsed = matterDocReadSchema.safeParse(doc.data());
        return parsed.success ? [{ id: doc.id, doc: parsed.data }] : [];
      });
    },
    async listCards(uid, matterId, status) {
      const snapshot = await matterRef(uid, matterId).collection(MATTER_APPROVALS_SUBCOLLECTION).where('status', '==', status).get();
      return snapshot.docs.flatMap((doc) => {
        const card = parseCard(doc.data());
        return card ? [{ id: doc.id, doc: card }] : [];
      });
    },
    async listProposals(uid, matterId, status) {
      const snapshot = await matterRef(uid, matterId).collection(MATTER_PROPOSALS_SUBCOLLECTION).where('status', '==', status).get();
      return snapshot.docs.flatMap((doc) => {
        const proposal = parseProposal(doc.data());
        return proposal ? [{ id: doc.id, doc: proposal }] : [];
      });
    },
    async listEvents(uid, matterId, limit) {
      const snapshot = await matterRef(uid, matterId).collection(MATTER_EVENTS_SUBCOLLECTION).orderBy('at', 'desc').limit(limit).get();
      return snapshot.docs.flatMap((doc) => {
        const parsed = matterEventSchema.safeParse(doc.data());
        return parsed.success ? [parsed.data] : [];
      });
    },
    async bookMeeting(uid, matterId, input, decide) {
      const ref = matterRef(uid, matterId);
      const meetingRef = db.doc(`users/${uid}/meetings/${input.meetingId}`);
      const taskRefs = input.taskIds.map((id) => db.doc(`users/${uid}/tasks/${id}`));
      return db.runTransaction(async (tx) => {
        const [matterSnap, meetingSnap, ...taskSnaps] = await Promise.all([tx.get(ref), tx.get(meetingRef), ...taskRefs.map((r) => tx.get(r))]);
        const matter = matterSnap.exists ? parseMatter(uid, matterId, matterSnap.data()) : null;
        const existing = taskSnaps.filter((snap) => snap.exists).map((snap) => snap.id);
        const outcome = decide(matter, meetingSnap.exists, existing);
        if (outcome.createMeeting) tx.create(meetingRef, input.meeting);
        for (const id of outcome.linkTasks ?? []) {
          if (existing.includes(id)) tx.update(db.doc(`users/${uid}/tasks/${id}`), { meetingId: input.meetingId, updatedAt: String(input.meeting.createdAt) });
        }
        if (outcome.patch && matter) tx.update(ref, outcome.patch);
        if (outcome.patch && matter) markEnded(tx, uid, matterId, outcome.patch);
        for (const event of outcome.events ?? []) tx.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
        for (const card of outcome.cards ?? []) tx.create(ref.collection(MATTER_APPROVALS_SUBCOLLECTION).doc(card.id), card.doc);
        if (outcome.schedule) writeSchedule(tx, uid, matterId, outcome.schedule.nextActionAt);
        return outcome.result;
      });
    },
    async moveMeeting(uid, matterId, meetingId, decide) {
      const ref = matterRef(uid, matterId);
      const meetingRef = db.doc(`users/${uid}/meetings/${meetingId}`);
      return db.runTransaction(async (tx) => {
        const [matterSnap, meetingSnap] = await Promise.all([tx.get(ref), tx.get(meetingRef)]);
        const matter = matterSnap.exists ? parseMatter(uid, matterId, matterSnap.data()) : null;
        const outcome = decide(matter, meetingSnap.exists ? (meetingSnap.data() as Record<string, unknown>) : null);
        if (outcome.meetingPatch && meetingSnap.exists) tx.update(meetingRef, outcome.meetingPatch);
        if (outcome.patch && matter) tx.update(ref, outcome.patch);
        if (outcome.patch && matter) markEnded(tx, uid, matterId, outcome.patch);
        for (const event of outcome.events ?? []) tx.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
        for (const card of outcome.cards ?? []) tx.create(ref.collection(MATTER_APPROVALS_SUBCOLLECTION).doc(card.id), card.doc);
        if (outcome.schedule) writeSchedule(tx, uid, matterId, outcome.schedule.nextActionAt);
        return outcome.result;
      });
    },
    async addUsage(uid, matterId, delta) {
      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(delta)) if (typeof value === 'number' && value > 0) fields[`usage.${key}`] = FieldValue.increment(Math.round(value));
      if (Object.keys(fields).length === 0) return;
      await matterRef(uid, matterId).update(fields);
    },
    // ---- A4 ----
    async getSpend(uid, dayKey) {
      const snapshot = await db.collection(MATTER_SPEND_COLLECTION).doc(matterSpendId(dayKey, uid)).get();
      return Number(snapshot.get('micros') ?? 0) || 0;
    },
    async addSpend(uid, dayKey, delta, nowIso) {
      const fields: Record<string, unknown> = { uid, day: dayKey, updatedAt: nowIso };
      for (const [key, value] of Object.entries(delta)) if (typeof value === 'number' && value > 0) fields[key] = FieldValue.increment(Math.round(value));
      await db.collection(MATTER_SPEND_COLLECTION).doc(matterSpendId(dayKey, uid)).set(fields, { merge: true });
    },
    async getDaily(uid, dayKey) {
      const snapshot = await db.doc(`usage/${uid}/days/${dayKey}`).get();
      return { drafts: Number(snapshot.get('matterDrafts') ?? 0) || 0, sends: Number(snapshot.get('matterSends') ?? 0) || 0 };
    },
    async getMonthly(uid, monthKey) {
      const snapshot = await db.doc(usageMonthPath(uid, monthKey)).get();
      return monthlyOf(snapshot.data());
    },
    async consumeMonthly(uid, monthKey, amounts, limits, nowIso) {
      const ref = db.doc(usageMonthPath(uid, monthKey));
      return db.runTransaction(async (tx) => {
        const used = monthlyOf((await tx.get(ref)).data());
        const over = overLimit(used, amounts, limits);
        if (over) return over;
        tx.set(ref, { ...increments(amounts), month: monthKey, updatedAt: nowIso }, { merge: true });
        return null;
      });
    },
    async consumeSend(uid, dayKey, dailyLimit, monthKey, monthlyLimit, nowIso) {
      const dayRef = db.doc(`usage/${uid}/days/${dayKey}`);
      const monthRef = db.doc(usageMonthPath(uid, monthKey));
      return db.runTransaction(async (tx) => {
        const [daySnap, monthSnap] = await Promise.all([tx.get(dayRef), tx.get(monthRef)]);
        if ((Number(daySnap.get('matterSends') ?? 0) || 0) >= dailyLimit) return 'daily' as const;
        if (monthlyLimit !== null && monthlyOf(monthSnap.data()).emails >= monthlyLimit) return 'monthly' as const;
        tx.set(dayRef, { matterSends: FieldValue.increment(1), updatedAt: nowIso }, { merge: true });
        tx.set(monthRef, { emails: FieldValue.increment(1), month: monthKey, updatedAt: nowIso }, { merge: true });
        return 'ok' as const;
      });
    },
    async dueRetention(beforeIso, limit) {
      const snapshot = await db.collection(MATTER_RETENTION_COLLECTION).where('endedAt', '<=', beforeIso).orderBy('endedAt').limit(limit).get();
      return snapshot.docs.map((doc) => matterRetentionSchema.safeParse(doc.data())).flatMap((p) => (p.success ? [p.data] : []));
    },
    async purgeMatter(uid, matterId, nowIso) {
      const ref = matterRef(uid, matterId);
      const retentionRef = db.collection(MATTER_RETENTION_COLLECTION).doc(matterId);
      const snapshot = await ref.get();
      if (!snapshot.exists) {
        await retentionRef.delete();
        return 'gone';
      }
      const status = snapshot.get('status');
      if (status !== 'done' && status !== 'cancelled') {
        await retentionRef.delete();
        return 'not_ended';
      }
      await db.recursiveDelete(ref.collection(MATTER_MESSAGES_SUBCOLLECTION));
      await db.recursiveDelete(ref.collection(MATTER_PROPOSALS_SUBCOLLECTION));
      const cards = await ref.collection(MATTER_APPROVALS_SUBCOLLECTION).get();
      await inBatches(cards.docs.map((doc) => (batch: FirebaseFirestore.WriteBatch) => batch.update(doc.ref, { draft: null, quote: null, from: null, threading: null, updatedAt: nowIso })));
      await deleteLookups(uid, matterId, snapshot.get('replyToken'));
      const batch = db.batch();
      batch.update(ref, { firstEmail: null, purgedAt: nowIso, updatedAt: nowIso });
      batch.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), { type: 'emails_deleted', at: nowIso, messageId: null, detail: '' });
      batch.delete(retentionRef);
      await batch.commit();
      return 'purged';
    },
    async deleteMatter(uid, matterId) {
      const ref = matterRef(uid, matterId);
      const snapshot = await ref.get();
      if (!snapshot.exists) return false;
      await deleteLookups(uid, matterId, snapshot.get('replyToken'));
      await db.recursiveDelete(ref);
      await db.collection(MATTER_RETENTION_COLLECTION).doc(matterId).delete();
      return true;
    },
  };

  /** A4: a patch that closes the matter writes its retention entry (create or overwrite). */
  function markEnded(writer: { set: (ref: FirebaseFirestore.DocumentReference, data: object) => unknown }, uid: string, matterId: string, patch: object | undefined): void {
    const endedAt = endedAtOf(patch);
    if (endedAt) writer.set(db.collection(MATTER_RETENTION_COLLECTION).doc(matterId), { uid, matterId, endedAt });
  }

  /** A4: everything outside users/{uid} that points at one matter (its schedule, read queue, addresses and Message-IDs). */
  async function deleteLookups(uid: string, matterId: string, replyToken: unknown): Promise<void> {
    const refs: FirebaseFirestore.DocumentReference[] = [db.collection(MATTER_SCHEDULE_COLLECTION).doc(matterId)];
    if (typeof replyToken === 'string' && replyToken.length > 0) refs.push(db.collection(MATTER_ADDRESSES_COLLECTION).doc(replyToken));
    for (const name of [MATTER_MESSAGE_IDS_COLLECTION, MATTER_READ_QUEUE_COLLECTION]) {
      const found = await db.collection(name).where('matterId', '==', matterId).get();
      for (const doc of found.docs) if (doc.get('uid') === uid) refs.push(doc.ref);
    }
    await inBatches(refs.map((docRef) => (batch: FirebaseFirestore.WriteBatch) => batch.delete(docRef)));
  }

  async function inBatches(writes: ((batch: FirebaseFirestore.WriteBatch) => unknown)[]): Promise<void> {
    for (let start = 0; start < writes.length; start += 400) {
      const batch = db.batch();
      for (const write of writes.slice(start, start + 400)) write(batch);
      await batch.commit();
    }
  }

  function writeSchedule(writer: { set: (ref: FirebaseFirestore.DocumentReference, data: object) => unknown; delete: (ref: FirebaseFirestore.DocumentReference) => unknown }, uid: string, matterId: string, nextActionAt: string | null): void {
    const scheduleRef = db.collection(MATTER_SCHEDULE_COLLECTION).doc(matterId);
    if (nextActionAt === null) writer.delete(scheduleRef);
    else writer.set(scheduleRef, { uid, matterId, nextActionAt });
  }

  async function consumeCounter(uid: string, dayKey: string, field: 'matterDrafts' | 'matterSends', limit: number, nowIso: string): Promise<boolean> {
    const ref = db.doc(`usage/${uid}/days/${dayKey}`);
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const used = Number((snapshot.data() as Record<string, unknown> | undefined)?.[field] ?? 0) || 0;
      if (used >= limit) return false;
      tx.set(ref, { [field]: FieldValue.increment(1), updatedAt: nowIso }, { merge: true });
      return true;
    });
  }
}

/**
 * Whether a read may be claimed (shared by the Firestore store and the fake):
 * 'none' always; 'failed', or a 'reading' claim older than staleBeforeIso, only on a retry; never
 * after maxAttempts ('exhausted'); 'done' and 'skipped' are finished.
 */
export function readClaimDecision(
  message: StoredMessage,
  input: { retry: boolean; staleBeforeIso: string; maxAttempts: number },
): { state: 'claimed' | 'not_inbound' | 'busy' | 'finished' | 'exhausted'; attempts: number } {
  const attempts = message.readAttempts ?? 0;
  if (message.direction !== 'inbound') return { state: 'not_inbound', attempts };
  const state = message.readState ?? 'none';
  if (state === 'done' || state === 'skipped') return { state: 'finished', attempts };
  if (state === 'reading') {
    const claimedAt = message.readClaimedAt ? Date.parse(message.readClaimedAt) : NaN;
    if (!input.retry || (Number.isFinite(claimedAt) && claimedAt > Date.parse(input.staleBeforeIso))) return { state: 'busy', attempts };
  }
  if (state === 'failed' && !input.retry) return { state: 'busy', attempts };
  if (attempts >= input.maxAttempts) return { state: 'exhausted', attempts };
  return { state: 'claimed', attempts: attempts + 1 };
}

/** usage/{uid}/months/{month} as counters (missing or damaged fields read as 0). */
export function monthlyOf(data: unknown): MonthlyCounts {
  const d = (data ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY_MONTHLY };
  for (const field of MONTHLY_FIELDS) {
    const value = Number(d[field] ?? 0);
    out[field] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return out;
}

/** The first field that `amounts` would take over its limit (shared by the Firestore store and the fake). */
export function overLimit(used: MonthlyCounts, amounts: Partial<MonthlyCounts>, limits: Partial<MonthlyCounts>): MonthlyField | null {
  for (const field of MONTHLY_FIELDS) {
    const amount = amounts[field] ?? 0;
    const limit = limits[field];
    if (amount > 0 && limit !== undefined && used[field] + amount > limit) return field;
  }
  return null;
}

function increments(amounts: Partial<MonthlyCounts>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of MONTHLY_FIELDS) if ((amounts[field] ?? 0) > 0) out[field] = FieldValue.increment(Math.round(amounts[field]!));
  return out;
}
