/**
 * Interactive Microsoft sign-in (PKCE) behind a small port, so the rest of the Outlook code and
 * its tests never touch expo-auth-session directly.
 *
 * expo-auth-session / expo-web-browser are added by the integrator (`npx expo install
 * expo-auth-session expo-web-browser`); until then this module compiles (lazy `require`, local
 * typings) but `promptForCode` reports `failed`. The interactive flow:
 *   AuthRequest (PKCE, response_type=code) -> promptAsync (system browser / custom tab) ->
 *   redirect meetingguardai://auth/microsoft -> { code, codeVerifier }.
 * The code is exchanged for tokens by the token manager (plain fetch), never here.
 */
import { createLogger } from '../../../core/logger';
import { microsoftEndpoints } from './tokenManager';

const log = createLogger('calendar');

export type PromptResult =
  | { type: 'success'; code: string; codeVerifier: string }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string | null };

export interface MicrosoftAuthPort {
  /** Opens the Microsoft sign-in and resolves with the authorization code (PKCE). */
  promptForCode(config: { clientId: string; tenant: string; scopes: readonly string[]; redirectUri: string }): Promise<PromptResult>;
  /** Opens the Microsoft "manage app access" page (Graph has no programmatic consent revoke). */
  openConsentPage(): Promise<void>;
}

/** Where a Microsoft account reviews and removes app access. */
export const MICROSOFT_CONSENT_URL = 'https://account.live.com/consent/Manage';

// ---- expo-auth-session surface (typed locally; the package may not be installed yet) ----------

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
    // Optional dependency: the integrator installs expo-auth-session/expo-web-browser; a static
    // import would break tsc/tests until then, and the whole Outlook feature is env-gated anyway.
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

export function createMicrosoftAuthPort(): MicrosoftAuthPort {
  return {
    async promptForCode(config) {
      const modules = loadAuthModules();
      if (!modules) {
        log.warn('expo-auth-session is not installed; the Outlook connect flow is unavailable');
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
        extraParams: { prompt: 'select_account' },
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
    },

    async openConsentPage() {
      const modules = loadAuthModules();
      if (!modules?.webBrowser.openBrowserAsync) return;
      await modules.webBrowser.openBrowserAsync(MICROSOFT_CONSENT_URL);
    },
  };
}
