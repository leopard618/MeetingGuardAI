// Re-applies account deletions after a Firestore restore or import (docs/DEPLOYMENT.md §7).
//
// A restore from a backup or a point in time brings back users/{uid}, entitlements/{uid} and
// usage/{uid} of every account deleted after that time. deleteAccount records each deletion in
// accountDeletions/{uid} (kept 30 days, never restored over because newer records are not in the
// backup); this script deletes those accounts' documents again. The Auth users stay deleted
// (Firebase Auth is not part of a Firestore restore). It also deletes the restored WhatsApp link
// state and the meeting summaries address (M10: summaryUsers/{uid} and every summaryAddresses doc
// naming the uid; users/{uid}/meetingSummaries goes with users/{uid}).
//
// Usage (from functions/, after `npm run build`, with Application Default Credentials of an
// account that may write the project's Firestore: `gcloud auth application-default login`):
//   node scripts/replay-account-deletions.mjs --project <project-id> --since <backup time, ISO 8601> [--dry-run]
// Run it right after the import into (default), before users open the app again.
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { ACCOUNT_DELETIONS_COLLECTION, replayAccountDeletions } = require('../lib/maintenance/core.js');
const { deleteWhatsAppDataForUid, firestoreLinkStore } = require('../lib/whatsapp/link.js');
const { deleteSummaryDataForUid } = require('../lib/summaries/accountDeletion.js');

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    since: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!values.project || !values.since) {
  console.error('Usage: node scripts/replay-account-deletions.mjs --project <project-id> --since <ISO time> [--dry-run]');
  process.exit(2);
}

initializeApp({ projectId: values.project });
const db = getFirestore();

const uids = await replayAccountDeletions(
  values.since,
  {
    async listDeletionsSince(since) {
      const snapshot = await db.collection(ACCOUNT_DELETIONS_COLLECTION).where('deletedAt', '>=', since).select().get();
      return snapshot.docs.map((document) => document.id);
    },
    async recursiveDelete(path) {
      await db.recursiveDelete(db.doc(path));
    },
    async deleteWhatsAppData(uid) {
      await deleteWhatsAppDataForUid(uid, firestoreLinkStore(db));
    },
    async deleteSummaryData(uid) {
      await deleteSummaryDataForUid(uid, { db });
    },
    async deleteDocument(path) {
      await db.doc(path).delete();
    },
  },
  { dryRun: values['dry-run'] },
);

console.log(`${values['dry-run'] ? 'Would delete' : 'Deleted'} the data of ${uids.length} account(s) deleted since ${values.since}.`);
