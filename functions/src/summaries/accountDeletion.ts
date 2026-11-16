/**
 * M10 account deletion (docs/v2/M10-DESIGN.md section 7, Deletion): the ROOT summary documents of
 * one uid, for deleteAccount (functions/src/deleteAccount.ts) and for the deletion replay after a
 * Firestore restore (functions/src/maintenance/core.ts, functions/scripts/replay-account-deletions.mjs).
 *
 * - summaryUsers/{uid} and the summaryAddresses/{tokenHash} it points at go first, in ONE
 *   transaction (address.ts deleteAddressDocs with mode 'account_deletion': no tombstone
 *   survives), so mail to the private address stops resolving at once. commitSummary,
 *   recordRefusal and storeGmailRequest (store.ts) re-read both inside their own transactions, so
 *   a delivery that resolved just before drops (address_changed) instead of writing.
 * - Then every summaryAddresses document that still names the uid is deleted as well: one the
 *   user document no longer points at (an import of summaryAddresses without summaryUsers, a
 *   leftover). Such a document already routes nobody (resolveToken cross-checks summaryUsers) but
 *   it still holds the uid. Normally there is none; more than STRAY_INDEX_MAX_PAGES pages of them
 *   fails the deletion (it is retried) rather than leaving any behind.
 * - users/{uid}/meetingSummaries (summaries and refused rows) is NOT handled here: both
 *   recursiveDelete passes over users/{uid} in deleteAccount remove it.
 * - summaryEvents (dedupe, deletion and digest markers, first-seen records) carry no uid and no
 *   content and expire on their own (35 and 2 days); dailyMaintenance purges them.
 *
 * Idempotent: a repeat call (the app retrying a partly failed deletion) finds nothing and writes
 * nothing. A Firestore error propagates, so the account deletion fails like any other port.
 * Logs carry the uid and counts only (address.ts adds tok8 for the address it deleted).
 */
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import { SUMMARY_ADDRESSES_COLLECTION, deleteAddressDocs, type AddressLogger } from './address';

/** summaryAddresses documents read and deleted per page (Firestore allows 500 writes per batch). */
export const STRAY_INDEX_PAGE_SIZE = 100;
/** Pages per call; past this the call throws (nothing is ever silently left behind). */
export const STRAY_INDEX_MAX_PAGES = 10;

export interface SummaryDeletionLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

const defaultLogger: SummaryDeletionLogger = {
  info: (event, fields) => logger.info(event, fields),
  warn: (event, fields) => logger.warn(event, fields),
};

export interface SummaryAccountDeletionDeps {
  db: Firestore;
  /** Test seam; new Date() by default. */
  now?: () => Date;
  /** Test seam; firebase-functions/logger by default (also passed to address.ts). */
  logger?: SummaryDeletionLogger;
}

export interface SummaryAccountDeletionResult {
  /** summaryUsers/{uid} held an address (a disconnect tombstone is not one). */
  addressDeleted: boolean;
  /** Further summaryAddresses documents that named the uid. */
  strayIndexDocsDeleted: number;
}

/**
 * Deletes summaryUsers/{uid} (tombstone included), the summaryAddresses document it points at,
 * and any other summaryAddresses document that names the uid. See the module comment.
 */
export async function deleteSummaryDataForUid(uid: string, deps: SummaryAccountDeletionDeps): Promise<SummaryAccountDeletionResult> {
  const log = deps.logger ?? defaultLogger;
  const addressLogger: AddressLogger = { info: (event, fields) => log.info(event, fields) };
  const addressDeps: Parameters<typeof deleteAddressDocs>[1] = { db: deps.db, logger: addressLogger };
  if (deps.now !== undefined) addressDeps.now = deps.now;
  // Throws on a malformed uid before anything is read, so the query below never sees one.
  const removed = await deleteAddressDocs(uid, addressDeps, { mode: 'account_deletion' });

  const db = deps.db;
  let stray = 0;
  for (let page = 0; page < STRAY_INDEX_MAX_PAGES; page += 1) {
    const snapshot = await db
      .collection(SUMMARY_ADDRESSES_COLLECTION)
      .where('uid', '==', uid)
      .select()
      .limit(STRAY_INDEX_PAGE_SIZE)
      .get();
    if (snapshot.empty) return finish(uid, removed.deleted, stray, log);
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    stray += snapshot.size;
    if (snapshot.size < STRAY_INDEX_PAGE_SIZE) return finish(uid, removed.deleted, stray, log);
  }
  log.warn('summaries.account_deletion.incomplete', { uid, strayIndexDocsDeleted: stray });
  throw new Error('summaries.account_deletion: summaryAddresses documents remain for the uid');
}

function finish(uid: string, addressDeleted: boolean, stray: number, log: SummaryDeletionLogger): SummaryAccountDeletionResult {
  // A stray index document is unexpected (regenerate and disconnect delete the old one): worth a warning.
  if (stray > 0) log.warn('summaries.account_deletion.stray_index_docs', { uid, count: stray });
  return { addressDeleted, strayIndexDocsDeleted: stray };
}
