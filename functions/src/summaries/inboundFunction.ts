/**
 * summaryInbound HTTPS shell (docs/v2/M10-DESIGN.md section 4 Options and steps 1 to 3, section 12
 * Gating). The Postmark inbound webhook; the pipeline is ./inbound.ts handleInboundRequest.
 *
 * - onRequest, FUNCTIONS_REGION, invoker 'public' set explicitly (a server-to-server webhook,
 *   authenticated by Basic auth inside the handler), the SUMMARIES_WEBHOOK_AUTH and
 *   SUMMARIES_DATA_KEY secrets, and SUMMARIES_FUNCTION_TUNING.inbound (1GiB, concurrency 2,
 *   maxInstances 3, 60 s; finding 11).
 * - Exported by ./index.ts only while SUMMARIES_ENABLED is true at deploy time
 *   (summariesEnabledAtLoad), so a default deploy never references the secrets. The handler checks
 *   SUMMARIES_ENABLED.value() again at request time: a stale deployment answers 404.
 * - ./inbound (and with it mailauth and postal-mime) is loaded LAZILY, on the first request, never
 *   at module load: every function instance of the project loads the whole functions entry point,
 *   so a static import would put both parsers and the sealing code into every other function
 *   (finding 13). This file imports only the config params, the pure ./gate reader, the Admin SDK
 *   getters and the firebase-functions shell; the module is required once and cached by Node.
 * - The Admin SDK is touched only when the pipeline reads Firestore or Auth (getters), so a 404,
 *   405 or 401 never initializes it.
 * - Runtime identity (design section 7, finding 13): when SUMMARIES_SERVICE_ACCOUNT is set at
 *   deploy time (./gate.ts summariesServiceAccountAtLoad: a plain key in
 *   functions/.env.<projectId>, deliberately NOT a declared param, read at deploy and load time
 *   only), the function runs as that dedicated account, and
 *   the CLI grants secretAccessor on the two secrets to that account (firebase-tools
 *   deploy/functions/ensure.js grants it to the endpoint's service account; it never revokes a
 *   grant an earlier deploy made to another account, so remove those by hand). When it is empty, the
 *   function deploys exactly as before, under the default compute account that EVERY function of
 *   the project shares: the CLI then grants that shared account access to SUMMARIES_DATA_KEY, so
 *   any function could read the sealing key and the "kept apart" claim does NOT hold.
 *
 * Nothing here logs request content: the load failure line carries the error name only.
 */
import * as logger from 'firebase-functions/logger';
import { onRequest } from 'firebase-functions/https';

import {
  FUNCTIONS_REGION,
  SUMMARIES_ADDRESS_TEMPLATE,
  SUMMARIES_DATA_KEY,
  SUMMARIES_ENABLED,
  SUMMARIES_FUNCTION_TUNING,
  SUMMARIES_PILOT_UIDS,
  SUMMARIES_SENDERS,
  SUMMARIES_WEBHOOK_AUTH,
} from '../config';
import { adminAuth, adminDb } from '../firebase';
import type { Keyring } from '../shared/sealed';
import { summariesServiceAccountAtLoad } from './gate';
import type * as InboundModuleNamespace from './inbound';

type InboundModule = typeof InboundModuleNamespace;

let inboundModule: InboundModule | null = null;
/** The keyring memo lives as long as the instance (parsed on the first seal, see lazyKeyring). */
let keyringOnce: (() => Keyring) | null = null;

/**
 * The pipeline module, required on first use. require (not import()) on purpose: the build is
 * CommonJS, a dynamic import() of an extensionless relative path fails under Node's ESM resolver,
 * and ts-jest runs CommonJS without the VM modules flag. A failed require is not cached by Node,
 * so the next request tries again.
 */
function loadInbound(): InboundModule {
  if (inboundModule === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see above.
    inboundModule = require('./inbound') as InboundModule;
  }
  return inboundModule;
}

/** Request body size: the raw body kept by the framework, or a larger declared Content-Length. */
function bodyBytesOf(rawBody: unknown, contentLength: string | undefined): number {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.length : 0;
  if (typeof contentLength !== 'string' || !/^[ \t]*[0-9]+[ \t]*$/.test(contentLength)) return raw;
  const declared = Number(contentLength.trim());
  return Number.isSafeInteger(declared) ? Math.max(raw, declared) : Number.POSITIVE_INFINITY;
}

function inboundDeps(mod: InboundModule): InboundModuleNamespace.InboundDeps {
  if (keyringOnce === null) keyringOnce = mod.lazyKeyring(() => SUMMARIES_DATA_KEY.value());
  const keyring = keyringOnce;
  return {
    enabled: () => SUMMARIES_ENABLED.value() === true,
    webhookSecret: () => SUMMARIES_WEBHOOK_AUTH.value(),
    pilotUids: () => SUMMARIES_PILOT_UIDS.value(),
    addressTemplate: () => SUMMARIES_ADDRESS_TEMPLATE.value(),
    senders: () => SUMMARIES_SENDERS.value(),
    keyring,
    get db() {
      return adminDb();
    },
    get authUsers() {
      return mod.firebaseAuthUsers(adminAuth());
    },
    candidates: mod.loadCandidates,
    now: () => new Date(),
  };
}

/** The summaryInbound function. No arguments: ./index.ts exports it behind the deploy gate. */
export function makeSummaryInbound() {
  const serviceAccount = summariesServiceAccountAtLoad();
  return onRequest(
    {
      region: FUNCTIONS_REGION,
      // Server-to-server webhook: publicly reachable, authenticated by Basic auth in the handler.
      invoker: 'public',
      secrets: [SUMMARIES_WEBHOOK_AUTH, SUMMARIES_DATA_KEY],
      // The dedicated runtime account when configured (the manifest carries it as
      // serviceAccountEmail). Left out when empty: the function then runs as the shared default
      // compute account, and the data key is NOT kept apart from the other functions (see the
      // file comment). The CLI validates the value (it must contain "@").
      ...(serviceAccount !== null ? { serviceAccount } : {}),
      ...SUMMARIES_FUNCTION_TUNING.inbound,
    },
    async (req, res) => {
      // Stale deployment or a param flipped off: fail soft before loading anything.
      if (SUMMARIES_ENABLED.value() !== true) {
        res.status(404).send('Not configured');
        return;
      }
      let mod: InboundModule;
      try {
        mod = loadInbound();
      } catch (error) {
        logger.error('summaries.inbound', { verdict: 'error', reason: 'load', errorName: error instanceof Error ? error.name : typeof error });
        res.status(500).send('Internal Server Error');
        return;
      }
      const response = await mod.handleInboundRequest(
        {
          method: req.method,
          authorization: req.get('authorization'),
          body: req.body,
          rawBodyBytes: bodyBytesOf(req.rawBody, req.get('content-length')),
        },
        inboundDeps(mod),
      );
      res.status(response.status).send(response.body);
    },
  );
}
