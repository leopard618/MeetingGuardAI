import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WHATSAPP_TUNING } from '../../src/config';
import {
  DELETION_LOG_RETENTION_DAYS,
  MAINTENANCE_MAX_PAGES,
  MAINTENANCE_PAGE_SIZE,
  TOMBSTONE_RETENTION_DAYS,
  WHATSAPP_SESSION_RETENTION_DAYS,
  cutoffIso,
  replayAccountDeletions,
  runDailyMaintenance,
  type DeletionReplayPorts,
  type MaintenancePorts,
} from '../../src/maintenance/core';

const NOW = new Date('2026-10-05T03:30:00.000Z');

/** In-memory "database": path -> deletedAt/expiresAt/updatedAt (ISO). */
function fakeMaintenance(
  tombstones: Record<string, string>,
  records: Record<string, string>,
  whatsapp: { events?: Record<string, string>; codes?: Record<string, string>; sessions?: Record<string, string> } = {},
  summaries: { meetingSummaries?: Record<string, string>; events?: Record<string, string> } = {},
) {
  const deleted: string[] = [];
  const pick = (source: Record<string, string>, cutoff: string, limit: number): string[] =>
    Object.entries(source)
      .filter(([path, at]) => at < cutoff && !deleted.includes(path))
      .sort((a, b) => a[1].localeCompare(b[1]))
      .slice(0, limit)
      .map(([path]) => path);
  const ports: MaintenancePorts = {
    listExpiredTombstones: jest.fn(async (cutoff: string, limit: number) => pick(tombstones, cutoff, limit)),
    listExpiredDeletionRecords: jest.fn(async (cutoff: string, limit: number) => pick(records, cutoff, limit)),
    listExpiredWhatsappEvents: jest.fn(async (cutoff: string, limit: number) => pick(whatsapp.events ?? {}, cutoff, limit)),
    listExpiredWhatsappCodes: jest.fn(async (cutoff: string, limit: number) => pick(whatsapp.codes ?? {}, cutoff, limit)),
    listStaleWhatsappSessions: jest.fn(async (cutoff: string, limit: number) => pick(whatsapp.sessions ?? {}, cutoff, limit)),
    listExpiredMeetingSummaries: jest.fn(async (cutoff: string, limit: number) => pick(summaries.meetingSummaries ?? {}, cutoff, limit)),
    listExpiredSummaryEvents: jest.fn(async (cutoff: string, limit: number) => pick(summaries.events ?? {}, cutoff, limit)),
    deleteDocuments: jest.fn(async (paths: readonly string[]) => {
      deleted.push(...paths);
    }),
    // The M10 purges: expiresAt is checked again at delete time (any source holding the path).
    deleteIfExpired: jest.fn(async (paths: readonly string[], nowIso: string) => {
      const all: Record<string, string> = { ...(summaries.meetingSummaries ?? {}), ...(summaries.events ?? {}) };
      const gone = paths.filter((path) => (all[path] ?? '') !== '' && (all[path] ?? '') < nowIso && !deleted.includes(path));
      deleted.push(...gone);
      return gone.length;
    }),
  };
  return { ports, deleted };
}

