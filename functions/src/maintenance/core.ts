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
 *    runbook replays every deletion recorded since the backup time (docs/v1/DEPLOYMENT.md §7), so a
 *    deleted account stays deleted. The record holds only the anonymous user id and the time, and
 *    is itself deleted after DELETION_LOG_RETENTION_DAYS (longer than any backup is kept).
 *
 * 3. Meeting summaries (M10, docs/v2/M10-DESIGN.md section 7). Every document carries its own
 *    `expiresAt`, set when it is written (functions/src/summaries/model.ts SUMMARY_RETENTION_DAYS):
 *    users/{uid}/meetingSummaries summaries (filed or kept 365 days, inbox 60 days, from receipt)
 *    and refused rows (30 days after the latest refusal), and the root summaryEvents markers
 *    (35 days) and first-seen records (2 days). The daily run deletes them once `expiresAt` passed.
 *    Gmail confirmation requests are not documents of their own: they live in
 *    summaryUsers/{uid}.gmailRequests and are pruned when that document is written.
 *    Two differences from the purges above (review findings P5 and S6, Nov 12):
 *    - Each M10 purge is NON-FATAL: its error is caught, recorded by error name only in
 *      purgeErrors, and the run goes on (complete false). The meetingSummaries purge is a
 *      collection-group query that needs the expiresAt fieldOverride, which is deployed with the
 *      rules after Apple's decision (design section 7); until then it fails every day and must
 *      not stop the summaryEvents purge or the completion log.
 *    - The delete re-checks expiresAt (deleteIfExpired): a summary filed or kept, or a marker
 *      claimed again, between the listing and the delete keeps its new expiry and is not deleted.
 */

/** Must equal TOMBSTONE_RETENTION_DAYS in src/core/types.ts (checked by a unit test). */
export const TOMBSTONE_RETENTION_DAYS = 60;

/** Longer than the backup retention (14 days) plus point-in-time recovery (7 days). */
export const DELETION_LOG_RETENTION_DAYS = 30;

/**
 * WhatsApp bot state retention (docs/v1/ARCHITECTURE.md §27): dedupe markers (whatsappEvents) and
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
  /**
   * Paths of users/{uid}/meetingSummaries documents of any user (summaries and refused rows) whose
   * `expiresAt` (ISO) is before `nowIso` (M10; collection-group query).
   */
  listExpiredMeetingSummaries(nowIso: string, limit: number): Promise<string[]>;
  /** Paths of summaryEvents markers and first-seen records whose `expiresAt` (ISO) is before `nowIso` (M10). */
  listExpiredSummaryEvents(nowIso: string, limit: number): Promise<string[]>;
  /** Deletes the documents (missing ones are fine). */
  deleteDocuments(paths: readonly string[]): Promise<void>;
  /**
   * M10: deletes each document whose `expiresAt` (ISO) is STILL before `nowIso` when it is deleted
   * (re-read in the same transaction); a missing one, or one whose expiry moved meanwhile, is left
   * alone. Resolves the number deleted.
   */
  deleteIfExpired(paths: readonly string[], nowIso: string): Promise<number>;
}

/** The M10 purges that may fail without failing the run (MaintenanceResult.purgeErrors). */
export type SummaryPurge = 'meetingSummaries' | 'summaryEvents';

export interface MaintenanceResult {
  tombstonesPurged: number;
  deletionRecordsPurged: number;
  whatsappEventsPurged: number;
  whatsappCodesPurged: number;
  whatsappSessionsPurged: number;
  /** M10: expired users/{uid}/meetingSummaries documents (summaries and refused rows). */
  meetingSummariesPurged: number;
  /** M10: expired summaryEvents documents (markers and first-seen records). */
  summaryEventsPurged: number;
  /** false when a page limit stopped the run early (the rest is done on the next run), or an M10 purge failed. */
  complete: boolean;
  /**
   * Present only when an M10 purge failed: the purge and the error's name (never its message,
   * which can carry project ids or paths). The documents it purged before failing are counted.
   */
  purgeErrors?: Partial<Record<SummaryPurge, string>>;
}

export function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

interface PurgeProgress {
  purged: number;
  complete: boolean;
}

