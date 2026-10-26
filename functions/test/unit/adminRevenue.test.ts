import { handleGetRevenue, type AdminCaller, type AdminRevenuePorts } from '../../src/admin';
import {
  computeRevenue,
  DEFAULT_PLAN_PRICES_USD,
  isYearlyProduct,
  monthlyRevenueUsd,
  storeBucket,
} from '../../src/admin/revenue';
import { getRevenueResponseSchema } from '../../src/admin/schemas';

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const admin: AdminCaller = { uid: 'admin-1', isAdmin: true };
const mortal: AdminCaller = { uid: 'user-1', isAdmin: false };
const now = new Date('2026-10-26T12:00:00.000Z');
const DAYS_7 = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];
const SINCE = '2026-10-20T00:00:00.000Z';

function marker(type: string, receivedAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, receivedAt, environment: 'PRODUCTION', store: 'PLAY_STORE', eventTimestampMs: Date.parse(receivedAt), ...extra };
}

function fakePorts(markers: unknown[] = [], entitlements: unknown[] = []) {
  const calls: string[] = [];
  const ports: AdminRevenuePorts = {
    listRevenueMarkers: jest.fn(async (since: string) => {
      calls.push(`markers:${since}`);
      return markers;
    }),
    listEntitlements: jest.fn(async () => {
      calls.push('entitlements');
      return entitlements;
    }),
  };
  return { ports, calls };
}

