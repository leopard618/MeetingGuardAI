/**
 * `dailyMaintenance` (scheduled, 03:30 UTC): server-side retention (./core.ts):
 * - hard-deletes meeting tombstones older than TOMBSTONE_RETENTION_DAYS (collection-group query on
 *   `deletedAt`; the collection-group index is in firestore.indexes.json);
 * - deletes account deletion records older than DELETION_LOG_RETENTION_DAYS.
 * Logs counts only (no ids, no content).
 */
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/scheduler';

import { FUNCTIONS_REGION } from '../config';
import { adminDb } from '../firebase';
import { ACCOUNT_DELETIONS_COLLECTION, runDailyMaintenance, type MaintenancePorts } from './core';

/** Firestore writes per batch (the limit is 500). */
const BATCH_SIZE = 400;

export function firestoreMaintenancePorts(): MaintenancePorts {
  const db = adminDb();
  return {
    async listExpiredTombstones(cutoff, limit) {
      // Only tombstones have a string deletedAt; active meetings store null and never match "<".
      const snapshot = await db.collectionGroup('meetings').where('deletedAt', '<', cutoff).orderBy('deletedAt').limit(limit).select().get();
      return snapshot.docs.map((document) => document.ref.path);
    },
    async listExpiredDeletionRecords(cutoff, limit) {
      const snapshot = await db
        .collection(ACCOUNT_DELETIONS_COLLECTION)
        .where('deletedAt', '<', cutoff)
        .orderBy('deletedAt')
        .limit(limit)
        .select()
        .get();
      return snapshot.docs.map((document) => document.ref.path);
    },
    async deleteDocuments(paths) {
      for (let start = 0; start < paths.length; start += BATCH_SIZE) {
        const batch = db.batch();
        for (const path of paths.slice(start, start + BATCH_SIZE)) batch.delete(db.doc(path));
        await batch.commit();
      }
    },
  };
}

export const dailyMaintenance = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'Etc/UTC',
    region: FUNCTIONS_REGION,
    timeoutSeconds: 540,
    memory: '256MiB',
    maxInstances: 1,
    retryCount: 1,
  },
  async () => {
    const result = await runDailyMaintenance(firestoreMaintenancePorts(), new Date());
    logger.info('dailyMaintenance.completed', result);
  },
);
