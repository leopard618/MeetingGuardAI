/**
 * Zoom Server-to-Server OAuth token manager (account_credentials grant).
 *
 * POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id={accountId}
 * with `Authorization: Basic base64(clientId:clientSecret)` returns
 * { access_token, expires_in } (about one hour). The token is cached in instance memory and
 * refreshed ZOOM_TUNING.tokenSafetyWindowSeconds before it expires; `invalidate()` drops it
 * (used for the one retry after an unexpected 401). The cache is keyed on accountId/clientId
 * so a secret rotation mid-instance never serves a token of the old app.
 *
 * SECURITY: the credentials and the token value never appear in logs or errors.
 */
import { z } from 'zod';

import { ZOOM_TUNING } from '../config';
import { ZoomApiError } from './errors';

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface ZoomTokenManager {
  /** Resolves a currently valid access token (cached or freshly minted). */
  getToken(credentials: ZoomCredentials): Promise<string>;
  /** Drops the cached token so the next getToken() mints a new one. */
  invalidate(): void;
}

export const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  /** Seconds. Zoom sends 3600; a malformed value falls back so the cache still works. */
  expires_in: z.number().int().positive().catch(3600),
});

interface CachedToken {
  /** accountId + clientId of the credentials the token was minted for. */
  key: string;
  token: string;
  expiresAtMs: number;
}

export interface ZoomTokenManagerDeps {
  fetchFn?: typeof fetch;
  nowMs?: () => number;
  requestTimeoutMs?: number;
  safetyWindowSeconds?: number;
}

export function createZoomTokenManager(deps: ZoomTokenManagerDeps = {}): ZoomTokenManager {
  const fetchFn = deps.fetchFn ?? fetch;
  const nowMs = deps.nowMs ?? Date.now;
  const requestTimeoutMs = deps.requestTimeoutMs ?? ZOOM_TUNING.zoomRequestTimeoutMs;
  const safetyWindowMs = (deps.safetyWindowSeconds ?? ZOOM_TUNING.tokenSafetyWindowSeconds) * 1000;
  let cached: CachedToken | null = null;

  async function mint(credentials: ZoomCredentials): Promise<CachedToken> {
    const url = `${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(credentials.accountId)}`;
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}` },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      // Timeout / DNS / connection reset. Never include the thrown error (it can echo the URL).
      throw new ZoomApiError('upstream_error', null, 'Zoom token request failed.');
    }
    if (!response.ok) {
      // 400 "invalid client" / 401 / 4711 missing scope: the owner's app is wrong or inactive.
      const reason = response.status === 400 || response.status === 401 ? 'not_configured' : 'upstream_error';
      throw new ZoomApiError(reason, response.status, `Zoom token endpoint answered ${response.status}.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ZoomApiError('upstream_error', response.status, 'Zoom token response was not JSON.');
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ZoomApiError('upstream_error', response.status, 'Zoom token response was malformed.');
    }
    return {
      key: `${credentials.accountId}/${credentials.clientId}`,
      token: parsed.data.access_token,
      expiresAtMs: nowMs() + parsed.data.expires_in * 1000,
    };
  }

  return {
    async getToken(credentials) {
      const key = `${credentials.accountId}/${credentials.clientId}`;
      if (cached && cached.key === key && nowMs() < cached.expiresAtMs - safetyWindowMs) {
        return cached.token;
      }
      cached = await mint(credentials);
      return cached.token;
    },
    invalidate() {
      cached = null;
    },
  };
}
