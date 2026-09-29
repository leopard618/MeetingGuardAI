/**
 * Daily assistant quota: an atomic per-user counter in usage/{uid}/days/{UTC yyyy-mm-dd}.
 *
 * The day boundary is UTC midnight (`usageDayKey` / `nextUsageResetIso` in the shared contract),
 * so a client cannot reset its quota by changing the time zone it sends. The plan comes from the
 * server-owned entitlements/{uid} document (default free) and is read inside the same
 * transaction as the counter.
 */
import type { Firestore } from 'firebase-admin/firestore';

import {
  PLAN_DAILY_AI_LIMITS,
  nextUsageResetIso,
  usageDayKey,
  type AssistantUsage,
  type Plan,
} from '../shared/aiContract';
import { resolveEffectivePlan } from '../shared/entitlement';

export interface QuotaEvaluation {
  allowed: boolean;
  /** Count to store when allowed (current + 1); equals the current count when denied. */
  nextCount: number;
  usage: AssistantUsage;
}

/** Pure quota decision for one request. */
export function evaluateQuota(input: { currentCount: number; plan: Plan; now: Date }): QuotaEvaluation {
  const limit = PLAN_DAILY_AI_LIMITS[input.plan];
  const current = Number.isInteger(input.currentCount) && input.currentCount > 0 ? input.currentCount : 0;
  const allowed = current < limit;
  const nextCount = allowed ? current + 1 : current;
  return {
    allowed,
    nextCount,
    usage: { used: nextCount, limit, plan: input.plan, resetsAt: nextUsageResetIso(input.now) },
  };
}

/** Reads/writes available inside one quota transaction (all reads happen before the write). */
export interface QuotaTransaction {
  /** Raw entitlements/{uid} data, or undefined when the document does not exist. */
  readEntitlement(uid: string): Promise<unknown>;
  /** Current count of usage/{uid}/days/{dayKey} (0 when missing or malformed). */
  readUsageCount(uid: string, dayKey: string): Promise<number>;
  writeUsageCount(uid: string, dayKey: string, count: number, updatedAtIso: string): void;
}

export interface QuotaStore {
  runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T>;
}

export interface QuotaDecision extends QuotaEvaluation {
  dayKey: string;
  /** false when entitlements/{uid} exists but is malformed (treated as free). */
  entitlementValid: boolean;
}

/** Counts one assistant request atomically. Does not throw on "over quota": check `allowed`. */
export async function consumeQuota(store: QuotaStore, uid: string, now: Date): Promise<QuotaDecision> {
  const dayKey = usageDayKey(now);
  return store.runTransaction(async (tx) => {
    const entitlement = resolveEffectivePlan(await tx.readEntitlement(uid), now);
    const currentCount = await tx.readUsageCount(uid, dayKey);
    const evaluation = evaluateQuota({ currentCount, plan: entitlement.plan, now });
    if (evaluation.allowed) {
      tx.writeUsageCount(uid, dayKey, evaluation.nextCount, now.toISOString());
    }
    return { ...evaluation, dayKey, entitlementValid: entitlement.valid };
  });
}

/**
 * Gives back one request after a failure the user did not cause (upstream error, missing
 * follow-up meeting). Never goes below zero.
 */
export async function refundQuota(store: QuotaStore, uid: string, dayKey: string, now: Date): Promise<void> {
  await store.runTransaction(async (tx) => {
    const current = await tx.readUsageCount(uid, dayKey);
    if (current > 0) tx.writeUsageCount(uid, dayKey, current - 1, now.toISOString());
  });
}

/** Firestore-backed store (Admin SDK transactions lock the documents they read). */
export function firestoreQuotaStore(db: Firestore): QuotaStore {
  return {
    runTransaction: <T>(fn: (tx: QuotaTransaction) => Promise<T>) =>
      db.runTransaction(
        (transaction) =>
          fn({
            async readEntitlement(uid) {
              const snapshot = await transaction.get(db.doc(`entitlements/${uid}`));
              return snapshot.exists ? snapshot.data() : undefined;
            },
            async readUsageCount(uid, dayKey) {
              const snapshot = await transaction.get(db.doc(`usage/${uid}/days/${dayKey}`));
              const count: unknown = snapshot.exists ? snapshot.get('count') : 0;
              return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
            },
            writeUsageCount(uid, dayKey, count, updatedAtIso) {
              transaction.set(db.doc(`usage/${uid}/days/${dayKey}`), { count, updatedAt: updatedAtIso }, { merge: true });
            },
          }),
        { maxAttempts: 5 },
      ),
  };
}
