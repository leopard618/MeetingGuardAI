/**
 * Server-side data retention (pure logic; the Firestore adapters and the scheduled trigger are in
 * ./index.ts, the restore tool in scripts/replay-account-deletions.mjs).
 *
 * 1. Deleted-meeting tombstones. The app keeps a tombstone (ids, time slot, external refs; content
 *    scrubbed) so a deletion reaches the user's other devices and calendars, and the privacy policy
 *    promises it is erased after TOMBSTONE_RETENTION_DAYS. The app purges old tombstones once per
 *    session, which never happens for a user who stopped opening it, so the daily maintenance run
 *    purges them on the server too (same cutoff as the app: src/core/types.ts).
 *
 * 2. Account deletion log. `deleteAccount` writes accountDeletions/{uid} = { deletedAt } BEFORE it
 *    deletes anything. Firestore backups (daily, kept 14 days) and point-in-time recovery (7 days)
 *    still hold a deleted user's data, and a restore imports it back. After any restore, the
 *    runbook replays every deletion recorded since the backup time (docs/DEPLOYMENT.md §7), so a
 *    deleted account stays deleted. The record holds only the anonymous user id and the time, and
 *    is itself deleted after DELETION_LOG_RETENTION_DAYS (longer than any backup is kept).
 */

/** Must equal TOMBSTONE_RETENTION_DAYS in src/core/types.ts (checked by a unit test). */
export const TOMBSTONE_RETENTION_DAYS = 60;

/** Longer than the backup retention (14 days) plus point-in-time recovery (7 days). */
export const DELETION_LOG_RETENTION_DAYS = 30;

/**
 * WhatsApp bot state retention (docs/ARCHITECTURE.md §27): dedupe markers (whatsappEvents) and
 * link codes (whatsappLinkCodes) carry their own `expiresAt` and are purged once it passed;
 * sessions idle longer than WHATSAPP_SESSION_RETENTION_DAYS (their `updatedAt`) are purged too
 * (must equal WHATSAPP_TUNING.sessionPurgeDays in ../config.ts; a unit test checks it).
 */
export const WHATSAPP_SESSION_RETENTION_DAYS = 30;

/** Collection of account deletion records (server-only; the rules deny clients). */
export const ACCOUNT_DELETIONS_COLLECTION = 'accountDeletions';

/** Documents deleted per page, and pages per run (a run stops early and the next day continues). */
export const MAINTENANCE_PAGE_SIZE = 300;
export const MAINTENANCE_MAX_PAGES = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MaintenancePorts {
  /** Paths of meeting tombstones of any user whose `deletedAt` (ISO) is before `cutoffIso`. */
  listExpiredTombstones(cutoffIso: string, limit: number): Promise<string[]>;
  /** Paths of account deletion records whose `deletedAt` (ISO) is before `cutoffIso`. */
  listExpiredDeletionRecords(cutoffIso: string, limit: number): Promise<string[]>;
  /** Paths of whatsappEvents dedupe markers whose `expiresAt` (ISO) is before `nowIso`. */
  listExpiredWhatsappEvents(nowIso: string, limit: number): Promise<string[]>;
  /** Paths of whatsappLinkCodes whose `expiresAt` (ISO) is before `nowIso`. */
  listExpiredWhatsappCodes(nowIso: string, limit: number): Promise<string[]>;
  /** Paths of whatsappSessions whose `updatedAt` (ISO) is before `cutoffIso`. */
  listStaleWhatsappSessions(cutoffIso: string, limit: number): Promise<string[]>;
  /** Deletes the documents (missing ones are fine). */
  deleteDocuments(paths: readonly string[]): Promise<void>;
}

export interface MaintenanceResult {
  tombstonesPurged: number;
  deletionRecordsPurged: number;
  whatsappEventsPurged: number;
  whatsappCodesPurged: number;
  whatsappSessionsPurged: number;
  /** false when a page limit stopped the run early (the rest is done on the next run). */
  complete: boolean;
}

