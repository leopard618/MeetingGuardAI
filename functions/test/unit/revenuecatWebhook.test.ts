/**
 * RevenueCat webhook handler tests (src/revenuecat/index.ts) with fake store/response ports:
 * auth (timing-safe secret), method, malformed bodies, idempotency (duplicate markers),
 * single-uid writes, TRANSFER double writes, ignored events and Firestore failure -> 500.
 */
import {
  decideWebhook,
  handleRevenueCatWebhook,
  timingSafeStringEqual,
  type EntitlementTarget,
  type RevenueCatStore,
  type WebhookRequestLike,
} from '../../src/revenuecat';

// Hoisted above the imports by ts-jest.
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const NOW = new Date('2026-09-30T12:00:00.000Z');
const SECRET = 'rc-webhook-shared-secret';

interface EventOverrides {
  [key: string]: unknown;
}

function body(overrides: EventOverrides = {}): unknown {
  return {
    api_version: '1.0',
    event: {
      id: 'evt-1',
      type: 'INITIAL_PURCHASE',
      app_user_id: 'uid-1',
      entitlement_ids: ['pro'],
      product_id: 'pro_monthly',
      expiration_at_ms: Date.parse('2026-10-30T12:00:00.000Z'),
      event_timestamp_ms: Date.parse('2026-09-30T11:59:00.000Z'),
      environment: 'PRODUCTION',
      store: 'PLAY_STORE',
      ...overrides,
    },
  };
}

function request(reqBody: unknown, options: { method?: string; auth?: string | undefined } = {}): WebhookRequestLike {
  const auth = 'auth' in options ? options.auth : SECRET;
  return {
    method: options.method ?? 'POST',
    header: (name: string) => (name.toLowerCase() === 'authorization' ? auth : undefined),
    body: reqBody,
  };
}

function fakeStore(outcome: 'applied' | 'duplicate' = 'applied', fail = false) {
  const calls: { eventId: string; marker: Record<string, unknown>; writes: readonly EntitlementTarget[] }[] = [];
  const store: RevenueCatStore = {
    async applyOnce(eventId, marker, writes) {
      if (fail) throw new Error('firestore unavailable');
      calls.push({ eventId, marker, writes });
      return outcome;
    },
  };
  return { store, calls };
}

function fakeRes() {
  const record: { code: number | null; body: unknown } = { code: null, body: null };
  return {
    record,
    res: {
      status(code: number) {
        record.code = code;
        return {
          json(payload: unknown) {
            record.body = payload;
          },
        };
      },
    },
  };
}

async function run(req: WebhookRequestLike, store: RevenueCatStore, secret: string = SECRET) {
  const { res, record } = fakeRes();
  await handleRevenueCatWebhook(req, res, { store: () => store, secret: () => secret, now: () => NOW });
  return record;
}

describe('auth and method', () => {
  it('rejects a wrong or missing Authorization header with 401 and touches nothing', async () => {
    const { store, calls } = fakeStore();
    expect((await run(request(body(), { auth: 'wrong' }), store)).code).toBe(401);
    expect((await run(request(body(), { auth: undefined }), store)).code).toBe(401);
    expect(calls).toEqual([]);
  });

  it('rejects everything when the secret is unset (empty)', async () => {
    const { store, calls } = fakeStore();
    expect((await run(request(body(), { auth: '' }), store, '')).code).toBe(401);
    expect(calls).toEqual([]);
  });

  it('rejects non-POST with 405', async () => {
    const { store, calls } = fakeStore();
    expect((await run(request(body(), { method: 'GET' }), store)).code).toBe(405);
    expect(calls).toEqual([]);
  });

  it('timingSafeStringEqual compares any lengths without throwing', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
    expect(timingSafeStringEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeStringEqual('', 'x')).toBe(false);
  });
});

