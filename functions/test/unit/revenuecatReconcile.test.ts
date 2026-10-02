/**
 * Entitlement reconciliation tests (src/revenuecat/reconcile.ts): REST subscriber mapping
 * (premium over pro only among CURRENTLY GRANTING entitlements, grace, refunds, the sandbox
 * gate incl. the fail-closed unverified case), its PARITY with the webhook mapping
 * (entitlementFromEvent), the drift decision (write only on drift, admin-grant protection,
 * missed-EXPIRATION heal), the handler over fake ports (admin claim, RevenueCat failures,
 * 404 = no subscriber, the eventTimestampMs:null write contract, the stale-snapshot race
 * guard, the audit log) and the deploy gating (export undefined by default; the secret bound
 * only to this callable).
 */
import { HttpsError } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';

import { entitlementFromEvent, revenueCatEventSchema } from '../../src/revenuecat/mapping';
import type * as ReconcileModuleNamespace from '../../src/revenuecat/reconcile';
import {
  decideReconcile,
  entitlementFromSubscriber,
  handleAdminReconcileEntitlement,
  reconcileEnabledAtLoad,
  restSnapshotMs,
  storedNewerThanSnapshot,
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

  it('an EXPIRED premium entitlement never shadows a currently active pro (post-downgrade REST state)', () => {
    // After an in-app premium -> pro switch the REST subscriber keeps the lapsed premium
    // entitlement next to the active pro one; the plan must come from what GRANTS.
    const mapping = entitlementFromSubscriber(
      subscriber({
        entitlements: {
          premium: { expires_date: PAST, product_identifier: 'premium_monthly' },
          pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' },
        },
        subscriptions: {
          premium_monthly: { expires_date: PAST, is_sandbox: false },
          pro_monthly: { expires_date: FUTURE, is_sandbox: false },
        },
      }),
      NOW,
    );
    expect(mapping.kind).toBe('write');
    if (mapping.kind === 'write') {
      expect(mapping.write.plan).toBe('pro');
      expect(mapping.write.status).toBe('active');
      expect(mapping.write.expiresAt).toBe(FUTURE);
    }
    // ... and a correct stored pro document shows NO phantom drift.
    const stored = { plan: 'pro', status: 'active', expiresAt: FUTURE, source: 'revenuecat' };
    expect(decideReconcile(stored, mapping, NOW)).toEqual({ kind: 'skip', outcome: 'unchanged' });
  });

  it('a refunded premium next to an active pro also resolves to pro', () => {
    const mapping = entitlementFromSubscriber(
      subscriber({
        entitlements: {
          premium: { expires_date: FUTURE, product_identifier: 'premium_monthly' },
          pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' },
        },
        subscriptions: {
          premium_monthly: { expires_date: FUTURE, is_sandbox: false, refunded_at: PAST },
          pro_monthly: { expires_date: FUTURE, is_sandbox: false },
        },
      }),
      NOW,
    );
    expect(mapping.kind === 'write' && mapping.write.plan).toBe('pro');
    expect(mapping.kind === 'write' && mapping.write.status).toBe('active');
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

  it('an entitlement WITHOUT a resolvable backing subscription is unverifiable, not production (fail closed)', () => {
    const orphan = subscriber({
      entitlements: { pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' } },
      subscriptions: {},
    });
    expect(entitlementFromSubscriber(orphan, NOW)).toEqual({ kind: 'none', reason: 'unverified' });
    expect(decideReconcile(null, { kind: 'none', reason: 'unverified' }, NOW)).toEqual({ kind: 'skip', outcome: 'no_data' });
    // The license-tester override applies here too (same param as the sandbox gate).
    const allowed = entitlementFromSubscriber(orphan, NOW, { allowSandbox: true });
    expect(allowed.kind).toBe('write');
  });

  it('promotional grants (rc_promo products) have no subscription record by design and stay eligible', () => {
    const promo = subscriber({
      entitlements: { premium: { expires_date: FUTURE, product_identifier: 'rc_promo_premium_monthly' } },
      subscriptions: {},
    });
    const mapping = entitlementFromSubscriber(promo, NOW);
    expect(mapping.kind).toBe('write');
    if (mapping.kind === 'write') {
      expect(mapping.write.plan).toBe('premium');
      expect(mapping.write.status).toBe('active');
    }
  });
});

describe('mapping parity: webhook event vs REST subscriber', () => {
  /**
   * The same store reality must produce the SAME entitlement document whichever path delivers
   * it, or a reconcile right after a webhook would report phantom drift. updatedAt is aligned
   * by giving the event event_timestamp_ms = NOW (the webhook prefers it over now()).
   */
  const cases: {
    name: string;
    event: Record<string, unknown>;
    rest: Parameters<typeof subscriber>[0];
  }[] = [
    {
      name: 'active subscription (INITIAL_PURCHASE)',
      event: { type: 'INITIAL_PURCHASE', entitlement_ids: ['pro'], product_id: 'pro_monthly', expiration_at_ms: Date.parse(FUTURE) },
      rest: {
        entitlements: { pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' } },
        subscriptions: { pro_monthly: { expires_date: FUTURE, is_sandbox: false } },
      },
    },
    {
      name: 'billing issue in grace (BILLING_ISSUE)',
      event: {
        type: 'BILLING_ISSUE',
        entitlement_ids: ['premium'],
        product_id: 'premium_yearly',
        expiration_at_ms: Date.parse(PAST),
        grace_period_expiration_at_ms: Date.parse(FUTURE),
      },
      rest: {
        entitlements: { premium: { expires_date: PAST, product_identifier: 'premium_yearly' } },
        subscriptions: {
          premium_yearly: { expires_date: PAST, is_sandbox: false, billing_issues_detected_at: PAST, grace_period_expires_date: FUTURE },
        },
      },
    },
    {
      name: 'lapsed subscription (EXPIRATION)',
      event: { type: 'EXPIRATION', entitlement_ids: ['pro'], product_id: 'pro_monthly', expiration_at_ms: Date.parse(PAST) },
      rest: {
        entitlements: { pro: { expires_date: PAST, product_identifier: 'pro_monthly' } },
        subscriptions: { pro_monthly: { expires_date: PAST, is_sandbox: false } },
      },
    },
    {
      name: 'refund (CANCELLATION/CUSTOMER_SUPPORT)',
      event: {
        type: 'CANCELLATION',
        cancel_reason: 'CUSTOMER_SUPPORT',
        entitlement_ids: ['pro'],
        product_id: 'pro_monthly',
        expiration_at_ms: Date.parse(FUTURE),
      },
      rest: {
        entitlements: { pro: { expires_date: FUTURE, product_identifier: 'pro_monthly' } },
        subscriptions: { pro_monthly: { expires_date: FUTURE, is_sandbox: false, refunded_at: PAST } },
      },
    },
  ];

  it.each(cases)('$name writes the identical document on both paths', ({ event, rest }) => {
    const parsedEvent = revenueCatEventSchema.parse({ id: 'evt-1', app_user_id: 'uid-1', event_timestamp_ms: NOW.getTime(), ...event });
    const fromWebhook = entitlementFromEvent(parsedEvent, NOW);
    const fromRest = entitlementFromSubscriber(subscriber(rest), NOW);
    expect(fromWebhook).not.toBeNull();
    expect(fromRest.kind).toBe('write');
    if (fromRest.kind === 'write') expect(fromRest.write).toEqual(fromWebhook);
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
    /** What the transactional read sees (set it to a doc NEWER than the snapshot for races). */
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
      async reconcileEntitlement(uid, decide) {
        const current = options.stored ?? null;
        const doc = decide(current);
        if (doc !== null) writes.push({ uid, doc });
        return current;
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

  it('404 (no subscriber at RevenueCat) is no-subscriber data, not an error: heals a stale granting doc', async () => {
    const { ports, writes } = fakePorts({ status: 404, body: null, stored: { plan: 'pro', status: 'active', expiresAt: PAST, source: 'revenuecat' } });
    const result = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, ports);
    expect(result).toEqual({ uid: 'uid-1', outcome: 'updated', plan: 'pro', status: 'expired', expiresAt: PAST });
    expect(writes[0]?.doc).toMatchObject({ plan: 'pro', status: 'expired', source: 'revenuecat', eventTimestampMs: null });
  });

  it('404 leaves an admin comp (skipped_admin) and a missing document (unchanged) alone', async () => {
    const comped = fakePorts({ status: 404, body: null, stored: { plan: 'premium', status: 'active', expiresAt: null, source: 'admin' } });
    const compResult = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, comped.ports);
    expect(compResult).toEqual({ uid: 'uid-1', outcome: 'skipped_admin', plan: 'premium', status: 'active', expiresAt: null });
    const empty = fakePorts({ status: 404, body: null, stored: null });
    const emptyResult = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, empty.ports);
    expect(emptyResult).toEqual({ uid: 'uid-1', outcome: 'unchanged', plan: 'free', status: 'active', expiresAt: null });
    expect(comped.writes.concat(empty.writes)).toHaveLength(0);
  });

  it('backs off (unchanged, no write) when a NEWER webhook write landed after the REST snapshot', async () => {
    // The REST body says pro/active (snapshot at NOW), but a PRODUCT_CHANGE webhook committed
    // premium/active one minute AFTER the snapshot was taken: the reconcile must not clobber it.
    const freshWebhookDoc = {
      plan: 'premium',
      status: 'active',
      expiresAt: FUTURE,
      source: 'revenuecat',
      updatedAt: NOW.toISOString(),
      eventTimestampMs: NOW.getTime() + 60_000,
    };
    const { ports, writes } = fakePorts({ stored: freshWebhookDoc });
    const result = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, ports);
    expect(result.outcome).toBe('unchanged');
    expect(result.plan).toBe('premium');
    expect(writes).toHaveLength(0);
  });

  it('backs off when an admin comp was written after the REST snapshot (404 heal path included)', async () => {
    const freshComp = {
      plan: 'premium',
      status: 'active',
      expiresAt: null,
      source: 'admin',
      updatedAt: new Date(NOW.getTime() + 30_000).toISOString(),
    };
    // An active pro at RevenueCat would normally overwrite a comp; not one written after the GET.
    const { ports, writes } = fakePorts({ stored: freshComp });
    const result = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, ports);
    expect(result.outcome).toBe('unchanged');
    expect(writes).toHaveLength(0);
    // An OLDER admin comp still loses to an active store subscription (documented precedence).
    const oldComp = { ...freshComp, updatedAt: PAST };
    const older = fakePorts({ stored: oldComp });
    const olderResult = await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, older.ports);
    expect(olderResult.outcome).toBe('updated');
    expect(older.writes).toHaveLength(1);
  });

  it('restSnapshotMs and storedNewerThanSnapshot order snapshots against stored documents', () => {
    expect(restSnapshotMs(subscriber(), 0)).toBe(NOW.getTime());
    expect(restSnapshotMs(null, 123)).toBe(123);
    expect(restSnapshotMs({ request_date_ms: 'nope' }, 123)).toBe(123);
    const t = NOW.getTime();
    expect(storedNewerThanSnapshot({ source: 'revenuecat', eventTimestampMs: t + 1 }, t)).toBe(true);
    expect(storedNewerThanSnapshot({ source: 'revenuecat', eventTimestampMs: t - 1 }, t)).toBe(false);
    expect(storedNewerThanSnapshot({ source: 'revenuecat', eventTimestampMs: null }, t)).toBe(false);
    expect(storedNewerThanSnapshot({ source: 'admin', updatedAt: new Date(t + 1).toISOString() }, t)).toBe(true);
    expect(storedNewerThanSnapshot({ source: 'admin', updatedAt: new Date(t - 1).toISOString() }, t)).toBe(false);
    expect(storedNewerThanSnapshot({ source: 'admin' }, t)).toBe(false);
    expect(storedNewerThanSnapshot(null, t)).toBe(false);
  });

  it('writes carry reconciledAt and the audit log names actor, uid and outcome - never key material', async () => {
    const info = logger.info as jest.Mock;
    info.mockClear();
    const { ports, writes } = fakePorts({ stored: null });
    await handleAdminReconcileEntitlement(ADMIN, { uid: 'uid-1' }, ports);
    expect(writes[0]?.doc).toMatchObject({ reconciledAt: NOW.toISOString(), eventTimestampMs: null });
    const audit = info.mock.calls.find((call) => call[0] === 'revenuecat.reconciled');
    expect(audit?.[1]).toMatchObject({ adminUid: 'admin-1', uid: 'uid-1', outcome: 'updated' });
    expect(JSON.stringify(audit)).not.toMatch(/sk_|Bearer|expires_date/);
  });
});

