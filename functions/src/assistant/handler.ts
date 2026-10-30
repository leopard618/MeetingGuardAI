/**
 * The `assistant` callable's logic, independent of Firebase wiring (dependencies are injected).
 *
 * Order: auth (a verified account: email_verified or a trusted provider, Google/Apple) -> request validation -> atomic
 * quota (usage/{uid}/days/{UTC day}) -> project-wide daily cap -> meetings context -> OpenAI
 * (tools) -> proposals validated against the shared contract -> response.
 * Nothing here writes meetings: the app confirms and executes every proposal itself.
 *
 * Refunds: the counted request is given back only when it failed BEFORE OpenAI did any work
 * (context loading, the follow-up meeting is missing, the global cap, configuration / connection
 * errors, rate limits and 5xx answers). Timeouts, bad requests and anything after a completion are
 * not refunded: OpenAI bills them, so refunding would make those requests free.
 *
 * Logs contain the uid and counts only (never messages, titles, emails or model output).
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/https';

import {
  AI_CONTRACT_VERSION,
  AI_LIMITS,
  assistantRequestSchema,
  assistantResponseSchema,
  isMutatingAction,
  isTrustedSignInProvider,
  type AssistantRequest,
  type AssistantResponse,
} from '../shared/aiContract';
import { mapToolCalls } from './actions';
import { FollowUpMeetingNotFoundError, loadMeetingContext, type MeetingReader } from './context';
import { UpstreamError, assistantError } from './errors';
import type { GlobalBudget } from './globalBudget';
import { safetyIdentifierFor, type LlmClient, type LlmResult } from './llm';
import { isPlainConsent, lastUserText, missingMoveQuestion } from './guards';
import { buildPromptMessages, collectUserText, composeListAnswer, fallbackReply, listAnswerItems } from './prompt';
import { recoverToolCallsFromText } from './recover';
import { consumeQuota, refundQuota, type QuotaDecision, type QuotaStore } from './quota';
import { buildTaskContext, type TaskContext, type TaskReader } from './tasksContext';
import { isValidTimeZone } from './time';
import { ASSISTANT_TOOLS, RESOLVE_PENDING_TOOL, TASK_TOOLS } from './tools';

export interface AssistantDeps {
  quota: QuotaStore;
  meetings: MeetingReader;
  /** v5: absent (older fakes / the WhatsApp bridge wiring) = no task context, no task tools. */
  tasks?: TaskReader;
  /** Created lazily (reads the secret only for requests that passed auth + quota). */
  llm: () => LlmClient;
  now: () => Date;
  /** Project-wide daily cap (optional: tests and the emulator run without one). */
  globalBudget?: GlobalBudget;
  /**
   * Admin v2 stats hook (docs/v1/ADMIN.md §v2): merge-set with increments on
   * adminStats/ai/days/{dayKey} after a successful completion. Optional, and guarded by its own
   * try/catch here: a stats failure is warn-logged and NEVER fails (or refunds) the request.
   */
  recordAiUsage?: (dayKey: string, tokens: { inputTokens: number; outputTokens: number }) => Promise<void>;
  newActionId?: () => string;
  nonce?: () => string;
}

/** The signed-in caller (from request.auth). */
export interface AssistantCaller {
  uid: string;
  /** request.auth.token.email_verified */
  emailVerified: boolean;
  /** request.auth.token.firebase.sign_in_provider ("google.com", "password", ...). */
  signInProvider: string | null;
}

/**
 * Only verified accounts may use the (paid) assistant: throw-away email/password accounts created
 * through the Auth REST API would otherwise multiply the free quota. Trusted providers (Google,
 * Apple - see TRUSTED_SIGN_IN_PROVIDERS in shared/aiContract.ts) count as verified even when
 * `email_verified` is false: Apple private-relay addresses are only issued to verified Apple IDs.
 */
export function isVerifiedCaller(caller: AssistantCaller): boolean {
  return caller.emailVerified || isTrustedSignInProvider(caller.signInProvider);
}

/** Upstream failures where OpenAI did no billable work: the user gets the request back. */
const REFUNDABLE_UPSTREAM: ReadonlySet<UpstreamError['kind']> = new Set<UpstreamError['kind']>([
  'configuration',
  'connection',
  'rate_limited',
  'server',
]);