describe('dailyMaintenance', () => {
  it('purges tombstones older than the retention and old deletion records, nothing newer', async () => {
    const { ports, deleted } = fakeMaintenance(
      {
        'users/a/meetings/old': '2026-07-01T00:00:00.000Z',
        'users/b/meetings/edge': cutoffIso(NOW, TOMBSTONE_RETENTION_DAYS),
        'users/b/meetings/recent': '2026-09-30T00:00:00.000Z',
      },
      {
        'accountDeletions/gone': '2026-08-01T00:00:00.000Z',
        'accountDeletions/fresh': '2026-10-01T00:00:00.000Z',
      },
    );
    const result = await runDailyMaintenance(ports, NOW);
    expect(result).toEqual({
      tombstonesPurged: 1,
      deletionRecordsPurged: 1,
      whatsappEventsPurged: 0,
      whatsappCodesPurged: 0,
      whatsappSessionsPurged: 0,
      meetingSummariesPurged: 0,
      summaryEventsPurged: 0,
      complete: true,
    });
    expect(deleted.sort()).toEqual(['accountDeletions/gone', 'users/a/meetings/old']);
    expect(ports.listExpiredTombstones).toHaveBeenCalledWith('2026-08-06T03:30:00.000Z', MAINTENANCE_PAGE_SIZE);
    expect(ports.listExpiredDeletionRecords).toHaveBeenCalledWith(cutoffIso(NOW, DELETION_LOG_RETENTION_DAYS), MAINTENANCE_PAGE_SIZE);
  });

  it('works in pages and stops at the page limit (the next run continues)', async () => {
    const many: Record<string, string> = {};
    for (let index = 0; index < MAINTENANCE_PAGE_SIZE * (MAINTENANCE_MAX_PAGES + 1); index += 1) {
      many[`users/u/meetings/m${index}`] = '2026-01-01T00:00:00.000Z';
    }
    const { ports } = fakeMaintenance(many, {});
    const result = await runDailyMaintenance(ports, NOW);
    expect(result.tombstonesPurged).toBe(MAINTENANCE_PAGE_SIZE * MAINTENANCE_MAX_PAGES);
    expect(result.complete).toBe(false);
  });

  it('keeps the deletion log longer than backups (14 days) and point-in-time recovery (7 days)', () => {
    expect(DELETION_LOG_RETENTION_DAYS).toBeGreaterThan(14 + 7);
  });

  it('uses the same tombstone retention as the app', () => {
    const appTypes = readFileSync(join(__dirname, '..', '..', '..', 'src', 'core', 'types.ts'), 'utf8');
    const match = /export const TOMBSTONE_RETENTION_DAYS = (\d+);/.exec(appTypes);
    expect(Number(match?.[1])).toBe(TOMBSTONE_RETENTION_DAYS);
  });

  it('purges WhatsApp state: expired events and codes by expiresAt (now), stale sessions by retention', async () => {
    const { ports, deleted } = fakeMaintenance(
      {},
      {},
      {
        events: { 'whatsappEvents/old': '2026-10-01T00:00:00.000Z', 'whatsappEvents/live': '2026-10-09T00:00:00.000Z' },
        codes: { 'whatsappLinkCodes/old': '2026-10-05T03:00:00.000Z', 'whatsappLinkCodes/live': '2026-10-05T04:00:00.000Z' },
        sessions: { 'whatsappSessions/stale': '2026-08-01T00:00:00.000Z', 'whatsappSessions/active': '2026-10-04T00:00:00.000Z' },
      },
    );
    const result = await runDailyMaintenance(ports, NOW);
    expect(result.whatsappEventsPurged).toBe(1);
    expect(result.whatsappCodesPurged).toBe(1);
    expect(result.whatsappSessionsPurged).toBe(1);
    expect(result.complete).toBe(true);
    expect(deleted.sort()).toEqual(['whatsappEvents/old', 'whatsappLinkCodes/old', 'whatsappSessions/stale']);
    // Events and codes purge against NOW itself (their own expiresAt), sessions against the cutoff.
    expect(ports.listExpiredWhatsappEvents).toHaveBeenCalledWith(NOW.toISOString(), MAINTENANCE_PAGE_SIZE);
    expect(ports.listStaleWhatsappSessions).toHaveBeenCalledWith(cutoffIso(NOW, WHATSAPP_SESSION_RETENTION_DAYS), MAINTENANCE_PAGE_SIZE);
  });

  it('keeps the session retention in sync with WHATSAPP_TUNING.sessionPurgeDays', () => {
    expect(WHATSAPP_SESSION_RETENTION_DAYS).toBe(WHATSAPP_TUNING.sessionPurgeDays);
  });

  it('purges meeting summaries and summary events by their own expiresAt (now), counts only (M10)', async () => {
    const { ports, deleted } = fakeMaintenance(
      {},
      {},
      {},
      {
        meetingSummaries: {
          'users/a/meetingSummaries/inbox': '2026-10-04T00:00:00.000Z',
          'users/b/meetingSummaries/refused-2026-09-01': '2026-10-01T00:00:00.000Z',
          'users/b/meetingSummaries/filed': '2027-09-01T00:00:00.000Z',
          'users/c/meetingSummaries/edge': NOW.toISOString(),
        },
        events: { 'summaryEvents/old': '2026-10-05T03:29:59.999Z', 'summaryEvents/live': '2026-11-01T00:00:00.000Z' },
      },
    );
    const result = await runDailyMaintenance(ports, NOW);
    expect(result).toMatchObject({ meetingSummariesPurged: 2, summaryEventsPurged: 1, complete: true });
    expect(deleted.sort()).toEqual(['summaryEvents/old', 'users/a/meetingSummaries/inbox', 'users/b/meetingSummaries/refused-2026-09-01']);
    // Both purge against NOW itself: expiresAt is set when the document is written.
    expect(ports.listExpiredMeetingSummaries).toHaveBeenCalledWith(NOW.toISOString(), MAINTENANCE_PAGE_SIZE);
    expect(ports.listExpiredSummaryEvents).toHaveBeenCalledWith(NOW.toISOString(), MAINTENANCE_PAGE_SIZE);
    // Every result field is a count or the completion flag: nothing else reaches the log line
    // (purgeErrors appears only when a purge failed, and then holds error names only).
    expect(result.purgeErrors).toBeUndefined();
    for (const value of Object.values(result)) expect(['number', 'boolean']).toContain(typeof value);
  });

  it('reports an incomplete run when the summaries purge hits the page limit, after the other purges ran', async () => {
    const many: Record<string, string> = {};
    for (let index = 0; index < MAINTENANCE_PAGE_SIZE * (MAINTENANCE_MAX_PAGES + 1); index += 1) {
      many[`users/u/meetingSummaries/s${index}`] = '2026-01-01T00:00:00.000Z';
    }
    const { ports } = fakeMaintenance(
      { 'users/a/meetings/old': '2026-07-01T00:00:00.000Z' },
      {},
      {},
      { meetingSummaries: many, events: { 'summaryEvents/old': '2026-10-01T00:00:00.000Z' } },
    );
    const result = await runDailyMaintenance(ports, NOW);
    expect(result.tombstonesPurged).toBe(1);
    expect(result.meetingSummariesPurged).toBe(MAINTENANCE_PAGE_SIZE * MAINTENANCE_MAX_PAGES);
    // The events purge still runs on the same day.
    expect(result.summaryEventsPurged).toBe(1);
    expect(result.complete).toBe(false);
  });

  it('never fails the run when an M10 purge fails: the other purges run and only the error name is kept (review P5)', async () => {
    const { ports, deleted } = fakeMaintenance(
      { 'users/a/meetings/old': '2026-07-01T00:00:00.000Z' },
      {},
      {},
      { events: { 'summaryEvents/old': '2026-10-01T00:00:00.000Z' } },
    );
    // A collection-group query before its index is deployed: FAILED_PRECONDITION, a message naming the project.
    const missingIndex = Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. https://console.firebase.google.com/project/p'), {
      code: 9,
    });
    (ports.listExpiredMeetingSummaries as jest.Mock).mockRejectedValue(missingIndex);
    const result = await runDailyMaintenance(ports, NOW);
    expect(result).toEqual({
      tombstonesPurged: 1,
      deletionRecordsPurged: 0,
      whatsappEventsPurged: 0,
      whatsappCodesPurged: 0,
      whatsappSessionsPurged: 0,
      meetingSummariesPurged: 0,
      summaryEventsPurged: 1,
      complete: false,
      purgeErrors: { meetingSummaries: 'Error' },
    });
    expect(deleted.sort()).toEqual(['summaryEvents/old', 'users/a/meetings/old']);
    expect(JSON.stringify(result)).not.toContain('FAILED_PRECONDITION');
  });

  it('keeps what a failing M10 purge deleted before it failed, and also survives a failing summaryEvents purge', async () => {
    const many: Record<string, string> = {};
    for (let index = 0; index < MAINTENANCE_PAGE_SIZE; index += 1) many[`users/u/meetingSummaries/s${index}`] = '2026-01-01T00:00:00.000Z';
    const { ports } = fakeMaintenance({}, {}, {}, { meetingSummaries: many });
    const list = ports.listExpiredMeetingSummaries as jest.Mock;
    const firstPage = list.getMockImplementation() as (cutoff: string, limit: number) => Promise<string[]>;
    list.mockImplementationOnce(firstPage).mockRejectedValueOnce(new TypeError('unavailable'));
    (ports.listExpiredSummaryEvents as jest.Mock).mockRejectedValue(new RangeError('deadline'));
    const result = await runDailyMaintenance(ports, NOW);
    expect(result.meetingSummariesPurged).toBe(MAINTENANCE_PAGE_SIZE);
    expect(result.purgeErrors).toEqual({ meetingSummaries: 'TypeError', summaryEvents: 'RangeError' });
    expect(result.complete).toBe(false);
  });

  it('purges M10 state through the expiry re-check, never the blind delete (review S6)', async () => {
    const { ports } = fakeMaintenance({}, {}, {}, { meetingSummaries: { 'users/a/meetingSummaries/inbox': '2026-10-04T00:00:00.000Z' } });
    await runDailyMaintenance(ports, NOW);
    expect(ports.deleteIfExpired).toHaveBeenCalledWith(['users/a/meetingSummaries/inbox'], NOW.toISOString());
    expect(ports.deleteDocuments).not.toHaveBeenCalled();
  });
});

