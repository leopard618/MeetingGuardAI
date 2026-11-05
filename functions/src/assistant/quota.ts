/**
 * Assistant allowances (ARCHITECTURE section 35; the numbers live in the shared contract,
 * AI_ALLOWANCES):
 *
 * - Free: the introductory allowance. A 7-day window that starts with the user's FIRST AI
 *   action, 10 actions in total, at most 3 per UTC day. When the window has ended or the 10 are
 *   used, AI needs a subscription (`subscriptionRequired` on the usage).
 * - Pro / Premium: a monthly allowance that renews on the monthly anniversary of the
 *   subscription start (entitlements/{uid}.startedAt, written by the RevenueCat webhook; a
 *   calendar month in UTC when the start is unknown). Yearly subscribers get the same monthly
 *   cycles.
 *
 * Counters are server-owned, atomic per user and shared by every device: the UTC-day counter in
 * usage/{uid}/days/{yyyy-mm-dd} (kept for every plan) and the root document usage/{uid}
 * (introStartedAt, introUsed, cycleKey + cycleUsed for the current paid cycle, clarifications).
 * The plan comes from the server-owned entitlement, read in the same transaction.
 *
 * Clarifications: a reply that only asks the user for missing details is not charged, at most
 * CLARIFICATIONS_PER_ACTION times in a row (handler.ts settles that after the model answered);
 * the counter resets on the next real answer or proposal, so a chain of unfinished requests
 * cannot run for free.
 */
import type { Firestore } from 'firebase-admin/firestore';

import {
  AI_ALLOWANCES,
  CLARIFICATIONS_PER_ACTION,
  nextUsageResetIso,
  usageDayKey,
  type AssistantUsage,
  type Plan,
} from '../shared/aiContract';
import { resolveEffectivePlan } from '../shared/entitlement';

const DAY_MS = 24 * 60 * 60 * 1000;

/** usage/{uid}: the per-user counters that are not per UTC day. */
export interface UsageRoot {
  /** First AI action of the free allowance (ISO); null until the first one. */
  introStartedAt: string | null;
  /** Free actions used inside the introductory window. */
  introUsed: number;
  /** Start of the paid cycle the `cycleUsed` counter belongs to (ISO); null when none yet. */
  cycleKey: string | null;
  cycleUsed: number;
  /** Clarification replies in a row that were not charged (reset by a real answer). */
  clarifications: number;
}

export const EMPTY_USAGE_ROOT: Readonly<UsageRoot> = Object.freeze({
  introStartedAt: null,
  introUsed: 0,
  cycleKey: null,
  cycleUsed: 0,
  clarifications: 0,
});

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Lenient reader of the stored root document (missing or malformed fields fall back). */
export function readUsageRoot(raw: unknown): UsageRoot {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_USAGE_ROOT };
  const record = raw as Record<string, unknown>;
  return {
    introStartedAt: isoOrNull(record.introStartedAt),
    introUsed: nonNegativeInt(record.introUsed),
    cycleKey: isoOrNull(record.cycleKey),
    cycleUsed: nonNegativeInt(record.cycleUsed),
    clarifications: nonNegativeInt(record.clarifications),
  };
}

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------

function utcWithDay(year: number, month: number, day: number, template: Date): number {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(day, daysInMonth), template.getUTCHours(), template.getUTCMinutes(), template.getUTCSeconds());
}

/**
 * The monthly cycle of a subscription that started at `startedAt`, containing `now`: the latest
 * monthly anniversary at or before now, and the next one. The day of the month is clamped to the
 * month's length (a subscription started on the 31st renews on the 30th in April).
 */
export function subscriptionCycle(startedAt: Date, now: Date): { start: Date; end: Date } {
  const day = startedAt.getUTCDate();
  // Start from the anniversary in now's month and step back until it is not in the future.
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let start = utcWithDay(year, month, day, startedAt);
  while (start > now.getTime()) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    start = utcWithDay(year, month, day, startedAt);
  }
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  const end = utcWithDay(nextYear, nextMonth, day, startedAt);
  return { start: new Date(Math.max(start, startedAt.getTime())), end: new Date(end) };
}

