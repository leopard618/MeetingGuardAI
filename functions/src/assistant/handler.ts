/**
 * The `assistant` callable's logic, independent of Firebase wiring (dependencies are injected).
 *
 * Order: auth -> request validation -> atomic quota (usage/{uid}/days/{UTC day}) -> meetings
 * context -> OpenAI (tools) -> proposals validated against the shared contract -> response.
 * Nothing here writes meetings: the app confirms and executes every proposal itself.
 * A request that fails after the quota was counted for reasons the user did not cause
 * (upstream failure, missing follow-up meeting) is refunded.
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
import { safetyIdentifierFor, type LlmClient } from './llm';
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
  newActionId?: () => string;
  nonce?: () => string;
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

export async function handleAssistant(uid: string | null, data: unknown, deps: AssistantDeps): Promise<AssistantResponse> {
  if (!uid) throw assistantError('unauthenticated');
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

  try {
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
    const completion = await deps.llm().complete({
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
    try {
      await refundQuota(deps.quota, uid, quota.dayKey, deps.now());
    } catch (refundError) {
      logger.warn('assistant.refund_failed', { uid, ...describeError(refundError) });
    }
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
