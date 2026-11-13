/**
 * `dailyMaintenance` (scheduled, 03:30 UTC): server-side retention (./core.ts):
 * - hard-deletes meeting tombstones older than TOMBSTONE_RETENTION_DAYS (collection-group query on
 *   `deletedAt`; the collection-group index is in firestore.indexes.json);
 * - deletes account deletion records older than DELETION_LOG_RETENTION_DAYS;
 * - purges WhatsApp bot state (§27): expired whatsappEvents dedupe markers and whatsappLinkCodes
 *   (their own `expiresAt`), plus whatsappSessions idle beyond WHATSAPP_SESSION_RETENTION_DAYS;
 * - purges meeting summaries state (M10, docs/v2/M10-DESIGN.md section 7) past its own
 *   `expiresAt`: users/{uid}/meetingSummaries (collection-group query; the meetingSummaries
 *   expiresAt fieldOverride is in firestore.indexes.json) and the root summaryEvents markers.
 *   Each is deleted in a transaction that re-reads expiresAt (deleteIfExpired), and a failure of
 *   either is logged as dailyMaintenance.purge_failed {purge, errorName} without failing the run
 *   (./core.ts). DEPLOY ORDER: firestore.indexes.json must be deployed before (or with) the first
 *   dailyMaintenance deploy that carries the M10 purges; until then the meetingSummaries purge
 *   logs purge_failed every day (FAILED_PRECONDITION, a missing collection-group index).
 * Logs counts only (no ids, no content).
 */
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/scheduler';
import type { Firestore } from 'firebase-admin/firestore';

import { FUNCTIONS_REGION } from '../config';
import { adminDb } from '../firebase';
import { MEETING_SUMMARIES_COLLECTION, SUMMARY_EVENTS_COLLECTION } from '../summaries/model';
import {
  WHATSAPP_EVENTS_COLLECTION,
  WHATSAPP_LINK_CODES_COLLECTION,
  WHATSAPP_SESSIONS_COLLECTION,
} from '../whatsapp/session';
import { ACCOUNT_DELETIONS_COLLECTION, runDailyMaintenance, type MaintenancePorts } from './core';

/** Firestore writes per batch (the limit is 500). */
const BATCH_SIZE = 400;

/** M10 conditional deletes run in parallel per chunk (one transaction each). */
const CONDITIONAL_DELETE_CONCURRENCY = 20;

/** `db` is a test seam (the in-memory fake); the scheduled run uses the default Admin SDK app. */
export function firestoreMaintenancePorts(db: Firestore = adminDb()): MaintenancePorts {
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
    // WhatsApp bot state (docs/v1/ARCHITECTURE.md §27): single-field range queries, so the
    // automatic single-field indexes cover them (no firestore.indexes.json entry needed).
    async listExpiredWhatsappEvents(nowIso, limit) {
      const snapshot = await db
        .collection(WHATSAPP_EVENTS_COLLECTION)
        .where('expiresAt', '<', nowIso)
        .orderBy('expiresAt')
        .limit(limit)
        .select()
        .get();
      return snapshot.docs.map((document) => document.ref.path);
    },
    async listExpiredWhatsappCodes(nowIso, limit) {
      const snapshot = await db
        .collection(WHATSAPP_LINK_CODES_COLLECTION)
        .where('expiresAt', '<', nowIso)
        .orderBy('expiresAt')
        .limit(limit)
        .select()
        .get();
      return snapshot.docs.map((document) => document.ref.path);
    },
    async listStaleWhatsappSessions(cutoff, limit) {
      const snapshot = await db
        .collection(WHATSAPP_SESSIONS_COLLECTION)
        .where('updatedAt', '<', cutoff)
        .orderBy('updatedAt')
        .limit(limit)
        .select()
        .get();
      return snapshot.docs.map((document) => document.ref.path);
    },
    // M10 meeting summaries: refs only (empty field mask), so no sealed content is ever read here.
    async listExpiredMeetingSummaries(nowIso, limit) {
      // Summaries and refused rows always store an ISO expiresAt; the collection-group index on it
      // is the meetingSummaries fieldOverride in firestore.indexes.json.
      const snapshot = await db
        .collectionGroup(MEETING_SUMMARIES_COLLECTION)
        .where('expiresAt', '<', nowIso)
        .orderBy('expiresAt')
        .limit(limit)
        .select()
        .get();
      return snapshot.docs.map((document) => document.ref.path);
    },
    async listExpiredSummaryEvents(nowIso, limit) {
      // A root collection: the automatic single-field index covers it.
      const snapshot = await db
        .collection(SUMMARY_EVENTS_COLLECTION)
        .where('expiresAt', '<', nowIso)
        .orderBy('expiresAt')
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
    // M10 (review S6): a listed document may have been filed, kept or re-claimed since the query,
    // so each delete re-reads expiresAt in its own transaction (field mask: no content is read).
    async deleteIfExpired(paths, nowIso) {
      let deleted = 0;
      for (let start = 0; start < paths.length; start += CONDITIONAL_DELETE_CONCURRENCY) {
        const outcomes = await Promise.all(
          paths.slice(start, start + CONDITIONAL_DELETE_CONCURRENCY).map((path) =>
            db.runTransaction(async (tx) => {
              const ref = db.doc(path);
              const [snapshot] = await tx.getAll(ref, { fieldMask: ['expiresAt'] });
              const expiresAt: unknown = snapshot?.exists === true ? snapshot.get('expiresAt') : undefined;
              if (typeof expiresAt !== 'string' || !(expiresAt < nowIso)) return false;
              tx.delete(ref);
              return true;
            }),
          ),
        );
        deleted += outcomes.filter(Boolean).length;
      }
      return deleted;
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
    // Fixed purge codes and error names only (an index error's message names the project).
    for (const [purge, errorName] of Object.entries(result.purgeErrors ?? {})) {
      logger.error('dailyMaintenance.purge_failed', { purge, errorName });
    }
    logger.info('dailyMaintenance.completed', result);
  },
);
