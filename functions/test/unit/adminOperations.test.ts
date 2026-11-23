/** M13/M14 admin additions: the WhatsApp panel and the alerts health view (pure parts). */
import { computeAlertsHealth, computeWhatsappPanel, mergeAlertHealth, MAX_ALERT_INSTALLATIONS, type AlertHealthEntry } from '../../src/admin/operations';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const ON = { agenda: true, debrief: false, confirmations: false, commitments: false, reminders: true };

describe('adminGetWhatsapp panel', () => {
  it('counts links, opt-ins for the linked phone only, stops, sends by kind and template states', () => {
    const panel = computeWhatsappPanel(
      [
        { phoneE164: '111', messages: { phoneE164: '111', switches: ON } },
        { phoneE164: '222', messages: { phoneE164: '999', switches: ON } },
        { phoneE164: '333', messages: { phoneE164: '333', switches: {}, stoppedAt: '2026-11-20T00:00:00.000Z' } },
        { phoneE164: null },
      ],
      [
        { id: 'a', data: { kind: 'agenda', status: 'sent', createdAt: '2026-11-23T10:00:00Z', uid: 'u1' } },
        { id: 'b', data: { kind: 'agenda', status: 'failed', errorCode: 131047, createdAt: '2026-11-23T11:00:00Z', uid: 'u1' } },
        { id: 'c', data: { kind: 'task', status: 'read', createdAt: '2026-11-22T11:00:00Z', uid: 'u2' } },
      ],
      [{ id: 'mg_task_reminder_v1_en', data: { status: 'APPROVED', category: 'UTILITY', ttlSeconds: 3600 } }],
      'preview',
      NOW,
    );
    expect(panel).toMatchObject({ mode: 'preview', linkedUsers: 3, optedIn: 1, stoppedLast30Days: 1 });
    expect(panel.switches).toMatchObject({ agenda: 1, reminders: 1, debrief: 0 });
    expect(panel.sends7d).toEqual({ agenda: { sent: 1, failed: 1 }, task: { read: 1 } });
    expect(panel.recent.map((r) => r.sendId)).toEqual(['b', 'a', 'c']);
    expect(panel.recent[0]).toMatchObject({ errorCode: 131047 });
    expect(JSON.stringify(panel)).not.toMatch(/111|222|333/);
    const task = panel.templates.find((t) => t.name === 'mg_task_reminder_v1' && t.language === 'en')!;
    expect(task.usable).toBe(true);
    expect(panel.templates.filter((t) => t.usable)).toHaveLength(1);
    expect(panel.templates).toHaveLength(14);
  });
});

function entry(overrides: Partial<AlertHealthEntry> = {}): AlertHealthEntry {
  return {
    platform: 'android',
    appVersion: '1.7.0',
    notifications: 'granted',
    exactAlarms: true,
    fullScreen: true,
    batteryUnrestricted: null,
    scheduledCount: 5,
    lastReconcileAt: '2026-11-23T10:00:00.000Z',
    reportedAt: '2026-11-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('alerts health view', () => {
  it('counts the phones that need attention, with their reasons', () => {
    const view = computeAlertsHealth(
      [
        { uid: 'u1', data: { installations: { a: entry(), b: entry({ platform: 'ios', exactAlarms: null, fullScreen: null, notifications: 'denied' }) } } },
        { uid: 'u2', data: { installations: { c: entry({ exactAlarms: false, lastReconcileAt: '2026-11-20T00:00:00.000Z', scheduledCount: 0 }) } } },
        { uid: 'u3', data: { installations: { d: { broken: true } } } },
      ],
      NOW,
    );
    expect(view).toMatchObject({ users: 2, installations: 3, notificationsOff: 1, exactAlarmsOff: 1, stalePlans: 1, noAlarms: 1 });
    expect(view.byPlatform).toEqual({ android: 2, ios: 1 });
    expect(view.attention).toEqual([
      expect.objectContaining({ uid: 'u1', installation: 'b', reasons: ['notifications_off'] }),
      expect.objectContaining({ uid: 'u2', installation: 'c', reasons: ['exact_alarms_off', 'stale_plan', 'no_alarms'] }),
    ]);
  });

  it('keeps the newest installations only', () => {
    let doc: unknown = undefined;
    for (let i = 0; i < MAX_ALERT_INSTALLATIONS + 2; i += 1) {
      doc = { installations: mergeAlertHealth(doc, `install-${i}`, entry({ reportedAt: `2026-11-2${i}T00:00:00.000Z` })) };
    }
    const kept = Object.keys((doc as { installations: Record<string, unknown> }).installations);
    expect(kept).toHaveLength(MAX_ALERT_INSTALLATIONS);
    expect(kept).not.toContain('install-0');
  });
});
