/**
 * Entitlement reconciliation tests (src/revenuecat/reconcile.ts): REST subscriber mapping
 * (premium over pro, grace, refunds, the sandbox gate), the drift decision (write only on
 * drift, admin-grant protection, missed-EXPIRATION heal) and the handler over fake ports
 * (admin claim, RevenueCat failures, the eventTimestampMs:null write contract).
 */
import { HttpsError } from 'firebase-functions/https';

import {
  decideReconcile,
  entitlementFromSubscriber,
  handleAdminReconcileEntitlement,
  reconcileEnabledAtLoad,
  type ReconcilePorts,
} from '../../src/revenuecat/reconcile';

// Hoisted above the imports by ts-jest.
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const NOW = new Date('2026-10-02T12:00:00.000Z');
const FUTURE = '2026-11-02T12:00:00.000Z';
const PAST = '2026-09-02T12:00:00.000Z';
const ADMIN = { uid: 'admin-1', isAdmin: true };

function subscriber(overrides: {
  entitlements?: Record<string, Record<string, unknown>>;
  subscriptions?: Record<string, Record<string, unknown>>;
} = {}): unknown {
  return {
    request_date_ms: NOW.getTime(),
    subscriber: {
      entitlements: overrides.entitlements ?? {
        pro: { expires_date: FUTURE, product_identifier: 'pro_monthly', purchase_date: PAST },
      },
      subscriptions: overrides.subscriptions ?? {
        pro_monthly: { expires_date: FUTURE, is_sandbox: false, store: 'play_store', period_type: 'normal' },
      },
    },
  };
}

