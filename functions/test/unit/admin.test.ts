import { HttpsError } from 'firebase-functions/https';

import {
  entitlementDisplayOf,
  handleGetMetrics,
  handleListUsers,
  handleSetUserDisabled,
  handleSetUserPlan,
  requireAdmin,
  utcDayStartIso,
  type AdminAuthUser,
  type AdminCaller,
  type AdminEntitlementWrite,
  type AdminPorts,
} from '../../src/admin';
import {
  getMetricsResponseSchema,
  listUsersResponseSchema,
} from '../../src/admin/schemas';

// Hoisted above the imports by ts-jest.
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const admin: AdminCaller = { uid: 'admin-1', isAdmin: true };
const mortal: AdminCaller = { uid: 'user-1', isAdmin: false };
const now = new Date('2026-09-30T12:00:00.000Z');

function authUser(uid: string, overrides: Partial<AdminAuthUser> = {}): AdminAuthUser {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: `Name of ${uid}`,
    disabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSignInAt: '2026-09-29T08:00:00.000Z',
    ...overrides,
  };
}

interface FakeOptions {
  users?: AdminAuthUser[];
  nextPageToken?: string | null;
  entitlements?: Record<string, unknown>;
  usage?: Record<string, number>;
  userExists?: boolean;
  totalUsers?: number;
  allEntitlements?: unknown[];
  usageSums?: Record<string, number>;
}

function fakePorts(options: FakeOptions = {}) {
  const calls: string[] = [];
  const entitlementWrites: Array<{ uid: string; doc: AdminEntitlementWrite }> = [];
  const ports: AdminPorts = {
    listAuthUsers: jest.fn(async (pageSize: number, pageToken: string | null) => {
      calls.push(`list:${pageSize}:${pageToken ?? ''}`);
      return { users: options.users ?? [], nextPageToken: options.nextPageToken ?? null };
    }),
    getEntitlements: jest.fn(async (uids: string[]) => {
      const map = new Map<string, unknown>();
      for (const uid of uids) {
        if (options.entitlements && uid in options.entitlements) map.set(uid, options.entitlements[uid]);
      }
      return map;
    }),
    getUsageCounts: jest.fn(async (uids: string[], dayKey: string) => {
      calls.push(`usage:${dayKey}`);
      const map = new Map<string, number>();
      for (const uid of uids) {
        const count = options.usage?.[uid];
        if (count !== undefined) map.set(uid, count);
      }
      return map;
    }),
    setAuthUserDisabled: jest.fn(async (uid: string, disabled: boolean) => {
      calls.push(`disable:${uid}:${disabled}`);
      return options.userExists ?? true;
    }),
    revokeRefreshTokens: jest.fn(async (uid: string) => {
      calls.push(`revoke:${uid}`);
    }),
    userExists: jest.fn(async () => options.userExists ?? true),
    writeEntitlement: jest.fn(async (uid: string, doc: AdminEntitlementWrite) => {
      entitlementWrites.push({ uid, doc });
    }),
    countAuthUsers: jest.fn(async () => options.totalUsers ?? 0),
    listAllEntitlements: jest.fn(async () => options.allEntitlements ?? []),
    sumUsageCountsSince: jest.fn(async (sinceIso: string) => options.usageSums?.[sinceIso] ?? 0),
    audit: { writeAudit: jest.fn(async () => undefined) },
  };
  return { ports, calls, entitlementWrites };
}

