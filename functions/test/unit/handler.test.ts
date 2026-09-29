import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import { UpstreamError } from '../../src/assistant/errors';
import { handleAssistant, type AssistantDeps } from '../../src/assistant/handler';
import type { LlmClient, LlmRequest, LlmResult } from '../../src/assistant/llm';
import { assistantErrorDetailsSchema, assistantResponseSchema, type AssistantRequest } from '../../src/shared/aiContract';
import { FakeMeetingReader, FakeQuotaStore } from './fakes';

// Hoisted above the imports by ts-jest.
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const NOW = new Date('2026-09-28T14:15:00.000Z');
const DAY = '2026-09-28';
const PRIVATE_TEXT = 'Confidential merger with Acme';

function chatRequest(overrides: Partial<AssistantRequest> = {}): AssistantRequest {
  return {
    messages: [{ role: 'user', content: `Move my ${PRIVATE_TEXT} meeting to 11:00` }],
    language: 'en',
    timezone: 'Europe/Madrid',
    nowIso: NOW.toISOString(),
    mode: 'chat',
    followUpMeetingId: null,
    ...overrides,
  };
}

class ScriptedLlm implements LlmClient {
  requests: LlmRequest[] = [];
  constructor(private readonly result: LlmResult | Error) {}
  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function result(overrides: Partial<LlmResult> = {}): LlmResult {
  return { content: 'Done deal.', refusal: null, toolCalls: [], finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 }, ...overrides };
}

function setup(llmResult: LlmResult | Error = result()) {
  const quota = new FakeQuotaStore();
  const meetings = new FakeMeetingReader()
    .add('merger', { title: PRIVATE_TEXT, startAt: '2026-09-29T08:00:00.000Z' })
    .add('ended', { title: 'Retro', startAt: '2026-09-28T12:00:00.000Z', description: 'Sprint 12 retro' });
  const llm = new ScriptedLlm(llmResult);
  const llmFactory = jest.fn(() => llm);
  const deps: AssistantDeps = { quota, meetings, llm: llmFactory, now: () => NOW, nonce: () => 'nonce1', newActionId: () => 'act_fixed' };
  return { quota, meetings, llm, llmFactory, deps };
}

