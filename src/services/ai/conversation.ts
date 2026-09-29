/**
 * Pure conversation state: reducer, trimming, request windows and selectors (unit-tested).
 *
 * - The thread keeps the newest MAX_STORED_MESSAGES messages; actions of dropped messages are
 *   dropped too (except ones still executing).
 * - Only the newest MAX_REQUEST_MESSAGES messages go to the server (content capped to the
 *   contract limit), so long threads never grow the request or the token bill.
 * - Action ids from the server are only unique within one response; the client re-keys them to
 *   `<assistant message id>-<n>` so they are unique in the thread (idempotency keys build on them).
 */
import {
  AI_LIMITS,
  isMutatingAction,
  type AiAction,
  type AssistantMessage,
  type AssistantUsage,
} from '../../core/aiContract';
import type { ActionPreview, ActionResult, ProposedActionState } from '../../core/contracts';

import type { ChatMessage, FailedRequest, ThreadState } from './types';

export const MAX_STORED_MESSAGES = 30;
export const MAX_REQUEST_MESSAGES = 12;
const MAX_FOLLOW_UPS_REMEMBERED = 50;

export const EMPTY_THREAD: ThreadState = Object.freeze({
  messages: [],
  actions: {},
  usage: null,
  followUpsRequested: [],
}) as ThreadState;

export function createEmptyThread(): ThreadState {
  return { messages: [], actions: {}, usage: null, followUpsRequested: [] };
}

/** Keeps the newest `max` messages and the actions they reference (running actions are kept). */
export function trimThread(thread: ThreadState, max: number = MAX_STORED_MESSAGES): ThreadState {
  if (thread.messages.length <= max) return thread;
  const messages = thread.messages.slice(thread.messages.length - max);
  const referenced = new Set(messages.flatMap((m) => m.actionIds));
  const actions: Record<string, ProposedActionState> = {};
  for (const [id, state] of Object.entries(thread.actions)) {
    if (referenced.has(id) || state.status === 'executing') actions[id] = state;
  }
  return { ...thread, messages, actions };
}

/** The request window: newest `max` non-empty messages, content capped to the contract limit. */
export function buildRequestMessages(messages: readonly ChatMessage[], max: number = MAX_REQUEST_MESSAGES): AssistantMessage[] {
  const usable = messages
    .filter((m) => m.content.trim().length > 0)
    .map((m): AssistantMessage => ({
      role: m.role,
      content: m.content.length > AI_LIMITS.maxMessageChars ? m.content.slice(0, AI_LIMITS.maxMessageChars) : m.content,
    }));
  return usable.slice(Math.max(0, usable.length - max));
}

/** Gives each proposed action a thread-unique id (`<messageId>-<n>`). */
export function assignActionIds(messageId: string, actions: readonly AiAction[]): AiAction[] {
  return actions.map((action, index) => ({ ...action, id: `${messageId}-${index + 1}` }));
}

/** Proposed, mutating actions in conversation order ("confirm all"). */
export function selectPendingActionIds(thread: ThreadState): string[] {
  const ids: string[] = [];
  for (const message of thread.messages) {
    for (const id of message.actionIds) {
      const state = thread.actions[id];
      if (state && state.status === 'proposed' && isMutatingAction(state.action)) ids.push(id);
    }
  }
  return ids;
}

/** What retry() would re-send for a thread loaded from storage. */
export function detectFailedRequest(thread: ThreadState): FailedRequest | null {
  const last = thread.messages[thread.messages.length - 1];
  return last && last.role === 'user' && last.delivery === 'failed' ? { mode: 'chat' } : null;
}

/** Normalizes a thread loaded from storage (interrupted requests/executions become retryable). */
export function reviveThread(thread: ThreadState): ThreadState {
  const messages = thread.messages.map((m) => (m.delivery === 'sending' ? { ...m, delivery: 'failed' as const } : m));
  const actions: Record<string, ProposedActionState> = {};
  for (const [id, state] of Object.entries(thread.actions)) {
    actions[id] = state.status === 'executing' ? { ...state, status: 'proposed', preview: null } : { ...state, preview: null };
  }
  return trimThread({ ...thread, messages, actions });
}

