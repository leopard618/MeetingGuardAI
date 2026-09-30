/**
 * Microsoft token manager for the Outlook sync (pure fetch against the v2.0 token endpoint;
 * unit-tested with a mocked fetch and token store).
 *
 * - Access tokens live ONLY in memory (refreshed ~60 s before expiry). The refresh token is
 *   persisted per uid through the injected store (src/services/auth/microsoftTokens.ts).
 * - Microsoft ROTATES refresh tokens: every refresh response may carry a new one, which replaces
 *   the stored token.
 * - `invalid_grant` / `interaction_required` (revoked or expired consent) clears the stored token,
 *   reports through `onDisconnected` and throws AppError('calendar_not_connected'): the account
 *   must be connected again interactively.
 */
import { MICROSOFT_OAUTH } from '../../../core/contracts';
import { AppError, toAppError } from '../../../core/errors';
import { createLogger } from '../../../core/logger';

const log = createLogger('calendar');

/** Refresh this long before the reported expiry. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** A stalled token-endpoint request must not hold a connect/refresh open (same as the Graph client). */
export const TOKEN_REQUEST_TIMEOUT_MS = 30_000;
/** Used when the token response has no expires_in. */
const DEFAULT_TOKEN_LIFETIME_S = 3600;

/** OAuth codes that mean "the user must sign in again" (not a transient failure). */
const DISCONNECT_ERRORS: ReadonlySet<string> = new Set(['invalid_grant', 'interaction_required', 'unauthorized_client']);

export interface MicrosoftEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

/** v2.0 endpoints for a tenant, derived from the MICROSOFT_OAUTH authority. */
export function microsoftEndpoints(tenant: string): MicrosoftEndpoints {
  const issuer = MICROSOFT_OAUTH.authority(tenant); // https://login.microsoftonline.com/{tenant}/v2.0
  const root = issuer.replace(/\/v2\.0$/, '');
  return {
    authorizationEndpoint: `${root}/oauth2/v2.0/authorize`,
    tokenEndpoint: `${root}/oauth2/v2.0/token`,
  };
}

export interface MicrosoftTokenStorePort {
  get(uid: string): Promise<string | null>;
  save(uid: string, refreshToken: string): Promise<void>;
  clear(uid: string): Promise<void>;
}

export interface TokenGrant {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds. */
  expiresIn: number | null;
}

export interface TokenManagerDeps {
  clientId: string;
  tenant: string;
  store: MicrosoftTokenStorePort;
  /** Active data-session uid (null = signed out). */
  getUid(): string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** The stored consent is gone (invalid_grant): status flips to disconnected. */
  onDisconnected?: () => void;
}

export interface MicrosoftTokenManager {
  /** A refresh token is stored for the active uid (cheap "connected" probe). */
  hasRefreshToken(): Promise<boolean>;
  /** Valid access token (memory cache; refreshes with the stored refresh token when needed). */
  getAccessToken(): Promise<string>;
  /** Drops the cached access token so the next getAccessToken() refreshes (Graph returned 401). */
  invalidateAccessToken(token: string): Promise<void>;
  /** Stores a fresh grant after the interactive connect (refresh token persisted). */
  adoptGrant(grant: TokenGrant): Promise<void>;
  /** Exchanges an authorization code (PKCE) at the token endpoint. */
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenGrant>;
  /** Forgets everything (disconnect / session end). Idempotent. */
  clear(): Promise<void>;
  /** Drops only the in-memory access token (session end for another user). */
  dropMemory(): void;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export function createMicrosoftTokenManager(deps: TokenManagerDeps): MicrosoftTokenManager {
  const fetchImpl = deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? ((): Date => new Date());
  const endpoints = microsoftEndpoints(deps.tenant);
  const scope = MICROSOFT_OAUTH.scopes.join(' ');

  let cached: { uid: string; accessToken: string; expiresAtMs: number } | null = null;
  let refreshing: Promise<string> | null = null;

  function requireUid(): string {
    const uid = deps.getUid();
    if (!uid) throw new AppError('unauthenticated', 'No active session for the Outlook sync');
    return uid;
  }

  async function tokenRequest(params: Record<string, string>): Promise<TokenGrant> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS) : null;
    let response: Response;
    try {
      response = await fetchImpl(endpoints.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: deps.clientId, scope, ...params }).toString(),
        signal: controller?.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('timeout', 'The Microsoft token request timed out', { cause: error });
      }
      throw new AppError('offline', 'The Microsoft sign-in service is unreachable', { cause: error });
    } finally {
      if (timer) clearTimeout(timer);
    }
    let body: OAuthTokenResponse = {};
    try {
      body = (await response.json()) as OAuthTokenResponse;
    } catch {
      // Fall through to the status checks below.
    }
    if (!response.ok || !body.access_token) {
      const oauthError = body.error ?? null;
      if (oauthError !== null && DISCONNECT_ERRORS.has(oauthError)) {
        throw new AppError('calendar_not_connected', 'The Microsoft sign-in has expired', {
          details: { oauthError },
        });
      }
      throw new AppError(response.status >= 500 ? 'upstream_error' : 'unauthenticated', 'Microsoft token request failed', {
        details: { status: response.status, oauthError },
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null,
    };
  }

  async function adopt(uid: string, grant: TokenGrant): Promise<void> {
    if (grant.refreshToken !== null) await deps.store.save(uid, grant.refreshToken);
    const lifetimeS = grant.expiresIn ?? DEFAULT_TOKEN_LIFETIME_S;
    cached = { uid, accessToken: grant.accessToken, expiresAtMs: now().getTime() + lifetimeS * 1000 - TOKEN_EXPIRY_MARGIN_MS };
  }

  async function refresh(uid: string): Promise<string> {
    const refreshToken = await deps.store.get(uid);
    if (refreshToken === null) {
      throw new AppError('calendar_not_connected', 'Outlook is not connected on this device');
    }
    try {
      const grant = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      await adopt(uid, grant);
      return grant.accessToken;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'calendar_not_connected') {
        // Consent revoked or the refresh token expired: forget it and surface "not connected".
        cached = null;
        await deps.store.clear(uid).catch(() => undefined);
        try {
          deps.onDisconnected?.();
        } catch (hookError) {
          log.warn('Outlook disconnect hook failed', toAppError(hookError).code);
        }
      }
      throw appError;
    }
  }

  return {
    async hasRefreshToken() {
      const uid = deps.getUid();
      if (!uid) return false;
      try {
        return (await deps.store.get(uid)) !== null;
      } catch {
        // Unreadable keystore: treat as not connected (never as success).
        return false;
      }
    },

    async getAccessToken() {
      const uid = requireUid();
      if (cached && cached.uid === uid && cached.expiresAtMs > now().getTime()) return cached.accessToken;
      if (!refreshing) {
        refreshing = refresh(uid).finally(() => {
          refreshing = null;
        });
      }
      return refreshing;
    },

    async invalidateAccessToken(token) {
      if (cached && cached.accessToken === token) cached = null;
    },

    async adoptGrant(grant) {
      const uid = requireUid();
      if (grant.refreshToken === null) {
        throw new AppError('calendar_not_connected', 'Microsoft did not return a refresh token (offline_access missing?)');
      }
      await adopt(uid, grant);
    },

    exchangeCode(code, codeVerifier, redirectUri) {
      return tokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });
    },

    async clear() {
      const uid = deps.getUid();
      cached = null;
      if (uid) await deps.store.clear(uid);
    },

    dropMemory() {
      cached = null;
    },
  };
}
