/**
 * Fathom sync (docs/v2/FATHOM-CONNECT.md section 9): the backup to the webhook. With the user's
 * own token it lists their recent recordings (GET /meetings, created in the last
 * FATHOM_SYNC_LOOKBACK_MS) and stores every one that is not stored yet, through the same steps as
 * a webhook delivery (webhook.ts ingestFathomMeeting). It catches a delivery Fathom never sent or
 * we missed, and the meetings recorded before the user connected.
 *
 * - At most one sync per user per FATHOM_SYNC_MIN_INTERVAL_MS (lastSyncAt on the connection,
 *   claimed in a transaction), so screens may ask on every visit.
 * - A recording already handled (stored, upgraded into an email copy, or deleted by the user) is
 *   skipped before its summary is fetched (store.ts summaryKnown); commitSummary decides the same
 *   again on its own, so a webhook and a sync of one recording are one copy.
 * - OAuth apps cannot ask /meetings for summaries: each new recording's summary is read from
 *   GET /recordings/{id}/summary, at most FATHOM_SYNC_MAX_FETCHES per sync and within
 *   FATHOM_SYNC_BUDGET_MS (Fathom allows 30 such calls a minute). One with no summary yet is
 *   pending and read on a later sync.
 * - A Fathom failure ends the sync with its failure code (never thrown); Firestore errors propagate.
 *
 * Logs: one `summaries.fathom_sync` line: uid, outcome, checked, imported, pending, failure, ms.
 * Never a title, the text, a token or a recording id.
 */
import * as logger from 'firebase-functions/logger';

import { messageMarkerKey, summaryIdFor } from '../model';
import { summaryKnown } from '../store';
import { FathomApiError, getRecordingSummary, listMeetings, type FathomClientConfig } from './api';
import { fathomMeetingSchema, recordingIdOf } from './payload';
import { accessTokenFor, connectionRef, parseConnection } from './store';
import { fathomMessageKey, ingestFathomMeeting, type FathomIngestDeps } from './webhook';

/** One sync per user at most this often. */
export const FATHOM_SYNC_MIN_INTERVAL_MS = 60 * 1000;
/** Recordings created this far back are looked at (the deletion markers live 35 days). */
export const FATHOM_SYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** GET /meetings pages per sync (10 recordings each). */
export const FATHOM_SYNC_MAX_PAGES = 3;
/** GET /recordings/{id}/summary calls per sync. */
export const FATHOM_SYNC_MAX_FETCHES = 5;
/** No new summary fetch starts after this long (the callable has 30 seconds). */
export const FATHOM_SYNC_BUDGET_MS = 15 * 1000;

export interface FathomSyncDeps extends FathomIngestDeps {
  now(): Date;
  client(): FathomClientConfig;
  /** Test seam for accessTokenFor's lease wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface FathomSyncResult {
  /** False when skipped: not connected, or synced within FATHOM_SYNC_MIN_INTERVAL_MS. */
  ran: boolean;
  /** Recordings in the listed pages. */
  checked: number;
  /** New summaries stored (created or upgraded). */
  imported: number;
  /** Recordings with no summary yet, or left for the next sync (fetch cap or time budget). */
  pending: number;
  /** FathomApiError failure code, or null. */
  failure: string | null;
  /** For a shape failure: the call and field names that did not match (never a value). */
  failureDetail?: string | null;
}

type Claim = 'missing' | 'recent' | 'claimed';

/** Claims this user's sync slot: lastSyncAt moves to now unless a sync ran within the interval. */
async function claimSyncSlot(deps: FathomSyncDeps, uid: string, now: Date): Promise<Claim> {
  const ref = connectionRef(deps.db, uid);
  return deps.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const connection = snapshot.exists ? parseConnection(snapshot.data()) : null;
    if (connection === null) return 'missing';
    const last = (connection as { lastSyncAt?: unknown }).lastSyncAt;
    const lastMs = typeof last === 'string' ? Date.parse(last) : Number.NaN;
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < FATHOM_SYNC_MIN_INTERVAL_MS && lastMs <= now.getTime()) return 'recent';
    tx.update(ref, { lastSyncAt: now.toISOString() });
    return 'claimed';
  });
}

/** Stores the user's recent Fathom recordings that are not stored yet. See the file comment. */
export async function syncFathom(uid: string, deps: FathomSyncDeps): Promise<FathomSyncResult> {
  const startedMs = Date.now();
  const now = deps.now();
  const result: FathomSyncResult = { ran: false, checked: 0, imported: 0, pending: 0, failure: null };
  const log = (outcome: string) =>
    logger.info('summaries.fathom_sync', {
      uid,
      outcome,
      checked: result.checked,
      imported: result.imported,
      pending: result.pending,
      failure: result.failure,
      failureDetail: result.failureDetail ?? null,
      ms: Date.now() - startedMs,
    });

  const claim = await claimSyncSlot(deps, uid, now);
  if (claim !== 'claimed') {
    log(claim === 'missing' ? 'not_connected' : 'recent');
    return result;
  }
  result.ran = true;

  const client = deps.client();
  let stopped: string | null = null;
  try {
    const token = await accessTokenFor(uid, {
      db: deps.db,
      keyring: deps.keyring(),
      client,
      now: deps.now,
      ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    });
    const createdAfter = new Date(now.getTime() - FATHOM_SYNC_LOOKBACK_MS);
    let cursor: string | null = null;
    let fetches = 0;
    for (let page = 0; page < FATHOM_SYNC_MAX_PAGES && stopped === null; page += 1) {
      const listed = await listMeetings(client, token, { createdAfter, cursor });
      for (const item of listed.items) {
        const parsed = fathomMeetingSchema.safeParse(item);
        if (!parsed.success) continue;
        result.checked += 1;
        const recordingId = recordingIdOf(parsed.data);
        const messageKey = fathomMessageKey(recordingId);
        if (await summaryKnown(deps.db, uid, summaryIdFor(uid, messageKey), messageMarkerKey(uid, messageKey), now)) continue;
        if (fetches >= FATHOM_SYNC_MAX_FETCHES || Date.now() - startedMs > FATHOM_SYNC_BUDGET_MS) {
          result.pending += 1;
          continue;
        }
        fetches += 1;
        const summary = await getRecordingSummary(client, token, recordingId);
        if (summary === null) {
          // Still processing, or Fathom wrote none (nobody spoke): looked at again next time.
          result.pending += 1;
          continue;
        }
        const raw = { ...(item as Record<string, unknown>), default_summary: summary };
        const ingested = await ingestFathomMeeting(uid, raw, deps, {
          attemptAt: now,
          receivedAt: now,
          providerEventId: `fathom:sync:${recordingId}`,
          stage: () => undefined,
        });
        if (ingested.verdict === 'stored' && (ingested.outcome === 'created' || ingested.outcome === 'upgraded')) result.imported += 1;
        // The caller may not store summaries now (left the pilot, no address, account gone): stop.
        if (ingested.verdict === 'dropped' && ingested.reason !== 'address_changed') stopped = ingested.reason;
        if (stopped !== null) break;
      }
      cursor = listed.nextCursor;
      if (cursor === null) break;
    }
  } catch (error) {
    if (!(error instanceof FathomApiError)) throw error;
    result.failure = error.failure;
    result.failureDetail = error.detail;
    log('fathom_failed');
    return result;
  }
  log(stopped !== null ? `stopped_${stopped}` : 'synced');
  return result;
}
