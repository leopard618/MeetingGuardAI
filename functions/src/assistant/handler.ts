/**
 * The `assistant` callable's logic, independent of Firebase wiring (dependencies are injected).
 *
 * Order: auth (a verified account: email_verified or Google) -> request validation -> atomic
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
  AI_LIMITS,
  assistantRequestSchema,
  assistantResponseSchema,
  type AssistantRequest,
  type AssistantResponse,
} from '../shared/aiContract';
import { mapToolCalls } from './actions';
import { FollowUpMeetingNotFoundError, loadMeetingContext, type MeetingReader } from './context';
import { UpstreamError, assistantError } from './errors';
import type { GlobalBudget } from './globalBudget';
import { safetyIdentifierFor, type LlmClient, type LlmResult } from './llm';
import { buildPromptMessages, collectUserText, fallbackReply } from './prompt';
import { consumeQuota, refundQuota, type QuotaDecision, type QuotaStore } from './quota';
import { isValidTimeZone } from './time';
import { ASSISTANT_TOOLS } from './tools';

export interface AssistantDeps {
  quota: QuotaStore;
  meetings: MeetingReader;
  /** Created lazily (reads the secret only for requests that passed auth + quota). */
  llm: () => LlmClient;
  now: () => Date;
  /** Project-wide daily cap (optional: tests and the emulator run without one). */
  globalBudget?: GlobalBudget;
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
 * through the Auth REST API would otherwise multiply the free quota.
 */
export function isVerifiedCaller(caller: AssistantCaller): boolean {
  return caller.emailVerified || caller.signInProvider === 'google.com';
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
    const { messages } = buildPromptMessages({
      language: request.language,
      timeZone: request.timezone,
      now,
      mode: request.mode,
      context,
      messages: request.messages,
      ...(deps.nonce ? { nonce: deps.nonce() } : {}),
    });
    const llm = deps.llm();
    llmStarted = true;
    const completion: LlmResult = await llm.complete({
      messages,
      tools: ASSISTANT_TOOLS,
      toolChoice: request.mode === 'followup' ? 'required' : 'auto',
      safetyIdentifier: safetyIdentifierFor(uid),
    });

    const mapped = mapToolCalls(completion.toolCalls, {
      language: request.language,
      mode: request.mode,
      userTimeZone: request.timezone,
      context,
      userText: collectUserText(request.messages),
      ...(deps.newActionId ? { newActionId: deps.newActionId } : {}),
    });

    let reply = (completion.content ?? '').trim();
    if (reply.length === 0 && completion.refusal) reply = completion.refusal.trim();
    if (reply.length === 0) {
      const onlyLists = mapped.actions.length > 0 && mapped.actions.every((action) => action.type === 'list');
      reply = fallbackReply(
        request.language,
        request.mode === 'followup' ? 'followup' : onlyLists ? 'list' : mapped.actions.length > 0 ? 'actions' : 'empty',
      );
    }
    if (reply.length > AI_LIMITS.maxReplyChars) reply = reply.slice(0, AI_LIMITS.maxReplyChars);

    const response: AssistantResponse = {
      reply,
      actions: mapped.actions,
      suggestions: mapped.suggestions,
      usage: quota.usage,
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
      actions: mapped.actions.length,
      suggestions: mapped.suggestions.length,
      dropped: mapped.dropped,
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
