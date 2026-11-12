/**
 * Assistant allowances (ARCHITECTURE section 35): the introductory free window, the monthly paid
 * cycles on the subscription anniversary, refunds and the clarification run.
 */
import {
  EMPTY_USAGE_ROOT,
  consumeQuota,
  evaluateQuota,
  paidCycle,
  readUsageRoot,
  refundQuota,
  settleClarification,
  subscriptionCycle,
  type UsageRoot,
} from '../../src/assistant/quota';
import { resolveEffectivePlan, withStartedAt } from '../../src/shared/entitlement';
import { FakeQuotaStore } from './fakes';

const NOW = new Date('2026-10-05T23:30:00.000Z');
const DAY = '2026-10-05';
const WINDOW_END = '2026-10-12T23:30:00.000Z';

function root(overrides: Partial<UsageRoot> = {}): UsageRoot {
  return { ...EMPTY_USAGE_ROOT, ...overrides };
}

describe('evaluateQuota: free introductory allowance', () => {
  it('starts the 7-day window with the first action and counts it against the total of 10', () => {
    const decision = evaluateQuota({ plan: 'free', startedAt: null, dayCount: 0, root: root(), now: NOW });
    expect(decision.allowed).toBe(true);
    expect(decision.usage).toEqual({ used: 1, limit: 10, plan: 'free', resetsAt: WINDOW_END, period: 'window' });
    expect(decision.nextDayCount).toBe(1);
    expect(decision.nextRoot).toMatchObject({ introStartedAt: NOW.toISOString(), introUsed: 1 });
    expect(decision.charges).toEqual({ day: true, intro: true, cycle: null });
  });

  it('allows at most 3 actions per UTC day inside the window', () => {
    const started = root({ introStartedAt: '2026-10-03T10:00:00.000Z', introUsed: 5 });
    const denied = evaluateQuota({ plan: 'free', startedAt: null, dayCount: 3, root: started, now: NOW });
    expect(denied.allowed).toBe(false);
    expect(denied.usage).toEqual({ used: 3, limit: 3, plan: 'free', resetsAt: '2026-10-06T00:00:00.000Z', period: 'day' });
    expect(denied.charges).toEqual({ day: false, intro: false, cycle: null });
    const allowed = evaluateQuota({ plan: 'free', startedAt: null, dayCount: 2, root: started, now: NOW });
    expect(allowed.allowed).toBe(true);
    expect(allowed.usage).toMatchObject({ used: 6, limit: 10, period: 'window', resetsAt: '2026-10-10T10:00:00.000Z' });
  });

  it('requires a subscription once the 10 are used or the window has ended', () => {
    const usedUp = evaluateQuota({ plan: 'free', startedAt: null, dayCount: 0, root: root({ introStartedAt: '2026-10-03T10:00:00.000Z', introUsed: 10 }), now: NOW });
    expect(usedUp.allowed).toBe(false);
    expect(usedUp.usage).toEqual({ used: 10, limit: 10, plan: 'free', resetsAt: '2026-10-10T10:00:00.000Z', period: 'window', subscriptionRequired: true });
    const ended = evaluateQuota({ plan: 'free', startedAt: null, dayCount: 0, root: root({ introStartedAt: '2026-09-20T10:00:00.000Z', introUsed: 2 }), now: NOW });
    expect(ended.allowed).toBe(false);
    expect(ended.usage).toMatchObject({ used: 2, limit: 10, period: 'window', subscriptionRequired: true, resetsAt: '2026-09-27T10:00:00.000Z' });
  });
});

