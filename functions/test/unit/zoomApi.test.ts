import { ZOOM_API_BASE, createZoomClient, type ZoomClient } from '../../src/zoom/api';
import { type ZoomCredentials, type ZoomTokenManager } from '../../src/zoom/token';

const CREDENTIALS: ZoomCredentials = {
  accountId: 'acct_1',
  clientId: 'client_1',
  clientSecret: 'secret_1',
};

interface RecordedCall {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
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

/** Token manager fake: hands out tok_1, then tok_2 after invalidate (and so on). */
function fakeTokens(): ZoomTokenManager & { minted: number; invalidations: number } {
  let cached: string | null = null;
  const manager = {
    minted: 0,
    invalidations: 0,
    async getToken(_credentials: ZoomCredentials) {
      if (cached === null) {
        manager.minted += 1;
        cached = `tok_${manager.minted}`;
      }
      return cached;
    },
    invalidate() {
      manager.invalidations += 1;
      cached = null;
    },
  };
  return manager;
}

function clientWith(script: Array<Response | Error>): {
  client: ZoomClient;
  calls: RecordedCall[];
  tokens: ReturnType<typeof fakeTokens>;
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchFn = (async (input: unknown, init?: unknown) => {
    calls.push({ url: String(input), init: (init ?? {}) as RecordedCall['init'] });
    const step = script[Math.min(index, script.length - 1)]!;
    index += 1;
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  const tokens = fakeTokens();
  return { client: createZoomClient({ credentials: CREDENTIALS, tokens, fetchFn }), calls, tokens };
}

const CREATED_BODY = {
  id: 987654321,
  join_url: 'https://zoom.us/j/987654321?pwd=abc',
  password: 'abc123',
};

describe('createZoomClient.createMeeting', () => {
  it('posts the scheduled meeting and parses id, join_url and passcode', async () => {
    const { client, calls } = clientWith([httpResponse(201, CREATED_BODY)]);

    const created = await client.createMeeting({
      topic: 'Weekly sync',
      startTimeUtc: '2026-10-05T14:00:00Z',
      durationMinutes: 45,
      timezone: 'Europe/Madrid',
    });

    expect(created).toEqual({
      zoomMeetingId: '987654321',
      joinUrl: 'https://zoom.us/j/987654321?pwd=abc',
      passcode: 'abc123',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${ZOOM_API_BASE}/users/me/meetings`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers?.Authorization).toBe('Bearer tok_1');
    expect(JSON.parse(calls[0]!.init.body ?? '{}')).toEqual({
      topic: 'Weekly sync',
      type: 2,
      start_time: '2026-10-05T14:00:00Z',
      duration: 45,
      timezone: 'Europe/Madrid',
    });
  });

  it('omits the timezone when the handler could not validate one', async () => {
    const { client, calls } = clientWith([httpResponse(201, CREATED_BODY)]);

    await client.createMeeting({ topic: 'T', startTimeUtc: '2026-10-05T14:00:00Z', durationMinutes: 30, timezone: null });

    expect(JSON.parse(calls[0]!.init.body ?? '{}')).not.toHaveProperty('timezone');
  });

  it('returns passcode null when Zoom sends no or an empty password', async () => {
    const { client } = clientWith([httpResponse(201, { id: '11', join_url: 'https://zoom.us/j/11' })]);

    const created = await client.createMeeting({
      topic: 'T',
      startTimeUtc: '2026-10-05T14:00:00Z',
      durationMinutes: 30,
      timezone: null,
    });

    expect(created.passcode).toBeNull();
    expect(created.zoomMeetingId).toBe('11');
  });

  it('retries ONCE with a fresh token on 401, then succeeds', async () => {
    const { client, calls, tokens } = clientWith([httpResponse(401), httpResponse(201, CREATED_BODY)]);

    const created = await client.createMeeting({
      topic: 'T',
      startTimeUtc: '2026-10-05T14:00:00Z',
      durationMinutes: 30,
      timezone: null,
    });

    expect(created.zoomMeetingId).toBe('987654321');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.headers?.Authorization).toBe('Bearer tok_2');
    expect(tokens.invalidations).toBe(1);
  });

  it('maps a second 401 to not_configured', async () => {
    const { client, calls } = clientWith([httpResponse(401)]);

    await expect(
      client.createMeeting({ topic: 'T', startTimeUtc: '2026-10-05T14:00:00Z', durationMinutes: 30, timezone: null }),
    ).rejects.toMatchObject({ name: 'ZoomApiError', reason: 'not_configured', status: 401 });
    expect(calls).toHaveLength(2);
  });

  it.each([
    [429, 'quota_exceeded'],
    [500, 'upstream_error'],
    [413, 'upstream_error'],
  ])('maps a %s to %s', async (status, reason) => {
    const { client } = clientWith([httpResponse(status)]);

    await expect(
      client.createMeeting({ topic: 'T', startTimeUtc: '2026-10-05T14:00:00Z', durationMinutes: 30, timezone: null }),
    ).rejects.toMatchObject({ name: 'ZoomApiError', reason, status });
  });

  it('maps a malformed create body to upstream_error', async () => {
    const { client } = clientWith([httpResponse(201, { id: 1 })]);

    await expect(
      client.createMeeting({ topic: 'T', startTimeUtc: '2026-10-05T14:00:00Z', durationMinutes: 30, timezone: null }),
    ).rejects.toMatchObject({ name: 'ZoomApiError', reason: 'upstream_error' });
  });

  it('maps a network failure to upstream_error with a null status', async () => {
    const { client } = clientWith([new Error('socket hang up')]);

    await expect(
      client.createMeeting({ topic: 'T', startTimeUtc: '2026-10-05T14:00:00Z', durationMinutes: 30, timezone: null }),
    ).rejects.toMatchObject({ name: 'ZoomApiError', reason: 'upstream_error', status: null });
  });
});

describe('createZoomClient.updateMeeting', () => {
  it('patches topic/start/duration/timezone', async () => {
    const { client, calls } = clientWith([httpResponse(204)]);

    const result = await client.updateMeeting('987654321', {
      topic: 'Moved sync',
      startTimeUtc: '2026-10-06T09:00:00Z',
      durationMinutes: 30,
      timezone: 'Europe/Madrid',
    });

    expect(result).toBe('updated');
    expect(calls[0]!.url).toBe(`${ZOOM_API_BASE}/meetings/987654321`);
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body ?? '{}')).toEqual({
      topic: 'Moved sync',
      start_time: '2026-10-06T09:00:00Z',
      duration: 30,
      timezone: 'Europe/Madrid',
    });
  });

  it('reports gone on a Zoom 404', async () => {
    const { client } = clientWith([httpResponse(404)]);

    await expect(
      client.updateMeeting('11', { topic: 'T', startTimeUtc: null, durationMinutes: 30, timezone: null }),
    ).resolves.toBe('gone');
  });
});

describe('createZoomClient.deleteMeeting', () => {
  it('deletes without the occurrence reminder and reports deleted', async () => {
    const { client, calls } = clientWith([httpResponse(204)]);

    await expect(client.deleteMeeting('987654321')).resolves.toBe('deleted');
    expect(calls[0]!.url).toBe(`${ZOOM_API_BASE}/meetings/987654321?schedule_for_reminder=false`);
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('reports gone on a Zoom 404 (already deleted)', async () => {
    const { client } = clientWith([httpResponse(404)]);

    await expect(client.deleteMeeting('11')).resolves.toBe('gone');
  });

  it('maps a 429 to quota_exceeded', async () => {
    const { client } = clientWith([httpResponse(429)]);

    await expect(client.deleteMeeting('11')).rejects.toMatchObject({ reason: 'quota_exceeded', status: 429 });
  });
});
