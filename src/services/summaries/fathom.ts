/**
 * Connect Fathom, app side (docs/v2/FATHOM-CONNECT.md section 7). The fathomConnect callable plus
 * the browser auth session:
 * - status(): {available, connected, ...}; a server without Connect Fathom (functions/not-found)
 *   or a caller who may not use summaries answers available false, never an error.
 * - connect(): start (the server makes sure the private address exists and answers the Fathom
 *   authorize URL), then an auth session that ends on FATHOM_RETURN_URL; its result and reason
 *   codes are read here (parseFathomReturn).
 * - disconnect(): removes the webhook in Fathom and the connection.
 * Pure pieces (parseFathomReturn, FATHOM_UNAVAILABLE) are exported for tests. Nothing here logs a
 * URL: the authorize URL carries a single-use state.
 */
import { httpsCallable } from 'firebase/functions';

import {
  FATHOM_CONNECT_CALLABLE,
  FATHOM_RETURN_REASONS,
  FATHOM_RETURN_URL,
  fathomConnectResponseSchema,
  type FathomConnectRequest,
  type FathomConnectResponse,
  type FathomConnectionStatus,
  type FathomReturnReason,
} from '../../core/aiContract';
import { AppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { functions } from '../../config/firebase';
import { isSummariesUnavailableError, mapSummaryError } from './summaryCore';

const log = createLogger('summaries');

const CALL_TIMEOUT_MS = 30_000;

export const FATHOM_UNAVAILABLE: FathomConnectionStatus = { available: false, connected: false, connectedAt: null, lastEventAt: null };

export type FathomConnectOutcome = { result: 'connected' } | { result: 'cancelled' } | { result: 'error'; reason: FathomReturnReason | null };

export interface FathomTransport {
  call(request: FathomConnectRequest, options: { timeoutMs: number }): Promise<unknown>;
}

/** The browser auth session (expo-web-browser openAuthSessionAsync in the app). */
export type FathomAuthSession = (url: string, returnUrl: string) => Promise<{ type: 'success'; url: string } | { type: 'cancel' }>;

export interface FathomServiceDeps {
  getTransport: () => FathomTransport | null;
  openSession: FathomAuthSession;
}

export interface FathomService {
  status(): Promise<FathomConnectionStatus>;
  connect(): Promise<FathomConnectOutcome>;
  disconnect(): Promise<{ status: FathomConnectionStatus; remoteRemoved: boolean | null }>;
}

/** The outcome a FATHOM_RETURN_URL redirect carries (pure). Anything else is an error without a reason. */
export function parseFathomReturn(url: string): FathomConnectOutcome {
  if (typeof url !== 'string' || !url.startsWith(FATHOM_RETURN_URL)) return { result: 'error', reason: null };
  const query = url.slice(FATHOM_RETURN_URL.length).replace(/^\?/, '');
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    const [key = '', value = ''] = pair.split('=', 2);
    if (key.length > 0) params.set(key, value);
  }
  const result = params.get('result');
  if (result === 'connected') return { result: 'connected' };
  if (result === 'cancelled') return { result: 'cancelled' };
  const reason = params.get('reason') ?? '';
  return { result: 'error', reason: (FATHOM_RETURN_REASONS as readonly string[]).includes(reason) ? (reason as FathomReturnReason) : null };
}

export function createFathomService(deps: FathomServiceDeps): FathomService {
  async function call(request: FathomConnectRequest): Promise<FathomConnectResponse> {
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    let raw: unknown;
    try {
      raw = await transport.call(request, { timeoutMs: CALL_TIMEOUT_MS });
    } catch (error) {
      const mapped = mapSummaryError(error);
      log.warn('fathom call failed', { op: request.op, code: mapped.code });
      throw mapped;
    }
    const parsed = fathomConnectResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn('fathom answer did not match the contract', { op: request.op });
      throw new AppError('upstream_error', 'invalid fathomConnect response');
    }
    return parsed.data;
  }

  return {
    async status() {
      if (!deps.getTransport()) return FATHOM_UNAVAILABLE;
      try {
        return (await call({ op: 'status' })).status;
      } catch (error) {
        // Not deployed (not-found maps to not_enabled) or not for this caller: just not offered.
        if (error instanceof AppError && isSummariesUnavailableError(error)) return FATHOM_UNAVAILABLE;
        throw error;
      }
    },
    async connect() {
      const started = await call({ op: 'start' });
      if (started.authorizeUrl === null) return { result: 'error', reason: 'server_error' };
      const session = await deps.openSession(started.authorizeUrl, FATHOM_RETURN_URL);
      if (session.type !== 'success') return { result: 'cancelled' };
      return parseFathomReturn(session.url);
    },
    async disconnect() {
      const answer = await call({ op: 'disconnect' });
      return { status: answer.status, remoteRemoved: answer.remoteRemoved };
    },
  };
}

function defaultTransport(): FathomTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(request, options) {
      const callable = httpsCallable<unknown, unknown>(instance, FATHOM_CONNECT_CALLABLE, { timeout: options.timeoutMs });
      return (await callable(request)).data;
    },
  };
}

interface WebBrowserLike {
  openAuthSessionAsync(url: string, redirectUrl: string): Promise<{ type: string; url?: string }>;
}

const defaultSession: FathomAuthSession = async (url, returnUrl) => {
  // Loaded lazily, like the Microsoft sign-in (services/microsoft/authPrompt.ts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, loaded on use
  const browser = require('expo-web-browser') as WebBrowserLike;
  const result = await browser.openAuthSessionAsync(url, returnUrl);
  return result.type === 'success' && typeof result.url === 'string' ? { type: 'success', url: result.url } : { type: 'cancel' };
};

export const fathomService: FathomService = createFathomService({ getTransport: defaultTransport, openSession: defaultSession });
