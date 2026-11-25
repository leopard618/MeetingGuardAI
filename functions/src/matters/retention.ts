/**
 * A4: retention and deletion (docs/v2/A4-THREAT-MODEL.md, "data kept too long").
 *
 * - Retention: the patch that closes a matter (done or cancelled; it carries endedAt) writes
 *   matterRetention/{matterId} (store.ts). matterTick deletes the email texts of matters closed
 *   more than MATTERS_RETENTION_DAYS ago (purgeDue -> store.purgeMatter): the emails and the
 *   proposed commitments, the text on the cards, the first email and the lookups that point at
 *   the matter. The matter, its cards and its timeline stay (no email text in them), so the owner
 *   still sees what happened.
 * - matterDelete: the owner removes a matter at any time, with everything that points at it; a
 *   running one is cancelled first in its own transaction, so nothing more is sent. Like
 *   matterCancel it does not depend on the switch or the tester list: the owner can always remove
 *   their own data. The meeting it booked and the tasks the owner accepted are their own and stay.
 * - deleteAccount removes all of it (users/{uid} recursively, usage/{uid}, and the server-only
 *   collections that carry the uid).
 */
import * as logger from 'firebase-functions/logger';

import { matterDeleteRequestSchema, type MatterDeleteResponse } from '../shared/aiContract';
import { event, matterError, readable, requireSignedIn, type MatterCaller, type MatterDeps } from './handlers';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The default MATTERS_RETENTION_DAYS. */
export const DEFAULT_RETENTION_DAYS = 90;

export function handleMatterDelete(callerIn: MatterCaller | null, data: unknown, deps: MatterDeps): Promise<MatterDeleteResponse> {
  return readable(async () => {
    const caller = requireSignedIn(callerIn);
    const parsed = matterDeleteRequestSchema.safeParse(data);
    if (!parsed.success) throw matterError('invalid_request');
    const { matterId } = parsed.data;
    const nowIso = deps.now().toISOString();
    // a running matter stops first, in a transaction: a send that races the deletion finds it cancelled
    const found = await deps.store.updateMatter(caller.uid, matterId, (doc) => {
      if (!doc) return { result: false };
      if (doc.status !== 'active' && doc.status !== 'paused') return { result: true };
      return {
        result: true,
        patch: { status: 'cancelled', endedAt: nowIso, updatedAt: nowIso, stopReason: 'user', followUpClaim: null },
        events: [event('status_changed', nowIso, 'cancelled')],
        schedule: { nextActionAt: null },
      };
    });
    if (!found) throw matterError('not_found');
    await deps.store.deleteMatter(caller.uid, matterId);
    logger.info('matters.deleted', { uid: caller.uid, matterId });
    return { matterId, deleted: true };
  });
}

/** matterTick: deletes the email texts of matters closed more than MATTERS_RETENTION_DAYS ago. */
export async function purgeDue(deps: MatterDeps, limit: number): Promise<number> {
  const now = deps.now();
  const days = Math.max(1, deps.retentionDays ?? DEFAULT_RETENTION_DAYS);
  const before = new Date(now.getTime() - days * DAY_MS).toISOString();
  let purged = 0;
  for (const entry of await deps.store.dueRetention(before, limit)) {
    try {
      const outcome = await deps.store.purgeMatter(entry.uid, entry.matterId, now.toISOString());
      if (outcome === 'purged') purged += 1;
      logger.info('matters.retention', { uid: entry.uid, matterId: entry.matterId, outcome });
    } catch (error) {
      logger.error('matters.retention_failed', { uid: entry.uid, matterId: entry.matterId, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return purged;
}
