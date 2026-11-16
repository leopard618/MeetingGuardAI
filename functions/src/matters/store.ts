/**
 * Firestore access of the matters module, behind a small port so the handlers are tested with
 * an in-memory fake (test/unit/mattersHandlers.test.ts). Layout: model.ts.
 */
import * as logger from 'firebase-functions/logger';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { ACCOUNT_DELETIONS_COLLECTION } from '../maintenance/core';

import {
  INBOUND_EMAILS_COLLECTION,
  MATTER_ADDRESSES_COLLECTION,
  MATTER_EVENTS_SUBCOLLECTION,
  MATTER_MESSAGES_SUBCOLLECTION,
  MATTER_MESSAGE_IDS_COLLECTION,
  matterDocReadSchema,
  matterPath,
  messageIdKey,
  type MatterDoc,
  type MatterEvent,
  type MatterMessage,
} from './model';

export interface MatterLookup {
  uid: string;
  matterId: string;
}

/** What a transactional update decides: write a patch (and events), or leave the matter alone. */
export type MatterUpdate<T> = { result: T; patch?: Partial<MatterDoc>; events?: MatterEvent[] };

export interface AddMessageOptions {
  indexMessageId?: boolean;
  patch?: Partial<MatterDoc>;
}

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
  addInboundMessage(uid: string, matterId: string, message: MatterMessage, event: MatterEvent, marker: InboundMarker): Promise<'stored' | 'duplicate'>;
  /** The dedupe marker alone, for mail that is not stored (unmatched); false = seen before. */
  markInbound(marker: InboundMarker): Promise<boolean>;
  findByToken(token: string): Promise<MatterLookup | null>;
  findByMessageKey(key: string): Promise<MatterLookup | null>;
  /** Counts one draft or revision on usage/{uid}/days/{day}.matterDrafts; false = over the cap. */
  consumeDaily(uid: string, dayKey: string, limit: number, nowIso: string): Promise<boolean>;
}

/** Reads tolerate fields this version does not know (matterDocReadSchema); a real mismatch throws. */
function parseMatter(uid: string, matterId: string, data: unknown): MatterDoc {
  const parsed = matterDocReadSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'))].slice(0, 10);
  logger.error('matters.unreadable', { uid, matterId, fields });
  throw new MatterUnreadableError(uid, matterId, fields);
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
        for (const event of outcome.events ?? []) tx.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
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
      batch.update(ref, { ...options.patch, updatedAt: message.at });
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
    async addInboundMessage(uid, matterId, message, event, marker) {
      const ref = matterRef(uid, matterId);
      const messageRef = ref.collection(MATTER_MESSAGES_SUBCOLLECTION).doc();
      const batch = db.batch();
      // create(): a provider id seen before fails the whole batch, so a retry never stores twice
      batch.create(db.collection(INBOUND_EMAILS_COLLECTION).doc(marker.providerId), { receivedAt: marker.receivedAt, expiresAt: marker.expiresAt });
      batch.create(messageRef, message);
      batch.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), { ...event, messageId: messageRef.id });
      batch.update(ref, { updatedAt: message.at });
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
      const ref = db.doc(`usage/${uid}/days/${dayKey}`);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const used = Number((snapshot.data() as { matterDrafts?: unknown } | undefined)?.matterDrafts ?? 0) || 0;
        if (used >= limit) return false;
        tx.set(ref, { matterDrafts: FieldValue.increment(1), updatedAt: nowIso }, { merge: true });
        return true;
      });
    },
  };
}
