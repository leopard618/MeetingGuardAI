/**
 * Connect Fathom: the fathomConnect callable and the fathomOAuth return step
 * (docs/v2/FATHOM-CONNECT.md sections 2 to 4). Pure handlers over injected deps; ./functions.ts
 * is the Firebase shell.
 *
 * fathomConnect {op}:
 * - status: {available, connected, connectedAt, lastEventAt}. Signed in only; available false
 *   (never an error) while summaries are off, the caller is not allowed, the address template or
 *   the Fathom client id is not set.
 * - start: verified caller, SUMMARIES_ENABLED, the pilot list, then createAddress (idempotent: a
 *   user who never set up email summaries gets their private address now, because every stored
 *   summary is bound to it), then one single-use state (10 minutes) and the authorize URL.
 * - disconnect: DELETE the webhook in Fathom with a fresh access token (best effort:
 *   remoteRemoved false when Fathom could not be told), then the connection and hook documents.
 * - sync: the backup to the webhook (./sync.ts, loaded on use): the caller's recent recordings
 *   that are not stored yet, at most once a minute; synced {ran, imported, pending}.
 *
 * fathomOAuth GET ?code&state (or ?error&state): the state is consumed first (single use), the
 * code exchanged, a webhook created for the user's own recordings with a new per-user URL, and the
 * connection saved (a reconnect replaces the previous one and tries to delete its webhook). The
 * browser is always sent on to FATHOM_RETURN_URL with result and reason codes.
 *
 * Logs carry uid, op, outcome, reason and failure codes only: never a code, a token, a state, a
 * secret, a URL or an email.
 */
import * as logger from 'firebase-functions/logger';
import type { Firestore } from 'firebase-admin/firestore';

import {
  FATHOM_RETURN_URL,
  fathomConnectRequestSchema,
  fathomConnectResponseSchema,
  type FathomConnectResponse,
  type FathomConnectionStatus,
  type FathomReturnReason,
  type FathomReturnResult,
} from '../../shared/aiContract';
import type { Keyring } from '../../shared/sealed';
import { createAddress, parseAddressTemplate, type AddressDeps } from '../address';
import { isVerifiedCaller, summaryCallerOf, summaryError, verifiedEmailOf, type SummaryCallableAuth } from '../callables';
import { isPilotUid } from '../gate';
import type { CandidatesLoader, InboundAuthUsers } from '../inbound';
import { FathomApiError, authorizeUrl, createWebhook, deleteWebhook, exchangeCode, type FathomClientConfig, type FathomFetch } from './api';
import {
  accessTokenFor,
  consumeState,
  createState,
  deleteConnectionDocs,
  hookHashOf,
  newRandomToken,
  readConnection,
  saveConnection,
  type FathomRandom,
} from './store';
import type * as SyncModuleNamespace from './sync';

export interface FathomConnectConfig {
  enabled: boolean;
  pilotUids: string;
  /** SUMMARIES_ADDRESS_TEMPLATE (empty = being set up). */
  template: string;
  /** FATHOM_CLIENT_ID (empty = Connect Fathom not set up). */
  clientId: string;
}