describe('requireAdmin', () => {
  it('rejects unauthenticated callers', () => {
    expect(() => requireAdmin(null)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });

  it('rejects authenticated callers without the admin claim', () => {
    expect(() => requireAdmin(mortal)).toThrow(expect.objectContaining({ code: 'permission-denied' }));
  });

  it('accepts admins', () => {
    expect(() => requireAdmin(admin)).not.toThrow();
  });
});

describe('every handler enforces auth before touching any port', () => {
  const handlers: Array<[string, (caller: AdminCaller | null, ports: AdminPorts) => Promise<unknown>]> = [
    ['adminListUsers', (caller, ports) => handleListUsers(caller, {}, ports, now)],
    ['adminSetUserDisabled', (caller, ports) => handleSetUserDisabled(caller, { uid: 'u1', disabled: true }, ports)],
    ['adminSetUserPlan', (caller, ports) => handleSetUserPlan(caller, { uid: 'u1', plan: 'pro', expiresAt: null }, ports, now)],
    ['adminGetMetrics', (caller, ports) => handleGetMetrics(caller, {}, ports, now)],
  ];

  it.each(handlers)('%s', async (_name, run) => {
    const { ports, calls } = fakePorts();
    await expect(run(null, ports)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(run(mortal, ports)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(calls).toEqual([]);
  });
});

describe('handleListUsers', () => {
  it('joins auth users with entitlements and today usage', async () => {
    const { ports } = fakePorts({
      users: [authUser('u1'), authUser('u2', { email: null, displayName: null, disabled: true })],
      nextPageToken: 'next-token',
      entitlements: {
        u1: { plan: 'pro', status: 'active', expiresAt: '2027-01-01T00:00:00.000Z', source: 'revenuecat', updatedAt: 'x' },
      },
      usage: { u1: 3 },
    });
    const response = await handleListUsers(admin, {}, ports, now);
    expect(listUsersResponseSchema.parse(response)).toEqual(response);
    expect(response.nextPageToken).toBe('next-token');
    expect(response.users).toHaveLength(2);
    expect(response.users[0]).toMatchObject({
      uid: 'u1',
      plan: 'pro',
      entitlementStatus: 'active',
      entitlementSource: 'revenuecat',
      expiresAt: '2027-01-01T00:00:00.000Z',
      usageToday: 3,
    });
    // No entitlement document and no usage document => free defaults.
    expect(response.users[1]).toMatchObject({
      uid: 'u2',
      email: null,
      disabled: true,
      plan: 'free',
      entitlementStatus: 'active',
      entitlementSource: 'none',
      expiresAt: null,
      usageToday: 0,
    });
  });

  it('reports the effective plan: an expired document shows free with its real status', async () => {
    const { ports } = fakePorts({
      users: [authUser('u1')],
      entitlements: {
        u1: { plan: 'premium', status: 'active', expiresAt: '2026-01-01T00:00:00.000Z', source: 'revenuecat' },
      },
    });
    const response = await handleListUsers(admin, {}, ports, now);
    expect(response.users[0]).toMatchObject({ plan: 'free', entitlementStatus: 'active', expiresAt: '2026-01-01T00:00:00.000Z' });
  });

  it('uses defaults and forwards paging arguments, keying usage on the UTC day', async () => {
    const { ports, calls } = fakePorts();
    await handleListUsers(admin, {}, ports, now);
    await handleListUsers(admin, { pageSize: 10, pageToken: 'abc' }, ports, now);
    expect(calls).toEqual(['list:50:', 'usage:2026-09-30', 'list:10:abc', 'usage:2026-09-30']);
  });

  it('rejects invalid paging arguments', async () => {
    const { ports } = fakePorts();
    await expect(handleListUsers(admin, { pageSize: 0 }, ports, now)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleListUsers(admin, { pageSize: 101 }, ports, now)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleListUsers(admin, { pageToken: '' }, ports, now)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('wraps unexpected port failures as internal', async () => {
    const { ports } = fakePorts();
    (ports.listAuthUsers as jest.Mock).mockRejectedValue(new Error('auth outage'));
    await expect(handleListUsers(admin, {}, ports, now)).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('handleSetUserDisabled', () => {
  it('disables a user and revokes refresh tokens', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleSetUserDisabled(admin, { uid: 'u1', disabled: true }, ports)).resolves.toEqual({ uid: 'u1', disabled: true });
    expect(calls).toEqual(['disable:u1:true', 'revoke:u1']);
  });

  it('re-enabling does not revoke tokens', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleSetUserDisabled(admin, { uid: 'u1', disabled: false }, ports)).resolves.toEqual({ uid: 'u1', disabled: false });
    expect(calls).toEqual(['disable:u1:false']);
  });

  it('rejects invalid input', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleSetUserDisabled(admin, { uid: '', disabled: true }, ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleSetUserDisabled(admin, { uid: 'u1', disabled: 'yes' }, ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handleSetUserDisabled(admin, null, ports)).rejects.toMatchObject({ code: 'invalid-argument' });
    // A '/' would splice extra Firestore path segments (entitlements/${uid}): same charset as
    // the RevenueCat webhook's SAFE_DOC_ID.
    await expect(handleSetUserDisabled(admin, { uid: 'x/extra/y', disabled: true }, ports)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(calls).toEqual([]);
  });

  it('refuses to change the admin own account', async () => {
    const { ports, calls } = fakePorts();
    await expect(handleSetUserDisabled(admin, { uid: admin.uid, disabled: true }, ports)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(calls).toEqual([]);
  });

  it('reports not-found for a missing user', async () => {
    const { ports } = fakePorts({ userExists: false });
    const error = await handleSetUserDisabled(admin, { uid: 'ghost', disabled: true }, ports).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe('not-found');
  });
});

describe('handleSetUserPlan', () => {
  it('writes the full admin entitlement document (also for free)', async () => {
    const { ports, entitlementWrites } = fakePorts();
    await expect(
      handleSetUserPlan(admin, { uid: 'u1', plan: 'premium', expiresAt: '2027-01-01T00:00:00.000Z' }, ports, now),
    ).resolves.toEqual({ uid: 'u1', plan: 'premium' });
    await expect(handleSetUserPlan(admin, { uid: 'u1', plan: 'free', expiresAt: null }, ports, now)).resolves.toEqual({
      uid: 'u1',
      plan: 'free',
    });
    expect(entitlementWrites).toEqual([
      {
        uid: 'u1',
        doc: {
          plan: 'premium',
          status: 'active',
          expiresAt: '2027-01-01T00:00:00.000Z',
          source: 'admin',
          updatedAt: '2026-09-30T12:00:00.000Z',
        },
      },
      {
        uid: 'u1',
        doc: { plan: 'free', status: 'active', expiresAt: null, source: 'admin', updatedAt: '2026-09-30T12:00:00.000Z' },
      },
    ]);
  });

  it('rejects invalid input', async () => {
    const { ports, entitlementWrites } = fakePorts();
    await expect(handleSetUserPlan(admin, { uid: 'u1', plan: 'gold', expiresAt: null }, ports, now)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(handleSetUserPlan(admin, { uid: 'u1', plan: 'pro', expiresAt: 'tomorrow' }, ports, now)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(handleSetUserPlan(admin, { uid: 'u1', plan: 'pro' }, ports, now)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(handleSetUserPlan(admin, { uid: 'x/extra/y', plan: 'pro', expiresAt: null }, ports, now)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(entitlementWrites).toEqual([]);
  });

  it('reports not-found for a missing user without writing', async () => {
    const { ports, entitlementWrites } = fakePorts({ userExists: false });
    await expect(handleSetUserPlan(admin, { uid: 'ghost', plan: 'pro', expiresAt: null }, ports, now)).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(entitlementWrites).toEqual([]);
  });
});

describe('handleGetMetrics', () => {
  it('counts users, effective plans and usage over the UTC boundaries', async () => {
    const { ports } = fakePorts({
      totalUsers: 10,
      allEntitlements: [
        { plan: 'pro', status: 'active', expiresAt: null },
        { plan: 'pro', status: 'active', expiresAt: '2026-01-01T00:00:00.000Z' }, // expired => free
        { plan: 'premium', status: 'active', expiresAt: '2027-01-01T00:00:00.000Z' },
        { plan: 'premium', status: 'revoked', expiresAt: null }, // revoked => free
        { plan: 'free', status: 'active', expiresAt: null }, // admin downgrade
        { nonsense: true }, // invalid document => free
      ],
      usageSums: {
        '2026-09-30T00:00:00.000Z': 7,
        '2026-09-24T00:00:00.000Z': 42,
      },
    });
    const response = await handleGetMetrics(admin, {}, ports, now);
    expect(getMetricsResponseSchema.parse(response)).toEqual(response);
    expect(response).toEqual({
      totalUsers: 10,
      planCounts: { free: 8, pro: 1, premium: 1 },
      assistantRequests: { today: 7, last7Days: 42 },
    });
  });

  it('accepts an empty, null or missing payload', async () => {
    const { ports } = fakePorts();
    await expect(handleGetMetrics(admin, {}, ports, now)).resolves.toBeDefined();
    await expect(handleGetMetrics(admin, null, ports, now)).resolves.toBeDefined();
    await expect(handleGetMetrics(admin, undefined, ports, now)).resolves.toBeDefined();
  });

  it('never reports negative free counts', async () => {
    const { ports } = fakePorts({
      totalUsers: 1,
      allEntitlements: [
        { plan: 'pro', status: 'active', expiresAt: null },
        { plan: 'premium', status: 'active', expiresAt: null },
      ],
    });
    const response = await handleGetMetrics(admin, {}, ports, now);
    expect(response.planCounts).toEqual({ free: 0, pro: 1, premium: 1 });
  });
});

describe('pure helpers', () => {
  it('utcDayStartIso returns UTC midnights with day offsets', () => {
    expect(utcDayStartIso(now)).toBe('2026-09-30T00:00:00.000Z');
    expect(utcDayStartIso(now, -6)).toBe('2026-09-24T00:00:00.000Z');
    // Crosses a month boundary.
    expect(utcDayStartIso(new Date('2026-10-03T01:00:00.000Z'), -6)).toBe('2026-09-27T00:00:00.000Z');
  });

  it('entitlementDisplayOf keeps the raw status while the plan is the effective one', () => {
    expect(entitlementDisplayOf(undefined, now)).toEqual({
      plan: 'free',
      entitlementStatus: 'active',
      entitlementSource: 'none',
      expiresAt: null,
    });
    expect(
      entitlementDisplayOf({ plan: 'pro', status: 'grace_period', expiresAt: '2027-01-01T00:00:00.000Z', source: 'revenuecat' }, now),
    ).toEqual({
      plan: 'pro',
      entitlementStatus: 'grace_period',
      entitlementSource: 'revenuecat',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    // Malformed document: free, but whatever fields still parse are shown.
    expect(entitlementDisplayOf({ plan: 'gold', status: 'revoked' }, now)).toEqual({
      plan: 'free',
      entitlementStatus: 'revoked',
      entitlementSource: 'unknown',
      expiresAt: null,
    });
  });
});
