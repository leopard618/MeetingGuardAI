/**
 * Firestore adapter for the data engine (Firebase JS SDK 12, memory cache in React Native).
 *
 * - Firestore Timestamps (legacy documents written with serverTimestamp()) are converted to ISO
 *   strings so the rest of the data layer only sees JSON.
 * - Writes are transactions (read + conditional write) so every outbox send can apply
 *   last-writer-wins and create-if-absent without trusting local state.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';

import { AppError, toAppError } from '../../core/errors';
import type { CommitDecision, RemoteData, RemoteStore } from './remote';

interface TimestampLike {
  toDate(): Date;
  seconds: number;
  nanoseconds: number;
}

function isTimestampLike(value: unknown): value is TimestampLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function' &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  );
}

/** Converts Firestore values to plain JSON (Timestamps -> ISO strings). */
export function normalizeFirestoreValue(value: unknown): unknown {
  if (isTimestampLike(value)) {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizeFirestoreValue(child);
    }
    return out;
  }
  return value;
}

function normalizeDoc(data: DocumentData | undefined): RemoteData | null {
  if (data === undefined) return null;
  return normalizeFirestoreValue(data) as RemoteData;
}

const TRANSACTION_ATTEMPTS = 3;

export function createFirestoreRemote(database: Firestore | null): RemoteStore {
  function requireDb(): Firestore {
    if (!database) throw new AppError('not_configured', 'Firestore is not configured');
    return database;
  }

  return {
    isAvailable: database !== null,

    newId(collectionPath) {
      return doc(collection(requireDb(), collectionPath)).id;
    },

    listenCollection(collectionPath, onNext, onError) {
      return onSnapshot(
        collection(requireDb(), collectionPath),
        (snapshot) => {
          onNext({
            fromCache: snapshot.metadata.fromCache,
            ids: snapshot.docs.map((item) => item.id),
            changes: snapshot.docChanges().map((change) => ({
              type: change.type,
              id: change.doc.id,
              data: change.type === 'removed' ? null : normalizeDoc(change.doc.data()),
            })),
          });
        },
        (error) => onError(toAppError(error)),
      );
    },

    listenDoc(docPath, onNext, onError) {
      return onSnapshot(
        doc(requireDb(), docPath),
        (snapshot) => {
          const exists = snapshot.exists();
          onNext({ fromCache: snapshot.metadata.fromCache, exists, data: exists ? normalizeDoc(snapshot.data()) : null });
        },
        (error) => onError(toAppError(error)),
      );
    },

    async getDoc(docPath) {
      const snapshot = await getDoc(doc(requireDb(), docPath));
      const exists = snapshot.exists();
      return { exists, data: exists ? normalizeDoc(snapshot.data()) : null };
    },

    async getCollection(collectionPath) {
      const snapshot = await getDocs(collection(requireDb(), collectionPath));
      return snapshot.docs.map((item) => ({ id: item.id, data: normalizeDoc(item.data()) ?? {} }));
    },

    async queryStartingFrom(collectionPath, fromIso) {
      const snapshot = await getDocs(query(collection(requireDb(), collectionPath), where('startAt', '>=', fromIso)));
      return snapshot.docs.map((item) => ({ id: item.id, data: normalizeDoc(item.data()) ?? {} }));
    },

    async commit(docPath, decide) {
      const firestore = requireDb();
      const ref = doc(firestore, docPath);
      try {
        return await runTransaction(
          firestore,
          async (transaction) => {
            const snapshot = await transaction.get(ref);
            const current = snapshot.exists() ? normalizeDoc(snapshot.data()) : null;
            const decision: CommitDecision = decide(current);
            if (decision.type === 'write') transaction.set(ref, decision.data);
            else if (decision.type === 'merge') transaction.set(ref, decision.data, { merge: true });
            else if (decision.type === 'delete') transaction.delete(ref);
            return { current, decision };
          },
          { maxAttempts: TRANSACTION_ATTEMPTS },
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        // The SDK gives up after TRANSACTION_ATTEMPTS contended attempts with the last precondition
        // failure: that is contention (another writer on the same document), retryable later,
        // never a bad write to drop and roll back.
        const code = (error as { code?: unknown }).code;
        if (code === 'failed-precondition' || code === 'aborted') {
          throw new AppError('conflict', 'The document changed while it was being written', { cause: error });
        }
        throw error;
      }
    },
  };
}
