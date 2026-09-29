import { ASSISTANT_CALL_TIMEOUT_MS, type AssistantRequest } from '../../../core/aiContract';
import { AppError, isAppError } from '../../../core/errors';
import { createAction, response, usage } from '../__fixtures__/aiTestKit';
import {
  createAssistantClient,
  mapAssistantError,
  parseAssistantResponse,
  quotaUsageFromError,
  type AssistantTransport,
} from '../assistantClient';

function request(overrides: Partial<AssistantRequest> = {}): AssistantRequest {
  return {
    messages: [{ role: 'user', content: 'Schedule a meeting tomorrow at 4pm' }],
    language: 'en',
    timezone: 'Europe/Madrid',
    nowIso: '2030-03-10T09:00:00.000Z',
    mode: 'chat',
    followUpMeetingId: null,
    ...overrides,
  };
}

/** Mimics the Firebase FunctionsError shape (code "functions/<status>", message, details). */
function functionsError(code: string, message: string, details?: unknown): Error {
  return Object.assign(new Error(message), { code: `functions/${code}`, details });
}

function transportReturning(result: unknown): AssistantTransport & { call: jest.Mock } {
  return { call: jest.fn(async () => result) };
}

function transportThrowing(error: unknown): AssistantTransport & { call: jest.Mock } {
  return {
    call: jest.fn(async () => {
      throw error;
    }),
  };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function captureError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('assistantClient.send', () => {
  it('sends the validated request with the contract timeout and returns the parsed response', async () => {
    const payload = response({ reply: 'Done', suggestions: ['Add a Meet link'] }, [createAction('act_1')]);
    const transport = transportReturning(payload);
    const client = createAssistantClient({ getTransport: () => transport });

    const result = await client.send(request());

    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(transport.call.mock.calls[0][1]).toEqual({ timeoutMs: ASSISTANT_CALL_TIMEOUT_MS });
    expect(result.reply).toBe('Done');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.type).toBe('create_meeting');
  });

  it('rejects an invalid request before calling the server', async () => {
    const transport = transportReturning(response());
    const client = createAssistantClient({ getTransport: () => transport });

    // chat mode must end with a user message
    const error = await captureError(client.send(request({ messages: [{ role: 'assistant', content: 'hi' }] })));

    expect(error.code).toBe('invalid_input');
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('accepts follow-up requests without messages', async () => {
    const transport = transportReturning(response());
    const client = createAssistantClient({ getTransport: () => transport });
    await client.send(request({ messages: [], mode: 'followup', followUpMeetingId: 'meeting_1' }));
    expect(transport.call).toHaveBeenCalledTimes(1);
  });

  it('fails with not_configured when Firebase is not set up', async () => {
    const client = createAssistantClient({ getTransport: () => null });
    expect((await captureError(client.send(request()))).code).toBe('not_configured');
  });

  it('fails fast with offline when the device is offline', async () => {
    const transport = transportReturning(response());
    const client = createAssistantClient({ getTransport: () => transport, connectivity: { isOffline: async () => true } });
    expect((await captureError(client.send(request()))).code).toBe('offline');
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('treats a response that breaks the contract as an upstream error', async () => {
    const bad = { ...response(), reply: 42 };
    const client = createAssistantClient({ getTransport: () => transportReturning(bad) });
    const error = await captureError(client.send(request()));
    expect(error.code).toBe('upstream_error');
    expect(error.details?.issues).toBeDefined();
  });

  it('drops an action kind this version does not know instead of failing the whole reply', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const future = { ...response({ reply: 'Done' }), actions: [{ type: 'teleport_meeting', id: 'x', summary: 's', confidence: 10 }] };
    const client = createAssistantClient({ getTransport: () => transportReturning(future) });
    const result = await client.send(request());
    expect(result.reply).toBe('Done');
    expect(result.actions).toEqual([]);
    warn.mockRestore();
  });

  it('rejects a response without usage', async () => {
    const { usage: _omitted, ...withoutUsage } = response();
    const client = createAssistantClient({ getTransport: () => transportReturning(withoutUsage) });
    expect((await captureError(client.send(request()))).code).toBe('upstream_error');
  });

  it('maps quota errors and exposes the usage from HttpsError.details', async () => {
    const quota = usage({ used: 5, limit: 5 });
    const client = createAssistantClient({
      getTransport: () => transportThrowing(functionsError('resource-exhausted', 'Daily limit', { reason: 'quota_exceeded', usage: quota })),
    });
    const error = await captureError(client.send(request()));
    expect(error.code).toBe('quota_exceeded');
    expect(quotaUsageFromError(error)).toEqual(quota);
  });

  it('classifies a failure as offline when the probe reports offline after the call', async () => {
    let offline = false;
    const transport: AssistantTransport = {
      call: async () => {
        offline = true;
        throw functionsError('internal', 'internal [500]');
      },
    };
    const client = createAssistantClient({ getTransport: () => transport, connectivity: { isOffline: async () => offline } });
    expect((await captureError(client.send(request()))).code).toBe('offline');
  });
});

describe('mapAssistantError', () => {
  it.each([
    [functionsError('unauthenticated', 'no auth', { reason: 'unauthenticated', usage: null }), 'unauthenticated'],
    [functionsError('invalid-argument', 'bad', { reason: 'invalid_request', usage: null }), 'invalid_input'],
    [functionsError('unavailable', 'openai down', { reason: 'upstream_error', usage: null }), 'upstream_error'],
    [functionsError('resource-exhausted', 'quota'), 'quota_exceeded'],
    [functionsError('unauthenticated', 'no auth'), 'unauthenticated'],
    [functionsError('permission-denied', 'denied'), 'unauthenticated'],
    [functionsError('invalid-argument', 'bad'), 'invalid_input'],
    [functionsError('deadline-exceeded', 'deadline-exceeded'), 'timeout'],
    [functionsError('internal', 'internal [0]'), 'offline'],
    [functionsError('internal', 'internal [500]'), 'upstream_error'],
    [functionsError('not-found', 'no such function [404]'), 'upstream_error'],
    [new TypeError('Network request failed'), 'offline'],
    [new Error('boom'), 'upstream_error'],
  ])('maps %p to %s', (error, code) => {
    expect(mapAssistantError(error).code).toBe(code);
  });

  it('prefers details.reason over the HTTP status', () => {
    const error = functionsError('internal', 'internal [500]', { reason: 'quota_exceeded', usage: null });
    expect(mapAssistantError(error).code).toBe('quota_exceeded');
  });

  it('keeps AppErrors unchanged and never puts message text in the AppError message', () => {
    const original = new AppError('timeout');
    expect(mapAssistantError(original)).toBe(original);
    const mapped = mapAssistantError(functionsError('internal', 'user text leaked? [500]'));
    expect(mapped.message).not.toContain('user text');
    expect(mapped.cause).toBeDefined();
  });

  it('returns null usage for non-quota errors', () => {
    expect(quotaUsageFromError(new AppError('offline'))).toBeNull();
    expect(quotaUsageFromError(null)).toBeNull();
  });
});

describe('parseAssistantResponse', () => {
  it('accepts an empty action list ("no action")', () => {
    expect(parseAssistantResponse(response()).actions).toEqual([]);
  });

  it('drops an invalid action (email share without recipients) and keeps the valid ones', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mixed = response({ reply: 'Here you go' }, [
      {
        type: 'share_meeting',
        id: 'a1',
        summary: 's',
        confidence: 80,
        meetingId: 'm1',
        recipients: [],
        channel: 'email',
        message: null,
      },
      createAction('act_2'),
    ]);
    const parsed = parseAssistantResponse(mixed);
    expect(parsed.reply).toBe('Here you go');
    expect(parsed.actions.map((action) => action.id)).toEqual(['act_2']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps working when a newer server sends an action kind this version does not know', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const future: unknown = {
      ...response({ reply: 'Done' }),
      actions: [
        { type: 'set_recurrence', id: 'a9', summary: 'Every Monday', confidence: 90, meetingId: 'm1', rrule: 'FREQ=WEEKLY' },
        createAction('act_1'),
      ],
    };
    const parsed = parseAssistantResponse(future);
    expect(parsed.actions.map((action) => action.type)).toEqual(['create_meeting']);
    expect(String(warn.mock.calls[0]?.slice(1))).toContain('set_recurrence');
    warn.mockRestore();
  });

  it('still rejects a broken envelope', () => {
    expect(() => parseAssistantResponse({ reply: 42, actions: [], suggestions: [], usage: null })).toThrow(AppError);
    expect(() => parseAssistantResponse({ ...response(), actions: 'nope' })).toThrow(AppError);
  });
});