describe('replayAccountDeletions', () => {
  function fakeReplay(uids: string[], options: { failSummariesFor?: string } = {}) {
    const calls: string[] = [];
    const ports: DeletionReplayPorts = {
      listDeletionsSince: jest.fn(async () => uids),
      recursiveDelete: jest.fn(async (path: string) => {
        calls.push(`recursive:${path}`);
      }),
      deleteDocument: jest.fn(async (path: string) => {
        calls.push(`doc:${path}`);
      }),
      deleteSummaryData: jest.fn(async (uid: string) => {
        calls.push(`summaries:${uid}`);
        if (options.failSummariesFor === uid) throw new Error('unavailable');
      }),
    };
    return { ports, calls };
  }

  it('deletes again the data of every account deleted since the backup time', async () => {
    const { ports, calls } = fakeReplay(['u1', 'u2']);
    await expect(replayAccountDeletions('2026-10-01T09:00:00Z', ports)).resolves.toEqual(['u1', 'u2']);
    expect(ports.listDeletionsSince).toHaveBeenCalledWith('2026-10-01T09:00:00.000Z');
    expect(calls).toEqual([
      'summaries:u1',
      'recursive:users/u1',
      'doc:entitlements/u1',
      'recursive:usage/u1',
      'summaries:u2',
      'recursive:users/u2',
      'doc:entitlements/u2',
      'recursive:usage/u2',
    ]);
  });

  it('removes the restored summaries address first, as deleteAccount does, and also with the WhatsApp port (M10)', async () => {
    const { ports, calls } = fakeReplay(['u1']);
    const withWhatsApp: DeletionReplayPorts = {
      ...ports,
      deleteWhatsAppData: jest.fn(async (uid: string) => {
        calls.push(`whatsapp:${uid}`);
      }),
    };
    await replayAccountDeletions('2026-10-01T09:00:00Z', withWhatsApp);
    expect(calls).toEqual(['summaries:u1', 'recursive:users/u1', 'doc:entitlements/u1', 'recursive:usage/u1', 'whatsapp:u1']);
  });

  it('stops the replay when the summaries port fails (the owner reruns it; every step is idempotent)', async () => {
    const { ports, calls } = fakeReplay(['u1', 'u2'], { failSummariesFor: 'u1' });
    await expect(replayAccountDeletions('2026-10-01T09:00:00Z', ports)).rejects.toThrow('unavailable');
    expect(calls).toEqual(['summaries:u1']);
  });

  it('only lists in a dry run, and rejects a bad time', async () => {
    const { ports, calls } = fakeReplay(['u1']);
    await expect(replayAccountDeletions('2026-10-01T09:00:00Z', ports, { dryRun: true })).resolves.toEqual(['u1']);
    expect(calls).toEqual([]);
    await expect(replayAccountDeletions('yesterday', ports)).rejects.toThrow('Invalid --since time');
  });
});
