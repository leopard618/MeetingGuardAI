/**
 * The real dependencies of summaryWhatsApp (docs/v2/M11-DESIGN.md section 4.3), loaded LAZILY by
 * ./whatsappFunction.ts on the first request together with the worker handler, so no other function
 * instance of the project carries this path.
 *
 * - The params are read per request (never at load): SUMMARIES_ENABLED and SUMMARIES_PILOT_UIDS.
 * - The commitments deps are summaryCommitments' own (./commitmentsRuntime.ts): the same keyring
 *   memo, quota store, global budget, OpenAI client and admin stats, so the app and WhatsApp share one
 *   allowance and one code path.
 * - Firebase Auth as the summaries service account (getUser), for the account checks.
 * Nothing here logs.
 */
import { SUMMARIES_ENABLED, SUMMARIES_PILOT_UIDS } from '../config';
import { adminAuth, adminDb } from '../firebase';
import { commitmentsDeps } from './commitmentsRuntime';
import { firebaseWorkerAuthUsers, handleSummaryWhatsApp, type SummaryWhatsAppDeps, type WorkerAnswer } from './whatsappCommitments';

/** The deps of one request (see the module comment). */
export function whatsAppWorkerDeps(): SummaryWhatsAppDeps {
  return {
    get db() {
      return adminDb();
    },
    get authUsers() {
      return firebaseWorkerAuthUsers(adminAuth());
    },
    now: () => new Date(),
    config: { enabled: SUMMARIES_ENABLED.value() === true, pilotUids: SUMMARIES_PILOT_UIDS.value() },
    commitments: () => commitmentsDeps(),
  };
}

/** One summaryWhatsApp request with the real deps. */
export function runSummaryWhatsApp(body: unknown): Promise<WorkerAnswer> {
  return handleSummaryWhatsApp(body, whatsAppWorkerDeps());
}
