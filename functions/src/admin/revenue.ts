/**
 * Revenue aggregation for the admin dashboard (owner: admin; docs/v1/ADMIN.md "Revenue").
 * PURE: no firebase imports, unit-tested standalone. Inputs are the raw documents two ports read:
 * - revenuecatEvents/{eventId} markers written by the webhook (functions/src/revenuecat/index.ts
 *   markerOf): type, store, environment, receivedAt, and since 2026-10-26 plan, productId,
 *   periodType, cancelReason, expirationReason, isTrialConversion, priceUsd, currency;
 * - entitlements/{uid} documents (plan, status, expiresAt, source, and the `billing` block the
 *   webhook stores next to them).
 *
 * Counting rules (one event, one bucket; SANDBOX events are never counted):
 * - INITIAL_PURCHASE: periodType TRIAL -> trialsStarted; NORMAL/INTRO -> newPaid. Markers from
 *   before the billing fields existed have no periodType; every real purchase starts with the
 *   3-day trial, so those count as trial starts.
 * - RENEWAL with isTrialConversion -> trialConversions AND newPaid; other renewals -> renewals.
 * - UNCANCELLATION -> uncancellations; PRODUCT_CHANGE -> productChanges; BILLING_ISSUE -> billingIssues.
 * - CANCELLATION with cancel_reason CUSTOMER_SUPPORT -> refunds; otherwise cancellations
 *   (auto-renew switched off; access runs to the period end).
 * - EXPIRATION -> expirations. TRANSFER and anything else are not counted.
 * Days are bucketed by `receivedAt` (the field the range query filters on), UTC.
 *
 * "Paying now" comes from the entitlement documents, not the events: source 'revenuecat', plan
 * pro or premium, status active or grace_period, and not past expiresAt. Admin-granted plans
 * (comps) are reported separately and never in MRR.
 *
 * Estimated MRR: each paying entitlement contributes its last known price per month
 * (yearly products divided by 12). When the price is unknown (entitlements written before the
 * billing block existed) the list price below is used and the response says how many of each.
 */
import { z } from 'zod';

import { usageDayKey } from '../shared/aiContract';

export const DEFAULT_PLAN_PRICES_USD = {
  pro: { monthly: 7.99, yearly: 69.99 },
  premium: { monthly: 14.99, yearly: 134.99 },
} as const;

const paidPlanSchema = z.enum(['pro', 'premium']);

/** Lenient reader for one revenuecatEvents marker; unknown or malformed documents are skipped. */
export const revenueMarkerSchema = z.object({
  type: z.string().min(1),
  receivedAt: z.string().min(1),
  environment: z.string().nullable().optional(),
  store: z.string().nullable().optional(),
  plan: paidPlanSchema.nullable().optional(),
  productId: z.string().nullable().optional(),
  periodType: z.string().nullable().optional(),
  cancelReason: z.string().nullable().optional(),
  expirationReason: z.string().nullable().optional(),
  isTrialConversion: z.boolean().nullable().optional(),
  priceUsd: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
});
export type RevenueMarker = z.infer<typeof revenueMarkerSchema>;

export const revenueBillingSchema = z.object({
  store: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  periodType: z.string().nullable().optional(),
  priceUsd: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
});

/** Lenient reader for one entitlements/{uid} document. */
export const revenueEntitlementSchema = z.object({
  plan: z.enum(['free', 'pro', 'premium']),
  status: z.enum(['active', 'grace_period', 'expired', 'revoked']),
  expiresAt: z.string().nullable().optional(),
  source: z.string().optional(),
  billing: revenueBillingSchema.nullable().optional(),
});

export type StoreBucket = 'playStore' | 'appStore' | 'other';

/** RevenueCat store names -> the three buckets the dashboard shows. */
export function storeBucket(store: string | null | undefined): StoreBucket {
  const value = (store ?? '').toUpperCase();
  if (value === 'PLAY_STORE') return 'playStore';
  if (value === 'APP_STORE' || value === 'MAC_APP_STORE') return 'appStore';
  return 'other';
}

/** Yearly products are named with a year marker in both stores (pro_yearly, p1y, ...). */
export function isYearlyProduct(productId: string | null | undefined): boolean {
  return /(year|annual|p1y|12m|\byr\b)/i.test(productId ?? '');
}

/** Monthly revenue of one paying entitlement, and whether the price came from the document. */
export function monthlyRevenueUsd(
  plan: 'pro' | 'premium',
  billing: z.infer<typeof revenueBillingSchema> | null | undefined,
): { usd: number; measured: boolean } {
  const yearly = isYearlyProduct(billing?.productId);
  const price = billing?.priceUsd;
  if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
    return { usd: yearly ? price / 12 : price, measured: true };
  }
  const list = DEFAULT_PLAN_PRICES_USD[plan];
  return { usd: yearly ? list.yearly / 12 : list.monthly, measured: false };
}