export type ThreadEvent =
  | { type: 'loaded'; thread: ThreadState }
  | { type: 'reset' }
  | { type: 'user_message'; message: ChatMessage }
  | { type: 'request_started'; userMessageId: string | null }
  | {
      type: 'request_succeeded';
      userMessageId: string | null;
      reply: ChatMessage;
      actions: readonly AiAction[];
      usage: AssistantUsage;
      followUpMeetingId: string | null;
    }
  | { type: 'request_failed'; userMessageId: string | null; usage: AssistantUsage | null }
  | { type: 'preview'; actionId: string; preview: ActionPreview | null }
  | { type: 'execute_started'; actionId: string }
  | { type: 'execute_finished'; actionId: string; result: ActionResult }
  | { type: 'rejected'; actionId: string };

function updateAction(
  thread: ThreadState,
  actionId: string,
  update: (state: ProposedActionState) => ProposedActionState,
): ThreadState {
  const current = thread.actions[actionId];
  if (!current) return thread;
  return { ...thread, actions: { ...thread.actions, [actionId]: update(current) } };
}

function setDelivery(messages: readonly ChatMessage[], id: string | null, delivery: ChatMessage['delivery']): ChatMessage[] {
  if (id === null) return [...messages];
  return messages.map((m) => {
    if (m.id !== id) return m;
    if (delivery === undefined) {
      const { delivery: _removed, ...rest } = m;
      return rest;
    }
    return { ...m, delivery };
  });
}

export function threadReducer(thread: ThreadState, event: ThreadEvent): ThreadState {
  switch (event.type) {
    case 'loaded':
      return event.thread;
    case 'reset':
      // Quota info and the follow-ups already requested are not part of the conversation.
      return { ...createEmptyThread(), usage: thread.usage, followUpsRequested: thread.followUpsRequested };
    case 'user_message':
      return trimThread({ ...thread, messages: [...thread.messages, event.message] });
    case 'request_started':
      return { ...thread, messages: setDelivery(thread.messages, event.userMessageId, 'sending') };
    case 'request_succeeded': {
      // Earlier undelivered user messages were part of this request's history: delivered now.
      const delivered = thread.messages.map((m) => {
        if (m.role !== 'user' || m.delivery === undefined) return m;
        const { delivery: _removed, ...rest } = m;
        return rest;
      });
      const actions = { ...thread.actions };
      for (const action of event.actions) actions[action.id] = { action, status: 'proposed', preview: null, result: null };
      const followUps =
        event.followUpMeetingId && !thread.followUpsRequested.includes(event.followUpMeetingId)
          ? [...thread.followUpsRequested, event.followUpMeetingId].slice(-MAX_FOLLOW_UPS_REMEMBERED)
          : thread.followUpsRequested;
      return trimThread({
        messages: [...delivered, { ...event.reply, actionIds: event.actions.map((a) => a.id) }],
        actions,
        usage: event.usage,
        followUpsRequested: followUps,
      });
    }
    case 'request_failed':
      return {
        ...thread,
        messages: setDelivery(thread.messages, event.userMessageId, 'failed'),
        usage: event.usage ?? thread.usage,
      };
    case 'preview':
      return updateAction(thread, event.actionId, (state) => ({ ...state, preview: event.preview }));
    case 'execute_started':
      return updateAction(thread, event.actionId, (state) => ({ ...state, status: 'executing' }));
    case 'execute_finished':
      return updateAction(thread, event.actionId, (state) => {
        const { result } = event;
        if (result.status === 'failed' && result.error.code === 'cancelled') {
          // The user backed out (e.g. dismissed the share sheet): the proposal stays open.
          return { ...state, status: 'proposed', result: null };
        }
        return { ...state, status: result.status === 'done' ? 'done' : 'failed', result };
      });
    case 'rejected':
      return updateAction(thread, event.actionId, (state) =>
        state.status === 'proposed' || state.status === 'failed' ? { ...state, status: 'rejected' } : state,
      );
  }
}