class GlobalBudgetExhaustedError extends Error {
  constructor() {
    super('Global assistant budget exhausted');
    this.name = 'GlobalBudgetExhaustedError';
  }
}

function parseRequest(data: unknown): AssistantRequest {
  const parsed = assistantRequestSchema.safeParse(data);
  if (!parsed.success) {
    throw assistantError('invalid_request');
  }
  if (!isValidTimeZone(parsed.data.timezone)) {
    throw assistantError('invalid_request', 'Unknown time zone.');
  }
  return parsed.data;
}

/** Error class + (Firestore/runtime) message for ops; never request content. */
export function describeError(error: unknown): { errorName: string; errorMessage: string } {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message.slice(0, 300) };
  return { errorName: typeof error, errorMessage: '' };
}

function logUpstream(uid: string, error: UpstreamError): void {
  const fields = { uid, kind: error.kind, status: error.status };
  if (error.kind === 'configuration' || error.kind === 'bad_request') {
    logger.error('assistant.upstream_failed', fields);
  } else {
    logger.warn('assistant.upstream_failed', fields);
  }
}

export async function handleAssistant(
  caller: AssistantCaller | null,
  data: unknown,
  deps: AssistantDeps,
): Promise<AssistantResponse> {
  if (!caller) throw assistantError('unauthenticated');
  const uid = caller.uid;
  if (!isVerifiedCaller(caller)) {
    logger.info('assistant.unverified_account', { uid });
    throw assistantError('unauthenticated', 'Verify your email address to use the assistant.');
  }
  const request = parseRequest(data);
  return runAssistant(uid, request, deps);
}

/**
 * The assistant pipeline for an ALREADY authenticated uid and an ALREADY validated request:
 * quota -> global budget -> context -> OpenAI -> mapped actions -> response (with refunds).
 * The callable goes through `handleAssistant` (auth gate + request parsing) above; the WhatsApp
 * bridge (functions/src/whatsapp, §27) calls this directly - the linked uid was attested by the
 * link code flow, and the bridge builds the request itself - so both paths share the SAME
 * per-user daily quota, global budget and usage counters.
 */