export interface RevenueDayPoint {
  date: string;
  trialsStarted: number;
  newPaid: number;
  cancellations: number;
  expirations: number;
}

export interface RevenueComputation {
  since: string;
  days: RevenueDayPoint[];
  totals: {
    trialsStarted: number;
    trialConversions: number;
    newPaid: number;
    renewals: number;
    uncancellations: number;
    productChanges: number;
    cancellations: number;
    refunds: number;
    billingIssues: number;
    expirations: number;
    eventsCounted: number;
    sandboxIgnored: number;
  };
  active: {
    paying: number;
    gracePeriod: number;
    byPlan: { pro: number; premium: number };
    byStore: { playStore: number; appStore: number; other: number };
    comps: number;
  };
  mrr: { estimateUsd: number; measuredPriceCount: number; defaultPriceCount: number };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeRevenue(
  rawMarkers: readonly unknown[],
  rawEntitlements: readonly unknown[],
  dayKeys: readonly string[],
  now: Date,
  since: string,
): RevenueComputation {
  const dayIndex = new Map<string, number>();
  const days: RevenueDayPoint[] = dayKeys.map((date, index) => {
    dayIndex.set(date, index);
    return { date, trialsStarted: 0, newPaid: 0, cancellations: 0, expirations: 0 };
  });
  const totals: RevenueComputation['totals'] = {
    trialsStarted: 0,
    trialConversions: 0,
    newPaid: 0,
    renewals: 0,
    uncancellations: 0,
    productChanges: 0,
    cancellations: 0,
    refunds: 0,
    billingIssues: 0,
    expirations: 0,
    eventsCounted: 0,
    sandboxIgnored: 0,
  };

  for (const raw of rawMarkers) {
    const parsed = revenueMarkerSchema.safeParse(raw);
    if (!parsed.success) continue;
    const marker = parsed.data;
    if ((marker.environment ?? '').toUpperCase() === 'SANDBOX') {
      totals.sandboxIgnored += 1;
      continue;
    }
    const receivedMs = Date.parse(marker.receivedAt);
    const day = Number.isNaN(receivedMs) ? undefined : days[dayIndex.get(usageDayKey(new Date(receivedMs))) ?? -1];
    const periodType = (marker.periodType ?? '').toUpperCase();
    switch (marker.type) {
      case 'INITIAL_PURCHASE':
        if (periodType === 'NORMAL' || periodType === 'INTRO') {
          totals.newPaid += 1;
          if (day) day.newPaid += 1;
        } else {
          totals.trialsStarted += 1;
          if (day) day.trialsStarted += 1;
        }
        break;
      case 'RENEWAL':
        if (marker.isTrialConversion === true) {
          totals.trialConversions += 1;
          totals.newPaid += 1;
          if (day) day.newPaid += 1;
        } else {
          totals.renewals += 1;
        }
        break;
      case 'UNCANCELLATION':
        totals.uncancellations += 1;
        break;
      case 'PRODUCT_CHANGE':
        totals.productChanges += 1;
        break;
      case 'BILLING_ISSUE':
        totals.billingIssues += 1;
        break;
      case 'CANCELLATION':
        if ((marker.cancelReason ?? '').toUpperCase() === 'CUSTOMER_SUPPORT') {
          totals.refunds += 1;
        } else {
          totals.cancellations += 1;
          if (day) day.cancellations += 1;
        }
        break;
      case 'EXPIRATION':
        totals.expirations += 1;
        if (day) day.expirations += 1;
        break;
      default:
        continue;
    }
    totals.eventsCounted += 1;
  }

  const active: RevenueComputation['active'] = {
    paying: 0,
    gracePeriod: 0,
    byPlan: { pro: 0, premium: 0 },
    byStore: { playStore: 0, appStore: 0, other: 0 },
    comps: 0,
  };
  let mrr = 0;
  let measuredPriceCount = 0;
  let defaultPriceCount = 0;
  const nowMs = now.getTime();
  for (const raw of rawEntitlements) {
    const parsed = revenueEntitlementSchema.safeParse(raw);
    if (!parsed.success) continue;
    const doc = parsed.data;
    if (doc.plan === 'free') continue;
    if (doc.status !== 'active' && doc.status !== 'grace_period') continue;
    const expiresMs = typeof doc.expiresAt === 'string' ? Date.parse(doc.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) continue;
    if (doc.source !== 'revenuecat') {
      active.comps += 1;
      continue;
    }
    active.paying += 1;
    if (doc.status === 'grace_period') active.gracePeriod += 1;
    active.byPlan[doc.plan] += 1;
    active.byStore[storeBucket(doc.billing?.store)] += 1;
    const monthly = monthlyRevenueUsd(doc.plan, doc.billing);
    mrr += monthly.usd;
    if (monthly.measured) measuredPriceCount += 1;
    else defaultPriceCount += 1;
  }

  return {
    since,
    days,
    totals,
    active,
    mrr: { estimateUsd: round2(mrr), measuredPriceCount, defaultPriceCount },
  };
}