async function expectAssistantError(promise: Promise<unknown>, code: string, reason: string) {
  const error = await promise.then(
    () => {
      throw new Error('expected an error');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpsError);
  const httpsError = error as HttpsError;
  expect(httpsError.code).toBe(code);
  const details = assistantErrorDetailsSchema.parse(httpsError.details);
  expect(details.reason).toBe(reason);
  return details;
}

function refOf(llm: ScriptedLlm, title: string): string {
  const block = llm.requests[0]!.messages[1]!.content.split('\n')[1]!;
  const payload = JSON.parse(block) as { meetings: { ref: string; title: string }[] };
  const meeting = payload.meetings.find((item) => item.title === title);
  if (!meeting) throw new Error('meeting not in context');
  return meeting.ref;
}

describe('handleAssistant', () => {
  it('requires authentication', async () => {
    const { deps, quota } = setup();
    await expectAssistantError(handleAssistant(null, chatRequest(), deps), 'unauthenticated', 'unauthenticated');
    expect(quota.transactions).toBe(0);
  });

  it('rejects invalid requests before counting quota', async () => {
    const { deps, quota } = setup();
    await expectAssistantError(handleAssistant('u1', { messages: [] }, deps), 'invalid-argument', 'invalid_request');
    await expectAssistantError(handleAssistant('u1', chatRequest({ timezone: 'Mars/Base' }), deps), 'invalid-argument', 'invalid_request');
    expect(quota.transactions).toBe(0);
  });

  it('enforces the daily quota without calling the model', async () => {
    const { deps, quota, llmFactory } = setup();
    quota.usage.set(`u1/${DAY}`, { count: 5, updatedAt: 'x' });
    const details = await expectAssistantError(handleAssistant('u1', chatRequest(), deps), 'resource-exhausted', 'quota_exceeded');
    expect(details.usage).toEqual({ used: 5, limit: 5, plan: 'free', resetsAt: '2026-09-29T00:00:00.000Z' });
    expect(llmFactory).not.toHaveBeenCalled();
  });

  it('returns a validated reply with proposals and usage', async () => {
    const { deps, llm, quota } = setup();
    const first = await handleAssistant('u1', chatRequest(), deps);
    expect(first).toEqual({
      reply: 'Done deal.',
      actions: [],
      suggestions: [],
      usage: { used: 1, limit: 5, plan: 'free', resetsAt: '2026-09-29T00:00:00.000Z' },
    });
    const request = llm.requests[0]!;
    expect(request.toolChoice).toBe('auto');
    expect(request.tools.length).toBe(7);
    expect(request.safetyIdentifier).toMatch(/^[0-9a-f]{32}$/);
    expect(request.messages[0]!.role).toBe('developer');
    expect(request.messages[0]!.content).not.toContain(PRIVATE_TEXT);
    expect(request.messages[1]!.content).toContain(PRIVATE_TEXT);
    expect(request.messages[2]).toEqual({ role: 'user', content: chatRequest().messages[0]!.content });

    const ref = refOf(llm, PRIVATE_TEXT);
    const withTools = setup(
      result({
        content: '',
        toolCalls: [
          {
            name: 'update_meeting',
            arguments: JSON.stringify({
              meeting_ref: ref,
              changes: {
                title: null,
                description: null,
                date: null,
                time: '11:00',
                all_day: null,
                timezone: null,
                duration_minutes: null,
                location: null,
                clear_location: false,
                conference: null,
                clear_conference: false,
                participants: null,
                preparation_tips: null,
                alert_minutes_before: null,
                reset_alert_times: false,
              },
              summary: 'Move to 11:00',
              confidence: 90,
            }),
          },
          { name: 'suggest_replies', arguments: JSON.stringify({ suggestions: ['Notify attendees'] }) },
        ],
      }),
    );
    withTools.quota.usage.set(`u1/${DAY}`, { count: 2, updatedAt: 'x' });
    const response = await handleAssistant('u1', chatRequest(), withTools.deps);
    expect(assistantResponseSchema.safeParse(response).success).toBe(true);
    expect(response.reply).toBe('I prepared the following for you. Please review and confirm.');
    expect(response.actions).toEqual([
      {
        type: 'update_meeting',
        id: 'act_fixed',
        summary: 'Move to 11:00',
        confidence: 90,
        meetingId: 'merger',
        changes: { startAt: '2026-09-29T11:00:00+02:00' },
      },
    ]);
    expect(response.suggestions).toEqual(['Notify attendees']);
    expect(response.usage.used).toBe(3);
    expect(quota.count('u1', DAY)).toBe(1);
  });

  it('runs follow-up mode with required tools and a localized fallback reply', async () => {
    const { deps, llm } = setup(
      result({ content: null, toolCalls: [{ name: 'suggest_replies', arguments: '{"suggestions":["Enviar un resumen"]}' }] }),
    );
    const response = await handleAssistant(
      'u1',
      chatRequest({ mode: 'followup', followUpMeetingId: 'ended', messages: [], language: 'es' }),
      deps,
    );
    expect(response.reply).toBe('Tu reunión terminó. Aquí tienes algunas ideas para darle seguimiento.');
    expect(response.suggestions).toEqual(['Enviar un resumen']);
    expect(llm.requests[0]!.toolChoice).toBe('required');
    expect(llm.requests[0]!.messages[0]!.content).toContain('# Follow-up mode');
    expect(llm.requests[0]!.messages[1]!.content).toContain('Sprint 12 retro');
  });

  it('refunds the quota when the follow-up meeting does not exist', async () => {
    const { deps, quota, llmFactory } = setup();
    await expectAssistantError(
      handleAssistant('u1', chatRequest({ mode: 'followup', followUpMeetingId: 'nope', messages: [] }), deps),
      'invalid-argument',
      'invalid_request',
    );
    expect(llmFactory).not.toHaveBeenCalled();
    expect(quota.count('u1', DAY)).toBe(0);
  });

  it('maps upstream failures to upstream_error and refunds the quota', async () => {
    const { deps, quota } = setup(new UpstreamError('rate_limited', 429));
    await expectAssistantError(handleAssistant('u1', chatRequest(), deps), 'unavailable', 'upstream_error');
    expect(quota.count('u1', DAY)).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('assistant.upstream_failed', { uid: 'u1', kind: 'rate_limited', status: 429 });

    const config = setup(new UpstreamError('configuration', 401));
    await expectAssistantError(handleAssistant('u1', chatRequest(), config.deps), 'unavailable', 'upstream_error');
    expect(logger.error).toHaveBeenCalledWith('assistant.upstream_failed', { uid: 'u1', kind: 'configuration', status: 401 });

    const unexpected = setup(new TypeError('boom'));
    await expectAssistantError(handleAssistant('u1', chatRequest(), unexpected.deps), 'unavailable', 'upstream_error');
    expect(unexpected.quota.count('u1', DAY)).toBe(0);
  });

  it('reports quota storage failures as upstream errors', async () => {
    const { deps, quota } = setup();
    quota.failNext = new Error('firestore down');
    await expectAssistantError(handleAssistant('u1', chatRequest(), deps), 'unavailable', 'upstream_error');
  });

  it('uses the refusal text and truncates oversized replies', async () => {
    const refusal = setup(result({ content: null, refusal: 'I cannot help with that.' }));
    expect((await handleAssistant('u1', chatRequest(), refusal.deps)).reply).toBe('I cannot help with that.');
    const long = setup(result({ content: 'y'.repeat(9000) }));
    expect((await handleAssistant('u1', chatRequest(), long.deps)).reply).toHaveLength(8000);
  });

  it('never logs message content or meeting titles', async () => {
    const { deps } = setup();
    await handleAssistant('u1', chatRequest(), deps);
    const logged = JSON.stringify([
      (logger.info as jest.Mock).mock.calls,
      (logger.warn as jest.Mock).mock.calls,
      (logger.error as jest.Mock).mock.calls,
    ]);
    expect(logged).toContain('assistant.completed');
    expect(logged).not.toContain(PRIVATE_TEXT);
    expect(logged).not.toContain('11:00');
  });
});
