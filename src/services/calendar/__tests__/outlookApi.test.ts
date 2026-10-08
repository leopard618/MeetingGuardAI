import { createOutlookGraphApi, graphHttpStatus, type GraphTokenProvider } from '../outlook/api';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function setup(options: { tokens?: GraphTokenProvider } = {}) {
  const fetchImpl = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
  const sleep = jest.fn(async () => undefined);
  const tokens: GraphTokenProvider = options.tokens ?? {
    getToken: jest.fn(async () => 'token-1'),
    invalidate: jest.fn(async () => undefined),
  };
  const api = createOutlookGraphApi({
    tokens,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    random: () => 0,
    maxRetries: 3,
  });
  return { api, fetchImpl, sleep, tokens };
}

describe('createOutlookGraphApi', () => {
  it('sends the bearer token, the Prefer header and the $select field list', async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/d1' }));

    const page = await api.startDelta('2026-09-01T00:00:00.000Z', '2027-03-30T00:00:00.000Z');
    expect(page['@odata.deltaLink']).toBe('https://graph.microsoft.com/v1.0/d1');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/me/calendarView/delta?startDateTime=2026-09-01');
    expect(String(url)).toContain('$select=');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers.Prefer).toContain('outlook.timezone="UTC"');
    expect(headers.Prefer).toContain('outlook.body-content-type="text"');
  });

  it('on 401 invalidates the token, refreshes once and retries', async () => {
    const getToken = jest.fn(async () => 'token-1');
    const invalidate = jest.fn(async () => {
      getToken.mockResolvedValue('token-2');
    });
    const { api, fetchImpl } = setup({ tokens: { getToken, invalidate } });
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'InvalidAuthenticationToken' } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'ev1' }));

    await expect(api.getEvent('ev1')).resolves.toMatchObject({ id: 'ev1' });
    expect(invalidate).toHaveBeenCalledWith('token-1');
    const secondHeaders = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders.Authorization).toBe('Bearer token-2');
  });

  it('a second 401 surfaces as unauthenticated (no refresh loop)', async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(401, { error: { code: 'InvalidAuthenticationToken' } }));
    await expect(api.getEvent('ev1')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const { api, fetchImpl, sleep } = setup();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(429, { error: { code: 'TooManyRequests' } }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'ev1' }));

    await expect(api.getEvent('ev1')).resolves.toMatchObject({ id: 'ev1' });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('gives up after maxRetries and keeps the status in details', async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(503, { error: { code: 'ServiceUnavailable' } }));
    await expect(api.getEvent('ev1')).rejects.toMatchObject({ code: 'upstream_error', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it('maps 410 to not_found with status 410 (delta resync trigger)', async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(410, { error: { code: 'syncStateNotFound' } }));
    const error = await api.getDeltaPage('https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=x').catch((e: unknown) => e);
    expect(graphHttpStatus(error)).toBe(410);
  });

  it('refuses delta links outside the Graph origin', async () => {
    const { api, fetchImpl } = setup();
    await expect(api.getDeltaPage('https://evil.example.com/steal-token')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('network failures surface as offline', async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockRejectedValue(new TypeError('Network request failed'));
    await expect(api.getEvent('ev1')).rejects.toMatchObject({ code: 'offline' });
  });

  it('DELETE tolerates the empty 204 body', async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse(204, ''));
    await expect(api.deleteEvent('ev1')).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('POST /me/events carries the JSON body', async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { id: 'ev-new', changeKey: 'ck1' }));
    await api.createEvent({ subject: 'Standup', transactionId: 'mgev-m1' });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ subject: 'Standup', transactionId: 'mgev-m1' });
  });
});
