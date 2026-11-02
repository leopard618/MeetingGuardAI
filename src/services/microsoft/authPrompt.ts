/**
 * Interactive Microsoft sign-in (authorization code + PKCE) shared by the Outlook connection
 * (src/services/calendar/outlook) and "Continue with Microsoft" (src/services/auth). Imports core
 * only, so L3 code may use it. The rest of the app and its tests never touch expo-auth-session.
 *
 * expo-auth-session / expo-web-browser are loaded lazily (local typings): a build without them
 * compiles, and `promptMicrosoftCode` reports `failed`. The interactive flow:
 *   AuthRequest (PKCE, response_type=code) -> promptAsync (system browser / custom tab) ->
 *   redirect meetingguardai://auth/microsoft -> { code, codeVerifier }.
 * The code is exchanged for tokens by the caller (plain fetch), never here.
 */
import { MICROSOFT_OAUTH } from '../../core/contracts';
import { createLogger } from '../../core/logger';

const log = createLogger('auth');

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

export type PromptResult =
  | { type: 'success'; code: string; codeVerifier: string }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string | null };

export interface MicrosoftPromptConfig {
  clientId: string;
  tenant: string;
  scopes: readonly string[];
  redirectUri: string;
  /** Extra authorize parameters (for example the sign-in nonce). `prompt=select_account` is always sent. */
  extraParams?: Record<string, string>;
}

/** Where a Microsoft account reviews and removes app access. */
export const MICROSOFT_CONSENT_URL = 'https://account.live.com/consent/Manage';

// ---- expo-auth-session surface (typed locally; loaded lazily) --------------------------------

interface AuthSessionResultLike {
  type: 'success' | 'cancel' | 'dismiss' | 'error' | 'locked' | 'opened' | string;
  params?: Record<string, string>;
  error?: { message?: string; description?: string } | null;
}

interface AuthRequestLike {
  codeVerifier?: string;
  promptAsync(discovery: { authorizationEndpoint: string; tokenEndpoint: string }): Promise<AuthSessionResultLike>;
}

interface AuthSessionModuleLike {
  AuthRequest: new (config: {
    clientId: string;
    scopes: string[];
    redirectUri: string;
    responseType: 'code';
    usePKCE: boolean;
    extraParams?: Record<string, string>;
  }) => AuthRequestLike;
}

interface WebBrowserModuleLike {
  maybeCompleteAuthSession?: () => unknown;
  openBrowserAsync?: (url: string) => Promise<unknown>;
}

function loadAuthModules(): { authSession: AuthSessionModuleLike; webBrowser: WebBrowserModuleLike } | null {
  try {
    // Loaded lazily: a static import would break tsc/tests in a build without the packages, and
    // every Microsoft feature is env-gated anyway.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native dependency
    const authSession = require('expo-auth-session') as AuthSessionModuleLike;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native dependency
    const webBrowser = require('expo-web-browser') as WebBrowserModuleLike;
    if (typeof authSession?.AuthRequest !== 'function') return null;
    // Required so a warm app finishes a pending auth session after the redirect.
    try {
      webBrowser.maybeCompleteAuthSession?.();
    } catch {
      // Not fatal: only relevant right after a redirect.
    }
    return { authSession, webBrowser };
  } catch {
    return null;
  }
}

/** Opens the Microsoft sign-in and resolves with the authorization code (PKCE). */
export async function promptMicrosoftCode(config: MicrosoftPromptConfig): Promise<PromptResult> {
  const modules = loadAuthModules();
  if (!modules) {
    log.warn('expo-auth-session is not installed; the Microsoft sign-in is unavailable');
    return { type: 'failed', message: 'auth_session_unavailable' };
  }
  const endpoints = microsoftEndpoints(config.tenant);
  const request = new modules.authSession.AuthRequest({
    clientId: config.clientId,
    scopes: [...config.scopes],
    redirectUri: config.redirectUri,
    responseType: 'code',
    usePKCE: true,
    // Always show the account picker: the Microsoft account is independent of the app account.
    extraParams: { prompt: 'select_account', ...config.extraParams },
  });
  const result = await request.promptAsync({
    authorizationEndpoint: endpoints.authorizationEndpoint,
    tokenEndpoint: endpoints.tokenEndpoint,
  });
  if (result.type === 'success') {
    const code = result.params?.code;
    const codeVerifier = request.codeVerifier;
    if (code && codeVerifier) return { type: 'success', code, codeVerifier };
    return { type: 'failed', message: result.params?.error ?? 'missing_code' };
  }
  if (result.type === 'cancel' || result.type === 'dismiss' || result.type === 'locked') {
    return { type: 'cancelled' };
  }
  return { type: 'failed', message: result.error?.message ?? result.params?.error ?? null };
}

/** Opens the Microsoft "manage app access" page (Graph has no programmatic consent revoke). */
export async function openMicrosoftConsentPage(): Promise<void> {
  const modules = loadAuthModules();
  if (!modules?.webBrowser.openBrowserAsync) return;
  await modules.webBrowser.openBrowserAsync(MICROSOFT_CONSENT_URL);
}
