/**
 * Project-wide daily cap on assistant requests that reach OpenAI (a spend safeguard on top of the
 * per-user quota: unlimited throw-away accounts must not translate into unlimited spend).
 *
 * - Counted in sharded documents usage_global/{UTC day}/shards/{0..N-1} with FieldValue.increment
 *   (no transaction, no hot document). Clients cannot read or write them (rules deny all).
 * - Each instance caches the day's total for a short time, so the check costs one small query per
 *   instance per minute. The cap is therefore approximate (it can be exceeded by the requests of a
 *   cache period), which is fine for a safeguard.
 * - ASSISTANT_GLOBAL_DAILY_LIMIT <= 0 disables it.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export const GLOBAL_BUDGET_SHARDS = 10;
export const GLOBAL_BUDGET_CACHE_MS = 60_000;

export interface GlobalBudgetStore {
  /** Requests counted for the UTC day. */
  readTotal(dayKey: string): Promise<number>;
  /** Counts one request. */
  increment(dayKey: string): Promise<void>;
}

export interface GlobalBudget {
  /** false when the day's cap is reached (the request must not reach OpenAI). Counts it otherwise. */
  tryAcquire(dayKey: string): Promise<boolean>;
}

export function createGlobalBudget(
  store: GlobalBudgetStore,
  options: { limit: () => number; cacheMs?: number; now?: () => number },
): GlobalBudget {
  const cacheMs = options.cacheMs ?? GLOBAL_BUDGET_CACHE_MS;
  const now = options.now ?? (() => Date.now());
  let cached: { dayKey: string; total: number; readAt: number } | null = null;

  return {
    async tryAcquire(dayKey) {
      const limit = options.limit();
      if (!Number.isFinite(limit) || limit <= 0) return true;
      if (!cached || cached.dayKey !== dayKey || now() - cached.readAt > cacheMs) {
        cached = { dayKey, total: await store.readTotal(dayKey), readAt: now() };
      }
      if (cached.total >= limit) return false;
      cached.total += 1;
      await store.increment(dayKey);
      return true;
    },
  };
}

export function firestoreGlobalBudgetStore(db: Firestore, random: () => number = Math.random): GlobalBudgetStore {
  const shards = (dayKey: string) => db.collection(`usage_global/${dayKey}/shards`);
  return {
    async readTotal(dayKey) {
      const snapshot = await shards(dayKey).get();
      let total = 0;
      for (const doc of snapshot.docs) {
        const count: unknown = doc.get('count');
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) total += count;
      }
      return total;
    },
    async increment(dayKey) {
      const shard = Math.floor(random() * GLOBAL_BUDGET_SHARDS) % GLOBAL_BUDGET_SHARDS;
      await shards(dayKey).doc(String(shard)).set({ count: FieldValue.increment(1) }, { merge: true });
    },
  };
}
