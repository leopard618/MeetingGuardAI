/**
 * Unit tests of the pure RevenueCat event -> entitlement mapping (src/revenuecat/mapping.ts):
 * one case per event type of the §20 decision table, plan resolution and anonymous-id detection.
 */
import {
  entitlementFromEvent,
  isAnonymousAppUserId,
  planFromEvent,
  revenueCatWebhookBodySchema,
  type RevenueCatEvent,
} from '../../src/revenuecat/mapping';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const EXP_MS = Date.parse('2026-10-30T12:00:00.000Z');
const GRACE_MS = Date.parse('2026-10-16T12:00:00.000Z');
const EVENT_MS = Date.parse('2026-09-30T11:59:00.000Z');

function event(overrides: Partial<RevenueCatEvent>): RevenueCatEvent {
  return {
    id: 'evt-1',
    type: 'INITIAL_PURCHASE',
    app_user_id: 'uid-1',
    entitlement_ids: ['pro'],
    product_id: 'pro_monthly',
    expiration_at_ms: EXP_MS,
    event_timestamp_ms: EVENT_MS,
    ...overrides,
  };
}

describe('planFromEvent', () => {
  it('premium wins over pro; product id is the fallback; unknown ids resolve to null', () => {
    expect(planFromEvent({ entitlement_ids: ['pro', 'premium'], product_id: null, new_product_id: null })).toBe('premium');
    expect(planFromEvent({ entitlement_ids: ['vip'], product_id: 'pro_yearly', new_product_id: null })).toBe('pro');
    expect(planFromEvent({ entitlement_ids: null, product_id: 'premium_monthly', new_product_id: null })).toBe('premium');
    // PRODUCT_CHANGE: the NEW product decides.
    expect(planFromEvent({ entitlement_ids: null, product_id: 'pro_monthly', new_product_id: 'premium_yearly' })).toBe('premium');
    expect(planFromEvent({ entitlement_ids: null, product_id: 'lifetime_deal', new_product_id: null })).toBeNull();
  });
});

describe('entitlementFromEvent', () => {
  const activeTypes = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED'] as const;

  it.each(activeTypes)('%s -> active with the store expiry', (type) => {
    expect(entitlementFromEvent(event({ type }), NOW)).toEqual({
      plan: 'pro',
      status: 'active',
      expiresAt: '2026-10-30T12:00:00.000Z',
      source: 'revenuecat',
      updatedAt: '2026-09-30T11:59:00.000Z',
    });
  });

  it('CANCELLATION keeps access until expiry (auto-renew off), except refunds which revoke', () => {
    expect(entitlementFromEvent(event({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }), NOW)).toMatchObject({
      status: 'active',
      expiresAt: '2026-10-30T12:00:00.000Z',
    });
    expect(entitlementFromEvent(event({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }), NOW)).toMatchObject({
      status: 'revoked',
    });
  });

  it('BILLING_ISSUE -> grace_period until the grace end (expiry as the fallback)', () => {
    expect(entitlementFromEvent(event({ type: 'BILLING_ISSUE', grace_period_expiration_at_ms: GRACE_MS }), NOW)).toMatchObject({
      status: 'grace_period',
      expiresAt: '2026-10-16T12:00:00.000Z',
    });
    expect(entitlementFromEvent(event({ type: 'BILLING_ISSUE', grace_period_expiration_at_ms: null }), NOW)).toMatchObject({
      status: 'grace_period',
      expiresAt: '2026-10-30T12:00:00.000Z',
    });
  });

  it('EXPIRATION -> expired (effectivePlan() then yields free)', () => {
    expect(entitlementFromEvent(event({ type: 'EXPIRATION' }), NOW)).toMatchObject({ plan: 'pro', status: 'expired' });
  });

  it('TEST, unknown types and unmappable plans map to null (no entitlement write)', () => {
    expect(entitlementFromEvent(event({ type: 'TEST' }), NOW)).toBeNull();
    expect(entitlementFromEvent(event({ type: 'SOMETHING_NEW' }), NOW)).toBeNull();
    expect(entitlementFromEvent(event({ type: 'TRANSFER' }), NOW)).toBeNull(); // handler-resolved
    expect(entitlementFromEvent(event({ entitlement_ids: [], product_id: 'mystery' }), NOW)).toBeNull();
  });

  it('falls back to `now` when the event carries no timestamp', () => {
    expect(entitlementFromEvent(event({ event_timestamp_ms: null }), NOW)?.updatedAt).toBe(NOW.toISOString());
  });
});

describe('schema + anonymous ids', () => {
  it('parses a realistic webhook body and tolerates unknown event types', () => {
    const body = { api_version: '1.0', event: { id: 'e', type: 'BRAND_NEW_TYPE', app_user_id: 'uid' } };
    expect(revenueCatWebhookBodySchema.safeParse(body).success).toBe(true);
    expect(revenueCatWebhookBodySchema.safeParse({ event: {} }).success).toBe(false);
  });

  it('detects RevenueCat anonymous ids', () => {
    expect(isAnonymousAppUserId('$RCAnonymousID:abc123')).toBe(true);
    expect(isAnonymousAppUserId('uid-1')).toBe(false);
  });
});
