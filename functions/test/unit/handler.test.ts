import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import { UpstreamError } from '../../src/assistant/errors';
import { handleAssistant, type AssistantCaller, type AssistantDeps } from '../../src/assistant/handler';
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

function caller(overrides: Partial<AssistantCaller> = {}): AssistantCaller {
  return { uid: 'u1', emailVerified: true, signInProvider: 'google.com', ...overrides };
}
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
    await expectAssistantError(handleAssistant(caller(), { messages: [] }, deps), 'invalid-argument', 'invalid_request');
    await expectAssistantError(handleAssistant(caller(), chatRequest({ timezone: 'Mars/Base' }), deps), 'invalid-argument', 'invalid_request');
    expect(quota.transactions).toBe(0);
  });

  it('enforces the daily quota without calling the model', async () => {
    const { deps, quota, llmFactory } = setup();
    quota.usage.set(`u1/${DAY}`, { count: 5, updatedAt: 'x' });
    const details = await expectAssistantError(handleAssistant(caller(), chatRequest(), deps), 'resource-exhausted', 'quota_exceeded');
    expect(details.usage).toEqual({ used: 5, limit: 5, plan: 'free', resetsAt: '2026-09-29T00:00:00.000Z' });
    expect(llmFactory).not.toHaveBeenCalled();
  });

  it('returns a validated reply with proposals and usage', async () => {
    const { deps, llm, quota } = setup();
    const first = await handleAssistant(caller(), chatRequest(), deps);
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
    const response = await handleAssistant(caller(), chatRequest(), withTools.deps);
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
      caller(),
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
      handleAssistant(caller(), chatRequest({ mode: 'followup', followUpMeetingId: 'nope', messages: [] }), deps),
      'invalid-argument',
      'invalid_request',
    );
    expect(llmFactory).not.toHaveBeenCalled();
    expect(quota.count('u1', DAY)).toBe(0);
  });

  it('maps upstream failures to upstream_error and refunds the quota', async () => {
    const { deps, quota } = setup(new UpstreamError('rate_limited', 429));
    await expectAssistantError(handleAssistant(caller(), chatRequest(), deps), 'unavailable', 'upstream_error');
    expect(quota.count('u1', DAY)).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('assistant.upstream_failed', { uid: 'u1', kind: 'rate_limited', status: 429 });

    const config = setup(new UpstreamError('configuration', 401));
    await expectAssistantError(handleAssistant(caller(), chatRequest(), config.deps), 'unavailable', 'upstream_error');
    expect(logger.error).toHaveBeenCalledWith('assistant.upstream_failed', { uid: 'u1', kind: 'configuration', status: 401 });

    // Failures after OpenAI started working are not refunded (they are billed).
    const unexpected = setup(new TypeError('boom'));
    await expectAssistantError(handleAssistant(caller(), chatRequest(), unexpected.deps), 'unavailable', 'upstream_error');
    expect(unexpected.quota.count('u1', DAY)).toBe(1);
  });

  it('never refunds requests OpenAI already worked on (timeouts, bad requests)', async () => {
    for (const kind of ['timeout', 'bad_request', 'unknown'] as const) {
      const { deps, quota } = setup(new UpstreamError(kind, kind === 'bad_request' ? 400 : null));
      await expectAssistantError(handleAssistant(caller(), chatRequest(), deps), 'unavailable', 'upstream_error');
      expect(quota.count('u1', DAY)).toBe(1);
    }
    for (const kind of ['connection', 'server'] as const) {
      const { deps, quota } = setup(new UpstreamError(kind, kind === 'server' ? 503 : null));
      await expectAssistantError(handleAssistant(caller(), chatRequest(), deps), 'unavailable', 'upstream_error');
      expect(quota.count('u1', DAY)).toBe(0);
    }
  });

  it('requires a verified account (email verified or a trusted provider) before counting quota', async () => {
    const { deps, quota, llmFactory } = setup();
    await expectAssistantError(
      handleAssistant(caller({ emailVerified: false, signInProvider: 'password' }), chatRequest(), deps),
      'unauthenticated',
      'unauthenticated',
    );
    await expectAssistantError(
      handleAssistant(caller({ emailVerified: false, signInProvider: null }), chatRequest(), deps),
      'unauthenticated',
      'unauthenticated',
    );
    expect(quota.transactions).toBe(0);
    expect(llmFactory).not.toHaveBeenCalled();
    await expect(handleAssistant(caller({ emailVerified: true, signInProvider: 'password' }), chatRequest(), deps)).resolves.toMatchObject({
      reply: 'Done deal.',
    });
  });

  it('accepts Apple and Google callers even while email_verified is false (private-relay edge)', async () => {
    // Apple "Hide My Email" relay addresses can surface with email_verified false; the provider
    // itself vouches for the account (TRUSTED_SIGN_IN_PROVIDERS in shared/aiContract.ts).
    const apple = setup();
    await expect(
      handleAssistant(caller({ emailVerified: false, signInProvider: 'apple.com' }), chatRequest(), apple.deps),
    ).resolves.toMatchObject({ reply: 'Done deal.' });
    const google = setup();
    await expect(
      handleAssistant(caller({ emailVerified: false, signInProvider: 'google.com' }), chatRequest(), google.deps),
    ).resolves.toMatchObject({ reply: 'Done deal.' });
  });

  it('stops at the project-wide daily cap without calling OpenAI and gives the request back', async () => {
    const { deps, quota, llmFactory } = setup();
    const budget = { tryAcquire: jest.fn(async () => false) };
    await expectAssistantError(handleAssistant(caller(), chatRequest(), { ...deps, globalBudget: budget }), 'unavailable', 'upstream_error');
    expect(budget.tryAcquire).toHaveBeenCalledWith(DAY);
    expect(llmFactory).not.toHaveBeenCalled();
    expect(quota.count('u1', DAY)).toBe(0);
  });

  it('reports quota storage failures as upstream errors', async () => {
    const { deps, quota } = setup();
    quota.failNext = new Error('firestore down');
    await expectAssistantError(handleAssistant(caller(), chatRequest(), deps), 'unavailable', 'upstream_error');
  });

  it('uses the refusal text and truncates oversized replies', async () => {
    const refusal = setup(result({ content: null, refusal: 'I cannot help with that.' }));
    expect((await handleAssistant(caller(), chatRequest(), refusal.deps)).reply).toBe('I cannot help with that.');
    const long = setup(result({ content: 'y'.repeat(9000) }));
    expect((await handleAssistant(caller(), chatRequest(), long.deps)).reply).toHaveLength(8000);
  });

  it('never logs message content or meeting titles', async () => {
    const { deps } = setup();
    await handleAssistant(caller(), chatRequest(), deps);
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

describe('pending-proposal resolution (v4)', () => {
  const PENDING = [{ type: 'create_meeting' as const, summary: 'Schedule "Kickoff" tomorrow at 4 PM.' }];

  it('offers resolve_pending only when the request carries pending proposals', async () => {
    const plain = setup();
    await handleAssistant(caller(), chatRequest(), plain.deps);
    expect(plain.llm.requests[0]!.tools.map((tool) => tool.function.name)).not.toContain('resolve_pending');

    const withPending = setup();
    await handleAssistant(caller(), chatRequest({ pendingActions: PENDING }), withPending.deps);
    const request = withPending.llm.requests[0]!;
    expect(request.tools.map((tool) => tool.function.name)).toContain('resolve_pending');
    expect(request.messages[0]!.content).toContain('# Pending proposals');
    expect(request.messages[1]!.content).toContain('pendingProposals');
  });

  it('returns the resolution when the model resolves and proposes nothing', async () => {
    const { deps } = setup(
      result({ content: '', toolCalls: [{ name: 'resolve_pending', arguments: '{"decision":"confirm"}' }] }),
    );
    const response = await handleAssistant(caller(), chatRequest({ pendingActions: PENDING, messages: [{ role: 'user', content: 'Yes, I confirm.' }] }), deps);
    expect(response.resolution).toBe('confirm');
    expect(response.actions).toEqual([]);
    expect(response.reply).toBe('Got it, confirming it now.');
    expect(assistantResponseSchema.parse(response).resolution).toBe('confirm');
  });

  it('returns reject with its own fallback reply', async () => {
    const { deps } = setup(
      result({ content: '', toolCalls: [{ name: 'resolve_pending', arguments: '{"decision":"reject"}' }] }),
    );
    const response = await handleAssistant(caller(), chatRequest({ pendingActions: PENDING, messages: [{ role: 'user', content: 'no' }] }), deps);
    expect(response.resolution).toBe('reject');
    expect(response.reply).toBe('Okay, I dismissed it. Nothing was changed.');
  });

  it('drops the resolution when the model also proposes actions', async () => {
    const { deps } = setup(
      result({
        content: 'Changing it instead.',
        toolCalls: [
          { name: 'resolve_pending', arguments: '{"decision":"confirm"}' },
          {
            name: 'create_meeting',
            arguments: JSON.stringify({
              title: 'Kickoff', description: '', date: '2026-09-29', time: '17:00', all_day: false,
              duration_minutes: null, timezone: null, location: null, conference: null,
              participants: [], preparation_tips: [], alert_minutes_before: null, recurrence: null,
              summary: 'Schedule "Kickoff" tomorrow at 5 PM.', confidence: 90,
            }),
          },
        ],
      }),
    );
    const response = await handleAssistant(caller(), chatRequest({ pendingActions: PENDING }), deps);
    expect(response.resolution).toBeUndefined();
    expect(response.actions).toHaveLength(1);
  });

  // "An unclear reply never executes anything": the model may still answer "yes but make it
  // earlier" with resolve_pending(confirm). The server honours a resolution only for plain words.
  it('blocks the resolution when the user qualified the answer, keeping the cards on screen', async () => {
    for (const content of ['yes but make it earlier', 'Move my meeting to 11:00', 'sí pero más tarde']) {
      const { deps } = setup(
        result({ content: 'Confirming.', toolCalls: [{ name: 'resolve_pending', arguments: '{"decision":"confirm"}' }] }),
      );
      const response = await handleAssistant(caller(), chatRequest({ pendingActions: PENDING, messages: [{ role: 'user', content }] }), deps);
      expect(response.resolution).toBeUndefined();
      expect(response.actions).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith('assistant.completed', expect.objectContaining({ resolutionBlocked: true }));
    }
  });

  it('never returns a resolution to a request without pending proposals', async () => {
    const { deps } = setup(
      result({ content: 'ok', toolCalls: [{ name: 'resolve_pending', arguments: '{"decision":"confirm"}' }] }),
    );
    const response = await handleAssistant(caller(), chatRequest(), deps);
    expect(response.resolution).toBeUndefined();
  });
});

describe('dropped-proposal fallback', () => {
  it('asks for the missing detail when every proposal was dropped (timed meeting without a time)', async () => {
    const { deps } = setup(
      result({
        content: '',
        toolCalls: [
          {
            name: 'create_meeting',
            arguments: JSON.stringify({
              title: 'Meeting with Isaias', description: '', date: '2026-09-29', time: null, all_day: false,
              duration_minutes: null, timezone: null, location: null, conference: null,
              participants: [], preparation_tips: [], alert_minutes_before: null, recurrence: null,
              summary: 'Schedule a meeting with Isaias tomorrow.', confidence: 80,
            }),
          },
        ],
      }),
    );
    const response = await handleAssistant(caller(), chatRequest(), deps);
    expect(response.actions).toEqual([]);
    expect(response.reply).toContain('date or start time is missing');
  });

  it('keeps the plain empty fallback when the model proposed nothing at all', async () => {
    const { deps } = setup(result({ content: '', toolCalls: [] }));
    const response = await handleAssistant(caller(), chatRequest(), deps);
    expect(response.reply).toContain("couldn't come up with an answer");
  });

  // An agenda answer is read-only. Captioning it "review and confirm" tells the user to confirm
  // something that does not exist, and it is what a voice-only user HEARS.
  describe('read-only answers are composed from the rows, never captioned as a proposal', () => {
    // A minimal task reader: these tests only need the tasks context to EXIST.
    const reads = {
      listRecent: async () => [
        {
          id: 'taskonly1',
          doc: {
            title: 'Prepare the proposal',
            description: '',
            dueDate: '2026-09-29',
            dueTime: '16:00',
            timezone: 'Europe/Madrid',
            reminderMinutesBefore: null,
            status: 'open',
            meetingId: null,
            people: [],
            completedAt: null,
            updatedAt: '2026-09-28T10:00:00.000Z',
          },
        },
      ],
    };

    function listCall(refs: string[]) {
      return {
        name: 'list_meetings',
        arguments: JSON.stringify({ meeting_refs: refs, summary: 'Your meetings.', confidence: 90 }),
      };
    }
    function listTasksCall(refs: string[]) {
      return {
        name: 'list_tasks',
        arguments: JSON.stringify({ task_refs: refs, summary: 'Your tasks.', confidence: 90 }),
      };
    }

    it('names the meetings and their times, so the spoken answer carries the agenda', async () => {
      const { deps, llm } = setup(result({ content: '', toolCalls: [] }));
      // Learn the refs the server assigned, then answer with them.
      await handleAssistant(caller(), chatRequest(), deps);
      const block = llm.requests[0]!.messages[1]!.content;
      const refs = [...block.matchAll(/"ref":"([a-z0-9]+)"/g)].map((match) => match[1]!);
      expect(refs.length).toBeGreaterThan(0);

      const second = setup(result({ content: '', toolCalls: [listCall([refs[0]!])] }));
      const response = await handleAssistant(caller(), chatRequest(), second.deps);
      expect(response.actions).toHaveLength(1);
      // Title plus the local time, not a content-free caption.
      expect(response.reply).toMatch(/\(\d{2}:\d{2}\)\.$/);
      expect(response.reply).not.toContain('confirm');
    });

    // What the composer reads aloud must match the calendar: a cancelled meeting is not part of
    // the day, and a repeating meeting's stored start is its FIRST occurrence, so only its time
    // of day is said.
    it('drops a cancelled meeting and says a repeating meeting as a time of day', async () => {
      function withExtras(llmResult = result({ content: '', toolCalls: [] })) {
        const built = setup(llmResult);
        built.meetings
          .add('gone', { title: 'Cancelled sync', startAt: '2026-09-29T09:00:00.000Z', status: 'cancelled' })
          .add('standup', {
            title: 'Standup', startAt: '2026-09-01T07:00:00.000Z',
            recurrence: { freq: 'weekly', interval: 1, byWeekday: ['mo', 'tu', 'we', 'th', 'fr'], byMonthDay: null, until: null, count: null },
          });
        return built;
      }
      const probe = withExtras();
      await handleAssistant(caller(), chatRequest(), probe.deps);
      const refs = [PRIVATE_TEXT, 'Cancelled sync', 'Standup'].map((title) => refOf(probe.llm, title));

      const second = withExtras(result({ content: '', toolCalls: [listCall(refs)] }));
      const response = await handleAssistant(caller(), chatRequest(), second.deps);
      expect(response.reply).not.toContain('Cancelled sync');
      expect(response.reply).not.toContain('2026-09-01');
      // Madrid is UTC+2 in September: 07:00Z is 09:00 local.
      expect(response.reply).toContain('Standup (09:00)');
      expect(response.reply).toContain(PRIVATE_TEXT);
    });
    it('says plainly that there is nothing when the list is empty', async () => {
      const { deps } = setup(result({ content: '', toolCalls: [listCall([])] }));
      const response = await handleAssistant(caller(), chatRequest(), deps);
      expect(response.reply).toBe('Nothing on your calendar for that.');
    });

    it('answers an empty task list in its own words', async () => {
      const { deps } = setup(result({ content: '', toolCalls: [listTasksCall([])] }));
      deps.tasks = reads;
      const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
      expect(response.reply).toBe('No tasks match that.');
    });

    it('answers a mixed read with one sentence per kind', async () => {
      const { deps } = setup(result({ content: '', toolCalls: [listCall([]), listTasksCall([])] }));
      deps.tasks = reads;
      const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
      expect(response.reply).toBe('Nothing on your calendar for that. No tasks match that.');
    });

    it('answers in Spanish', async () => {
      const { deps } = setup(result({ content: '', toolCalls: [listCall([])] }));
      const response = await handleAssistant(caller(), chatRequest({ language: 'es' }), deps);
      expect(response.reply).toBe('No tienes nada en el calendario para eso.');
    });

    it('still asks for confirmation when a read is mixed with a real change', async () => {
      const create = {
        name: 'create_meeting',
        arguments: JSON.stringify({
          title: 'Kickoff', description: '', date: '2026-09-29', time: '17:00', all_day: false,
          duration_minutes: null, timezone: null, location: null, conference: null,
          participants: [], preparation_tips: [], alert_minutes_before: null, recurrence: null,
          summary: 'Schedule Kickoff.', confidence: 90,
        }),
      };
      const { deps } = setup(result({ content: '', toolCalls: [listCall([]), create] }));
      const response = await handleAssistant(caller(), chatRequest(), deps);
      expect(response.reply).toContain('review and confirm');
    });
  });
});

describe('task tools (v5)', () => {
  const taskReader = {
    listRecent: async () => [
      {
        id: 'taskkick1',
        doc: {
          title: 'Prepare the proposal',
          description: '',
          dueDate: '2026-09-29',
          dueTime: '16:00',
          timezone: 'Europe/Madrid',
          reminderMinutesBefore: 30,
          status: 'open',
          meetingId: 'merger',
          people: [],
          completedAt: null,
          updatedAt: '2026-09-28T10:00:00.000Z',
        },
      },
    ],
  };

  it('offers the task tools and the tasks data only to contractVersion >= 5 clients', async () => {
    const v5 = setup();
    v5.deps.tasks = taskReader;
    await handleAssistant(caller(), chatRequest({ contractVersion: 5 }), v5.deps);
    const request = v5.llm.requests[0]!;
    expect(request.tools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['create_task', 'update_task', 'delete_task', 'list_tasks']));
    expect(request.messages[0]!.content).toContain('# Tasks');
    expect(request.messages[1]!.content).toContain('Prepare the proposal');
    // The task's linked meeting is exposed as the meeting's REF, never its id.
    expect(request.messages[1]!.content).not.toContain('"merger"');

    const v4 = setup();
    v4.deps.tasks = taskReader;
    await handleAssistant(caller(), chatRequest(), v4.deps);
    const old = v4.llm.requests[0]!;
    expect(old.tools.map((tool) => tool.function.name)).not.toContain('create_task');
    expect(old.messages[0]!.content).not.toContain('# Tasks');
    expect(old.messages[1]!.content).not.toContain('Prepare the proposal');
  });

  it('maps a create_task call into a validated create_task action', async () => {
    const { deps } = setup(
      result({
        content: 'Task ready.',
        toolCalls: [
          {
            name: 'create_task',
            arguments: JSON.stringify({
              title: 'Prepare the slides',
              description: '',
              due_date: '2026-09-29',
              due_time: '12:00',
              reminder_minutes_before: 30,
              meeting_ref: null,
              people: [{ name: 'Ana', email: null }],
              summary: 'Add a task "Prepare the slides" for tomorrow at noon.',
              confidence: 90,
            }),
          },
        ],
      }),
    );
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest({ contractVersion: 5 }), deps);
    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]).toMatchObject({
      type: 'create_task',
      task: {
        title: 'Prepare the slides',
        dueDate: '2026-09-29',
        dueTime: '12:00',
        reminderMinutesBefore: 30,
        meetingId: null,
        people: [{ name: 'Ana', email: null }],
      },
    });
  });

  // "When a meeting moves, the assistant asks whether related task dates should move too": the
  // question is appended by the server when the model moved the meeting and said nothing about
  // the linked task, and left alone when the model handled it.
  describe('a meeting move asks about its linked dated tasks', () => {
    function moveCall(ref: string) {
      return {
        name: 'update_meeting',
        arguments: JSON.stringify({
          meeting_ref: ref,
          changes: {
            title: null, description: null, date: '2026-10-01', time: '11:00', all_day: null, timezone: null,
            duration_minutes: null, location: null, clear_location: false, conference: null, clear_conference: false,
            participants: null, preparation_tips: null, alert_minutes_before: null, reset_alert_times: false,
          },
          summary: 'Move the merger meeting to Oct 1 at 11:00.', confidence: 90,
        }),
      };
    }
    async function refForMerger() {
      const probe = setup();
      probe.deps.tasks = taskReader;
      await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), probe.deps);
      return refOf(probe.llm, PRIVATE_TEXT);
    }

    it('appends the question when the model forgot it', async () => {
      const ref = await refForMerger();
      const { deps } = setup(result({ content: 'Moving it to October 1 at 11:00.', toolCalls: [moveCall(ref)] }));
      deps.tasks = taskReader;
      const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
      expect(response.actions).toHaveLength(1);
      expect(response.reply).toBe('Moving it to October 1 at 11:00. Should I move "Prepare the proposal" as well?');
      expect(logger.info).toHaveBeenCalledWith('assistant.completed', expect.objectContaining({ moveQuestion: true }));
    });

    it('asks in Spanish for a Spanish request', async () => {
      const ref = await refForMerger();
      const { deps } = setup(result({ content: 'La muevo al 1 de octubre.', toolCalls: [moveCall(ref)] }));
      deps.tasks = taskReader;
      const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6, language: 'es' }), deps);
      expect(response.reply).toBe('La muevo al 1 de octubre. ¿Muevo también "Prepare the proposal"?');
    });

    it('leaves the reply alone when the model already asked', async () => {
      const ref = await refForMerger();
      const { deps } = setup(result({ content: 'Moving it. Should I move Prepare the proposal too?', toolCalls: [moveCall(ref)] }));
      deps.tasks = taskReader;
      const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
      expect(response.reply).toBe('Moving it. Should I move Prepare the proposal too?');
      expect(logger.info).toHaveBeenCalledWith('assistant.completed', expect.objectContaining({ moveQuestion: false }));
    });
  });

  // "Book the call with Ana and add a task the day before to prepare the proposal": the meeting
  // has no ref yet, so the task points at the create_meeting ACTION and the client resolves it.
  function combined(linkToNewMeeting: boolean, meetings = 1) {
    const meetingCalls = Array.from({ length: meetings }, (_unused, index) => ({
      name: 'create_meeting',
      arguments: JSON.stringify({
        title: `Call with Ana ${index + 1}`, description: '', date: '2026-09-30', time: '10:00', all_day: false,
        duration_minutes: null, timezone: null, location: null, conference: null,
        participants: [], preparation_tips: [], alert_minutes_before: null, recurrence: null,
        summary: 'Schedule the call with Ana.', confidence: 90,
      }),
    }));
    return result({
      content: 'Both ready.',
      toolCalls: [
        ...meetingCalls,
        {
          name: 'create_task',
          arguments: JSON.stringify({
            title: 'Prepare the proposal', description: '', due_date: '2026-09-29', due_time: '16:00',
            reminder_minutes_before: null, meeting_ref: null, link_to_new_meeting: linkToNewMeeting,
            people: [], summary: 'Add a task to prepare the proposal.', confidence: 90,
          }),
        },
      ],
    });
  }

  it('links a task to the meeting created in the same response', async () => {
    const { deps } = setup(combined(true));
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
    expect(response.actions).toHaveLength(2);
    const meeting = response.actions.find((action) => action.type === 'create_meeting');
    const task = response.actions.find((action) => action.type === 'create_task');
    expect(meeting).toBeDefined();
    expect(task).toMatchObject({ task: { title: 'Prepare the proposal', meetingId: null } });
    // The link is the sibling ACTION id, never a placeholder and never a meeting id.
    expect(task?.type === 'create_task' && task.task.meetingActionId).toBe(meeting?.id);
    expect(task?.type === 'create_task' && task.task.meetingActionId).not.toBe('__new_meeting__');
  });

  it('leaves the task unlinked when the response creates no meeting to point at', async () => {
    const { deps } = setup(
      result({
        content: 'Task ready.',
        toolCalls: [
          {
            name: 'create_task',
            arguments: JSON.stringify({
              title: 'Prepare the proposal', description: '', due_date: null, due_time: null,
              reminder_minutes_before: null, meeting_ref: null, link_to_new_meeting: true,
              people: [], summary: 'Add a task.', confidence: 90,
            }),
          },
        ],
      }),
    );
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]).toMatchObject({ type: 'create_task', task: { meetingId: null } });
    // Keeping the task matters more than keeping the link; no placeholder leaks either.
    expect(response.actions[0]?.type === 'create_task' && response.actions[0].task.meetingActionId).toBeUndefined();
  });

  it('leaves the task unlinked when several meetings are created and the target is ambiguous', async () => {
    const { deps } = setup(combined(true, 2));
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
    expect(response.actions).toHaveLength(3);
    const task = response.actions.find((action) => action.type === 'create_task');
    expect(task?.type === 'create_task' && task.task.meetingActionId).toBeUndefined();
  });

  it('never sends the link to a v5 client, which cannot resolve it', async () => {
    const { deps } = setup(combined(true));
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest({ contractVersion: 5 }), deps);
    expect(response.actions).toHaveLength(2);
    const task = response.actions.find((action) => action.type === 'create_task');
    // Both actions still arrive, so the combined request works; only the link is withheld.
    expect(task?.type === 'create_task' && task.task.meetingActionId).toBeUndefined();
  });

  it('does not link when the model did not ask for it', async () => {
    const { deps } = setup(combined(false));
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest({ contractVersion: 6 }), deps);
    const task = response.actions.find((action) => action.type === 'create_task');
    expect(task?.type === 'create_task' && task.task.meetingActionId).toBeUndefined();
  });

  it('drops task actions whose ref is not in the task context', async () => {
    const { deps } = setup(
      result({
        content: 'Done.',
        toolCalls: [
          { name: 'delete_task', arguments: JSON.stringify({ task_ref: 'tunknown99', summary: 'Delete it.', confidence: 80 }) },
        ],
      }),
    );
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest({ contractVersion: 5 }), deps);
    expect(response.actions).toEqual([]);
  });

  it('never emits task actions to a v4 request even if the model calls a task tool', async () => {
    const { deps } = setup(
      result({
        content: 'ok',
        toolCalls: [
          {
            name: 'create_task',
            arguments: JSON.stringify({
              title: 'X', description: '', due_date: null, due_time: null, reminder_minutes_before: null,
              meeting_ref: null, people: [], summary: 'Add a task.', confidence: 80,
            }),
          },
        ],
      }),
    );
    deps.tasks = taskReader;
    const response = await handleAssistant(caller(), chatRequest(), deps);
    // No tasksContext => the mapper cannot resolve anything task-shaped; the call is dropped
    // as unknown-by-context work and the response stays v4-parseable.
    expect(response.actions.every((action) => !action.type.includes('task'))).toBe(true);
  });
});

