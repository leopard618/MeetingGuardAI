/**
 * Connect Fathom: the Firebase shells of fathomConnect (callable), fathomOAuth (the redirect URI)
 * and fathomWebhook (Fathom's deliveries). docs/v2/FATHOM-CONNECT.md section 6.
 *
 * Deploy gate (fathomEnabledAtLoad): all three exist only while SUMMARIES_ENABLED is true AND the
 * plain key FATHOM_CLIENT_ID is set in functions/.env.<projectId> at deploy time. The client id is
 * not a secret (it is in every authorize URL), so it is read from process.env like
 * SUMMARIES_SERVICE_ACCOUNT, never declared as a param. FATHOM_CLIENT_SECRET is declared ONLY
 * inside the gate (fathomClientSecret), so a deploy without Connect Fathom never asks for it.
 *
 * Runtime identity: SUMMARIES_SERVICE_ACCOUNT when set (the account that may read
 * SUMMARIES_DATA_KEY), exactly like summaryInbound.
 *
 * URLs: https://<FUNCTIONS_REGION>-<project>.cloudfunctions.net/fathomOAuth is the redirect URI to
 * register with Fathom; fathomWebhook gets ?k=<per-user token>.
 *
 * The handler modules load on the first request (the summaries index rule: nothing heavy at load).
 */
import { defineSecret } from 'firebase-functions/params';
import { onCall, onRequest, type CallableOptions } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_REGION, SUMMARIES_ADDRESS_TEMPLATE, SUMMARIES_DATA_KEY, SUMMARIES_ENABLED, SUMMARIES_PILOT_UIDS } from '../../config';
import { adminAuth, adminDb } from '../../firebase';
import type { FathomConnectResponse } from '../../shared/aiContract';
import { parseKeyring, type Keyring } from '../../shared/sealed';
import { summariesEnabledAtLoad, summariesServiceAccountAtLoad } from '../gate';
import type * as ConnectModuleNamespace from './connect';
import type * as WebhookModuleNamespace from './webhook';
import type * as CandidatesModuleNamespace from '../candidates';

type ConnectModule = typeof ConnectModuleNamespace;
type WebhookModule = typeof WebhookModuleNamespace;
type CandidatesModule = typeof CandidatesModuleNamespace;

export const FATHOM_OAUTH_FUNCTION = 'fathomOAuth';
export const FATHOM_WEBHOOK_FUNCTION = 'fathomWebhook';

/** FATHOM_CLIENT_ID from functions/.env.<projectId> (plain, not a param). */
export function fathomClientIdAtLoad(): string | null {
  const raw = process.env.FATHOM_CLIENT_ID;
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 && value.length <= 200 ? value : null;
}

/** Whether the Connect Fathom functions are exported (deploy gate). */
export function fathomEnabledAtLoad(): boolean {
  return summariesEnabledAtLoad() && fathomClientIdAtLoad() !== null;
}

let clientSecretParam: ReturnType<typeof defineSecret> | null = null;
/** Declares FATHOM_CLIENT_SECRET on first use; called only inside the gate. */
function fathomClientSecret(): ReturnType<typeof defineSecret> {
  if (clientSecretParam === null) clientSecretParam = defineSecret('FATHOM_CLIENT_SECRET');
  return clientSecretParam;
}

/** https://<region>-<project>.cloudfunctions.net/<name> */
export function functionUrl(name: string): string {
  const project = process.env.GCLOUD_PROJECT?.trim() ?? '';
  return `https://${FUNCTIONS_REGION.value()}-${project}.cloudfunctions.net/${name}`;
}

let connectModule: ConnectModule | null = null;
let webhookModule: WebhookModule | null = null;
function loadConnect(): ConnectModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load (file comment).
  if (connectModule === null) connectModule = require('./connect') as ConnectModule;
  return connectModule;
}
function loadWebhook(): WebhookModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load (file comment).
  if (webhookModule === null) webhookModule = require('./webhook') as WebhookModule;
  return webhookModule;
}

let keyringMemo: { secret: string; keyring: Keyring } | null = null;
function keyring(): Keyring {
  const secret = SUMMARIES_DATA_KEY.value();
  if (keyringMemo !== null && keyringMemo.secret === secret) return keyringMemo.keyring;
  const parsed = parseKeyring(secret);
  keyringMemo = { secret, keyring: parsed };
  return parsed;
}

