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
  if (error instanceof OpenAI.RateLimitError) return new UpstreamError('rate_limited', error.status, { cause: error });
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

export function createOpenAiClient(options: {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffortSetting | null;
}): LlmClient {
  if (options.apiKey.trim().length === 0) {
    throw new UpstreamError('configuration', null);
  }
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: ASSISTANT_TUNING.openAiRequestTimeoutMs,
    maxRetries: ASSISTANT_TUNING.openAiMaxRetries,
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
            max_completion_tokens: ASSISTANT_TUNING.maxCompletionTokens,
            ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
            safety_identifier: request.safetyIdentifier,
            // Conversations contain personal data: do not keep them in the OpenAI dashboard.
            store: false,
          },
          { signal: AbortSignal.timeout(ASSISTANT_TUNING.openAiDeadlineMs) },
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