describe('bodies and decisions', () => {
  it('400 on a malformed body', async () => {
    const { store, calls } = fakeStore();
    const record = await run(request({ nope: true }), store);
    expect(record.code).toBe(400);
    expect(calls).toEqual([]);
  });

  it('writes the entitlement transactionally with the idempotency marker', async () => {
    const { store, calls } = fakeStore();
    const record = await run(request(body()), store);
    expect(record.code).toBe(200);
    expect(record.body).toEqual({ received: true, duplicate: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventId).toBe('evt-1');
    expect(calls[0]!.marker).toMatchObject({ type: 'INITIAL_PURCHASE', appUserId: 'uid-1', receivedAt: NOW.toISOString() });
    expect(calls[0]!.writes).toEqual([
      {
        uid: 'uid-1',
        write: {
          plan: 'pro',
          status: 'active',
          expiresAt: '2026-10-30T12:00:00.000Z',
          source: 'revenuecat',
          updatedAt: '2026-09-30T11:59:00.000Z',
        },
      },
    ]);
  });

  it('a replayed event id is acknowledged as a duplicate no-op', async () => {
    const { store } = fakeStore('duplicate');
    const record = await run(request(body()), store);
    expect(record.code).toBe(200);
    expect(record.body).toEqual({ received: true, duplicate: true });
  });

  it('acknowledges TEST, anonymous ids, unknown types and unmappable plans with 200 and no write', async () => {
    const { store, calls } = fakeStore();
    for (const overrides of [
      { type: 'TEST' },
      { app_user_id: '$RCAnonymousID:abc' },
      { app_user_id: null },
      { app_user_id: 'evil/../path' },
      { type: 'SOMETHING_NEW' },
      { entitlement_ids: [], product_id: 'mystery_product' },
    ]) {
      const record = await run(request(body(overrides)), store);
      expect(record.code).toBe(200);
      expect(record.body).toMatchObject({ received: true });
      expect((record.body as { ignored?: string }).ignored).toBeTruthy();
    }
    expect(calls).toEqual([]);
  });

  it('TRANSFER moves the plan: transferred_to becomes active, transferred_from expires', async () => {
    const { store, calls } = fakeStore();
    const record = await run(
      request(
        body({
          type: 'TRANSFER',
          app_user_id: null,
          entitlement_ids: null,
          product_id: 'premium_yearly',
          transferred_to: ['$RCAnonymousID:skip-me', 'uid-new'],
          transferred_from: ['uid-old'],
        }),
      ),
      store,
    );
    expect(record.code).toBe(200);
    expect(calls[0]!.writes).toEqual([
      {
        uid: 'uid-new',
        write: { plan: 'premium', status: 'active', expiresAt: '2026-10-30T12:00:00.000Z', source: 'revenuecat', updatedAt: NOW.toISOString() },
      },
      {
        uid: 'uid-old',
        write: { plan: 'premium', status: 'expired', expiresAt: '2026-10-30T12:00:00.000Z', source: 'revenuecat', updatedAt: NOW.toISOString() },
      },
    ]);
  });

  it('TRANSFER without a usable target or plan is acknowledged and ignored', async () => {
    const { store, calls } = fakeStore();
    const noTarget = await run(request(body({ type: 'TRANSFER', transferred_to: ['$RCAnonymousID:only'], product_id: 'pro_monthly' })), store);
    expect(noTarget.code).toBe(200);
    const noPlan = await run(request(body({ type: 'TRANSFER', transferred_to: ['uid-new'], entitlement_ids: [], product_id: 'mystery' })), store);
    expect(noPlan.code).toBe(200);
    expect(calls).toEqual([]);
  });

  it('a store failure returns 500 so RevenueCat retries (idempotent via the marker)', async () => {
    const { store } = fakeStore('applied', true);
    const record = await run(request(body()), store);
    expect(record.code).toBe(500);
    expect(record.body).toEqual({ error: 'internal' });
  });
});

describe('decideWebhook details', () => {
  it('refuses unsafe event ids as ignored (no Firestore path tricks)', () => {
    const decision = decideWebhook(body({ id: 'evil/../x' }), NOW);
    expect(decision).toMatchObject({ kind: 'ignored', reason: 'unsafe_event_id' });
  });

  it('CANCELLATION with CUSTOMER_SUPPORT revokes through the shared mapping', () => {
    const decision = decideWebhook(body({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }), NOW);
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.writes[0]!.write.status).toBe('revoked');
    }
  });
});