describe('entitlementFromSubscriber', () => {
  it('maps an active subscription to an active entitlement write', () => {
    const mapping = entitlementFromSubscriber(subscriber(), NOW);
    expect(mapping).toEqual({
      kind: 'write',
      write: { plan: 'pro', status: 'active', expiresAt: FUTURE, source: 'revenuecat', updatedAt: NOW.toISOString() },
    });
  });

  it('premium wins over pro', () => {
    const mapping = entitlementFromSubscriber(
      subscriber({
        entitlements: {
          pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' },
          premium: { expires_date: FUTURE, product_identifier: 'premium_yearly' },
        },
        subscriptions: {
          pro_monthly: { expires_date: FUTURE, is_sandbox: false },
          premium_yearly: { expires_date: FUTURE, is_sandbox: false },
        },
      }),
      NOW,
    );
    expect(mapping.kind).toBe('write');
    if (mapping.kind === 'write') expect(mapping.write.plan).toBe('premium');
  });

  it('expired by date without grace -> expired; with a future grace end -> grace_period', () => {
    const expired = entitlementFromSubscriber(
      subscriber({
        entitlements: { pro: { expires_date: PAST, product_identifier: 'pro_monthly' } },
        subscriptions: { pro_monthly: { expires_date: PAST, is_sandbox: false } },
      }),
      NOW,
    );
    expect(expired.kind === 'write' && expired.write.status).toBe('expired');

    const grace = entitlementFromSubscriber(
      subscriber({
        entitlements: { pro: { expires_date: PAST, product_identifier: 'pro_monthly' } },
        subscriptions: {
          pro_monthly: { expires_date: PAST, is_sandbox: false, billing_issues_detected_at: PAST, grace_period_expires_date: FUTURE },
        },
      }),
      NOW,
    );
    expect(grace.kind).toBe('write');
    if (grace.kind === 'write') {
      expect(grace.write.status).toBe('grace_period');
      expect(grace.write.expiresAt).toBe(FUTURE);
    }
  });

  it('a refunded backing subscription -> revoked', () => {
    const mapping = entitlementFromSubscriber(
      subscriber({
        entitlements: { pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' } },
        subscriptions: { pro_monthly: { expires_date: FUTURE, is_sandbox: false, refunded_at: PAST } },
      }),
      NOW,
    );
    expect(mapping.kind === 'write' && mapping.write.status).toBe('revoked');
  });

  it('sandbox subscriptions are ignored unless allowSandbox (same gate as the webhook)', () => {
    const sandbox = subscriber({
      entitlements: { pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' } },
      subscriptions: { pro_monthly: { expires_date: FUTURE, is_sandbox: true } },
    });
    expect(entitlementFromSubscriber(sandbox, NOW)).toEqual({ kind: 'none', reason: 'sandbox_only' });
    const allowed = entitlementFromSubscriber(sandbox, NOW, { allowSandbox: true });
    expect(allowed.kind).toBe('write');
  });

  it('tolerates base-plan suffixes when matching the backing subscription', () => {
    const mapping = entitlementFromSubscriber(
      subscriber({
        entitlements: { pro: { expires_date: FUTURE, product_identifier: 'pro_monthly:p1m' } },
        subscriptions: { pro_monthly: { expires_date: FUTURE, is_sandbox: true } },
      }),
      NOW,
    );
    expect(mapping).toEqual({ kind: 'none', reason: 'sandbox_only' });
  });

  it('no entitlements -> none; malformed body -> malformed', () => {
    expect(entitlementFromSubscriber({ subscriber: { entitlements: {}, subscriptions: {} } }, NOW)).toEqual({
      kind: 'none',
      reason: 'no_entitlements',
    });
    expect(entitlementFromSubscriber({ nope: true }, NOW)).toEqual({ kind: 'malformed' });
  });
});

describe('decideReconcile', () => {
  const activeWrite = {
    kind: 'write' as const,
    write: { plan: 'pro' as const, status: 'active' as const, expiresAt: FUTURE, source: 'revenuecat' as const, updatedAt: NOW.toISOString() },
  };

  it('unchanged when plan+status+expiresAt already match (no write on no drift)', () => {
    const stored = { plan: 'pro', status: 'active', expiresAt: FUTURE, source: 'revenuecat', updatedAt: PAST };
    expect(decideReconcile(stored, activeWrite, NOW)).toEqual({ kind: 'skip', outcome: 'unchanged' });
  });

  it('writes on drift, including over an admin grant when the store subscription is ACTIVE', () => {
    const drifted = { plan: 'free', status: 'active', expiresAt: null, source: 'admin' };
    const decision = decideReconcile(drifted, activeWrite, NOW);
    expect(decision.kind).toBe('write');
  });

  it('never downgrades an admin grant from stale store history', () => {
    const comped = { plan: 'premium', status: 'active', expiresAt: null, source: 'admin' };
    const expired = {
      kind: 'write' as const,
      write: { plan: 'pro' as const, status: 'expired' as const, expiresAt: PAST, source: 'revenuecat' as const, updatedAt: NOW.toISOString() },
    };
    expect(decideReconcile(comped, expired, NOW)).toEqual({ kind: 'skip', outcome: 'skipped_admin' });
    expect(decideReconcile(comped, { kind: 'none', reason: 'no_entitlements' }, NOW)).toEqual({ kind: 'skip', outcome: 'skipped_admin' });
  });

  it('expires a still-granting revenuecat document that RevenueCat no longer backs (missed EXPIRATION)', () => {
    const stored = { plan: 'pro', status: 'active', expiresAt: PAST, source: 'revenuecat' };
    const decision = decideReconcile(stored, { kind: 'none', reason: 'no_entitlements' }, NOW);
    expect(decision.kind).toBe('write');
    if (decision.kind === 'write') expect(decision.write).toMatchObject({ plan: 'pro', status: 'expired', source: 'revenuecat' });
  });

  it('no stored document + nothing at RevenueCat -> unchanged; sandbox-only -> no_data', () => {
    expect(decideReconcile(null, { kind: 'none', reason: 'no_entitlements' }, NOW)).toEqual({ kind: 'skip', outcome: 'unchanged' });
    expect(decideReconcile(null, { kind: 'none', reason: 'sandbox_only' }, NOW)).toEqual({ kind: 'skip', outcome: 'no_data' });
  });
});

describe('handleAdminReconcileEntitlement', () => {
  function fakePorts(options: {
    status?: number;
    body?: unknown;
    stored?: unknown;
    fetchThrows?: boolean;
    allowSandbox?: boolean;
  } = {}) {
    const writes: { uid: string; doc: Record<string, unknown> }[] = [];
    const ports: ReconcilePorts = {
      async fetchSubscriber() {
        if (options.fetchThrows) throw new Error('network down');
        return { status: options.status ?? 200, body: options.body ?? subscriber() };
      },
      async readEntitlement() {
        return options.stored ?? null;
      },
      async writeEntitlement(uid, doc) {
        writes.push({ uid, doc });
      },
      allowSandbox: () => options.allowSandbox ?? false,
      now: () => NOW,
    };
    return { ports, writes };
  }

  it('requires the admin claim and a valid uid', async () => {
    const { ports } = fakePorts();
    await expect(handleAdminReconcileEntitlement(null, { uid: 'uid-1' }, ports)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(handleAdminReconcileEntitlement({ uid: 'u', isAdmin: false }, { uid: 'uid-1' }, ports)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(handleAdminReconcileEntitlement(ADMIN, { uid: 'bad/uid' }, ports)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('writes the drifted entitlement with eventTimestampMs null so future webhook events win', async () => {
    const { ports, writes } = fakePorts({ stored: { plan: 'free', status: 'expired', expiresAt: null, source: 'revenuecat' } });
    const result = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, ports);
    expect(result).toEqual({ uid: 'uid-1', outcome: 'updated', plan: 'pro', status: 'active', expiresAt: FUTURE });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.doc).toMatchObject({ plan: 'pro', status: 'active', source: 'revenuecat', eventTimestampMs: null });
  });

  it('writes nothing when the stored document already matches', async () => {
    const stored = { plan: 'pro', status: 'active', expiresAt: FUTURE, source: 'revenuecat' };
    const { ports, writes } = fakePorts({ stored });
    const result = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, ports);
    expect(result).toEqual({ uid: 'uid-1', outcome: 'unchanged', plan: 'pro', status: 'active', expiresAt: FUTURE });
    expect(writes).toHaveLength(0);
  });

  it('maps RevenueCat failures honestly and never writes', async () => {
    const down = fakePorts({ fetchThrows: true });
    await expect(handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, down.ports)).rejects.toBeInstanceOf(HttpsError);
    const unauthorized = fakePorts({ status: 401 });
    await expect(handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, unauthorized.ports)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    const flaky = fakePorts({ status: 503 });
    await expect(handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, flaky.ports)).rejects.toMatchObject({ code: 'unavailable' });
    expect(down.writes.concat(unauthorized.writes, flaky.writes)).toHaveLength(0);
  });
});

describe('deploy gating', () => {
  it('the callable export is undefined while REVENUECAT_RECONCILE_ENABLED is not "true" at load', () => {
    expect(reconcileEnabledAtLoad()).toBe(false);
  });
});
