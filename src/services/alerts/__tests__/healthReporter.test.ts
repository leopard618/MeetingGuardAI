import type { AlertEngineStatus } from '../../../core/contracts';
import { healthReportOf, reportAlertHealthOnce, type HealthReporterDeps } from '../healthReporter';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

const STATUS: AlertEngineStatus = {
  initialized: true,
  permission: { notifications: 'granted', canAskAgain: true, exactAlarms: 'denied' },
  pendingCount: 12,
  nextAlertAt: null,
  lastReconcileAt: '2026-11-23T10:00:00.000Z',
  lastReconcileError: null,
  fullScreenAlarms: { exactAllowed: false, fullScreenAllowed: true, notificationsAllowed: true },
};

function deps(overrides: Partial<HealthReporterDeps> = {}) {
  const store = new Map<string, string>();
  const sent: unknown[] = [];
  let now = Date.parse('2026-11-23T12:00:00.000Z');
  const value: HealthReporterDeps = {
    getStatus: async () => STATUS,
    send: async (request) => {
      sent.push(request);
    },
    storage: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, item: string) => {
        store.set(key, item);
      },
    } as HealthReporterDeps['storage'],
    platform: 'android',
    appVersion: '1.7.0',
    now: () => now,
    newId: () => 'install-abc12345',
    ...overrides,
  };
  return { value, sent, advance: (ms: number) => (now += ms) };
}

describe('alerts health report (M14)', () => {
  it('carries permissions and counts only', () => {
    expect(healthReportOf(STATUS, 'install-abc12345', 'android', '1.7.0')).toEqual({
      installationId: 'install-abc12345',
      platform: 'android',
      appVersion: '1.7.0',
      notifications: 'granted',
      exactAlarms: false,
      fullScreen: true,
      batteryUnrestricted: null,
      scheduledCount: 12,
      lastReconcileAt: '2026-11-23T10:00:00.000Z',
    });
    const ios = healthReportOf({ ...STATUS, permission: { notifications: 'provisional', canAskAgain: true, exactAlarms: 'not_required' }, fullScreenAlarms: null }, 'install-abc12345', 'ios', '1.7.0');
    expect(ios).toMatchObject({ notifications: 'granted', exactAlarms: null, fullScreen: null });
  });

  it('sends once, again only when something changed or after a day', async () => {
    const d = deps();
    expect(await reportAlertHealthOnce(d.value)).toBe(true);
    expect(await reportAlertHealthOnce(d.value)).toBe(false);
    d.advance(25 * 3_600_000);
    expect(await reportAlertHealthOnce(d.value)).toBe(true);
    const changed = { ...d.value, getStatus: async () => ({ ...STATUS, pendingCount: 0 }) };
    expect(await reportAlertHealthOnce(changed)).toBe(true);
    expect(d.sent).toHaveLength(3);
    expect(new Set(d.sent.map((r) => (r as { installationId: string }).installationId))).toEqual(new Set(['install-abc12345']));
  });

  it('never throws and sends nothing before the engine started', async () => {
    const failing = deps({ send: async () => Promise.reject(new Error('offline')) });
    await expect(reportAlertHealthOnce(failing.value)).resolves.toBe(false);
    const early = deps({ getStatus: async () => ({ ...STATUS, initialized: false }) });
    expect(await reportAlertHealthOnce(early.value)).toBe(false);
    expect(early.sent).toHaveLength(0);
  });

  it('another account on the same phone reports at once', async () => {
    const d = deps();
    expect(await reportAlertHealthOnce(d.value, 'u1')).toBe(true);
    expect(await reportAlertHealthOnce(d.value, 'u1')).toBe(false);
    expect(await reportAlertHealthOnce(d.value, 'u2')).toBe(true);
  });
});
