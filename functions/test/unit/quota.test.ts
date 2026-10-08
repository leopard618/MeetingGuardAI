import { consumeQuota, evaluateQuota, refundQuota } from '../../src/assistant/quota';
import { resolveEffectivePlan } from '../../src/shared/entitlement';
import { FakeQuotaStore } from './fakes';

const NOW = new Date('2026-10-05T23:30:00.000Z');
const DAY = '2026-10-05';

describe('evaluateQuota', () => {
  it('allows requests below the plan limit and counts this one', () => {
    expect(evaluateQuota({ currentCount: 0, plan: 'free', now: NOW })).toEqual({
      allowed: true,
      nextCount: 1,
      usage: { used: 1, limit: 5, plan: 'free', resetsAt: '2026-10-06T00:00:00.000Z' },
    });
    expect(evaluateQuota({ currentCount: 4, plan: 'free', now: NOW }).allowed).toBe(true);
  });

  it('denies requests at the limit without counting them', () => {
    const result = evaluateQuota({ currentCount: 5, plan: 'free', now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.nextCount).toBe(5);
    expect(result.usage.used).toBe(5);
  });

  it('uses the per-plan limits', () => {
    expect(evaluateQuota({ currentCount: 99, plan: 'pro', now: NOW }).allowed).toBe(true);
    expect(evaluateQuota({ currentCount: 100, plan: 'pro', now: NOW }).allowed).toBe(false);
    expect(evaluateQuota({ currentCount: 499, plan: 'premium', now: NOW }).usage.limit).toBe(500);
    expect(evaluateQuota({ currentCount: 500, plan: 'premium', now: NOW }).allowed).toBe(false);
  });

  it('treats malformed counts as zero', () => {
    expect(evaluateQuota({ currentCount: -3, plan: 'free', now: NOW }).nextCount).toBe(1);
    expect(evaluateQuota({ currentCount: 1.5, plan: 'free', now: NOW }).nextCount).toBe(1);
  });
});

describe('resolveEffectivePlan', () => {
  it('defaults to free and honours status and expiry', () => {
    expect(resolveEffectivePlan(undefined, NOW)).toEqual({ plan: 'free', valid: true });
    expect(resolveEffectivePlan({ plan: 'pro', status: 'active', expiresAt: null }, NOW)).toEqual({ plan: 'pro', valid: true });
    expect(resolveEffectivePlan({ plan: 'premium', status: 'grace_period' }, NOW).plan).toBe('premium');
    expect(resolveEffectivePlan({ plan: 'pro', status: 'expired', expiresAt: null }, NOW).plan).toBe('free');
    expect(resolveEffectivePlan({ plan: 'pro', status: 'revoked', expiresAt: null }, NOW).plan).toBe('free');
    expect(resolveEffectivePlan({ plan: 'pro', status: 'active', expiresAt: '2026-10-01T00:00:00.000Z' }, NOW).plan).toBe('free');
    expect(resolveEffectivePlan({ plan: 'pro', status: 'active', expiresAt: '2026-11-01T00:00:00.000Z' }, NOW).plan).toBe('pro');
  });

  it('treats malformed documents as free and flags them', () => {
    expect(resolveEffectivePlan({ plan: 'gold', status: 'active' }, NOW)).toEqual({ plan: 'free', valid: false });
    expect(resolveEffectivePlan({ plan: 'pro', status: 'active', expiresAt: 'soon' }, NOW)).toEqual({ plan: 'free', valid: false });
  });
});

describe('consumeQuota (transaction)', () => {
  it('increments the UTC-day counter and reports usage', async () => {
    const store = new FakeQuotaStore();
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision).toMatchObject({ allowed: true, dayKey: DAY, entitlementValid: true });
    expect(decision.usage).toEqual({ used: 1, limit: 5, plan: 'free', resetsAt: '2026-10-06T00:00:00.000Z' });
    expect(store.usage.get(`u1/${DAY}`)).toEqual({ count: 1, updatedAt: NOW.toISOString() });
  });

  it('reads the plan from the entitlement inside the transaction', async () => {
    const store = new FakeQuotaStore();
    store.entitlements.set('u1', { plan: 'pro', status: 'active', expiresAt: null });
    store.usage.set(`u1/${DAY}`, { count: 7, updatedAt: NOW.toISOString() });
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision.allowed).toBe(true);
    expect(decision.usage).toMatchObject({ used: 8, limit: 100, plan: 'pro' });
  });

  it('reports malformed entitlements', async () => {
    const store = new FakeQuotaStore();
    store.entitlements.set('u1', { plan: 'enterprise' });
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision).toMatchObject({ allowed: true, entitlementValid: false });
    expect(decision.usage.plan).toBe('free');
  });

  it('does not write when the quota is exhausted', async () => {
    const store = new FakeQuotaStore();
    store.usage.set(`u1/${DAY}`, { count: 5, updatedAt: 'x' });
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision.allowed).toBe(false);
    expect(store.usage.get(`u1/${DAY}`)).toEqual({ count: 5, updatedAt: 'x' });
  });

  it('is atomic under concurrent requests', async () => {
    const store = new FakeQuotaStore();
    const decisions = await Promise.all(Array.from({ length: 12 }, () => consumeQuota(store, 'u1', NOW)));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(store.count('u1', DAY)).toBe(5);
  });

  it('keeps users and UTC days separate', async () => {
    const store = new FakeQuotaStore();
    await consumeQuota(store, 'u1', NOW);
    await consumeQuota(store, 'u2', NOW);
    await consumeQuota(store, 'u1', new Date('2026-10-06T00:00:01.000Z'));
    expect(store.count('u1', DAY)).toBe(1);
    expect(store.count('u2', DAY)).toBe(1);
    expect(store.count('u1', '2026-10-06')).toBe(1);
  });

  it('refunds one request and never goes below zero', async () => {
    const store = new FakeQuotaStore();
    await consumeQuota(store, 'u1', NOW);
    await consumeQuota(store, 'u1', NOW);
    await refundQuota(store, 'u1', DAY, NOW);
    expect(store.count('u1', DAY)).toBe(1);
    await refundQuota(store, 'u1', DAY, NOW);
    await refundQuota(store, 'u1', DAY, NOW);
    expect(store.count('u1', DAY)).toBe(0);
  });
});
