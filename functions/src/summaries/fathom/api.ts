/**
 * Fathom API client (Connect Fathom; docs/v2/FATHOM-CONNECT.md section 3). The four calls the
 * integration makes: the authorization-code exchange, the refresh, POST /webhooks and
 * DELETE /webhooks/{id}. Over an injected fetch port so tests never reach the network.
 *
 * Facts from developers.fathom.ai (checked 2026-11-17) and the official fathom-typescript SDK
 * 0.0.43 (funcs/getAuthorizationUrl.js, funcs/withAuthorization.js):
 * - authorize: https://fathom.video/external/v1/oauth2/authorize with client_id, redirect_uri,
 *   scope, state and response_type=code. The only scope is public_api.
 * - token: POST application/x-www-form-urlencoded with the client credentials in the body; the
 *   answer is {access_token, refresh_token, expires_in, token_type?, scope?}. Refresh tokens are
 *   single use and rotate on every refresh (a second use answers 400).
 * - REST: https://api.fathom.ai/external/v1 with Authorization: Bearer <access token>.
 *
 * Nothing here logs. Tokens, codes, the client secret and the webhook secret never leave this
 * module except in the returned values.
 */
import { z } from 'zod';

export const FATHOM_AUTHORIZE_URL = 'https://fathom.video/external/v1/oauth2/authorize';
/** The documented token endpoint (the SDK posts to https://fathom.video/external/v1/oauth2/token). */
export const FATHOM_TOKEN_URL = 'https://api.fathom.ai/external/v1/oauth2/token';
export const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';
export const FATHOM_SCOPE = 'public_api';
/** Every Fathom call gives up after this long. */
export const FATHOM_TIMEOUT_MS = 10_000;
/** expires_in when the token answer leaves it out (the SDK requires it; this is only a fallback). */
const DEFAULT_EXPIRES_IN_SECONDS = 1800;

/** The slice of fetch the client uses (global fetch in production). */
export type FathomFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Why a Fathom call failed (fixed codes, safe to log). */
export type FathomFailure = 'network' | 'http_4xx' | 'http_5xx' | 'unauthorized' | 'rate_limited' | 'shape';

export class FathomApiError extends Error {
  constructor(
    readonly failure: FathomFailure,
    readonly status: number | null,
  ) {
    super(`fathom api: ${failure}${status === null ? '' : ` ${status}`}`);
    this.name = 'FathomApiError';
  }
}

export interface FathomClientConfig {
  clientId: string;
  clientSecret: string;
  fetch: FathomFetch;
}

export interface FathomTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token stops working. */
  accessExpiresAtMs: number;
}

export interface FathomWebhook {
  id: string;
  /** whsec_<base64>: the key that signs every delivery of this webhook. */
  secret: string;
}

/** The authorize URL the app opens (pure). */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(FATHOM_AUTHORIZE_URL);
  url.searchParams.append('client_id', clientId);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('scope', FATHOM_SCOPE);
  url.searchParams.append('state', state);
  url.searchParams.append('response_type', 'code');
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4096),
  refresh_token: z.string().min(1).max(4096),
  expires_in: z.number().positive().optional(),
});

const webhookResponseSchema = z.object({
  id: z.union([z.string().min(1).max(200), z.number().int().nonnegative()]),
  secret: z.string().regex(/^whsec_[A-Za-z0-9+/=_-]{8,200}$/),
});

function statusFailure(status: number): FathomFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'http_5xx' : 'http_4xx';
}

async function call(
  config: FathomClientConfig,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; json(): Promise<unknown> }> {
  try {
    return await config.fetch(url, { ...init, signal: AbortSignal.timeout(FATHOM_TIMEOUT_MS) });
  } catch {
    throw new FathomApiError('network', null);
  }
}

async function jsonOf(response: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new FathomApiError('shape', null);
  }
}

async function tokenCall(config: FathomClientConfig, form: Record<string, string>, nowMs: number): Promise<FathomTokens> {
  const response = await call(config, FATHOM_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...form, client_id: config.clientId, client_secret: config.clientSecret }).toString(),
  });
  if (response.status < 200 || response.status > 299) throw new FathomApiError(statusFailure(response.status), response.status);
  const parsed = tokenResponseSchema.safeParse(await jsonOf(response));
  if (!parsed.success) throw new FathomApiError('shape', response.status);
  const expiresIn = parsed.data.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS;
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    accessExpiresAtMs: nowMs + Math.floor(expiresIn * 1000),
  };
}

/** The authorization-code grant (the redirect_uri must equal the one the authorize URL carried). */
export function exchangeCode(config: FathomClientConfig, code: string, redirectUri: string, nowMs: number): Promise<FathomTokens> {
  return tokenCall(config, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, nowMs);
}

/** The refresh grant. The refresh token is spent: store the returned one before anything else. */
export function refreshTokens(config: FathomClientConfig, refreshToken: string, nowMs: number): Promise<FathomTokens> {
  return tokenCall(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, nowMs);
}

/**
 * POST /webhooks for the authorized user: the summary and the action items of the user's own
 * recordings (my_recordings), delivered to `destinationUrl`.
 */
export async function createWebhook(config: FathomClientConfig, accessToken: string, destinationUrl: string): Promise<FathomWebhook> {
  const response = await call(config, `${FATHOM_API_BASE}/webhooks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      destination_url: destinationUrl,
      triggered_for: ['my_recordings'],
      include_summary: true,
      include_action_items: true,
      include_transcript: false,
      include_crm_matches: false,
    }),
  });
  if (response.status < 200 || response.status > 299) throw new FathomApiError(statusFailure(response.status), response.status);
  const parsed = webhookResponseSchema.safeParse(await jsonOf(response));
  if (!parsed.success) throw new FathomApiError('shape', response.status);
  return { id: String(parsed.data.id), secret: parsed.data.secret };
}

/** DELETE /webhooks/{id}. A 404 counts as removed (already gone in Fathom). */
export async function deleteWebhook(config: FathomClientConfig, accessToken: string, webhookId: string): Promise<void> {
  const response = await call(config, `${FATHOM_API_BASE}/webhooks/${encodeURIComponent(webhookId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (response.status === 404) return;
  if (response.status < 200 || response.status > 299) throw new FathomApiError(statusFailure(response.status), response.status);
}
