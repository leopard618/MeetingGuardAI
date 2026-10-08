import { AppError, isAppError } from '../../../core/errors';
import { createGoogleCalendarApi, googleHttpStatus, type GoogleTokenProvider } from '../google/api';

interface FakeResponseInit {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function response({ status, body, headers = {} }: FakeResponseInit): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : undefined),
  } as unknown as Response;
}

function googleError(status: number, reason: string): FakeResponseInit {
  return { status, body: { error: { code: status, message: reason, errors: [{ reason }] } } };
}

function setup(responses: (FakeResponseInit | Error)[]) {
  const queue = [...responses];
  const fetchImpl = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return response(next);
  });
  let tokenSeq = 0;
  const tokens: GoogleTokenProvider & { getToken: jest.Mock; invalidate: jest.Mock } = {
    getToken: jest.fn(async () => {
      tokenSeq += 1;
      return `token-${tokenSeq}`;
    }),
    invalidate: jest.fn(async () => undefined),
  };
  const sleep = jest.fn(async (_ms: number) => undefined);
  const api = createGoogleCalendarApi({ tokens, fetchImpl, sleep, random: () => 0 });
  const authHeader = (call: number): string | undefined =>
    (fetchImpl.mock.calls[call]?.[1]?.headers as Record<string, string> | undefined)?.Authorization;
  return { api, fetchImpl, tokens, sleep, authHeader };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('Google Calendar API client', () => {
  it('refreshes the token once after a 401 and retries', async () => {
    const { api, fetchImpl, tokens, authHeader } = setup([
      googleError(401, 'authError'),
      { status: 200, body: { id: 'e1', etag: '"1"' } },
    ]);
    await expect(api.getEvent('primary', 'e1')).resolves.toEqual({ id: 'e1', etag: '"1"' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(tokens.invalidate).toHaveBeenCalledWith('token-1');
    expect(authHeader(0)).toBe('Bearer token-1');
    expect(authHeader(1)).toBe('Bearer token-2');
  });

  it('gives up after a second 401 (no retry loop)', async () => {
    const { api, fetchImpl, tokens } = setup([googleError(401, 'authError'), googleError(401, 'authError')]);
    const error = await rejection(api.getEvent('primary', 'e1'));
    expect(error.code).toBe('unauthenticated');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
  });

  it('backs off on 429 and honours Retry-After', async () => {
    const { api, sleep } = setup([
      { ...googleError(429, 'rateLimitExceeded'), headers: { 'Retry-After': '3' } },
      { status: 200, body: { items: [], nextSyncToken: 't' } },
    ]);
    await expect(api.listEvents('primary', { syncToken: 's' })).resolves.toEqual({ items: [], nextSyncToken: 't' });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('retries 5xx with exponential backoff, then reports a retryable upstream error', async () => {
    const { api, sleep, fetchImpl } = setup([
      { status: 503 },
      { status: 500 },
      { status: 502 },
      { status: 503 },
    ]);
    const error = await rejection(api.getEvent('primary', 'e1'));
    expect(error.code).toBe('upstream_error');
    expect(error.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('retries 403 rate limits but not permission errors', async () => {
    const rateLimited = setup([googleError(403, 'userRateLimitExceeded'), { status: 200, body: { id: 'e1' } }]);
    await expect(rateLimited.api.getEvent('primary', 'e1')).resolves.toEqual({ id: 'e1' });

    const scope = setup([googleError(403, 'insufficientPermissions')]);
    expect((await rejection(scope.api.getEvent('primary', 'e1'))).code).toBe('calendar_scope_missing');
    expect(scope.fetchImpl).toHaveBeenCalledTimes(1);

    const forbidden = setup([googleError(403, 'forbiddenForNonOrganizer')]);
    expect((await rejection(forbidden.api.getEvent('primary', 'e1'))).code).toBe('permission_denied');
  });

  it('exposes the HTTP status (410 = sync token expired)', async () => {
    const { api } = setup([googleError(410, 'fullSyncRequired')]);
    const error = await rejection(api.listEvents('primary', { syncToken: 'old' }));
    expect(googleHttpStatus(error)).toBe(410);
    expect(error.details?.reason).toBe('fullSyncRequired');
  });

  it('maps network failures to offline', async () => {
    const { api } = setup([new TypeError('Network request failed')]);
    expect((await rejection(api.getEvent('primary', 'e1'))).code).toBe('offline');
  });

  it('builds list, patch and delete requests', async () => {
    const { api, fetchImpl } = setup([
      { status: 200, body: { items: [] } },
      { status: 200, body: { id: 'e1' } },
      { status: 204 },
    ]);
    await api.listEvents('primary', { syncToken: 'tok', timeMin: '2026-01-01T00:00:00.000Z', pageToken: 'p2' });
    const listUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(listUrl).toContain('/calendars/primary/events?');
    expect(listUrl).toContain('singleEvents=true');
    expect(listUrl).toContain('syncToken=tok');
    expect(listUrl).toContain('pageToken=p2');
    expect(listUrl).not.toContain('timeMin');

    await api.patchEvent('primary', 'e1', { summary: 'x' }, { sendUpdates: 'all', conferenceDataVersion: 1, ifMatch: '"7"' });
    const [patchUrl, patchInit] = fetchImpl.mock.calls[1] ?? [];
    expect(String(patchUrl)).toContain('/events/e1?sendUpdates=all&conferenceDataVersion=1');
    expect(patchInit?.method).toBe('PATCH');
    expect((patchInit?.headers as Record<string, string>)['If-Match']).toBe('"7"');
    expect(patchInit?.body).toBe(JSON.stringify({ summary: 'x' }));

    await expect(api.deleteEvent('primary', 'e1', { sendUpdates: 'none' })).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe('DELETE');
  });
});