/** Calendar month in UTC (paid plan without a known subscription start). */
export function calendarMonthCycle(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export function paidCycle(startedAt: string | null, now: Date): { start: Date; end: Date } {
  const started = startedAt === null ? NaN : Date.parse(startedAt);
  if (!Number.isFinite(started) || started > now.getTime()) return calendarMonthCycle(now);
  return subscriptionCycle(new Date(started), now);
}

// ---------------------------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------------------------

export interface QuotaCharges {
  /** The UTC-day counter was incremented. */
  day: boolean;
  /** The free introductory total was incremented. */
  intro: boolean;
  /** The paid cycle counter (this key) was incremented. */
  cycle: string | null;
}

export interface QuotaEvaluation {
  allowed: boolean;
  usage: AssistantUsage;
  /** What to store when allowed. */
  nextDayCount: number;
  nextRoot: UsageRoot;
  charges: QuotaCharges;
}

export interface QuotaInput {
  plan: Plan;
  /** entitlements/{uid}.startedAt (paid plans). */
  startedAt: string | null;
  dayCount: number;
  root: UsageRoot;
  now: Date;
}

/** Pure allowance decision for one request. */
export function evaluateQuota(input: QuotaInput): QuotaEvaluation {
  const { plan, now } = input;
  const dayCount = nonNegativeInt(input.dayCount);
  const root = input.root;
  const noCharge: QuotaCharges = { day: false, intro: false, cycle: null };

  if (plan === 'free') {
    const allowance = AI_ALLOWANCES.free;
    const introStartedAt = root.introStartedAt ?? now.toISOString();
    const windowEnd = new Date(Date.parse(introStartedAt) + allowance.windowDays * DAY_MS);
    const windowOver = now.getTime() >= windowEnd.getTime();
    if (windowOver || root.introUsed >= allowance.total) {
      return {
        allowed: false,
        usage: {
          used: Math.min(root.introUsed, allowance.total),
          limit: allowance.total,
          plan,
          resetsAt: windowEnd.toISOString(),
          period: 'window',
          subscriptionRequired: true,
        },
        nextDayCount: dayCount,
        nextRoot: root,
        charges: noCharge,
      };
    }
    if (dayCount >= allowance.perDay) {
      return {
        allowed: false,
        usage: { used: dayCount, limit: allowance.perDay, plan, resetsAt: nextUsageResetIso(now), period: 'day' },
        nextDayCount: dayCount,
        nextRoot: root,
        charges: noCharge,
      };
    }
    const introUsed = root.introUsed + 1;
    return {
      allowed: true,
      usage: { used: introUsed, limit: allowance.total, plan, resetsAt: windowEnd.toISOString(), period: 'window' },
      nextDayCount: dayCount + 1,
      nextRoot: { ...root, introStartedAt, introUsed },
      charges: { day: true, intro: true, cycle: null },
    };
  }

  const allowance = AI_ALLOWANCES[plan];
  const cycle = paidCycle(input.startedAt, now);
  const cycleKey = cycle.start.toISOString();
  const cycleUsed = root.cycleKey === cycleKey ? root.cycleUsed : 0;
  if (cycleUsed >= allowance.perMonth) {
    return {
      allowed: false,
      usage: { used: cycleUsed, limit: allowance.perMonth, plan, resetsAt: cycle.end.toISOString(), period: 'month' },
      nextDayCount: dayCount,
      nextRoot: root,
      charges: noCharge,
    };
  }
  return {
    allowed: true,
    usage: { used: cycleUsed + 1, limit: allowance.perMonth, plan, resetsAt: cycle.end.toISOString(), period: 'month' },
    nextDayCount: dayCount + 1,
    nextRoot: { ...root, cycleKey, cycleUsed: cycleUsed + 1 },
    charges: { day: true, intro: false, cycle: cycleKey },
  };
}

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

/** Reads/writes available inside one quota transaction (all reads happen before the write). */
export interface QuotaTransaction {
  /** Raw entitlements/{uid} data, or undefined when the document does not exist. */
  readEntitlement(uid: string): Promise<unknown>;
  /** Current count of usage/{uid}/days/{dayKey} (0 when missing or malformed). */
  readUsageCount(uid: string, dayKey: string): Promise<number>;
  writeUsageCount(uid: string, dayKey: string, count: number, updatedAtIso: string): void;
  /** Raw usage/{uid} data, or undefined when the document does not exist. */
  readUsageRoot(uid: string): Promise<unknown>;
  /** Merges the given fields into usage/{uid}. */
  writeUsageRoot(uid: string, patch: Partial<UsageRoot>, updatedAtIso: string): void;
}

export interface QuotaStore {
  runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T>;
}

export interface QuotaDecision {
  allowed: boolean;
  usage: AssistantUsage;
  dayKey: string;
  /** false when entitlements/{uid} exists but is malformed (treated as free). */
  entitlementValid: boolean;
  charges: QuotaCharges;
  /** Un-charged clarification replies in a row before this request. */
  clarificationsUsed: number;
}

/** Counts one assistant request atomically. Does not throw on "over quota": check `allowed`. */
export async function consumeQuota(store: QuotaStore, uid: string, now: Date): Promise<QuotaDecision> {
  const dayKey = usageDayKey(now);
  return store.runTransaction(async (tx) => {
    const entitlement = resolveEffectivePlan(await tx.readEntitlement(uid), now);
    const dayCount = await tx.readUsageCount(uid, dayKey);
    const root = readUsageRoot(await tx.readUsageRoot(uid));
    const evaluation = evaluateQuota({ plan: entitlement.plan, startedAt: entitlement.startedAt, dayCount, root, now });
    if (evaluation.allowed) {
      const nowIso = now.toISOString();
      tx.writeUsageCount(uid, dayKey, evaluation.nextDayCount, nowIso);
      const { clarifications: _clarifications, ...counters } = evaluation.nextRoot;
      tx.writeUsageRoot(uid, counters, nowIso);
    }
    return {
      allowed: evaluation.allowed,
      usage: evaluation.usage,
      dayKey,
      entitlementValid: entitlement.valid,
      charges: evaluation.charges,
      clarificationsUsed: root.clarifications,
    };
  });
}

function refundIn(tx: QuotaTransaction, uid: string, dayKey: string, charges: QuotaCharges, root: UsageRoot, dayCount: number, nowIso: string): UsageRoot {
  let next = root;
  if (charges.day && dayCount > 0) tx.writeUsageCount(uid, dayKey, dayCount - 1, nowIso);
  if (charges.intro && root.introUsed > 0) next = { ...next, introUsed: root.introUsed - 1 };
  if (charges.cycle !== null && root.cycleKey === charges.cycle && root.cycleUsed > 0) next = { ...next, cycleUsed: root.cycleUsed - 1 };
  return next;
}

/**
 * Gives back one request after a failure the user did not cause (upstream error, missing
 * follow-up meeting). Never goes below zero; only the counters this decision charged.
 */
export async function refundQuota(store: QuotaStore, uid: string, decision: Pick<QuotaDecision, 'dayKey' | 'charges'>, now: Date): Promise<void> {
  await store.runTransaction(async (tx) => {
    const dayCount = await tx.readUsageCount(uid, decision.dayKey);
    const root = readUsageRoot(await tx.readUsageRoot(uid));
    const next = refundIn(tx, uid, decision.dayKey, decision.charges, root, dayCount, now.toISOString());
    if (next !== root) tx.writeUsageRoot(uid, { introUsed: next.introUsed, cycleUsed: next.cycleUsed }, now.toISOString());
  });
}

export interface ClarificationSettlement {
  /** The request was refunded (a clarification within the free allowance of them). */
  refunded: boolean;
}

/**
 * After the model answered: a reply that only asked for missing details is refunded while the
 * user has fewer than CLARIFICATIONS_PER_ACTION un-charged clarifications in a row; any other
 * reply resets that run. The third clarification in a row stays charged (and the prompt told
 * the model to stop asking, handler.ts).
 */
export async function settleClarification(
  store: QuotaStore,
  uid: string,
  decision: Pick<QuotaDecision, 'dayKey' | 'charges'>,
  clarification: boolean,
  now: Date,
): Promise<ClarificationSettlement> {
  return store.runTransaction(async (tx) => {
    const nowIso = now.toISOString();
    const root = readUsageRoot(await tx.readUsageRoot(uid));
    if (!clarification) {
      if (root.clarifications !== 0) tx.writeUsageRoot(uid, { clarifications: 0 }, nowIso);
      return { refunded: false };
    }
    const dayCount = await tx.readUsageCount(uid, decision.dayKey);
    const refund = root.clarifications < CLARIFICATIONS_PER_ACTION;
    const next = refund ? refundIn(tx, uid, decision.dayKey, decision.charges, root, dayCount, nowIso) : root;
    tx.writeUsageRoot(uid, { introUsed: next.introUsed, cycleUsed: next.cycleUsed, clarifications: root.clarifications + 1 }, nowIso);
    return { refunded: refund };
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
              return nonNegativeInt(count);
            },
            writeUsageCount(uid, dayKey, count, updatedAtIso) {
              transaction.set(db.doc(`usage/${uid}/days/${dayKey}`), { count, updatedAt: updatedAtIso }, { merge: true });
            },
            async readUsageRoot(uid) {
              const snapshot = await transaction.get(db.doc(`usage/${uid}`));
              return snapshot.exists ? snapshot.data() : undefined;
            },
            writeUsageRoot(uid, patch, updatedAtIso) {
              transaction.set(db.doc(`usage/${uid}`), { ...patch, updatedAt: updatedAtIso }, { merge: true });
            },
          }),
        { maxAttempts: 5 },
      ),
  };
}
