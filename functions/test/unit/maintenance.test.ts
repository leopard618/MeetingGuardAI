import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DELETION_LOG_RETENTION_DAYS,
  MAINTENANCE_MAX_PAGES,
  MAINTENANCE_PAGE_SIZE,
  TOMBSTONE_RETENTION_DAYS,
  cutoffIso,
  replayAccountDeletions,
  runDailyMaintenance,
  type DeletionReplayPorts,
  type MaintenancePorts,
} from '../../src/maintenance/core';

const NOW = new Date('2026-10-05T03:30:00.000Z');

/** In-memory "database": path -> deletedAt (ISO). */
function fakeMaintenance(tombstones: Record<string, string>, records: Record<string, string>) {
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
    deleteDocuments: jest.fn(async (paths: readonly string[]) => {
      deleted.push(...paths);
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
    expect(result).toEqual({ tombstonesPurged: 1, deletionRecordsPurged: 1, complete: true });
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
});

describe('replayAccountDeletions', () => {
  function fakeReplay(uids: string[]) {
    const calls: string[] = [];
    const ports: DeletionReplayPorts = {
      listDeletionsSince: jest.fn(async () => uids),
      recursiveDelete: jest.fn(async (path: string) => {
        calls.push(`recursive:${path}`);
      }),
      deleteDocument: jest.fn(async (path: string) => {
        calls.push(`doc:${path}`);
      }),
    };
    return { ports, calls };
  }

  it('deletes again the data of every account deleted since the backup time', async () => {
    const { ports, calls } = fakeReplay(['u1', 'u2']);
    await expect(replayAccountDeletions('2026-10-01T09:00:00Z', ports)).resolves.toEqual(['u1', 'u2']);
    expect(ports.listDeletionsSince).toHaveBeenCalledWith('2026-10-01T09:00:00.000Z');
    expect(calls).toEqual([
      'recursive:users/u1',
      'doc:entitlements/u1',
      'recursive:usage/u1',
      'recursive:users/u2',
      'doc:entitlements/u2',
      'recursive:usage/u2',
    ]);
  });

  it('only lists in a dry run, and rejects a bad time', async () => {
    const { ports, calls } = fakeReplay(['u1']);
    await expect(replayAccountDeletions('2026-10-01T09:00:00Z', ports, { dryRun: true })).resolves.toEqual(['u1']);
    expect(calls).toEqual([]);
    await expect(replayAccountDeletions('yesterday', ports)).rejects.toThrow('Invalid --since time');
  });
});
