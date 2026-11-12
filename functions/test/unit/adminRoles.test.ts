import {
  handleGetHealth,
  handleGetMetrics,
  handleGetRevenue,
  handleGetStats,
  handleListUsers,
  handleSetUserDisabled,
  handleSetUserPlan,
  requireViewer,
  type AdminCaller,
  type AdminHealthPorts,
  type AdminPorts,
  type AdminRevenuePorts,
  type AdminStatsPorts,
} from '../../src/admin';
import { entitlementSummary, type AdminAuditEntry } from '../../src/admin/audit';

jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const admin: AdminCaller = { uid: 'admin-1', isAdmin: true, isViewer: true };
const viewer: AdminCaller = { uid: 'viewer-1', isAdmin: false, isViewer: true };
const mortal: AdminCaller = { uid: 'user-1', isAdmin: false, isViewer: false };
const now = new Date('2026-10-26T12:00:00.000Z');

function fakeAdminPorts(entitlement: unknown = undefined) {
  const audit: AdminAuditEntry[] = [];
  const ports: AdminPorts = {
    listAuthUsers: jest.fn(async () => ({ users: [], nextPageToken: null })),
    getEntitlements: jest.fn(async (uids: string[]) => {
      const map = new Map<string, unknown>();
      for (const uid of uids) if (entitlement !== undefined) map.set(uid, entitlement);
      return map;
    }),
    getUsageCounts: jest.fn(async () => new Map<string, number>()),
    setAuthUserDisabled: jest.fn(async () => true),
    revokeRefreshTokens: jest.fn(async () => undefined),
    userExists: jest.fn(async () => true),
    writeEntitlement: jest.fn(async () => undefined),
    countAuthUsers: jest.fn(async () => 0),
    listAllEntitlements: jest.fn(async () => []),
    sumUsageCountsSince: jest.fn(async () => 0),
    audit: { writeAudit: jest.fn(async (entry: AdminAuditEntry) => { audit.push(entry); }) },
  };
  return { ports, audit };
}

const statsPorts: AdminStatsPorts = {
  getStatsDays: jest.fn(async () => new Map<string, unknown>()),
  listAuthCreationTimes: jest.fn(async () => []),
  pricing: () => ({ inPerM: 0, outPerM: 0 }),
};

const revenuePorts: AdminRevenuePorts = {
  listRevenueMarkers: jest.fn(async () => []),
  listEntitlements: jest.fn(async () => []),
};

function fakeHealthPorts() {
  const ping = jest.fn(async () => ({ ok: true, latencyMs: 10 }));
  const ports: AdminHealthPorts = {
    runtimeConfig: () => ({ model: 'm', reasoningEffort: 'none', globalDailyLimit: 100 }),
    keyStatus: jest.fn(async () => ({ mode: 'rest' as const, version: '1', lastRotatedAt: null, iamReady: true })),
    pingAssistant: ping,
  };
  return { ports, ping };
}

describe('requireViewer', () => {
  it('admits admins and viewers, rejects everyone else', () => {
    expect(() => requireViewer(admin)).not.toThrow();
    expect(() => requireViewer(viewer)).not.toThrow();
    expect(() => requireViewer(mortal)).toThrow(expect.objectContaining({ code: 'permission-denied' }));
    expect(() => requireViewer({ uid: 'legacy', isAdmin: false })).toThrow(expect.objectContaining({ code: 'permission-denied' }));
    expect(() => requireViewer(null)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });
});

describe('viewer role', () => {
  it('may read every view', async () => {
    const { ports } = fakeAdminPorts();
    await expect(handleListUsers(viewer, {}, ports, now)).resolves.toMatchObject({ users: [] });
    await expect(handleGetMetrics(viewer, {}, ports, now)).resolves.toMatchObject({ totalUsers: 0 });
    await expect(handleGetStats(viewer, { days: 7 }, statsPorts, now)).resolves.toMatchObject({ totals: { requests: 0 } });
    await expect(handleGetRevenue(viewer, { days: 7 }, revenuePorts, now)).resolves.toMatchObject({ active: { paying: 0 } });
    const health = fakeHealthPorts();
    await expect(handleGetHealth(viewer, { ping: false }, health.ports)).resolves.toMatchObject({ model: 'm' });
    expect(health.ping).not.toHaveBeenCalled();
  });

  it('may not write, and may not send the billed ping', async () => {
    const { ports, audit } = fakeAdminPorts();
    await expect(handleSetUserDisabled(viewer, { uid: 'u1', disabled: true }, ports)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(handleSetUserPlan(viewer, { uid: 'u1', plan: 'pro', expiresAt: null }, ports, now)).rejects.toMatchObject({ code: 'permission-denied' });
    const health = fakeHealthPorts();
    await expect(handleGetHealth(viewer, { ping: true }, health.ports)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(health.ping).not.toHaveBeenCalled();
    expect(ports.setAuthUserDisabled).not.toHaveBeenCalled();
    expect(ports.writeEntitlement).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });
});

describe('audit log', () => {
  it('records a plan change with the state before and after', async () => {
    const { ports, audit } = fakeAdminPorts({ plan: 'free', status: 'expired', expiresAt: null, source: 'revenuecat', eventTimestampMs: 1 });
    await handleSetUserPlan(admin, { uid: 'u1', plan: 'premium', expiresAt: '2026-12-31T23:59:59.000Z' }, ports, now);
    expect(audit).toEqual([
      {
        at: now.toISOString(),
        actorUid: 'admin-1',
        action: 'setUserPlan',
        targetUid: 'u1',
        before: { plan: 'free', status: 'expired', expiresAt: null, source: 'revenuecat' },
        after: { plan: 'premium', status: 'active', expiresAt: '2026-12-31T23:59:59.000Z', source: 'admin' },
        outcome: 'ok',
      },
    ]);
  });

  it('records a disable and an enable', async () => {
    const { ports, audit } = fakeAdminPorts();
    await handleSetUserDisabled(admin, { uid: 'u1', disabled: true }, ports);
    await handleSetUserDisabled(admin, { uid: 'u1', disabled: false }, ports);
    expect(audit.map((entry) => [entry.action, entry.targetUid, entry.after?.disabled, entry.outcome])).toEqual([
      ['setUserDisabled', 'u1', true, 'ok'],
      ['setUserDisabled', 'u1', false, 'ok'],
    ]);
    expect(audit.every((entry) => entry.actorUid === 'admin-1')).toBe(true);
  });

  it('entitlementSummary keeps only the display fields', () => {
    expect(entitlementSummary({ plan: 'pro', status: 'active', expiresAt: null, source: 'admin', eventTimestampMs: 5, billing: {} }))
      .toEqual({ plan: 'pro', status: 'active', expiresAt: null, source: 'admin' });
    expect(entitlementSummary(null)).toBeNull();
    expect(entitlementSummary('x')).toBeNull();
    expect(entitlementSummary({ unrelated: 1 })).toBeNull();
  });
});
