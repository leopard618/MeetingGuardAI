/**
 * A5: model calls whose text arrives as it is written (spoken answers that start at once). The
 * matters module's own adapter, beside the shared one (assistant/llm.ts, left unchanged): the same
 * request shape, the same settings (no storage at OpenAI, the safety identifier, the tuning and
 * the error mapping), with stream: true. onText gets the reply's text as it grows; onToolArgs the
 * arguments of a tool call as they grow (matterAsk's answer is inside them, see AnswerExtractor).
 */
import OpenAI from 'openai';

import type { ReasoningEffortSetting } from '../config';
import { UpstreamError } from '../assistant/errors';
import { openAiClientTuningOf, toUpstreamError, type LlmRequest, type LlmResult, type OpenAiClientTuning } from '../assistant/llm';

export interface StreamHandlers {
  onText?(delta: string): void;
  onToolArgs?(delta: string): void;
}

/** A request that may have no tools (a briefing is plain text). */
export type StreamRequest = Omit<LlmRequest, 'tools' | 'toolChoice'> & Partial<Pick<LlmRequest, 'tools' | 'toolChoice'>>;

export interface StreamLlm {
  stream(request: StreamRequest, handlers: StreamHandlers): Promise<LlmResult>;
}

export function createOpenAiStreamClient(options: {
  apiKey: () => Promise<string>;
  model: string;
  reasoningEffort: ReasoningEffortSetting | null;
  tuning?: Partial<OpenAiClientTuning>;
}): StreamLlm {
  const tuning = openAiClientTuningOf(options.tuning);
  return {
    async stream(request, handlers) {
      try {
        const apiKey = await options.apiKey();
        if (!apiKey.trim()) throw new UpstreamError('configuration', null);
        const client = new OpenAI({ apiKey, timeout: tuning.requestTimeoutMs, maxRetries: 0 });
        const tools = request.tools?.length ? request.tools.map((tool) => ({ type: 'function' as const, function: { ...tool.function } })) : undefined;
        const stream = await client.chat.completions.create(
          {
            model: options.model,
            messages: request.messages,
            ...(tools ? { tools, tool_choice: request.toolChoice ?? 'auto' } : {}),
            max_completion_tokens: tuning.maxCompletionTokens,
            ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
            safety_identifier: request.safetyIdentifier,
            // personal data: nothing kept in the OpenAI dashboard
            store: false,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: AbortSignal.timeout(tuning.deadlineMs) },
        );
        let content = '';
        let finishReason: string | null = null;
        let usage: LlmResult['usage'] = null;
        const calls = new Map<number, { name: string; arguments: string }>();
        for await (const chunk of stream) {
          if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens };
          const choice = chunk.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta;
          if (delta?.content) {
            content += delta.content;
            handlers.onText?.(delta.content);
          }
          for (const call of delta?.tool_calls ?? []) {
            const current = calls.get(call.index) ?? { name: '', arguments: '' };
            if (call.function?.name) current.name += call.function.name;
            if (call.function?.arguments) {
              current.arguments += call.function.arguments;
              handlers.onToolArgs?.(call.function.arguments);
            }
            calls.set(call.index, current);
          }
        }
        return { content: content || null, refusal: null, toolCalls: [...calls.values()], finishReason, usage };
      } catch (error) {
        throw toUpstreamError(error);
      }
    },
  };
}

/**
 * Reads one string field ("answer") out of a JSON object while its text is still arriving, so its
 * words can be spoken before the object is complete. feed() returns the newly decoded characters
 * of that field (escapes decoded; a split escape waits for its end).
 */
export class AnswerExtractor {
  private buffer = '';
  private start = -1;
  private pos = 0;
  private done = false;

  constructor(private readonly field = 'answer') {}

  feed(chunk: string): string {
    this.buffer += chunk;
    if (this.done) return '';
    if (this.start < 0) {
      const match = new RegExp(`"${this.field}"\\s*:\\s*"`).exec(this.buffer);
      if (!match) return '';
      this.start = match.index + match[0].length;
      this.pos = this.start;
    }
    let out = '';
    while (this.pos < this.buffer.length) {
      const ch = this.buffer[this.pos]!;
      if (ch === '"') {
        this.done = true;
        break;
      }
      if (ch !== '\\') {
        out += ch;
        this.pos += 1;
        continue;
      }
      const next = this.buffer[this.pos + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = this.buffer.slice(this.pos + 2, this.pos + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        this.pos += 6;
        continue;
      }
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '' : next === 'b' || next === 'f' ? '' : next;
      this.pos += 2;
    }
    return out;
  }
}