async function purgeInPages(
  list: (cutoff: string, limit: number) => Promise<string[]>,
  cutoff: string,
  ports: MaintenancePorts,
  remove: (paths: readonly string[]) => Promise<number> = async (paths) => {
    await ports.deleteDocuments(paths);
    return paths.length;
  },
  progress: PurgeProgress = { purged: 0, complete: false },
): Promise<PurgeProgress> {
  for (let page = 0; page < MAINTENANCE_MAX_PAGES; page += 1) {
    const paths = await list(cutoff, MAINTENANCE_PAGE_SIZE);
    if (paths.length === 0) return { purged: progress.purged, complete: true };
    progress.purged += await remove(paths);
    if (paths.length < MAINTENANCE_PAGE_SIZE) return { purged: progress.purged, complete: true };
  }
  return { purged: progress.purged, complete: false };
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * An M10 purge (see the file comment): expiresAt re-checked at delete time, and an error is
 * recorded in `errors` instead of failing the run. What was purged before the error still counts.
 */
async function purgeSummaryState(
  purge: SummaryPurge,
  list: (cutoff: string, limit: number) => Promise<string[]>,
  nowIso: string,
  ports: MaintenancePorts,
  errors: Partial<Record<SummaryPurge, string>>,
): Promise<PurgeProgress> {
  const progress: PurgeProgress = { purged: 0, complete: false };
  try {
    return await purgeInPages(list, nowIso, ports, (paths) => ports.deleteIfExpired(paths, nowIso), progress);
  } catch (error) {
    errors[purge] = errorNameOf(error);
    return { purged: progress.purged, complete: false };
  }
}

/**
 * The daily run: expired tombstones, deletion records, then the WhatsApp bot state (§27), then the
 * meeting summaries state (M10, by its own expiresAt).
 */
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
  // M10: both carry their own expiresAt, so they purge against now itself; neither can fail the run.
  const purgeErrors: Partial<Record<SummaryPurge, string>> = {};
  const summaries = await purgeSummaryState(
    'meetingSummaries',
    (cutoff, limit) => ports.listExpiredMeetingSummaries(cutoff, limit),
    nowIso,
    ports,
    purgeErrors,
  );
  const summaryEvents = await purgeSummaryState(
    'summaryEvents',
    (cutoff, limit) => ports.listExpiredSummaryEvents(cutoff, limit),
    nowIso,
    ports,
    purgeErrors,
  );
  return {
    tombstonesPurged: tombstones.purged,
    deletionRecordsPurged: records.purged,
    whatsappEventsPurged: events.purged,
    whatsappCodesPurged: codes.purged,
    whatsappSessionsPurged: sessions.purged,
    meetingSummariesPurged: summaries.purged,
    summaryEventsPurged: summaryEvents.purged,
    complete:
      tombstones.complete &&
      records.complete &&
      events.complete &&
      codes.complete &&
      sessions.complete &&
      summaries.complete &&
      summaryEvents.complete,
    ...(Object.keys(purgeErrors).length > 0 ? { purgeErrors } : {}),
  };
}

export interface DeletionReplayPorts {
  /** User ids of the deletion records with `deletedAt` at or after `sinceIso`. */
  listDeletionsSince(sinceIso: string): Promise<string[]>;
  /** Deletes a document and all of its subcollections (no-op when nothing exists). */
  recursiveDelete(path: string): Promise<void>;
  /** Deletes one document (no-op when missing). */
  deleteDocument(path: string): Promise<void>;
  /** Removes the WhatsApp link, session and user documents of the uid (restored by the backup). */
  deleteWhatsAppData?(uid: string): Promise<void>;
  /**
   * M10: removes summaryUsers/{uid} and every summaryAddresses doc naming the uid (restored by the
   * backup; summaries/accountDeletion.ts deleteSummaryDataForUid). Required, so no caller can skip it.
   */
  deleteSummaryData(uid: string): Promise<void>;
}

/** The server data of one deleted account (the Auth user is already gone: Auth is not restored). */
export async function deleteAccountDocuments(
  uid: string,
  ports: Pick<DeletionReplayPorts, 'recursiveDelete' | 'deleteDocument' | 'deleteWhatsAppData' | 'deleteSummaryData'>,
): Promise<void> {
  // First, as in deleteAccount: a restored private address stops resolving before anything else.
  // (The inbound pipeline also refuses a uid without an Auth user, and Auth is not restored.)
  await ports.deleteSummaryData(uid);
  await ports.recursiveDelete(`users/${uid}`);
  await ports.deleteDocument(`entitlements/${uid}`);
  await ports.recursiveDelete(`usage/${uid}`);
  // Without this the restored whatsappLinks/{phone} still names the dead uid and the next message
  // from that phone runs the assistant for an account that no longer exists.
  if (ports.deleteWhatsAppData) await ports.deleteWhatsAppData(uid);
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
