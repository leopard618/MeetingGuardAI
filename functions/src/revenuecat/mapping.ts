/**
 * RevenueCat webhook -> entitlements/{uid} mapping (owner: billing; docs/v1/ARCHITECTURE.md §20).
 * PURE: no firebase imports, unit-tested standalone.
 *
 * Webhook shape (RevenueCat "Webhooks" integration): POST body { api_version: "1.0", event },
 * with the shared secret sent VERBATIM in the `Authorization` header (configured in the
 * RevenueCat dashboard; the function compares it against the REVENUECAT_WEBHOOK_AUTH secret).
 * `event.id` is stable across retries and is the idempotency key
 * (revenuecatEvents/{event.id} marker documents; see the handler contract in §20).
 *
 * `app_user_id` IS the Firebase uid because the app calls Purchases.configure({ appUserID: uid })
 * on session start. Anonymous ids ("$RCAnonymousID:...") are ignored with a log.
 */
import { z } from 'zod';

import { PLANS, type Plan } from '../shared/aiContract';

/** Event types this webhook reacts to (anything else is acknowledged with 200 and ignored). */
export const HANDLED_EVENT_TYPES = [
  'TEST',
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
  'TRANSFER',
] as const;

/** Lenient event reader: only the fields the mapping needs; unknown types still parse. */
export const revenueCatEventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  app_user_id: z.string().max(200).optional().nullable(),
  /** RevenueCat entitlement identifiers; ours are exactly 'pro' and 'premium'. */
  entitlement_ids: z.array(z.string()).optional().nullable(),
  product_id: z.string().optional().nullable(),
  period_type: z.string().optional().nullable(),
  purchased_at_ms: z.number().optional().nullable(),
  expiration_at_ms: z.number().optional().nullable(),
  grace_period_expiration_at_ms: z.number().optional().nullable(),
  cancel_reason: z.string().optional().nullable(),
  new_product_id: z.string().optional().nullable(),
  event_timestamp_ms: z.number().optional().nullable(),
  environment: z.string().optional().nullable(),
  store: z.string().optional().nullable(),
  /** TRANSFER only: RevenueCat ids that gained / lost the purchases. */
  transferred_to: z.array(z.string()).optional().nullable(),
  transferred_from: z.array(z.string()).optional().nullable(),
  /** Billing facts kept for the admin revenue view (never used for entitlement decisions). */
  price: z.number().optional().nullable(),
  currency: z.string().optional().nullable(),
  is_trial_conversion: z.boolean().optional().nullable(),
  expiration_reason: z.string().optional().nullable(),
});
export type RevenueCatEvent = z.infer<typeof revenueCatEventSchema>;

export const revenueCatWebhookBodySchema = z.object({
  api_version: z.string(),
  event: revenueCatEventSchema,
});

/** Exactly the entitlements/{uid} document the app reads (src/core/types.ts entitlementSchema). */
export interface EntitlementWrite {
  plan: Plan;
  status: 'active' | 'grace_period' | 'expired' | 'revoked';
  expiresAt: string | null;
  source: 'revenuecat';
  updatedAt: string;
}

/** True for RevenueCat anonymous ids, which can never be a Firebase uid. */
export function isAnonymousAppUserId(appUserId: string): boolean {
  return appUserId.startsWith('$RCAnonymousID:');
}

/** 'premium' wins over 'pro'; unknown entitlement ids are ignored; product id is the fallback. */
export function planFromEvent(event: Pick<RevenueCatEvent, 'entitlement_ids' | 'product_id' | 'new_product_id'>): Plan | null {
  const ids = new Set(event.entitlement_ids ?? []);
  if (ids.has('premium')) return 'premium';
  if (ids.has('pro')) return 'pro';
  const product = event.new_product_id ?? event.product_id ?? '';
  for (const plan of PLANS) {
    if (plan !== 'free' && product.startsWith(`${plan}_`)) return plan;
  }
  return null;
}

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Maps one subscription-lifecycle event to the entitlement document to write, or null when the
 * event needs no entitlement write (TEST, unknown types, unmappable plan, and TRANSFER - the
 * handler resolves TRANSFER itself because it writes TWO uids: `transferred_to` gains the plan,
 * `transferred_from` gets status 'expired').
 *
 * Decision table:
 * - INITIAL_PURCHASE / RENEWAL / UNCANCELLATION / NON_RENEWING_PURCHASE / PRODUCT_CHANGE /
 *   SUBSCRIPTION_EXTENDED           -> { plan, 'active', expiresAt }
 * - CANCELLATION, cancel_reason 'CUSTOMER_SUPPORT' (refund) -> { plan, 'revoked' }
 * - CANCELLATION otherwise (auto-renew off; access runs until expiry) -> { plan, 'active', expiresAt }
 * - BILLING_ISSUE                   -> { plan, 'grace_period', grace end (fallback expiresAt) }
 * - EXPIRATION                      -> { plan, 'expired' } (effectivePlan() then yields free)
 */
export function entitlementFromEvent(event: RevenueCatEvent, now: Date): EntitlementWrite | null {
  const plan = planFromEvent(event);
  if (plan === null) return null;
  const updatedAt = iso(event.event_timestamp_ms) ?? now.toISOString();
  const expiresAt = iso(event.expiration_at_ms);
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'NON_RENEWING_PURCHASE':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
      return { plan, status: 'active', expiresAt, source: 'revenuecat', updatedAt };
    case 'CANCELLATION':
      return event.cancel_reason === 'CUSTOMER_SUPPORT'
        ? { plan, status: 'revoked', expiresAt, source: 'revenuecat', updatedAt }
        : { plan, status: 'active', expiresAt, source: 'revenuecat', updatedAt };
    case 'BILLING_ISSUE':
      return {
        plan,
        status: 'grace_period',
        expiresAt: iso(event.grace_period_expiration_at_ms) ?? expiresAt,
        source: 'revenuecat',
        updatedAt,
      };
    case 'EXPIRATION':
      return { plan, status: 'expired', expiresAt, source: 'revenuecat', updatedAt };
    default:
      return null;
  }
}

/**
 * Billing facts the revenue view needs, stored on the webhook marker and next to the entitlement
 * (entitlements/{uid}.billing). Pure data: the entitlement decision above never reads them.
 * `price` is RevenueCat's USD amount for purchase/renewal events (null on cancellations etc.).
 */
export interface BillingInfo {
  store: string | null;
  productId: string | null;
  periodType: string | null;
  priceUsd: number | null;
  currency: string | null;
}

export function billingFromEvent(
  event: Pick<RevenueCatEvent, 'store' | 'product_id' | 'new_product_id' | 'period_type' | 'price' | 'currency'>,
): BillingInfo {
  const price = event.price;
  return {
    store: event.store ?? null,
    productId: event.new_product_id ?? event.product_id ?? null,
    periodType: event.period_type ?? null,
    priceUsd: typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null,
    currency: event.currency ?? null,
  };
}