export interface FathomConnectDeps {
  db: Firestore;
  now: () => Date;
  config: FathomConnectConfig;
  /** FATHOM_CLIENT_SECRET, read only when Fathom is called. */
  clientSecret: () => string;
  /** The summaries keyring (SUMMARIES_DATA_KEY), read only when a connection is sealed or opened. */
  keyring: () => Keyring;
  fetch: FathomFetch;
  /** This project's fathomOAuth URL (the redirect URI registered with Fathom). */
  redirectUri: string;
  /** This project's fathomWebhook URL (no query). */
  webhookUrl: string;
  authUsers?: InboundAuthUsers;
  /** The meeting candidates loader (sync only; ../candidates loadCandidates). */
  candidates?: CandidatesLoader;
  random?: FathomRandom;
  /** Test seam for accessTokenFor's lease wait. */
  sleep?: (ms: number) => Promise<void>;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function client(deps: FathomConnectDeps): FathomClientConfig {
  return { clientId: deps.config.clientId, clientSecret: deps.clientSecret(), fetch: deps.fetch };
}

function configured(config: FathomConnectConfig): boolean {
  return config.enabled && config.clientId.trim().length > 0 && parseAddressTemplate(config.template) !== null;
}

const UNAVAILABLE: FathomConnectionStatus = { available: false, connected: false, connectedAt: null, lastEventAt: null };

async function statusOf(uid: string, deps: FathomConnectDeps): Promise<FathomConnectionStatus> {
  const connection = await readConnection(deps.db, uid);
  return {
    available: true,
    connected: connection !== null,
    connectedAt: connection?.connectedAt ?? null,
    lastEventAt: connection?.lastEventAt ?? null,
  };
}

function respond(response: FathomConnectResponse): FathomConnectResponse {
  return fathomConnectResponseSchema.parse(response);
}

// ---------------------------------------------------------------------------------------------
// fathomConnect
// ---------------------------------------------------------------------------------------------

export async function handleFathomConnect(auth: SummaryCallableAuth, data: unknown, deps: FathomConnectDeps): Promise<FathomConnectResponse> {
  const caller = summaryCallerOf(auth);
  if (caller === null) throw summaryError('unauthenticated', 'Sign in to connect Fathom.');
  const parsed = fathomConnectRequestSchema.safeParse(data ?? {});
  if (!parsed.success) throw summaryError('invalid_request', 'The Fathom request is not valid.');
  const op = parsed.data.op;
  const allowed = isVerifiedCaller(caller) && isPilotUid(caller.uid, deps.config.pilotUids);

  if (op === 'status') {
    if (!configured(deps.config) || !allowed) return respond({ status: UNAVAILABLE, authorizeUrl: null, remoteRemoved: null });
    try {
      return respond({ status: await statusOf(caller.uid, deps), authorizeUrl: null, remoteRemoved: null });
    } catch (error) {
      logger.error('summaries.fathom_connect', { uid: caller.uid, op, outcome: 'error', errorName: errorName(error) });
      throw summaryError('upstream_error', 'Fathom is not available right now. Try again later.');
    }
  }

  if (!isVerifiedCaller(caller)) throw summaryError('unauthenticated', 'Verify your email to connect Fathom.');
  if (!deps.config.enabled) throw summaryError('not_enabled', 'Meeting summaries are not switched on.');
  if (!isPilotUid(caller.uid, deps.config.pilotUids)) throw summaryError('not_allowed', 'Meeting summaries are not available for this account yet.');
  if (!configured(deps.config)) throw summaryError('not_ready', 'Connect Fathom is being set up. Try again later.');

  if (op === 'start') {
    const addressDeps: AddressDeps = { db: deps.db, now: deps.now, template: deps.config.template };
    let created;
    try {
      created = await createAddress(caller.uid, verifiedEmailOf(caller), addressDeps);
    } catch (error) {
      logger.error('summaries.fathom_connect', { uid: caller.uid, op, outcome: 'error', stage: 'address', errorName: errorName(error) });
      throw summaryError('upstream_error', 'Fathom is not available right now. Try again later.');
    }
    if (created.status === 'rate_limited') throw summaryError('rate_limited', 'Too many new addresses today. Try again tomorrow.');
    if (created.status === 'not_ready') throw summaryError('not_ready', 'Connect Fathom is being set up. Try again later.');
    if (created.status === 'account_deleted') throw summaryError('not_allowed', 'This account is being deleted.');
    try {
      const state = await createState(deps.db, caller.uid, deps.now(), deps.random);
      logger.info('summaries.fathom_connect', { uid: caller.uid, op, outcome: 'started', address: created.status });
      return respond({
        status: await statusOf(caller.uid, deps),
        authorizeUrl: authorizeUrl(deps.config.clientId, deps.redirectUri, state),
        remoteRemoved: null,
      });
    } catch (error) {
      logger.error('summaries.fathom_connect', { uid: caller.uid, op, outcome: 'error', stage: 'state', errorName: errorName(error) });
      throw summaryError('upstream_error', 'Fathom is not available right now. Try again later.');
    }
  }

  if (op === 'sync') {
    const { authUsers, candidates } = deps;
    if (authUsers === undefined || candidates === undefined) throw summaryError('not_ready', 'Connect Fathom is being set up. Try again later.');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load: status and start stay light.
      const { syncFathom } = require('./sync') as typeof SyncModuleNamespace;
      const synced = await syncFathom(caller.uid, {
        db: deps.db,
        now: deps.now,
        client: () => client(deps),
        keyring: deps.keyring,
        pilotUids: () => deps.config.pilotUids,
        authUsers,
        candidates,
        ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
      });
      return respond({
        status: await statusOf(caller.uid, deps),
        authorizeUrl: null,
        remoteRemoved: null,
        synced: { ran: synced.ran, imported: synced.imported, pending: synced.pending },
      });
    } catch (error) {
      logger.error('summaries.fathom_connect', { uid: caller.uid, op, outcome: 'error', errorName: errorName(error) });
      throw summaryError('upstream_error', 'Fathom is not available right now. Try again later.');
    }
  }

  // disconnect
  try {
    const remoteRemoved = await disconnectFathom(caller.uid, deps);
    return respond({ status: await statusOf(caller.uid, deps), authorizeUrl: null, remoteRemoved });
  } catch (error) {
    logger.error('summaries.fathom_connect', { uid: caller.uid, op, outcome: 'error', errorName: errorName(error) });
    throw summaryError('upstream_error', 'Fathom is not available right now. Try again later.');
  }
}

/**
 * Removes the webhook in Fathom (best effort) and the connection. Returns null when there was no
 * connection, true when Fathom confirmed the removal (or had none), false when it could not be told.
 */