describe('evaluateQuota: paid monthly cycles', () => {
  it('counts 100 (pro) and 400 (premium) per cycle and keys the counter by the cycle start', () => {
    const pro = evaluateQuota({ plan: 'pro', startedAt: '2026-08-20T09:15:00.000Z', dayCount: 0, root: root(), now: NOW });
    expect(pro.allowed).toBe(true);
    expect(pro.usage).toEqual({ used: 1, limit: 100, plan: 'pro', resetsAt: '2026-10-20T09:15:00.000Z', period: 'month' });
    expect(pro.nextRoot).toMatchObject({ cycleKey: '2026-09-20T09:15:00.000Z', cycleUsed: 1 });
    expect(pro.charges).toEqual({ day: true, intro: false, cycle: '2026-09-20T09:15:00.000Z' });
    const premium = evaluateQuota({ plan: 'premium', startedAt: '2026-08-20T09:15:00.000Z', dayCount: 0, root: root(), now: NOW });
    expect(premium.usage).toMatchObject({ limit: 400 });
  });

  it('starts a fresh counter when the cycle key changed and denies at the limit', () => {
    const previousCycle = root({ cycleKey: '2026-08-20T09:15:00.000Z', cycleUsed: 100 });
    const fresh = evaluateQuota({ plan: 'pro', startedAt: '2026-08-20T09:15:00.000Z', dayCount: 0, root: previousCycle, now: NOW });
    expect(fresh.allowed).toBe(true);
    expect(fresh.usage.used).toBe(1);
    const full = root({ cycleKey: '2026-09-20T09:15:00.000Z', cycleUsed: 100 });
    const denied = evaluateQuota({ plan: 'pro', startedAt: '2026-08-20T09:15:00.000Z', dayCount: 0, root: full, now: NOW });
    expect(denied.allowed).toBe(false);
    expect(denied.usage).toEqual({ used: 100, limit: 100, plan: 'pro', resetsAt: '2026-10-20T09:15:00.000Z', period: 'month' });
  });

  it('falls back to the UTC calendar month when the subscription start is unknown', () => {
    const decision = evaluateQuota({ plan: 'pro', startedAt: null, dayCount: 0, root: root(), now: NOW });
    expect(decision.usage.resetsAt).toBe('2026-11-01T00:00:00.000Z');
    expect(decision.nextRoot.cycleKey).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('subscription cycles', () => {
  it('renews on the monthly anniversary, clamped to the month length', () => {
    expect(subscriptionCycle(new Date('2026-01-31T08:00:00.000Z'), new Date('2026-02-15T00:00:00.000Z'))).toEqual({
      start: new Date('2026-01-31T08:00:00.000Z'),
      end: new Date('2026-02-28T08:00:00.000Z'),
    });
    expect(subscriptionCycle(new Date('2026-01-31T08:00:00.000Z'), new Date('2026-03-01T00:00:00.000Z'))).toEqual({
      start: new Date('2026-02-28T08:00:00.000Z'),
      end: new Date('2026-03-31T08:00:00.000Z'),
    });
    // A yearly subscriber gets the same monthly cycles.
    expect(subscriptionCycle(new Date('2025-11-05T12:00:00.000Z'), NOW)).toEqual({
      start: new Date('2026-10-05T12:00:00.000Z'),
      end: new Date('2026-11-05T12:00:00.000Z'),
    });
    // The first cycle starts at the subscription itself, never before.
    expect(subscriptionCycle(new Date('2026-10-01T12:00:00.000Z'), NOW).start).toEqual(new Date('2026-10-01T12:00:00.000Z'));
  });

  it('paidCycle ignores an unparseable or future start', () => {
    expect(paidCycle('nonsense', NOW).start).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(paidCycle('2027-01-01T00:00:00.000Z', NOW).start).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });
});

describe('resolveEffectivePlan and startedAt', () => {
  it('defaults to free and honours status and expiry', () => {
    expect(resolveEffectivePlan(undefined, NOW)).toEqual({ plan: 'free', valid: true, startedAt: null });
    expect(resolveEffectivePlan({ plan: 'pro', status: 'active', expiresAt: null, startedAt: '2026-09-01T00:00:00.000Z' }, NOW)).toEqual({
      plan: 'pro',
      valid: true,
      startedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(resolveEffectivePlan({ plan: 'pro', status: 'expired' }, NOW)).toEqual({ plan: 'free', valid: true, startedAt: null });
    expect(resolveEffectivePlan({ plan: 'premium', status: 'active', expiresAt: '2026-10-05T00:00:00.000Z' }, NOW)).toEqual({ plan: 'free', valid: true, startedAt: null });
    expect(resolveEffectivePlan({ plan: 'pro', status: 'active', startedAt: 'garbage' }, NOW)).toMatchObject({ plan: 'pro', startedAt: null });
  });

  it('treats malformed documents as free and flags them', () => {
    expect(resolveEffectivePlan({ plan: 'gold', status: 'active' }, NOW)).toEqual({ plan: 'free', valid: false, startedAt: null });
    expect(resolveEffectivePlan({ plan: 'pro', status: 'active', expiresAt: 'soon' }, NOW)).toEqual({ plan: 'free', valid: false, startedAt: null });
  });

  it('withStartedAt keeps the start across renewals and resets it for a new subscription', () => {
    const renewal = { plan: 'pro' as const, status: 'active' as const, expiresAt: '2026-11-05T00:00:00.000Z' };
    const stored = { plan: 'pro', status: 'active', startedAt: '2026-08-05T00:00:00.000Z' };
    expect(withStartedAt(stored, renewal, '2026-10-05T00:00:00.000Z').startedAt).toBe('2026-08-05T00:00:00.000Z');
    expect(withStartedAt({ ...stored, status: 'grace_period' }, renewal, '2026-10-05T00:00:00.000Z').startedAt).toBe('2026-08-05T00:00:00.000Z');
    // A plan change or a subscription after an expiry starts a new cycle.
    expect(withStartedAt({ ...stored, plan: 'premium' }, renewal, '2026-10-05T00:00:00.000Z').startedAt).toBe('2026-10-05T00:00:00.000Z');
    expect(withStartedAt({ ...stored, status: 'expired' }, renewal, '2026-10-05T00:00:00.000Z').startedAt).toBe('2026-10-05T00:00:00.000Z');
    expect(withStartedAt(undefined, renewal, '2026-10-05T00:00:00.000Z').startedAt).toBe('2026-10-05T00:00:00.000Z');
    // Expired and revoked writes keep what was stored.
    expect(withStartedAt(stored, { ...renewal, status: 'expired' }, '2026-10-05T00:00:00.000Z').startedAt).toBe('2026-08-05T00:00:00.000Z');
    expect(withStartedAt(undefined, { ...renewal, status: 'revoked' }, '2026-10-05T00:00:00.000Z').startedAt).toBeNull();
  });
});

describe('consumeQuota (transaction)', () => {
  it('increments the UTC-day counter and the introductory counters, and reports usage', async () => {
    const store = new FakeQuotaStore();
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision).toMatchObject({ allowed: true, dayKey: DAY, entitlementValid: true, clarificationsUsed: 0 });
    expect(decision.usage).toEqual({ used: 1, limit: 10, plan: 'free', resetsAt: WINDOW_END, period: 'window' });
    expect(store.usage.get(`u1/${DAY}`)).toEqual({ count: 1, updatedAt: NOW.toISOString() });
    expect(store.root('u1')).toMatchObject({ introStartedAt: NOW.toISOString(), introUsed: 1, cycleKey: null, cycleUsed: 0 });
    expect('clarifications' in store.root('u1')).toBe(false);
  });

  it('reads the plan and the subscription start from the entitlement inside the transaction', async () => {
    const store = new FakeQuotaStore();
    store.entitlements.set('u1', { plan: 'pro', status: 'active', expiresAt: null, startedAt: '2026-08-20T09:15:00.000Z' });
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision.usage).toEqual({ used: 1, limit: 100, plan: 'pro', resetsAt: '2026-10-20T09:15:00.000Z', period: 'month' });
    expect(store.root('u1')).toMatchObject({ cycleKey: '2026-09-20T09:15:00.000Z', cycleUsed: 1, introUsed: 0 });
  });

  it('reports malformed entitlements', async () => {
    const store = new FakeQuotaStore();
    store.entitlements.set('u1', { plan: 'gold' });
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision).toMatchObject({ allowed: true, entitlementValid: false });
    expect(decision.usage.plan).toBe('free');
  });

  it('does not write when the allowance is exhausted', async () => {
    const store = new FakeQuotaStore();
    store.roots.set('u1', { introStartedAt: '2026-10-03T10:00:00.000Z', introUsed: 10 });
    const decision = await consumeQuota(store, 'u1', NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.usage.subscriptionRequired).toBe(true);
    expect(store.usage.has(`u1/${DAY}`)).toBe(false);
    expect(store.root('u1')).toEqual({ introStartedAt: '2026-10-03T10:00:00.000Z', introUsed: 10 });
  });

  it('is atomic under concurrent requests', async () => {
    const store = new FakeQuotaStore();
    const results = await Promise.all(Array.from({ length: 5 }, () => consumeQuota(store, 'u1', NOW)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(store.usage.get(`u1/${DAY}`)?.count).toBe(3);
    expect(store.root('u1')).toMatchObject({ introUsed: 3 });
  });

  it('keeps users and UTC days separate', async () => {
    const store = new FakeQuotaStore();
    await consumeQuota(store, 'u1', NOW);
    await consumeQuota(store, 'u2', NOW);
    await consumeQuota(store, 'u1', new Date('2026-10-06T00:00:01.000Z'));
    expect(store.usage.get(`u1/${DAY}`)?.count).toBe(1);
    expect(store.usage.get('u1/2026-10-06')?.count).toBe(1);
    expect(store.usage.get(`u2/${DAY}`)?.count).toBe(1);
    expect(store.root('u1')).toMatchObject({ introUsed: 2 });
    expect(store.root('u2')).toMatchObject({ introUsed: 1 });
  });

  it('refunds exactly the counters a decision charged and never goes below zero', async () => {
    const store = new FakeQuotaStore();
    const decision = await consumeQuota(store, 'u1', NOW);
    await refundQuota(store, 'u1', decision, NOW);
    expect(store.usage.get(`u1/${DAY}`)?.count).toBe(0);
    expect(store.root('u1')).toMatchObject({ introUsed: 0, introStartedAt: NOW.toISOString() });
    await refundQuota(store, 'u1', decision, NOW);
    expect(store.usage.get(`u1/${DAY}`)?.count).toBe(0);
    expect(store.root('u1')).toMatchObject({ introUsed: 0 });

    store.entitlements.set('p1', { plan: 'pro', status: 'active', startedAt: '2026-08-20T09:15:00.000Z' });
    const paid = await consumeQuota(store, 'p1', NOW);
    await refundQuota(store, 'p1', paid, NOW);
    expect(store.root('p1')).toMatchObject({ cycleUsed: 0 });
    // A refund for an older cycle key leaves the current counter alone.
    const again = await consumeQuota(store, 'p1', NOW);
    await refundQuota(store, 'p1', { dayKey: again.dayKey, charges: { ...again.charges, cycle: '2026-01-20T09:15:00.000Z' } }, NOW);
    expect(store.root('p1')).toMatchObject({ cycleUsed: 1 });
  });
});

describe('settleClarification', () => {
  it('refunds the first two clarifications in a row, charges the third, and resets on a real answer', async () => {
    const store = new FakeQuotaStore();
    const first = await consumeQuota(store, 'u1', NOW);
    expect(await settleClarification(store, 'u1', first, true, NOW)).toEqual({ refunded: true });
    expect(store.root('u1')).toMatchObject({ introUsed: 0, clarifications: 1 });
    const second = await consumeQuota(store, 'u1', NOW);
    expect(second.clarificationsUsed).toBe(1);
    expect(await settleClarification(store, 'u1', second, true, NOW)).toEqual({ refunded: true });
    expect(store.root('u1')).toMatchObject({ introUsed: 0, clarifications: 2 });
    const third = await consumeQuota(store, 'u1', NOW);
    expect(third.clarificationsUsed).toBe(2);
    expect(await settleClarification(store, 'u1', third, true, NOW)).toEqual({ refunded: false });
    expect(store.root('u1')).toMatchObject({ introUsed: 1, clarifications: 3 });
    // A real answer keeps its charge and resets the run.
    const answer = await consumeQuota(store, 'u1', NOW);
    expect(await settleClarification(store, 'u1', answer, false, NOW)).toEqual({ refunded: false });
    expect(store.root('u1')).toMatchObject({ introUsed: 2, clarifications: 0 });
    expect(store.usage.get(`u1/${DAY}`)?.count).toBe(2);
  });
});

describe('readUsageRoot', () => {
  it('reads leniently', () => {
    expect(readUsageRoot(undefined)).toEqual(EMPTY_USAGE_ROOT);
    expect(readUsageRoot({ introStartedAt: 'x', introUsed: -3, cycleKey: 7, cycleUsed: 2.5, clarifications: '1' })).toEqual(EMPTY_USAGE_ROOT);
    expect(readUsageRoot({ introStartedAt: NOW.toISOString(), introUsed: 4, cycleKey: NOW.toISOString(), cycleUsed: 9, clarifications: 1 })).toEqual({
      introStartedAt: NOW.toISOString(),
      introUsed: 4,
      cycleKey: NOW.toISOString(),
      cycleUsed: 9,
      clarifications: 1,
    });
  });
});
