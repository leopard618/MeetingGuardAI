/**
 * Firestore access of the matters module, behind a small port so the handlers are tested with
 * an in-memory fake (test/unit/mattersHandlers.test.ts). Layout: model.ts.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import {
  INBOUND_EMAILS_COLLECTION,
  MATTER_ADDRESSES_COLLECTION,
  MATTER_EVENTS_SUBCOLLECTION,
  MATTER_MESSAGES_SUBCOLLECTION,
  MATTER_MESSAGE_IDS_COLLECTION,
  matterDocSchema,
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

export interface MatterStore {
  newMatterId(): string;
  /** The matter, its first event and its reply address (matterAddresses/{token}), in one batch. */
  createMatter(uid: string, matterId: string, doc: MatterDoc, event: MatterEvent): Promise<void>;
  /** The matter, or null when missing or unreadable. */
  getMatter(uid: string, matterId: string): Promise<MatterDoc | null>;
  /** Reads and updates one matter in a transaction. */
  updateMatter<T>(uid: string, matterId: string, decide: (doc: MatterDoc | null) => MatterUpdate<T>): Promise<T>;
  /**
   * Stores an email of the matter and its event in one batch; resolves the message id.
   * indexMessageId: also index its Message-ID (matterMessageIds, with create()). Only for our own
   * outgoing emails; never for inbound ones. patch: fields of the matter written in the same batch.
   */
  addMessage(uid: string, matterId: string, message: MatterMessage, event: MatterEvent, options?: AddMessageOptions): Promise<string>;
  findByToken(token: string): Promise<MatterLookup | null>;
  findByMessageKey(key: string): Promise<MatterLookup | null>;
  /** Create-once inbound marker; false when this provider id was already processed. */
  claimInbound(providerId: string, receivedAtIso: string, expiresAtIso: string): Promise<boolean>;
  /** Removes the marker again when storing failed, so the provider's retry is processed. */
  releaseInbound(providerId: string): Promise<void>;
  /** Counts one draft or revision on usage/{uid}/days/{day}.matterDrafts; false = over the cap. */
  consumeDaily(uid: string, dayKey: string, limit: number, nowIso: string): Promise<boolean>;
}

function parseMatter(data: unknown): MatterDoc | null {
  const parsed = matterDocSchema.safeParse(data);
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
      const batch = db.batch();
      const ref = matterRef(uid, matterId);
      batch.create(ref, doc);
      batch.create(ref.collection(MATTER_EVENTS_SUBCOLLECTION).doc(), event);
      batch.create(db.collection(MATTER_ADDRESSES_COLLECTION).doc(doc.replyToken), { uid, matterId, createdAt: doc.createdAt });
      await batch.commit();
    },
    async getMatter(uid, matterId) {
      const snapshot = await matterRef(uid, matterId).get();
      return snapshot.exists ? parseMatter(snapshot.data()) : null;
    },
    async updateMatter(uid, matterId, decide) {
      const ref = matterRef(uid, matterId);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const outcome = decide(snapshot.exists ? parseMatter(snapshot.data()) : null);
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
    async claimInbound(providerId, receivedAtIso, expiresAtIso) {
      try {
        await db.collection(INBOUND_EMAILS_COLLECTION).doc(providerId).create({ receivedAt: receivedAtIso, expiresAt: expiresAtIso });
        return true;
      } catch (error) {
        if (isAlreadyExists(error)) return false;
        throw error;
      }
    },
    async releaseInbound(providerId) {
      await db.collection(INBOUND_EMAILS_COLLECTION).doc(providerId).delete();
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
