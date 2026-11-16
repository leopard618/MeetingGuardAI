/**
 * summaryWhatsApp HTTPS shell (docs/v2/M11-DESIGN.md section 4.3; section 15 findings 2 and 12;
 * section 13 hazards 16 and 40). The worker is ./whatsappCommitments.ts handleSummaryWhatsApp, with
 * the real deps of ./whatsappRuntime.ts.
 *
 * - onRequest, POST JSON, FUNCTIONS_REGION, secrets SUMMARIES_DATA_KEY and OPENAI_API_KEY (exactly
 *   these two), SUMMARY_WHATSAPP_FUNCTION_TUNING (90 s). It holds no WhatsApp secret and sends
 *   nothing: the webhook sends what it answers.
 * - invoker: ONLY the webhook's runtime service account (SUMMARIES_WHATSAPP_INVOKER, a plain key read
 *   at load, ./gate.ts). Cloud Run checks the caller's ID token before this code runs, so the handler
 *   never sees an unauthenticated request.
 * - serviceAccount: SUMMARIES_SERVICE_ACCOUNT, the summaries account, the only one allowed to read
 *   the data key (M10 section 7).
 * - Exported only while SUMMARIES_ENABLED and WHATSAPP_ENABLED are true at load AND the summaries
 *   service account is set AND the invoker is set AND the two differ: a worker running as the
 *   webhook's own account would put the data key in the webhook's hands, the one thing this function
 *   exists to prevent (finding 2). The summaries account must also not be a default account, and the
 *   invoker must be one service account, never "public" (allUsers) or "private" (./gate.ts). Without
 *   those lines it is simply not exported; a deploy that names it reports nothing to deploy for it,
 *   which is the signal, not a fault.
 * - ./whatsappRuntime (the handler, the reader, the OpenAI client) is loaded LAZILY on the first
 *   request: every function instance of the project loads the whole functions entry point. This file
 *   imports only the config params, the pure ./gate readers and the firebase-functions shell.
 *
 * What it changes, stated honestly (finding 12): today the invoker is the default compute account,
 * which every function without its own account runs as, and the worker cannot check that the number
 * really wrote. The bounds are in the worker: 20 lists per summary per day, one log line per call,
 * no AI started on its own, never the whole text.
 *
 * Nothing here logs request content: the load failure line carries the error name only.
 */
import * as logger from 'firebase-functions/logger';
import { onRequest } from 'firebase-functions/https';

import { FUNCTIONS_REGION, OPENAI_API_KEY, SUMMARIES_DATA_KEY, SUMMARIES_ENABLED, SUMMARY_WHATSAPP_FUNCTION_TUNING } from '../config';
import { dedicatedSummariesServiceAccountAtLoad, sameServiceAccount, summariesEnabledAtLoad, summariesWhatsAppInvokerAtLoad } from './gate';
import type * as RuntimeModuleNamespace from './whatsappRuntime';

type RuntimeModule = typeof RuntimeModuleNamespace;

let runtimeModule: RuntimeModule | null = null;

/** The runtime module, required on first use (as ./commitmentsFunction.ts; a failed require is retried). */
function loadRuntime(): RuntimeModule {
  if (runtimeModule === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see above.
    runtimeModule = require('./whatsappRuntime') as RuntimeModule;
  }
  return runtimeModule;
}

/** WHATSAPP_ENABLED while the module is loaded (whatsapp/index.ts whatsappEnabledAtLoad, read here without loading the bot). */
function whatsappEnabledAtLoad(): boolean {
  const raw = process.env.WHATSAPP_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

/** The runtime and invoker accounts when summaryWhatsApp may be exported by this deploy, else null. */
export function summaryWhatsAppAccounts(): { serviceAccount: string; invoker: string } | null {
  if (!summariesEnabledAtLoad() || !whatsappEnabledAtLoad()) return null;
  // Both validated in ./gate.ts: a dedicated summaries account (never a default account or the
  // invoker) and an invoker that is one service account (never "public", which means allUsers).
  const serviceAccount = dedicatedSummariesServiceAccountAtLoad();
  const invoker = summariesWhatsAppInvokerAtLoad();
  if (serviceAccount === null || invoker === null || sameServiceAccount(serviceAccount, invoker)) return null;
  return { serviceAccount, invoker };
}

/** The summaryWhatsApp function, or undefined while it may not be exported (see the file comment). */
export function makeSummaryWhatsApp() {
  const accounts = summaryWhatsAppAccounts();
  if (accounts === null) return undefined;
  return onRequest(
    {
      region: FUNCTIONS_REGION,
      invoker: [accounts.invoker],
      serviceAccount: accounts.serviceAccount,
      secrets: [SUMMARIES_DATA_KEY, OPENAI_API_KEY],
      ...SUMMARY_WHATSAPP_FUNCTION_TUNING,
    },
    async (req, res) => {
      // Stale deployment or a param flipped off: fail soft before loading anything.
      if (SUMMARIES_ENABLED.value() !== true) {
        res.status(404).send('Not configured');
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }
      let mod: RuntimeModule;
      try {
        mod = loadRuntime();
      } catch (error) {
        logger.error('summaries.whatsapp.failed', { reason: 'load', errorName: error instanceof Error ? error.name : typeof error });
        res.status(500).send('Internal Server Error');
        return;
      }
      const answer = await mod.runSummaryWhatsApp(req.body);
      if (typeof answer.body === 'string') res.status(answer.status).send(answer.body);
      else res.status(answer.status).json(answer.body);
    },
  );
}