export function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

async function purgeInPages(
  list: (cutoff: string, limit: number) => Promise<string[]>,
  cutoff: string,
  ports: MaintenancePorts,
): Promise<{ purged: number; complete: boolean }> {
  let purged = 0;
  for (let page = 0; page < MAINTENANCE_MAX_PAGES; page += 1) {
    const paths = await list(cutoff, MAINTENANCE_PAGE_SIZE);
    if (paths.length === 0) return { purged, complete: true };
    await ports.deleteDocuments(paths);
    purged += paths.length;
    if (paths.length < MAINTENANCE_PAGE_SIZE) return { purged, complete: true };
  }
  return { purged, complete: false };
}

/** The daily run: expired tombstones, deletion records, then the WhatsApp bot state (§27). */
export async function runDailyMaintenance(ports: MaintenancePorts, now: Date): Promise<MaintenanceResult> {
  const tombstones = await purgeInPages(
    (cutoff, limit) => ports.listExpiredTombstones(cutoff, limit),
    cutoffIso(now, TOMBSTONE_RETENTION_DAYS),
    ports,
  );
  const records = await purgeInPages(
    (cutoff, limit) => ports.listExpiredDeletionRecords(cutoff, limit),
    cutoffIso(now, DELETION_LOG_RETENTION_DAYS),
    ports,
  );
  const nowIso = now.toISOString();
  const events = await purgeInPages((cutoff, limit) => ports.listExpiredWhatsappEvents(cutoff, limit), nowIso, ports);
  const codes = await purgeInPages((cutoff, limit) => ports.listExpiredWhatsappCodes(cutoff, limit), nowIso, ports);
  const sessions = await purgeInPages(
    (cutoff, limit) => ports.listStaleWhatsappSessions(cutoff, limit),
    cutoffIso(now, WHATSAPP_SESSION_RETENTION_DAYS),
    ports,
  );
  return {
    tombstonesPurged: tombstones.purged,
    deletionRecordsPurged: records.purged,
    whatsappEventsPurged: events.purged,
    whatsappCodesPurged: codes.purged,
    whatsappSessionsPurged: sessions.purged,
    complete: tombstones.complete && records.complete && events.complete && codes.complete && sessions.complete,
  };
}

export interface DeletionReplayPorts {
  /** User ids of the deletion records with `deletedAt` at or after `sinceIso`. */
  listDeletionsSince(sinceIso: string): Promise<string[]>;
  /** Deletes a document and all of its subcollections (no-op when nothing exists). */
  recursiveDelete(path: string): Promise<void>;
  /** Deletes one document (no-op when missing). */
  deleteDocument(path: string): Promise<void>;
}

/** The server data of one deleted account (the Auth user is already gone: Auth is not restored). */
export async function deleteAccountDocuments(uid: string, ports: Pick<DeletionReplayPorts, 'recursiveDelete' | 'deleteDocument'>): Promise<void> {
  await ports.recursiveDelete(`users/${uid}`);
  await ports.deleteDocument(`entitlements/${uid}`);
  await ports.recursiveDelete(`usage/${uid}`);
}

/**
 * After a Firestore restore or import: deletes again the data of every account deleted since
 * `sinceIso` (the backup or snapshot time). Returns the user ids it processed.
 */
export async function replayAccountDeletions(sinceIso: string, ports: DeletionReplayPorts, options: { dryRun?: boolean } = {}): Promise<string[]> {
  if (Number.isNaN(Date.parse(sinceIso))) throw new Error(`Invalid --since time: ${sinceIso}`);
  const since = new Date(sinceIso).toISOString();
  const uids = await ports.listDeletionsSince(since);
  if (options.dryRun) return uids;
  for (const uid of uids) {
    await deleteAccountDocuments(uid, ports);
  }
  return uids;
}
