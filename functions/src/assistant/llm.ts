/**
 * OpenAI adapter (chat completions + function tools). The handler depends on the small `LlmClient`
 * interface so it can be tested without the network.
 */
import { createHash } from 'node:crypto';

import OpenAI from 'openai';

import { ASSISTANT_TUNING, type ReasoningEffortSetting } from '../config';
import { UpstreamError } from './errors';
import type { PromptMessage } from './prompt';
import type { ToolDefinition } from './tools';

export interface LlmRequest {
  messages: PromptMessage[];
  tools: readonly ToolDefinition[];
  toolChoice: 'auto' | 'required';
  /** Stable, non-reversible end-user id for OpenAI abuse monitoring. */
  safetyIdentifier: string;
}

export interface LlmToolCall {
  name: string;
  arguments: string;
}

export interface LlmResult {
  content: string | null;
  refusal: string | null;
  toolCalls: LlmToolCall[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResult>;
}

export function safetyIdentifierFor(uid: string): string {
  return createHash('sha256').update(`meetingguard:${uid}`).digest('hex').slice(0, 32);
}

/** Maps OpenAI SDK errors to `UpstreamError` (status + category, never the response body). */
export function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof OpenAI.APIUserAbortError) {
    return new UpstreamError('timeout', null, { cause: error });
  }
  if (error instanceof OpenAI.APIConnectionError) return new UpstreamError('connection', null, { cause: error });
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError || error instanceof OpenAI.NotFoundError) {
    return new UpstreamError('configuration', error.status, { cause: error });
  }
  if (error instanceof OpenAI.RateLimitError) {
    // A 429 with code insufficient_quota is the account's billing, not traffic: it needs an
    // operator, so it is a configuration error (error-level log), never a "try again".
    const code = (error as { code?: string | null }).code;
    return new UpstreamError(code === 'insufficient_quota' ? 'configuration' : 'rate_limited', error.status, { cause: error });
  }
  if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError) {
    return new UpstreamError('bad_request', error.status, { cause: error });
  }
  if (error instanceof OpenAI.APIError) {
    const status = typeof error.status === 'number' ? error.status : null;
    return new UpstreamError(status !== null && status >= 500 ? 'server' : 'unknown', status, { cause: error });
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new UpstreamError('timeout', null, { cause: error });
  }
  return new UpstreamError('unknown', null, { cause: error });
}

/**
 * M11 (docs/v2/M11-DESIGN.md section 2.1): per-client timeouts and token cap, so summaryCommitments
 * sets its own (COMMITMENTS_TUNING) while the assistant keeps ASSISTANT_TUNING. Every field is
 * optional and falls back to the assistant's value, so a client created without it is unchanged.
 */
export interface OpenAiClientTuning {
  requestTimeoutMs: number;
  deadlineMs: number;
  maxRetries: number;
  maxCompletionTokens: number;
}

/** The tuning a client runs with: the overrides given, else ASSISTANT_TUNING. */
export function openAiClientTuningOf(overrides: Partial<OpenAiClientTuning> | undefined): OpenAiClientTuning {
  return {
    requestTimeoutMs: overrides?.requestTimeoutMs ?? ASSISTANT_TUNING.openAiRequestTimeoutMs,
    deadlineMs: overrides?.deadlineMs ?? ASSISTANT_TUNING.openAiDeadlineMs,
    maxRetries: overrides?.maxRetries ?? ASSISTANT_TUNING.openAiMaxRetries,
    maxCompletionTokens: overrides?.maxCompletionTokens ?? ASSISTANT_TUNING.maxCompletionTokens,
  };
}

export function createOpenAiClient(options: {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffortSetting | null;
  /** M11: optional overrides; absent means ASSISTANT_TUNING (openAiClientTuningOf). */
  tuning?: Partial<OpenAiClientTuning>;
}): LlmClient {
  if (options.apiKey.trim().length === 0) {
    throw new UpstreamError('configuration', null);
  }
  const tuning = openAiClientTuningOf(options.tuning);
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: tuning.requestTimeoutMs,
    maxRetries: tuning.maxRetries,
  });
  return {
    async complete(request) {
      try {
        const completion = await client.chat.completions.create(
          {
            model: options.model,
            messages: request.messages,
            tools: request.tools.map((tool) => ({ type: 'function', function: { ...tool.function } })),
            tool_choice: request.toolChoice,
            max_completion_tokens: tuning.maxCompletionTokens,
            ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
            safety_identifier: request.safetyIdentifier,
            // Conversations contain personal data: do not keep them in the OpenAI dashboard.
            store: false,
          },
          { signal: AbortSignal.timeout(tuning.deadlineMs) },
        );
        const choice = completion.choices[0];
        if (!choice) throw new UpstreamError('unknown', null);
        const toolCalls: LlmToolCall[] = [];
        for (const call of choice.message.tool_calls ?? []) {
          if (call.type === 'function') toolCalls.push({ name: call.function.name, arguments: call.function.arguments });
        }
        return {
          content: choice.message.content,
          refusal: choice.message.refusal,
          toolCalls,
          finishReason: choice.finish_reason ?? null,
          usage: completion.usage
            ? { promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens }
            : null,
        };
      } catch (error) {
        throw toUpstreamError(error);
      }
    },
  };
}
