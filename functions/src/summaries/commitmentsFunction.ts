/**
 * summaryCommitments callable shell (docs/v2/M11-DESIGN.md section 2.1; section 15 finding 2;
 * section 13 hazard 40). The handler is ./commitmentsHandler.ts handleSummaryCommitments, with the
 * real deps of ./commitmentsRuntime.ts.
 *
 * - onCall, FUNCTIONS_REGION, enforceAppCheck false, secrets SUMMARIES_DATA_KEY and OPENAI_API_KEY
 *   (exactly these two: it opens the summary and calls OpenAI; it never needs the webhook secret),
 *   COMMITMENTS_FUNCTION_TUNING (512MiB, 1 vCPU, concurrency 20, 90 s, at most 10 instances).
 * - Exported by ./index.ts only while SUMMARIES_ENABLED is true at deploy time
 *   (summariesEnabledAtLoad) AND the SUMMARIES_SERVICE_ACCOUNT line names a dedicated account
 *   (dedicatedSummariesServiceAccountAtLoad): without that line a function deploys as the default
 *   compute account, the CLI would grant the data key to it, and every function without its own
 *   account (the WhatsApp webhook included) runs as that account. So a line that names a default
 *   account, or the webhook's invoker account, counts as no line. M10's two functions accept the
 *   fallback; this one does not exist without its dedicated account. The handler checks
 *   SUMMARIES_ENABLED.value() again per call.
 * - ./commitmentsRuntime (the handler, the OpenAI client, the quota, the open path) is loaded
 *   LAZILY, on the first call, never at module load: every function instance of the project loads
 *   the whole functions entry point. This file imports only the config params, the pure ./gate
 *   reader, summaryError and the firebase-functions shell.
 *
 * Nothing here logs request content: the load failure line carries the error name only.
 */
import * as logger from 'firebase-functions/logger';
import { onCall } from 'firebase-functions/https';

import { COMMITMENTS_FUNCTION_TUNING, FUNCTIONS_REGION, OPENAI_API_KEY, SUMMARIES_DATA_KEY } from '../config';
import type { SummaryCommitmentsResponse } from '../shared/aiContract';
import { summaryError } from './callables';
import { dedicatedSummariesServiceAccountAtLoad, summariesEnabledAtLoad } from './gate';
import type * as RuntimeModuleNamespace from './commitmentsRuntime';

type RuntimeModule = typeof RuntimeModuleNamespace;

let runtimeModule: RuntimeModule | null = null;

/**
 * The runtime module, required on first use. require (not import()) on purpose, as in
 * ./readFunction.ts: the build is CommonJS and ts-jest runs CommonJS. A failed require is not
 * cached by Node, so the next call tries again.
 */
function loadRuntime(): RuntimeModule {
  if (runtimeModule === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see above.
    runtimeModule = require('./commitmentsRuntime') as RuntimeModule;
  }
  return runtimeModule;
}

/** Whether summaryCommitments is exported by this deploy (see the file comment). */
export function summaryCommitmentsExportable(): boolean {
  return summariesEnabledAtLoad() && dedicatedSummariesServiceAccountAtLoad() !== null;
}

/** The summaryCommitments function, or undefined while it may not be exported. */
export function makeSummaryCommitments() {
  const serviceAccount = dedicatedSummariesServiceAccountAtLoad();
  if (!summariesEnabledAtLoad() || serviceAccount === null) return undefined;
  return onCall(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: false,
      secrets: [SUMMARIES_DATA_KEY, OPENAI_API_KEY],
      serviceAccount,
      ...COMMITMENTS_FUNCTION_TUNING,
    },
    async (request): Promise<SummaryCommitmentsResponse> => {
      let mod: RuntimeModule;
      try {
        mod = loadRuntime();
      } catch (error) {
        logger.error('summaries.commitments.failed', { reason: 'load', errorName: error instanceof Error ? error.name : typeof error });
        throw summaryError('upstream_error', 'Suggested tasks are not available right now. Try again later.');
      }
      return mod.runSummaryCommitments(request.auth, request.data);
    },
  );
}