function connectDeps(): ConnectModuleNamespace.FathomConnectDeps {
  return {
    get db() {
      return adminDb();
    },
    now: () => new Date(),
    config: {
      enabled: SUMMARIES_ENABLED.value() === true,
      pilotUids: SUMMARIES_PILOT_UIDS.value(),
      template: SUMMARIES_ADDRESS_TEMPLATE.value(),
      clientId: fathomClientIdAtLoad() ?? '',
    },
    clientSecret: () => fathomClientSecret().value(),
    keyring,
    fetch: (url, init) => fetch(url, init),
    redirectUri: functionUrl(FATHOM_OAUTH_FUNCTION),
    webhookUrl: functionUrl(FATHOM_WEBHOOK_FUNCTION),
    get authUsers() {
      return loadInboundAuthUsers();
    },
    // The sync's meeting candidates (a pure loader, no mail parsers), loaded on use.
    candidates: (...args) => loadCandidatesModule().loadCandidates(...args),
  };
}

let candidatesModule: CandidatesModule | null = null;
function loadCandidatesModule(): CandidatesModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load (file comment).
  if (candidatesModule === null) candidatesModule = require('../candidates') as CandidatesModule;
  return candidatesModule;
}

/** Auth reads in the inbound shape, without loading ./inbound (mailauth). */
function loadInboundAuthUsers() {
  const auth = adminAuth();
  return {
    async getUser(uid: string) {
      try {
        const record = await auth.getUser(uid);
        return {
          exists: true,
          disabled: record.disabled === true,
          email: typeof record.email === 'string' ? record.email : null,
          emailVerified: record.emailVerified === true,
        };
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'auth/user-not-found') return { exists: false, disabled: false, email: null, emailVerified: false };
        throw error;
      }
    },
  };
}

function baseOptions() {
  const serviceAccount = summariesServiceAccountAtLoad();
  return {
    region: FUNCTIONS_REGION,
    secrets: [fathomClientSecret(), SUMMARIES_DATA_KEY],
    ...(serviceAccount !== null ? { serviceAccount } : {}),
  };
}

export function makeFathomConnect() {
  const options: CallableOptions = {
    ...baseOptions(),
    enforceAppCheck: false,
    memory: '512MiB',
    cpu: 1,
    concurrency: 20,
    maxInstances: 10,
    timeoutSeconds: 30,
  };
  return onCall(options, (request): Promise<FathomConnectResponse> => {
    const mod = loadConnect();
    return mod.handleFathomConnect(request.auth, request.data, connectDeps());
  });
}

export function makeFathomOAuth() {
  return onRequest({ ...baseOptions(), invoker: 'public', memory: '512MiB', cpu: 1, concurrency: 20, maxInstances: 10, timeoutSeconds: 30 }, async (req, res) => {
    let mod: ConnectModule;
    try {
      mod = loadConnect();
    } catch (error) {
      logger.error('summaries.fathom_oauth', { outcome: 'error', reason: 'load', errorName: error instanceof Error ? error.name : typeof error });
      res.status(500).send('Internal Server Error');
      return;
    }
    const response = await mod.handleFathomOAuth({ method: req.method, query: req.query as Record<string, unknown> }, connectDeps());
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    if (response.location !== null) res.set('Location', response.location);
    res.status(response.status).type('html').send(response.body);
  });
}

export function makeFathomWebhook() {
  const serviceAccount = summariesServiceAccountAtLoad();
  return onRequest(
    {
      region: FUNCTIONS_REGION,
      invoker: 'public',
      // Only the data key: the webhook secret is sealed in the connection document.
      secrets: [SUMMARIES_DATA_KEY],
      ...(serviceAccount !== null ? { serviceAccount } : {}),
      memory: '512MiB',
      cpu: 1,
      concurrency: 10,
      maxInstances: 20,
      timeoutSeconds: 60,
    },
    async (req, res) => {
      if (SUMMARIES_ENABLED.value() !== true) {
        res.status(404).send('Not configured');
        return;
      }
      let mod: WebhookModule;
      let candidates: WebhookModuleNamespace.FathomWebhookDeps['candidates'];
      try {
        mod = loadWebhook();
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- pure loader, no mail parsers.
        candidates = (require('../candidates') as CandidatesModule).loadCandidates;
      } catch (error) {
        logger.error('summaries.fathom_webhook', { verdict: 'error', reason: 'load', errorName: error instanceof Error ? error.name : typeof error });
        res.status(500).send('Internal Server Error');
        return;
      }
      const response = await mod.handleFathomWebhook(
        {
          method: req.method,
          hookToken: Array.isArray(req.query.k) ? req.query.k[0] : req.query.k,
          webhookId: req.get('webhook-id'),
          webhookTimestamp: req.get('webhook-timestamp'),
          webhookSignature: req.get('webhook-signature'),
          rawBody: Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0),
        },
        {
          enabled: () => SUMMARIES_ENABLED.value() === true,
          pilotUids: () => SUMMARIES_PILOT_UIDS.value(),
          keyring,
          get db() {
            return adminDb();
          },
          get authUsers() {
            return loadInboundAuthUsers();
          },
          candidates,
          now: () => new Date(),
        },
      );
      res.status(response.status).send(response.body);
    },
  );
}
