/**
 * requestMicrosoftIdToken (docs/v1/ARCHITECTURE.md section 31): identity scopes + nonce in the
 * prompt, code exchange at the token endpoint, id_token out; nothing else leaves the module.
 */
import { MICROSOFT_OAUTH } from '../../../core/contracts';
import { isAppError } from '../../../core/errors';
import type { MicrosoftPromptConfig, PromptResult } from '../authPrompt';
import { MS_SIGN_IN_REDIRECT_URI, requestMicrosoftIdToken } from '../signIn';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function setup(promptResult: PromptResult, responses: Response[]) {
  const prompts: MicrosoftPromptConfig[] = [];
  const requests: { url: string; body: URLSearchParams }[] = [];
  const prompt = jest.fn(async (config: MicrosoftPromptConfig) => {
    prompts.push(config);
    return promptResult;
  });
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: new URLSearchParams(String(init?.body)) });
    const next = responses.shift();
    if (!next) throw new TypeError('Network request failed');
    return next;
  }) as unknown as typeof fetch;
  return { prompt, fetchImpl, prompts, requests };
}

const success: PromptResult = { type: 'success', code: 'code-1', codeVerifier: 'verifier-1' };

it('asks for the identity scopes with the nonce and exchanges the code for the id_token', async () => {
  const { prompt, fetchImpl, prompts, requests } = setup(success, [jsonResponse(200, { id_token: 'jwt-1', access_token: 'at' })]);
  const result = await requestMicrosoftIdToken({ clientId: 'client', tenant: 'common', nonce: 'nonce-1', prompt, fetchImpl });

  expect(result).toEqual({ type: 'success', idToken: 'jwt-1' });
  expect(prompts).toEqual([
    {
      clientId: 'client',
      tenant: 'common',
      scopes: MICROSOFT_OAUTH.signInScopes,
      redirectUri: MS_SIGN_IN_REDIRECT_URI,
      extraParams: { nonce: 'nonce-1' },
    },
  ]);
  expect(MICROSOFT_OAUTH.signInScopes).not.toContain('offline_access');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
  const body = requests[0]?.body;
  expect(body?.get('grant_type')).toBe('authorization_code');
  expect(body?.get('code')).toBe('code-1');
  expect(body?.get('code_verifier')).toBe('verifier-1');
  expect(body?.get('client_id')).toBe('client');
  expect(body?.get('redirect_uri')).toBe('meetingguardai://auth/microsoft');
  expect(body?.get('scope')).toBe('openid profile email');
});

it('passes a cancelled or failed prompt through without touching the token endpoint', async () => {
  const cancelled = setup({ type: 'cancelled' }, []);
  await expect(requestMicrosoftIdToken({ clientId: 'c', tenant: 'common', nonce: 'n', ...cancelled })).resolves.toEqual({ type: 'cancelled' });
  expect(cancelled.fetchImpl).not.toHaveBeenCalled();

  const failed = setup({ type: 'failed', message: 'access_denied' }, []);
  await expect(requestMicrosoftIdToken({ clientId: 'c', tenant: 'common', nonce: 'n', ...failed })).resolves.toEqual({
    type: 'failed',
    message: 'access_denied',
  });
  expect(failed.fetchImpl).not.toHaveBeenCalled();
});

it('reports a token response without id_token as an upstream error (never the token endpoint body)', async () => {
  const { prompt, fetchImpl } = setup(success, [jsonResponse(400, { error: 'invalid_grant', error_description: 'secret text' })]);
  const error = await requestMicrosoftIdToken({ clientId: 'c', tenant: 'common', nonce: 'n', prompt, fetchImpl }).catch((e: unknown) => e);
  expect(isAppError(error) && error.code).toBe('upstream_error');
  expect(isAppError(error) && error.details).toEqual({ status: 400, oauthError: 'invalid_grant' });
  expect(isAppError(error) && error.message).not.toContain('secret text');
});

it('maps a network failure to offline and a 5xx to a retryable upstream error', async () => {
  const offline = setup(success, []);
  const offlineError = await requestMicrosoftIdToken({ clientId: 'c', tenant: 'common', nonce: 'n', ...offline }).catch((e: unknown) => e);
  expect(isAppError(offlineError) && offlineError.code).toBe('offline');

  const down = setup(success, [jsonResponse(503, {})]);
  const downError = await requestMicrosoftIdToken({ clientId: 'c', tenant: 'common', nonce: 'n', ...down }).catch((e: unknown) => e);
  expect(isAppError(downError) && downError.code).toBe('upstream_error');
  expect(isAppError(downError) && downError.retryable).toBe(true);
});

it('uses the tenant for the token endpoint', async () => {
  const { prompt, fetchImpl, requests } = setup(success, [jsonResponse(200, { id_token: 'jwt' })]);
  await requestMicrosoftIdToken({ clientId: 'c', tenant: 'consumers', nonce: 'n', prompt, fetchImpl });
  expect(requests[0]?.url).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
});
