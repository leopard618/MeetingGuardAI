import { createMicrosoftTokenManager, microsoftEndpoints, type MicrosoftTokenStorePort } from '../outlook/tokenManager';

const UID = 'user-1';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function memoryStore(initial: string | null = null): MicrosoftTokenStorePort & { tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  if (initial !== null) tokens.set(UID, initial);
  return {
    tokens,
    async get(uid) {
      return tokens.get(uid) ?? null;
    },
    async save(uid, token) {
      tokens.set(uid, token);
    },
    async clear(uid) {
      tokens.delete(uid);
    },
  };
}

function setup(options: { store?: MicrosoftTokenStorePort; now?: () => Date; onDisconnected?: () => void } = {}) {
  const fetchImpl = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
  const store = options.store ?? memoryStore('refresh-1');
  const manager = createMicrosoftTokenManager({
    clientId: 'client-1',
    tenant: 'common',
    store,
    getUid: () => UID,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: options.now,
    onDisconnected: options.onDisconnected,
  });
  return { manager, fetchImpl, store };
}

describe('microsoftEndpoints', () => {
  it('derives the v2.0 endpoints from the contract authority', () => {
    expect(microsoftEndpoints('common')).toEqual({
      authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    });
    expect(microsoftEndpoints('contoso.com').tokenEndpoint).toBe('https://login.microsoftonline.com/contoso.com/oauth2/v2.0/token');
  });
});

describe('createMicrosoftTokenManager', () => {
  it('refreshes with the stored refresh token and caches the access token', async () => {
    const { manager, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1', refresh_token: 'refresh-2', expires_in: 3600 }));

    await expect(manager.getAccessToken()).resolves.toBe('at-1');
    await expect(manager.getAccessToken()).resolves.toBe('at-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    const body = String(init?.body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=refresh-1');
    expect(body).toContain('client_id=client-1');
    expect(body).toContain('offline_access');
  });

  it('persists the ROTATED refresh token from the response', async () => {
    const store = memoryStore('refresh-1');
    const { manager, fetchImpl } = setup({ store });
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1', refresh_token: 'refresh-2', expires_in: 3600 }));
    await manager.getAccessToken();
    expect(store.tokens.get(UID)).toBe('refresh-2');
  });

  it('refreshes again after invalidateAccessToken (Graph returned 401)', async () => {
    const { manager, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(200, { access_token: 'at-2', expires_in: 3600 }));
    const first = await manager.getAccessToken();
    await manager.invalidateAccessToken(first);
    await manager.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refreshes when the cached token expires', async () => {
    let nowMs = Date.parse('2026-10-01T08:00:00.000Z');
    const { manager, fetchImpl } = setup({ now: () => new Date(nowMs) });
    fetchImpl.mockResolvedValue(jsonResponse(200, { access_token: 'at-x', expires_in: 3600 }));
    await manager.getAccessToken();
    nowMs += 3600_000; // past expiry (and the 60 s margin)
    await manager.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('invalid_grant clears the stored token, reports the disconnect and throws calendar_not_connected', async () => {
    const store = memoryStore('refresh-1');
    const onDisconnected = jest.fn();
    const { manager, fetchImpl } = setup({ store, onDisconnected });
    fetchImpl.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant', error_description: 'expired' }));

    await expect(manager.getAccessToken()).rejects.toMatchObject({ code: 'calendar_not_connected' });
    expect(store.tokens.has(UID)).toBe(false);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('throws calendar_not_connected without a stored refresh token', async () => {
    const { manager, fetchImpl } = setup({ store: memoryStore(null) });
    await expect(manager.getAccessToken()).rejects.toMatchObject({ code: 'calendar_not_connected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a 5xx from the token endpoint is a retryable upstream error and keeps the refresh token', async () => {
    const store = memoryStore('refresh-1');
    const { manager, fetchImpl } = setup({ store });
    fetchImpl.mockResolvedValueOnce(jsonResponse(503, {}));
    await expect(manager.getAccessToken()).rejects.toMatchObject({ code: 'upstream_error', retryable: true });
    expect(store.tokens.get(UID)).toBe('refresh-1');
  });

  it('a network failure surfaces as offline', async () => {
    const { manager, fetchImpl } = setup();
    fetchImpl.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(manager.getAccessToken()).rejects.toMatchObject({ code: 'offline' });
  });

  it('exchangeCode posts the PKCE authorization-code grant', async () => {
    const { manager, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1', refresh_token: 'refresh-9', expires_in: 900 }));
    const grant = await manager.exchangeCode('code-1', 'verifier-1', 'meetingguardai://auth/microsoft');
    expect(grant).toEqual({ accessToken: 'at-1', refreshToken: 'refresh-9', expiresIn: 900 });
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=code-1');
    expect(body).toContain('code_verifier=verifier-1');
    expect(body).toContain(encodeURIComponent('meetingguardai://auth/microsoft'));
  });

  it('adoptGrant requires a refresh token and hasRefreshToken reflects the store', async () => {
    const store = memoryStore(null);
    const { manager } = setup({ store });
    await expect(manager.hasRefreshToken()).resolves.toBe(false);
    await expect(manager.adoptGrant({ accessToken: 'at', refreshToken: null, expiresIn: 60 })).rejects.toMatchObject({
      code: 'calendar_not_connected',
    });
    await manager.adoptGrant({ accessToken: 'at', refreshToken: 'refresh-5', expiresIn: 3600 });
    await expect(manager.hasRefreshToken()).resolves.toBe(true);
    await expect(manager.getAccessToken()).resolves.toBe('at');

    await manager.clear();
    await expect(manager.hasRefreshToken()).resolves.toBe(false);
  });
});