describe('admin stats hook (recordAiUsage)', () => {
  it('records the day key and token usage after a successful completion', async () => {
    const { deps } = setup();
    const recordAiUsage = jest.fn(async () => undefined);
    await expect(handleAssistant(caller(), chatRequest(), { ...deps, recordAiUsage })).resolves.toMatchObject({
      reply: 'Done deal.',
    });
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith(DAY, { inputTokens: 10, outputTokens: 5 });
  });

  it('records zeros when OpenAI omitted the usage object', async () => {
    const { deps } = setup(result({ usage: null }));
    const recordAiUsage = jest.fn(async () => undefined);
    await handleAssistant(caller(), chatRequest(), { ...deps, recordAiUsage });
    expect(recordAiUsage).toHaveBeenCalledWith(DAY, { inputTokens: 0, outputTokens: 0 });
  });

  it('a stats write failure is warn-logged and never fails or refunds the request', async () => {
    const { deps, quota } = setup();
    const recordAiUsage = jest.fn(async () => {
      throw new Error('firestore down');
    });
    await expect(handleAssistant(caller(), chatRequest(), { ...deps, recordAiUsage })).resolves.toMatchObject({
      reply: 'Done deal.',
      usage: { used: 1 },
    });
    expect(quota.count('u1', DAY)).toBe(1); // still billed, not refunded
    expect(logger.warn).toHaveBeenCalledWith('assistant.stats_failed', {
      uid: 'u1',
      errorName: 'Error',
      errorMessage: 'firestore down',
    });
  });

  it('does not record anything when the completion itself fails', async () => {
    const { deps } = setup(new UpstreamError('server', 503));
    const recordAiUsage = jest.fn(async () => undefined);
    await expectAssistantError(handleAssistant(caller(), chatRequest(), { ...deps, recordAiUsage }), 'unavailable', 'upstream_error');
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it('does not record over-quota requests (they never reach OpenAI)', async () => {
    const { deps, quota } = setup();
    quota.usage.set(`u1/${DAY}`, { count: 5, updatedAt: 'x' });
    const recordAiUsage = jest.fn(async () => undefined);
    await expectAssistantError(handleAssistant(caller(), chatRequest(), { ...deps, recordAiUsage }), 'resource-exhausted', 'quota_exceeded');
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});

describe('a list answer always carries the items, because the reply is what is read aloud', () => {
  async function learnFirstMeeting() {
    const probe = setup(result({ content: '', toolCalls: [] }));
    await handleAssistant(caller(), chatRequest(), probe.deps);
    const block = probe.llm.requests[0]!.messages[1]!.content;
    const payload = JSON.parse(block.split('\n')[1]!) as { meetings: { ref: string; title: string }[] };
    const first = payload.meetings[0];
    if (!first) throw new Error('no meeting in the data block');
    return first;
  }

  function listCall(refs: string[]) {
    return { name: 'list_meetings', arguments: JSON.stringify({ meeting_refs: refs, summary: 'Your meetings.', confidence: 90 }) };
  }

  it('appends the items when the model only wrote a caption', async () => {
    const meeting = await learnFirstMeeting();
    const { deps } = setup(result({ content: 'Here is your day.', toolCalls: [listCall([meeting.ref])] }));
    const response = await handleAssistant(caller(), chatRequest(), deps);
    expect(response.reply.startsWith('Here is your day. ')).toBe(true);
    expect(response.reply).toContain(meeting.title);
    expect(response.reply).toMatch(/\(\d{2}:\d{2}\)\.$/);
  });

  it('leaves the reply alone when the model already named an item', async () => {
    const meeting = await learnFirstMeeting();
    const content = 'You have ' + meeting.title + ' this afternoon.';
    const { deps } = setup(result({ content, toolCalls: [listCall([meeting.ref])] }));
    const response = await handleAssistant(caller(), chatRequest(), deps);
    expect(response.reply).toBe(content);
  });

  it('leaves the reply alone when the list is empty and the model said so', async () => {
    const { deps } = setup(result({ content: 'Nothing on that day.', toolCalls: [listCall([])] }));
    const response = await handleAssistant(caller(), chatRequest(), deps);
    expect(response.reply).toBe('Nothing on that day.');
  });
});
