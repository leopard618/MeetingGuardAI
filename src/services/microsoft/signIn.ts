/**
 * "Continue with Microsoft": the identity half of the Microsoft PKCE flow (owner: auth; L3-safe,
 * imports core and ./authPrompt only; docs/v1/ARCHITECTURE.md section 31).
 *
 * Opens the Microsoft sign-in with the identity scopes only (MICROSOFT_OAUTH.signInScopes: no
 * offline_access, so no refresh token exists), exchanges the code at the token endpoint with a
 * plain fetch and returns ONLY the id_token. Nothing is stored. The server (the microsoftSignIn
 * callable) verifies the id_token, including the nonce the caller put in the request, and mints
 * the Firebase custom token the app signs in with. The Outlook connection stays a separate
 * consent (its own scopes and refresh token).
 */
import { MICROSOFT_OAUTH } from '../../core/contracts';
import { AppError } from '../../core/errors';
import { DEEP_LINK_PREFIX, MS_AUTH_REDIRECT_PATH } from '../../core/identifiers';

import { microsoftEndpoints, promptMicrosoftCode, type MicrosoftPromptConfig, type PromptResult } from './authPrompt';

/** Same registered redirect as the Outlook connection (docs/v1/SETUP.md section 10.1). */
export const MS_SIGN_IN_REDIRECT_URI = `${DEEP_LINK_PREFIX}${MS_AUTH_REDIRECT_PATH}`;
/** A stalled token-endpoint request must not hold the sign-in open. */
export const SIGN_IN_TOKEN_TIMEOUT_MS = 30_000;

export type MicrosoftIdTokenResult = { type: 'success'; idToken: string } | { type: 'cancelled' } | { type: 'failed'; message: string | null };

export interface MicrosoftIdTokenDeps {
  clientId: string;
  tenant: string;
  /** Raw nonce sent in the authorize request (the server checks the token's nonce claim). */
  nonce: string;
  /** The browser prompt (default: expo-auth-session through ./authPrompt). */
  prompt?: (config: MicrosoftPromptConfig) => Promise<PromptResult>;
  fetchImpl?: typeof fetch;
}

interface OAuthTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

/** Microsoft sign-in -> authorization code -> id_token (never logged, never stored). */
export async function requestMicrosoftIdToken(deps: MicrosoftIdTokenDeps): Promise<MicrosoftIdTokenResult> {
  const prompt = deps.prompt ?? promptMicrosoftCode;
  const result = await prompt({
    clientId: deps.clientId,
    tenant: deps.tenant,
    scopes: MICROSOFT_OAUTH.signInScopes,
    redirectUri: MS_SIGN_IN_REDIRECT_URI,
    extraParams: { nonce: deps.nonce },
  });
  if (result.type !== 'success') return result;
  const idToken = await exchangeCodeForIdToken(deps, result.code, result.codeVerifier);
  return { type: 'success', idToken };
}

async function exchangeCodeForIdToken(deps: MicrosoftIdTokenDeps, code: string, codeVerifier: string): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const endpoints = microsoftEndpoints(deps.tenant);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SIGN_IN_TOKEN_TIMEOUT_MS) : null;
  let response: Response;
  try {
    response = await fetchImpl(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: deps.clientId,
        scope: MICROSOFT_OAUTH.signInScopes.join(' '),
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: MS_SIGN_IN_REDIRECT_URI,
      }).toString(),
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
  if (!response.ok || typeof body.id_token !== 'string' || body.id_token.length === 0) {
    throw new AppError('upstream_error', 'Microsoft returned no id_token', {
      details: { status: response.status, oauthError: body.error ?? null },
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  return body.id_token;
}
