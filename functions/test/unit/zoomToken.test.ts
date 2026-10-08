import { ZoomApiError } from '../../src/zoom/errors';
import { ZOOM_TOKEN_URL, createZoomTokenManager, type ZoomCredentials } from '../../src/zoom/token';

const CREDENTIALS: ZoomCredentials = {
  accountId: 'acct_1',
  clientId: 'client_1',
  clientSecret: 'secret_1',
};

interface RecordedCall {
  url: string;
  init: { method?: string; headers?: Record<string, string> };
}

function httpResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Response;
}

function tokenBody(token: string, expiresIn = 3600): unknown {
  return { access_token: token, token_type: 'bearer', expires_in: expiresIn, scope: 'meeting:write:meeting' };
}

function scriptedFetch(script: Array<Response | Error>): { fetchFn: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchFn = (async (input: unknown, init?: unknown) => {
    calls.push({ url: String(input), init: (init ?? {}) as RecordedCall['init'] });
    const step = script[Math.min(index, script.length - 1)]!;
    index += 1;
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('createZoomTokenManager', () => {
  it('mints with the account_credentials grant and Basic client auth', async () => {
    const { fetchFn, calls } = scriptedFetch([httpResponse(200, tokenBody('tok_1'))]);
    const manager = createZoomTokenManager({ fetchFn, nowMs: () => 0 });

    await expect(manager.getToken(CREDENTIALS)).resolves.toBe('tok_1');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=acct_1`);
    expect(calls[0]!.init.method).toBe('POST');
    const expectedBasic = Buffer.from('client_1:secret_1').toString('base64');
    expect(calls[0]!.init.headers?.Authorization).toBe(`Basic ${expectedBasic}`);
  });

  it('caches the token until the safety window before expiry', async () => {
    let nowMs = 0;
    const { fetchFn, calls } = scriptedFetch([
      httpResponse(200, tokenBody('tok_1', 3600)),
      httpResponse(200, tokenBody('tok_2', 3600)),
    ]);
    const manager = createZoomTokenManager({ fetchFn, nowMs: () => nowMs, safetyWindowSeconds: 60 });

    await expect(manager.getToken(CREDENTIALS)).resolves.toBe('tok_1');
    nowMs = (3600 - 61) * 1000; // still inside the window
    await expect(manager.getToken(CREDENTIALS)).resolves.toBe('tok_1');
    expect(calls).toHaveLength(1);

    nowMs = (3600 - 60) * 1000; // the safety window starts: refresh
    await expect(manager.getToken(CREDENTIALS)).resolves.toBe('tok_2');
    expect(calls).toHaveLength(2);
  });

  it('invalidate() drops the cache', async () => {
    const { fetchFn, calls } = scriptedFetch([
      httpResponse(200, tokenBody('tok_1')),
      httpResponse(200, tokenBody('tok_2')),
    ]);
    const manager = createZoomTokenManager({ fetchFn, nowMs: () => 0 });

    await manager.getToken(CREDENTIALS);
    manager.invalidate();
    await expect(manager.getToken(CREDENTIALS)).resolves.toBe('tok_2');
    expect(calls).toHaveLength(2);
  });

  it('re-mints when the credentials change (secret rotation)', async () => {
    const { fetchFn, calls } = scriptedFetch([
      httpResponse(200, tokenBody('tok_1')),
      httpResponse(200, tokenBody('tok_2')),
    ]);
    const manager = createZoomTokenManager({ fetchFn, nowMs: () => 0 });

    await manager.getToken(CREDENTIALS);
    await expect(manager.getToken({ ...CREDENTIALS, clientId: 'client_2' })).resolves.toBe('tok_2');
    expect(calls).toHaveLength(2);
  });

  it.each([
    [400, 'not_configured'],
    [401, 'not_configured'],
    [500, 'upstream_error'],
  ])('maps a %s from the token endpoint to %s', async (status, reason) => {
    const { fetchFn } = scriptedFetch([httpResponse(status)]);
    const manager = createZoomTokenManager({ fetchFn, nowMs: () => 0 });

    await expect(manager.getToken(CREDENTIALS)).rejects.toMatchObject({ name: 'ZoomApiError', reason, status });
  });

  it('maps a network failure to upstream_error without echoing the error', async () => {
    const { fetchFn } = scriptedFetch([new Error('getaddrinfo ENOTFOUND zoom.us https://zoom.us/secret')]);
    const manager = createZoomTokenManager({ fetchFn, nowMs: () => 0 });

    const failure = await manager.getToken(CREDENTIALS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ZoomApiError);
    expect((failure as ZoomApiError).reason).toBe('upstream_error');
    expect((failure as ZoomApiError).status).toBeNull();
    expect((failure as ZoomApiError).message).not.toContain('zoom.us/secret');
  });

  it('maps a malformed token body to upstream_error and does not cache it', async () => {
    const { fetchFn, calls } = scriptedFetch([
      httpResponse(200, { token_type: 'bearer' }),
      httpResponse(200, tokenBody('tok_2')),
    ]);
    const manager = createZoomTokenManager({ fetchFn, nowMs: () => 0 });

    await expect(manager.getToken(CREDENTIALS)).rejects.toMatchObject({ reason: 'upstream_error' });
    await expect(manager.getToken(CREDENTIALS)).resolves.toBe('tok_2');
    expect(calls).toHaveLength(2);
  });
});