export async function disconnectFathom(uid: string, deps: FathomConnectDeps): Promise<boolean | null> {
  const connection = await readConnection(deps.db, uid);
  if (connection === null) {
    await deleteConnectionDocs(deps.db, uid);
    return null;
  }
  let remoteRemoved = true;
  if (connection.webhookId !== null) {
    try {
      const token = await accessTokenFor(uid, {
        db: deps.db,
        keyring: deps.keyring(),
        client: client(deps),
        now: deps.now,
        ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
      });
      await deleteWebhook(client(deps), token, connection.webhookId);
    } catch (error) {
      remoteRemoved = false;
      logger.warn('summaries.fathom_connect', {
        uid,
        op: 'disconnect',
        outcome: 'remote_failed',
        failure: error instanceof FathomApiError ? error.failure : errorName(error),
      });
    }
  }
  await deleteConnectionDocs(deps.db, uid);
  logger.info('summaries.fathom_connect', { uid, op: 'disconnect', outcome: 'disconnected', remoteRemoved });
  return remoteRemoved;
}

// ---------------------------------------------------------------------------------------------
// fathomOAuth (the redirect URI)
// ---------------------------------------------------------------------------------------------

export interface FathomOAuthRequest {
  method: string;
  query: Record<string, unknown>;
}

export interface FathomOAuthResponse {
  status: number;
  /** Set on a redirect. */
  location: string | null;
  body: string;
}

export function returnUrl(result: FathomReturnResult, reason: FathomReturnReason | null = null): string {
  return `${FATHOM_RETURN_URL}?result=${result}${reason === null ? '' : `&reason=${reason}`}`;
}

function redirect(result: FathomReturnResult, reason: FathomReturnReason | null = null): FathomOAuthResponse {
  const location = returnUrl(result, reason);
  const message = result === 'connected' ? 'Fathom is connected.' : 'Fathom was not connected.';
  return {
    status: 302,
    location,
    body: `<!doctype html><meta charset="utf-8"><title>Meeting Guard AI</title><p>${message} <a href="${location}">Return to Meeting Guard AI</a></p>`,
  };
}

function firstString(value: unknown): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === 'string' && one.length > 0 && one.length <= 2048 ? one : null;
}

function failureReason(error: unknown): FathomReturnReason {
  if (error instanceof FathomApiError) {
    return error.failure === 'unauthorized' || error.failure === 'http_4xx' ? 'fathom_refused' : 'fathom_unavailable';
  }
  return 'server_error';
}

export async function handleFathomOAuth(request: FathomOAuthRequest, deps: FathomConnectDeps): Promise<FathomOAuthResponse> {
  if (request.method !== 'GET') return { status: 405, location: null, body: 'Method Not Allowed' };
  if (!configured(deps.config)) return redirect('error', 'not_allowed');
  const now = deps.now();
  let uid: string | null = null;
  let stage = 'state';
  try {
    const consumed = await consumeState(deps.db, firstString(request.query.state), now);
    if (!consumed.ok) {
      logger.warn('summaries.fathom_oauth', { outcome: 'refused', reason: consumed.reason });
      return redirect('error', 'expired');
    }
    uid = consumed.uid;
    if (firstString(request.query.error) !== null) {
      logger.info('summaries.fathom_oauth', { uid, outcome: 'cancelled' });
      return redirect('cancelled');
    }
    const code = firstString(request.query.code);
    if (code === null) {
      logger.warn('summaries.fathom_oauth', { uid, outcome: 'refused', reason: 'no_code' });
      return redirect('error', 'fathom_refused');
    }
    if (!isPilotUid(uid, deps.config.pilotUids)) return redirect('error', 'not_allowed');
    if (deps.authUsers !== undefined) {
      stage = 'auth_user';
      const user = await deps.authUsers.getUser(uid);
      if (!user.exists || user.disabled) return redirect('error', 'not_allowed');
    }

    stage = 'exchange';
    const api = client(deps);
    const tokens = await exchangeCode(api, code, deps.redirectUri, now.getTime());
    stage = 'previous';
    const previous = await readConnection(deps.db, uid);
    stage = 'webhook';
    const hookToken = newRandomToken(deps.random);
    const webhook = await createWebhook(api, tokens.accessToken, `${deps.webhookUrl}?k=${hookToken}`);
    if (previous?.webhookId) {
      try {
        await deleteWebhook(api, tokens.accessToken, previous.webhookId);
      } catch {
        // The previous webhook may belong to another Fathom account; its hook maps to nobody now.
      }
    }
    stage = 'save';
    await saveConnection(
      deps.db,
      { uid, hookHash: hookHashOf(hookToken), webhookId: webhook.id, tokens, webhookSecret: webhook.secret, keyring: deps.keyring(), now },
      previous,
    );
    logger.info('summaries.fathom_oauth', { uid, outcome: 'connected', reconnect: previous !== null });
    return redirect('connected');
  } catch (error) {
    const reason = failureReason(error);
    logger.error('summaries.fathom_oauth', {
      uid,
      outcome: 'error',
      stage,
      reason,
      failure: error instanceof FathomApiError ? error.failure : errorName(error),
      httpStatus: error instanceof FathomApiError ? error.status : null,
    });
    return redirect('error', reason);
  }
}
