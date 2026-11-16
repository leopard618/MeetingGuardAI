/**
 * Meeting summaries functions (M10). Design: docs/v2/M10-DESIGN.md sections 4 (pipeline and
 * callables), 7 (data and deletion) and 12 (gating). Contract: shared/aiContract.ts (summary*
 * schemas, SUMMARY_ERROR_CODES, SUMMARY_ERROR_HTTPS_CODES).
 *
 * Deployability rules (the whatsapp pattern, functions/src/whatsapp/index.ts - DO NOT break them):
 * - summaryStatus and summaryAction NEVER reference the SUMMARIES_* secrets. They answer from the
 *   non-secret SUMMARIES_ENABLED, SUMMARIES_PILOT_UIDS and SUMMARIES_ADDRESS_TEMPLATE params and
 *   Firestore, so they always deploy (1.6.0 never calls them) and the app can always ask.
 *   summaryAction never decrypts.
 * - summaryInbound (the Postmark webhook) binds SUMMARIES_WEBHOOK_AUTH and SUMMARIES_DATA_KEY, so
 *   it is exported ONLY while SUMMARIES_ENABLED is true at deploy time (summariesEnabledAtLoad
 *   reads the param's env value during CLI discovery). While the param is false (the default) a
 *   full `firebase deploy --only functions` never validates the secrets and cannot fail on them.
 * - summaryRead (the lists and the full view) binds SUMMARIES_DATA_KEY only, never the webhook
 *   secret, and follows the same gate. Both gated functions run as SUMMARIES_SERVICE_ACCOUNT when
 *   it is set at deploy time (gate.ts summariesServiceAccountAtLoad).
 *
 * Module loading: this file and everything it imports at load time must not load mailauth,
 * postal-mime, ./authenticity, ./mime, ./inbound or ./read (functions/test/unit/summariesIndex.test.ts
 * checks it). ./inboundFunction builds the HTTPS shell and loads the pipeline on its first request;
 * ./readFunction builds the summaryRead shell and loads ./read on its first call.
 */
import { onCall, type CallableOptions } from 'firebase-functions/https';

import {
  FUNCTIONS_REGION,
  SUMMARIES_ADDRESS_TEMPLATE,
  SUMMARIES_ENABLED,
  SUMMARIES_FUNCTION_TUNING,
  SUMMARIES_PILOT_UIDS,
} from '../config';
import { adminDb } from '../firebase';
import type { SummaryActionResponse, SummaryStatusResponse } from '../shared/aiContract';
import { handleSummaryAction, handleSummaryStatus, type SummaryCallableDeps } from './callables';
import { summariesEnabledAtLoad } from './gate';
import { makeSummaryInbound } from './inboundFunction';
import { makeSummaryRead } from './readFunction';
// M11 (docs/v2/M11-DESIGN.md section 2.1): the summaryCommitments shell; it loads nothing heavy at load.
import { makeSummaryCommitments } from './commitmentsFunction';
// M11 (docs/v2/M11-DESIGN.md section 4.3): the summaryWhatsApp worker shell; it loads nothing heavy at load.
import { makeSummaryWhatsApp } from './whatsappFunction';

export { summaryError } from './callables';
export { summariesEnabledAtLoad } from './gate';

// ---------------------------------------------------------------------------------------------
// Callables (no secrets, always deployed)
// ---------------------------------------------------------------------------------------------

const CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: false,
  timeoutSeconds: SUMMARIES_FUNCTION_TUNING.callables.timeoutSeconds,
  memory: SUMMARIES_FUNCTION_TUNING.callables.memory,
  maxInstances: SUMMARIES_FUNCTION_TUNING.callables.maxInstances,
};

/** The params are read per call (never at load); none of them is a secret. */
function callableDeps(): SummaryCallableDeps {
  return {
    db: adminDb(),
    now: () => new Date(),
    config: {
      enabled: SUMMARIES_ENABLED.value() === true,
      pilotUids: SUMMARIES_PILOT_UIDS.value(),
      template: SUMMARIES_ADDRESS_TEMPLATE.value(),
    },
  };
}

/**
 * summaryStatus {} -> {enabled, allowed, ready, address, mailboxes, gmailRequests, inboxCount,
 * lastReceivedAt, lastRefused}. Signed in only; enabled / allowed false instead of an error.
 */
export const summaryStatus = onCall(CALLABLE_OPTIONS, (request): Promise<SummaryStatusResponse> =>
  handleSummaryStatus(request.auth, request.data, callableDeps()),
);

/**
 * summaryAction {op, ...} -> {changed, status, summary}: create_address, regenerate_address,
 * set_mailboxes, dismiss_gmail, attach, detach, keep, delete, disconnect. Verified caller,
 * SUMMARIES_ENABLED and the pilot list.
 */
export const summaryAction = onCall(CALLABLE_OPTIONS, (request): Promise<SummaryActionResponse> =>
  handleSummaryAction(request.auth, request.data, callableDeps()),
);

// ---------------------------------------------------------------------------------------------
// Webhook (binds the secrets; exported only while SUMMARIES_ENABLED at deploy time)
// ---------------------------------------------------------------------------------------------

/**
 * Exported only while SUMMARIES_ENABLED is true at deploy time, so the default deploy never
 * references the secrets (undefined exports are skipped by the functions loader). Flipping the
 * param to false again makes the next deploy offer to delete the function: answer No (AGENTS.md
 * rule 3, the project is shared); removing a deployed function is a separate owner decision.
 */
export const summaryInbound = summariesEnabledAtLoad() ? makeSummaryInbound() : undefined;

// ---------------------------------------------------------------------------------------------
// Reader (binds the data key only; exported only while SUMMARIES_ENABLED at deploy time)
// ---------------------------------------------------------------------------------------------

/**
 * summaryRead {op: 'list', view, meetingId?} | {op: 'get', summaryId} -> the lists (titles only,
 * after the inbox re-match) or the full view. Same gate as summaryInbound: while it is undefined
 * the app gets functions/not-found without details and shows the feature as not enabled.
 */
export const summaryRead = summariesEnabledAtLoad() ? makeSummaryRead() : undefined;

// ---------------------------------------------------------------------------------------------
// M11: suggested tasks (binds the data key and the OpenAI key; exported only while
// SUMMARIES_ENABLED at deploy time AND SUMMARIES_SERVICE_ACCOUNT is set, docs/v2/M11-DESIGN.md
// section 2.1, finding 2). Without the service account line it is not exported at all: a deploy
// that names it reports nothing to deploy for it, which is the signal, not a fault.
// ---------------------------------------------------------------------------------------------

/**
 * summaryCommitments {op: 'get' | 'prepare' | 'decide', ...} -> the suggested tasks of a filed or
 * kept summary. Loads its handler on the first call (./commitmentsFunction.ts).
 */
export const summaryCommitments = makeSummaryCommitments();

// ---------------------------------------------------------------------------------------------
// M11: suggested tasks on WhatsApp, the private worker (binds the data key and the OpenAI key;
// docs/v2/M11-DESIGN.md section 4.3, finding 2). Exported only while SUMMARIES_ENABLED and
// WHATSAPP_ENABLED are true at deploy time, the summaries service account and
// SUMMARIES_WHATSAPP_INVOKER are set, and the two differ.
// ---------------------------------------------------------------------------------------------

/**
 * summaryWhatsApp {op: 'offer' | 'reply', ...} -> the text the webhook sends and the offer ids it
 * stores. Invoked only by the webhook's runtime account; loads its handler on the first request
 * (./whatsappFunction.ts).
 */
export const summaryWhatsApp = makeSummaryWhatsApp();
