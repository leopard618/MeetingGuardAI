/**
 * Minimal port between the data engine and the remote database. The production adapter is
 * firestoreRemote.ts (Firebase JS SDK); unit tests use an in-memory fake. Documents cross this
 * boundary as plain JSON: Firestore Timestamps are converted to ISO strings by the adapter.
 */
import type { AppError } from '../../core/errors';
import type { Unsubscribe } from '../../core/events';

export type RemoteData = Record<string, unknown>;

export interface RemoteDocChange {
  type: 'added' | 'modified' | 'removed';
  id: string;
  /** null for 'removed'. */
  data: RemoteData | null;
}

export interface RemoteCollectionSnapshot {
  /** true when the SDK could not reach the backend (memory cache only; never authoritative). */
  fromCache: boolean;
  /** Changes since the previous snapshot of this listener (the first snapshot lists every doc as 'added'). */
  changes: RemoteDocChange[];
  /** Ids of every document in the snapshot. */
  ids: string[];
}

export interface RemoteDocSnapshot {
  fromCache: boolean;
  exists: boolean;
  data: RemoteData | null;
}

export type CommitDecision =
  | { type: 'write'; data: RemoteData }
  | { type: 'merge'; data: RemoteData }
  /**
   * `followUp: 'create'`: the server copy is in the pre-rebuild shape, which the security rules
   * never accept as the base of an update (source/createdAt/userId must stay unchanged). It is
   * deleted first and the same outbox entry is then sent again as a create.
   */
  | { type: 'delete'; followUp?: 'create' }
  | { type: 'skip'; reason: 'exists' | 'stale' | 'absent' | 'already_migrated' };

export interface CommitResult {
  /** Document as read inside the transaction (null = absent). */
  current: RemoteData | null;
  decision: CommitDecision;
}

export interface RemoteStore {
  /** false when Firebase is not configured. */
  readonly isAvailable: boolean;
  /** New random document id (usable offline). `collectionPath` like users/{uid}/meetings. */
  newId(collectionPath: string): string;
  listenCollection(
    collectionPath: string,
    onNext: (snapshot: RemoteCollectionSnapshot) => void,
    onError: (error: AppError) => void,
  ): Unsubscribe;
  listenDoc(docPath: string, onNext: (snapshot: RemoteDocSnapshot) => void, onError: (error: AppError) => void): Unsubscribe;
  getDoc(docPath: string): Promise<{ exists: boolean; data: RemoteData | null }>;
  getCollection(collectionPath: string): Promise<{ id: string; data: RemoteData }[]>;
  /** Documents whose `startAt` >= `fromIso` (single-field range; no composite index). */
  queryStartingFrom(collectionPath: string, fromIso: string): Promise<{ id: string; data: RemoteData }[]>;
  /**
   * Transaction: reads `docPath`, calls the PURE `decide(current)` (may run more than once on
   * contention) and applies its decision atomically. Rejects with the provider error.
   */
  commit(docPath: string, decide: (current: RemoteData | null) => CommitDecision): Promise<CommitResult>;
}
