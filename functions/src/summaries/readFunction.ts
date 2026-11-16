/**
 * summaryRead callable shell (docs/v2/M10-DESIGN.md section 4 Callables, section 7 Encryption,
 * section 12 Gating). The handler is ./read.ts handleSummaryRead.
 *
 * - onCall, FUNCTIONS_REGION, the SUMMARIES_DATA_KEY secret ONLY (it opens sealed content; it never
 *   needs SUMMARIES_WEBHOOK_AUTH), and SUMMARIES_FUNCTION_TUNING.read (512MiB, 30 s: decrypting a
 *   page of titles plus the inbox re-match).
 * - Exported by ./index.ts only while SUMMARIES_ENABLED is true at deploy time
 *   (summariesEnabledAtLoad), so a default deploy never references the data key. The handler
 *   checks SUMMARIES_ENABLED.value() again at call time (not_enabled).
 * - Runtime identity (design section 7, finding 13), exactly as summaryInbound
 *   (./inboundFunction.ts): when SUMMARIES_SERVICE_ACCOUNT is set at deploy time (./gate.ts
 *   summariesServiceAccountAtLoad, a plain dotenv key, never a declared param) the function runs
 *   as that dedicated account and the CLI grants it secretAccessor on the data key; when it is
 *   empty the function runs as the shared default compute account, and the "kept apart" claim
 *   does NOT hold.
 * - ./read (the open path, candidates and matching) is loaded LAZILY, on the first call, never at
 *   module load: every function instance of the project loads the whole functions entry point. This
 *   file imports only the config params, the pure ./gate reader, summaryError, the Admin SDK getter
 *   and the firebase-functions shell. The Admin SDK is touched only when the handler reads
 *   Firestore (a getter), so a refused caller never initializes it.
 *
 * Nothing here logs request content: the load failure line carries the error name only.
 */
import * as logger from 'firebase-functions/logger';
import { onCall } from 'firebase-functions/https';

import { FUNCTIONS_REGION, SUMMARIES_DATA_KEY, SUMMARIES_ENABLED, SUMMARIES_FUNCTION_TUNING, SUMMARIES_PILOT_UIDS } from '../config';
import { adminDb } from '../firebase';
import type { SummaryReadResponse } from '../shared/aiContract';
import type { Keyring } from '../shared/sealed';
import { summaryError } from './callables';
import { summariesServiceAccountAtLoad } from './gate';
import type * as ReadModuleNamespace from './read';

type ReadModule = typeof ReadModuleNamespace;

let readModule: ReadModule | null = null;
/** The keyring memo lives as long as the instance (parsed on the first open, see lazyKeyring). */
let keyringOnce: (() => Keyring) | null = null;

/**
 * The read module, required on first use. require (not import()) on purpose, as in
 * ./inboundFunction.ts: the build is CommonJS and ts-jest runs CommonJS. A failed require is not
 * cached by Node, so the next call tries again.
 */
function loadRead(): ReadModule {
  if (readModule === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see above.
    readModule = require('./read') as ReadModule;
  }
  return readModule;
}

/** The params are read per call (never at load); the data key only when something is opened. */
function readDeps(mod: ReadModule): ReadModuleNamespace.SummaryReadDeps {
  if (keyringOnce === null) keyringOnce = mod.lazyKeyring(() => SUMMARIES_DATA_KEY.value());
  return {
    get db() {
      return adminDb();
    },
    now: () => new Date(),
    config: {
      enabled: SUMMARIES_ENABLED.value() === true,
      pilotUids: SUMMARIES_PILOT_UIDS.value(),
    },
    keyring: keyringOnce,
  };
}

/** The summaryRead function. No arguments: ./index.ts exports it behind the deploy gate. */
export function makeSummaryRead() {
  const serviceAccount = summariesServiceAccountAtLoad();
  return onCall(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: false,
      secrets: [SUMMARIES_DATA_KEY],
      // The dedicated runtime account when configured (see the file comment); left out when empty.
      ...(serviceAccount !== null ? { serviceAccount } : {}),
      ...SUMMARIES_FUNCTION_TUNING.read,
    },
    async (request): Promise<SummaryReadResponse> => {
      let mod: ReadModule;
      try {
        mod = loadRead();
      } catch (error) {
        logger.error('summaries.read.failed', { reason: 'load', errorName: error instanceof Error ? error.name : typeof error });
        throw summaryError('upstream_error', 'Meeting summaries are not available right now. Try again later.');
      }
      return mod.handleSummaryRead(request.auth, request.data, readDeps(mod));
    },
  );
}