describe('handleGetRevenue', () => {
  it('enforces auth before touching any port', async () => {
    const unauthenticated = fakePorts();
    await expect(handleGetRevenue(null, { days: 7 }, unauthenticated.ports, now)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(unauthenticated.calls).toEqual([]);
    const denied = fakePorts();
    await expect(handleGetRevenue(mortal, { days: 7 }, denied.ports, now)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(denied.calls).toEqual([]);
  });

  it('rejects an unsupported range', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleGetRevenue(admin, { days: 14 }, ports, now)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(calls).toEqual([]);
  });

  it('queries markers from the first day of the range and returns a schema-valid, zero-filled response', async () => {
    const { ports, calls } = fakePorts();
    const response = await handleGetRevenue(admin, { days: 7 }, ports, now);
    expect(calls).toEqual([`markers:${SINCE}`, 'entitlements']);
    expect(getRevenueResponseSchema.parse(response)).toEqual(response);
    expect(response.since).toBe(SINCE);
    expect(response.days.map((d) => d.date)).toEqual(DAYS_7);
    expect(response.days.every((d) => d.trialsStarted === 0 && d.newPaid === 0 && d.cancellations === 0 && d.expirations === 0)).toBe(true);
    expect(response.active).toEqual({ paying: 0, gracePeriod: 0, byPlan: { pro: 0, premium: 0 }, byStore: { playStore: 0, appStore: 0, other: 0 }, comps: 0 });
    expect(response.mrr).toEqual({ estimateUsd: 0, measuredPriceCount: 0, defaultPriceCount: 0 });
  });
});

describe('computeRevenue: events', () => {
  it('buckets each event type once and ignores sandbox, transfers and garbage', () => {
    const markers = [
      marker('INITIAL_PURCHASE', '2026-10-21T09:00:00.000Z', { periodType: 'TRIAL', plan: 'pro' }),
      marker('INITIAL_PURCHASE', '2026-10-21T10:00:00.000Z', { periodType: 'NORMAL', plan: 'premium', priceUsd: 14.99 }),
      marker('INITIAL_PURCHASE', '2026-10-22T10:00:00.000Z'), // legacy marker, no periodType -> trial start
      marker('RENEWAL', '2026-10-24T10:00:00.000Z', { isTrialConversion: true, plan: 'pro', priceUsd: 7.99 }),
      marker('RENEWAL', '2026-10-24T11:00:00.000Z', { isTrialConversion: false }),
      marker('UNCANCELLATION', '2026-10-24T12:00:00.000Z'),
      marker('PRODUCT_CHANGE', '2026-10-24T13:00:00.000Z'),
      marker('BILLING_ISSUE', '2026-10-25T08:00:00.000Z'),
      marker('CANCELLATION', '2026-10-25T09:00:00.000Z', { cancelReason: 'UNSUBSCRIBE' }),
      marker('CANCELLATION', '2026-10-25T10:00:00.000Z', { cancelReason: 'CUSTOMER_SUPPORT' }),
      marker('EXPIRATION', '2026-10-26T06:00:00.000Z', { expirationReason: 'UNSUBSCRIBE' }),
      marker('TRANSFER', '2026-10-26T07:00:00.000Z'),
      marker('INITIAL_PURCHASE', '2026-10-26T08:00:00.000Z', { environment: 'SANDBOX', periodType: 'NORMAL' }),
      marker('EXPIRATION', '2026-10-01T08:00:00.000Z'), // outside the day range: totals yes, no day bucket
      { type: 'INITIAL_PURCHASE' }, // no receivedAt -> skipped
      'garbage',
      null,
    ];
    const result = computeRevenue(markers, [], DAYS_7, now, SINCE);
    expect(result.totals).toEqual({
      trialsStarted: 2,
      trialConversions: 1,
      newPaid: 2,
      renewals: 1,
      uncancellations: 1,
      productChanges: 1,
      cancellations: 1,
      refunds: 1,
      billingIssues: 1,
      expirations: 2,
      eventsCounted: 12,
      sandboxIgnored: 1,
    });
    const byDate = Object.fromEntries(result.days.map((d) => [d.date, d]));
    expect(byDate['2026-10-21']).toEqual({ date: '2026-10-21', trialsStarted: 1, newPaid: 1, cancellations: 0, expirations: 0 });
    expect(byDate['2026-10-22']).toEqual({ date: '2026-10-22', trialsStarted: 1, newPaid: 0, cancellations: 0, expirations: 0 });
    expect(byDate['2026-10-24']).toEqual({ date: '2026-10-24', trialsStarted: 0, newPaid: 1, cancellations: 0, expirations: 0 });
    expect(byDate['2026-10-25']).toEqual({ date: '2026-10-25', trialsStarted: 0, newPaid: 0, cancellations: 1, expirations: 0 });
    expect(byDate['2026-10-26']).toEqual({ date: '2026-10-26', trialsStarted: 0, newPaid: 0, cancellations: 0, expirations: 1 });
    expect(getRevenueResponseSchema.parse(result)).toEqual(result);
  });
});

describe('computeRevenue: paying users and MRR', () => {
  const entitlement = (over: Record<string, unknown>) => ({
    plan: 'pro',
    status: 'active',
    expiresAt: '2026-11-20T00:00:00.000Z',
    source: 'revenuecat',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...over,
  });

  it('counts active revenuecat entitlements by plan and store, comps apart, expired and free never', () => {
    const entitlements = [
      entitlement({ billing: { store: 'PLAY_STORE', productId: 'pro_monthly:p1m', periodType: 'NORMAL', priceUsd: 7.99, currency: 'USD' } }),
      entitlement({ plan: 'premium', status: 'grace_period', billing: { store: 'APP_STORE', productId: 'premium_yearly', priceUsd: 134.99 } }),
      entitlement({ plan: 'premium' }), // no billing block (pre-2026-10-26 document): list price, store unknown
      entitlement({ source: 'admin', expiresAt: null }), // comp: counted apart, not in MRR
      entitlement({ status: 'expired' }),
      entitlement({ status: 'revoked' }),
      entitlement({ expiresAt: '2026-10-25T00:00:00.000Z' }), // past expiry
      entitlement({ plan: 'free', source: 'admin', expiresAt: null }),
      { plan: 'pro' }, // malformed -> skipped
    ];
    const result = computeRevenue([], entitlements, DAYS_7, now, SINCE);
    expect(result.active).toEqual({
      paying: 3,
      gracePeriod: 1,
      byPlan: { pro: 1, premium: 2 },
      byStore: { playStore: 1, appStore: 1, other: 1 },
      comps: 1,
    });
    const expected = 7.99 + 134.99 / 12 + DEFAULT_PLAN_PRICES_USD.premium.monthly;
    expect(result.mrr).toEqual({ estimateUsd: Math.round(expected * 100) / 100, measuredPriceCount: 2, defaultPriceCount: 1 });
  });

  it('monthlyRevenueUsd divides yearly prices by 12 and falls back to the list price', () => {
    expect(monthlyRevenueUsd('pro', { productId: 'pro_yearly:p1y', priceUsd: 69.99 })).toEqual({ usd: 69.99 / 12, measured: true });
    expect(monthlyRevenueUsd('pro', { productId: 'pro_monthly', priceUsd: 0 })).toEqual({ usd: 7.99, measured: false });
    expect(monthlyRevenueUsd('premium', null)).toEqual({ usd: 14.99, measured: false });
    expect(monthlyRevenueUsd('premium', { productId: 'premium_annual' })).toEqual({ usd: 134.99 / 12, measured: false });
  });

  it('recognises yearly products and store buckets', () => {
    expect(isYearlyProduct('pro_yearly:p1y')).toBe(true);
    expect(isYearlyProduct('premium_annual')).toBe(true);
    expect(isYearlyProduct('premium_12m')).toBe(true);
    expect(isYearlyProduct('pro_monthly:p1m')).toBe(false);
    expect(isYearlyProduct(null)).toBe(false);
    expect(storeBucket('PLAY_STORE')).toBe('playStore');
    expect(storeBucket('APP_STORE')).toBe('appStore');
    expect(storeBucket('MAC_APP_STORE')).toBe('appStore');
    expect(storeBucket('STRIPE')).toBe('other');
    expect(storeBucket(null)).toBe('other');
  });
});