export async function runAssistant(uid: string, request: AssistantRequest, deps: AssistantDeps): Promise<AssistantResponse> {
  const startedAt = Date.now();
  const now = deps.now();

  let quota: QuotaDecision;
  try {
    quota = await consumeQuota(deps.quota, uid, now);
  } catch (error) {
    logger.error('assistant.quota_failed', { uid, ...describeError(error) });
    throw assistantError('upstream_error');
  }
  if (!quota.entitlementValid) logger.warn('assistant.entitlement_invalid', { uid });
  if (!quota.allowed) {
    logger.info('assistant.quota_exceeded', { uid, plan: quota.usage.plan, limit: quota.usage.limit });
    throw assistantError('quota_exceeded', undefined, quota.usage);
  }

  /** Set right before the OpenAI call: from then on OpenAI may bill the request. */
  let llmStarted = false;
  try {
    if (deps.globalBudget && !(await deps.globalBudget.tryAcquire(quota.dayKey))) {
      logger.error('assistant.global_budget_exhausted', { uid, day: quota.dayKey });
      throw new GlobalBudgetExhaustedError();
    }
    const context = await loadMeetingContext(deps.meetings, uid, now, request.followUpMeetingId);
    // v4: unconfirmed proposals the app is showing. Only chat mode carries them, and the
    // resolve_pending tool exists for the model only while there is something to resolve.
    const pendingActions = request.mode === 'chat' ? (request.pendingActions ?? []) : [];
    // v5: tasks exist for the model ONLY when the client said it can parse the task action
    // types (an older client's response schema would reject the whole response otherwise).
    const wantsTasks = request.mode === 'chat' && (request.contractVersion ?? 0) >= 5 && deps.tasks !== undefined;
    let tasksContext: TaskContext | null = null;
    if (wantsTasks && deps.tasks) {
      const taskRecords = await deps.tasks.listRecent(uid, AI_LIMITS.maxActions * 20);
      tasksContext = buildTaskContext(taskRecords, now);
    }
    const { messages } = buildPromptMessages({
      language: request.language,
      timeZone: request.timezone,
      now,
      mode: request.mode,
      context,
      tasksContext,
      messages: request.messages,
      pendingActions,
      ...(deps.nonce ? { nonce: deps.nonce() } : {}),
    });
    const llm = deps.llm();
    llmStarted = true;
    const tools = [
      ...ASSISTANT_TOOLS,
      ...(tasksContext !== null ? TASK_TOOLS : []),
      ...(pendingActions.length > 0 ? [RESOLVE_PENDING_TOOL] : []),
    ];
    const completion: LlmResult = await llm.complete({
      messages,
      tools,
      toolChoice: request.mode === 'followup' ? 'required' : 'auto',
      safetyIdentifier: safetyIdentifierFor(uid),
    });

    // Admin stats aggregate: OpenAI answered, so this request is billed work. Awaited (the
    // function may be frozen after returning) but isolated: a stats failure never fails the
    // user's request and never refunds the quota.
    if (deps.recordAiUsage) {
      try {
        await deps.recordAiUsage(quota.dayKey, {
          inputTokens: completion.usage?.promptTokens ?? 0,
          outputTokens: completion.usage?.completionTokens ?? 0,
        });
      } catch (statsError) {
        logger.warn('assistant.stats_failed', { uid, ...describeError(statsError) });
      }
    }

    // The model sometimes writes a tool's arguments as JSON text instead of calling it (seen on a
    // device, 2026-10-21). Such objects become tool calls, validated like any other, and no raw
    // JSON ever reaches the reply. Real tool calls win when both are present.
    const recovered = recoverToolCallsFromText(completion.content ?? '', new Set(tools.map((tool) => tool.function.name)));
    const toolCalls = completion.toolCalls.length > 0 ? completion.toolCalls : recovered.toolCalls;
    const mapped = mapToolCalls(toolCalls, {
      language: request.language,
      mode: request.mode,
      userTimeZone: request.timezone,
      context,
      tasksContext,
      allowNewMeetingLinks: (request.contractVersion ?? 0) >= 6,
      userText: collectUserText(request.messages),
      ...(deps.newActionId ? { newActionId: deps.newActionId } : {}),
    });

    // A resolution only counts when something was pending AND the model proposed nothing new:
    // "yes but change X" style answers come back as proposals and must never auto-confirm.
    // ... and, as a deterministic backstop, only when the user's own words were plain consent or
    // refusal. "Yes but make it earlier" must never execute, whatever the model decided.
    const plainConsent = isPlainConsent(lastUserText(request.messages));
    const resolutionBlocked = pendingActions.length > 0 && mapped.actions.length === 0 && mapped.resolution !== null && !plainConsent;
    const resolution =
      pendingActions.length > 0 && mapped.actions.length === 0 && plainConsent ? mapped.resolution : null;

    let reply = recovered.text.trim();
    if (reply.length === 0 && completion.refusal) reply = completion.refusal.trim();
    // A read-only answer is never captioned "review and confirm": there is nothing to confirm.
    // It is composed from the rows themselves, because the reply is what gets read aloud and a
    // voice-only user must hear the actual items (and hear "nothing" when the answer is nothing).
    const reads = mapped.actions.filter((action) => !isMutatingAction(action));
    const onlyLists = mapped.actions.length > 0 && reads.length === mapped.actions.length;
    const listAnswer = onlyLists ? composeListAnswer(reads, context, tasksContext, request.language, request.timezone) : null;
    if (reply.length > 0 && listAnswer !== null) {
      // The model wrote a caption ("Here is your day.") and left the items to the card. Append
      // the composed items unless the reply already names at least one of them.
      const items = listAnswerItems(reads, context, tasksContext, request.timezone);
      const lower = reply.toLowerCase();
      const namesOne = items.some((item) => item.title.trim().length > 0 && lower.includes(item.title.trim().toLowerCase()));
      if (items.length > 0 && !namesOne) reply = reply + " " + listAnswer;
    }
    if (resolutionBlocked) {
      // The model took a qualified answer for consent and nothing was applied: its own
      // "confirming it now" sentence would be a lie. Say what to do instead.
      reply = fallbackReply(request.language, 'resolve_tap');
    }
    if (reply.length === 0) {
      // Every proposal the model made was dropped (e.g. a timed meeting without a time): tell
      // the user WHAT is missing instead of a useless "couldn't generate a response" loop.
      const allDropped =
        mapped.actions.length === 0 && toolCalls.length > 0 && Object.keys(mapped.dropped).length > 0;
      if (listAnswer !== null) {
        reply = listAnswer;
      } else {
        reply = fallbackReply(
          request.language,
          request.mode === 'followup'
            ? 'followup'
            : resolution !== null
              ? resolution === 'confirm'
                ? 'resolve_confirm'
                : 'resolve_reject'
              : mapped.actions.length > 0
                ? 'actions'
                : allDropped
                  ? 'need_details'
                  : 'empty',
        );
      }
    }
    // A meeting move with linked, dated tasks must ask about them; append the question when the
    // model left it out, so the promise does not depend on the model remembering.
    const moveQuestion = missingMoveQuestion(mapped.actions, tasksContext, request.language, reply);
    if (moveQuestion !== null) reply = reply.length > 0 ? reply + ' ' + moveQuestion : moveQuestion;
    if (reply.length > AI_LIMITS.maxReplyChars) reply = reply.slice(0, AI_LIMITS.maxReplyChars);

    const response: AssistantResponse = {
      reply,
      actions: mapped.actions,
      suggestions: mapped.suggestions,
      usage: quota.usage,
      ...(resolution !== null ? { resolution } : {}),
    };
    const checked = assistantResponseSchema.safeParse(response);
    if (!checked.success) {
      logger.error('assistant.response_invalid', { uid, issues: checked.error.issues.length });
      throw new UpstreamError('unknown', null);
    }

    logger.info('assistant.completed', {
      uid,
      mode: request.mode,
      messages: request.messages.length,
      meetings: context.meetings.length,
      skippedMeetings: context.skippedInvalid,
      toolCalls: completion.toolCalls.length,
      recoveredToolCalls: completion.toolCalls.length > 0 ? 0 : recovered.toolCalls.length,
      actions: mapped.actions.length,
      pendingActions: pendingActions.length,
      tasks: tasksContext?.tasks.length ?? null,
      contractVersion: Math.min(request.contractVersion ?? 0, AI_CONTRACT_VERSION),
      resolution,
      suggestions: mapped.suggestions.length,
      dropped: mapped.dropped,
      // Field evidence without a device: how many tasks arrived linked to a same-response meeting,
      // whether the consent backstop vetoed a resolution, and whether a move question was added.
      linkedTasks: mapped.actions.filter((action) => action.type === 'create_task' && action.task.meetingActionId !== null && action.task.meetingActionId !== undefined).length,
      resolutionBlocked,
      moveQuestion: moveQuestion !== null,
      finishReason: completion.finishReason,
      promptTokens: completion.usage?.promptTokens ?? null,
      completionTokens: completion.usage?.completionTokens ?? null,
      used: quota.usage.used,
      limit: quota.usage.limit,
      plan: quota.usage.plan,
      latencyMs: Date.now() - startedAt,
    });
    return checked.data;
  } catch (error) {
    const refundable =
      !llmStarted || (error instanceof UpstreamError && REFUNDABLE_UPSTREAM.has(error.kind));
    if (refundable) {
      try {
        await refundQuota(deps.quota, uid, quota.dayKey, deps.now());
      } catch (refundError) {
        logger.warn('assistant.refund_failed', { uid, ...describeError(refundError) });
      }
    }
    if (error instanceof GlobalBudgetExhaustedError) throw assistantError('upstream_error');
    if (error instanceof FollowUpMeetingNotFoundError) {
      logger.info('assistant.followup_not_found', { uid });
      throw assistantError('invalid_request', 'The follow-up meeting was not found.');
    }
    if (error instanceof HttpsError) throw error;
    if (error instanceof UpstreamError) {
      logUpstream(uid, error);
      throw assistantError('upstream_error');
    }
    logger.error('assistant.failed', { uid, ...describeError(error) });
    throw assistantError('upstream_error');
  }
}
