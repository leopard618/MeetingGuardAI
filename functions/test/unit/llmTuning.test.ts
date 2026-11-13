/**
 * assistant/llm.ts per-client tuning (docs/v2/M11-DESIGN.md section 2.1): summaryCommitments sets
 * its own timeouts and token cap; a client created without them keeps ASSISTANT_TUNING, so the
 * assistant is unchanged. The OpenAI SDK is replaced by a recorder: no network.
 */
const mockCreated: Record<string, unknown>[] = [];
const mockCalls: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];

jest.mock('openai', () => {
  class APIError extends Error {}
  class FakeOpenAI {
    static APIError = APIError;
    static APIConnectionTimeoutError = class extends APIError {};
    static APIUserAbortError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    static AuthenticationError = class extends APIError {};
    static PermissionDeniedError = class extends APIError {};
    static NotFoundError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static UnprocessableEntityError = class extends APIError {};
    chat = {
      completions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          mockCalls.push({ params, options });
          return {
            choices: [{ message: { content: null, refusal: null, tool_calls: [{ type: 'function', function: { name: 't', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 3, completion_tokens: 4 },
          };
        },
      },
    };
    constructor(options: Record<string, unknown>) {
      mockCreated.push(options);
    }
  }
  return { __esModule: true, default: FakeOpenAI };
});

import { ASSISTANT_TUNING, COMMITMENTS_TUNING } from '../../src/config';
import { createOpenAiClient, openAiClientTuningOf } from '../../src/assistant/llm';

const REQUEST = { messages: [{ role: 'user' as const, content: 'x' }], tools: [], toolChoice: 'required' as const, safetyIdentifier: 'id' };

beforeEach(() => {
  mockCreated.length = 0;
  mockCalls.length = 0;
});

describe('OpenAI client tuning', () => {
  it('without overrides is exactly the assistant tuning', async () => {
    expect(openAiClientTuningOf(undefined)).toEqual({
      requestTimeoutMs: ASSISTANT_TUNING.openAiRequestTimeoutMs,
      deadlineMs: ASSISTANT_TUNING.openAiDeadlineMs,
      maxRetries: ASSISTANT_TUNING.openAiMaxRetries,
      maxCompletionTokens: ASSISTANT_TUNING.maxCompletionTokens,
    });
    const result = await createOpenAiClient({ apiKey: 'test-key', model: 'gpt-test', reasoningEffort: 'low' }).complete(REQUEST);
    expect(mockCreated[0]).toMatchObject({ timeout: ASSISTANT_TUNING.openAiRequestTimeoutMs, maxRetries: ASSISTANT_TUNING.openAiMaxRetries });
    expect(mockCalls[0]?.params).toMatchObject({ model: 'gpt-test', max_completion_tokens: ASSISTANT_TUNING.maxCompletionTokens, reasoning_effort: 'low', store: false });
    expect(mockCalls[0]?.options.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({ toolCalls: [{ name: 't', arguments: '{}' }], finishReason: 'tool_calls', usage: { promptTokens: 3, completionTokens: 4 } });
  });

  it('takes the commitments overrides, and a partial override keeps the rest', async () => {
    await createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: null,
      tuning: {
        requestTimeoutMs: COMMITMENTS_TUNING.openAiRequestTimeoutMs,
        deadlineMs: COMMITMENTS_TUNING.openAiDeadlineMs,
        maxRetries: COMMITMENTS_TUNING.openAiMaxRetries,
        maxCompletionTokens: COMMITMENTS_TUNING.maxCompletionTokens,
      },
    }).complete(REQUEST);
    expect(mockCreated[0]).toMatchObject({ timeout: 65_000, maxRetries: 1 });
    expect(mockCalls[0]?.params.max_completion_tokens).toBe(6_000);
    expect(mockCalls[0]?.params).not.toHaveProperty('reasoning_effort');
    expect(openAiClientTuningOf({ maxCompletionTokens: 10 })).toEqual({ ...openAiClientTuningOf(undefined), maxCompletionTokens: 10 });
  });
});