describe('deploy gating (zoom/whatsapp pattern)', () => {
  type ReconcileModule = typeof ReconcileModuleNamespace;

  function loadModule(enabled: string | undefined): ReconcileModule {
    jest.resetModules();
    if (enabled === undefined) delete process.env.REVENUECAT_RECONCILE_ENABLED;
    else process.env.REVENUECAT_RECONCILE_ENABLED = enabled;
    return jest.requireActual<ReconcileModule>('../../src/revenuecat/reconcile');
  }

  function secretKeys(fn: unknown): string[] {
    const endpoint = (fn as { __endpoint?: { secretEnvironmentVariables?: { key: string }[] } }).__endpoint;
    return (endpoint?.secretEnvironmentVariables ?? []).map((secret) => secret.key).sort();
  }

  const original = process.env.REVENUECAT_RECONCILE_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.REVENUECAT_RECONCILE_ENABLED;
    else process.env.REVENUECAT_RECONCILE_ENABLED = original;
    jest.resetModules();
  });

  it('the callable export is undefined while REVENUECAT_RECONCILE_ENABLED is unset or false (default deploy never references the secret)', () => {
    expect(reconcileEnabledAtLoad()).toBe(false);
    expect(loadModule(undefined).adminReconcileEntitlement).toBeUndefined();
    expect(loadModule('false').adminReconcileEntitlement).toBeUndefined();
  });

  it('REVENUECAT_RECONCILE_ENABLED=true exports the callable with REVENUECAT_SECRET_KEY as its ONLY secret', () => {
    const mod = loadModule('true');
    expect(mod.adminReconcileEntitlement).toBeDefined();
    expect(secretKeys(mod.adminReconcileEntitlement)).toEqual(['REVENUECAT_SECRET_KEY']);
  });

  it('reconcileEnabledAtLoad accepts only a true-ish env value', () => {
    const mod = loadModule(undefined);
    expect(mod.reconcileEnabledAtLoad()).toBe(false);
    process.env.REVENUECAT_RECONCILE_ENABLED = 'false';
    expect(mod.reconcileEnabledAtLoad()).toBe(false);
    process.env.REVENUECAT_RECONCILE_ENABLED = ' TRUE ';
    expect(mod.reconcileEnabledAtLoad()).toBe(true);
    process.env.REVENUECAT_RECONCILE_ENABLED = 'true';
    expect(mod.reconcileEnabledAtLoad()).toBe(true);
  });
});
