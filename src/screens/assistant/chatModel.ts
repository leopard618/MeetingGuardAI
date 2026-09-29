/**
 * Pure view logic of the assistant chat (route "AIChat"): route params, what the chat shows
 * (error notice, suggestion chips, follow-up button, the actions under review) and the snackbar
 * summary after confirming. No React / React Native imports; unit-tested.
 */
import type { ActionResult, ProposedActionState, RootStackParamList } from '../../core/contracts';
import type { AppError } from '../../core/errors';
import { describeAssistantError, describeResult, type ErrorDescription, type Feedback } from '../../services/ai/presentation';
import type { AssistantFormatter, ChatMessage } from '../../services/ai/types';

/** Example prompts shown on an empty conversation (keys of ai:examples). */
export const EXAMPLE_KEYS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] as const;

/** How often the usage pill and relative reset times are re-evaluated. */
export const USAGE_CLOCK_MS = 60_000;

export interface ChatParams {
  followUpMeetingId: string | null;
  prefill: string;
  /** Set only by the app's own follow-up notification; external links show a button instead. */
  autoStartFollowUp: boolean;
}

export function parseChatParams(params: RootStackParamList['AIChat'] | null | undefined): ChatParams {
  const followup = params?.followup;
  return {
    followUpMeetingId: typeof followup === 'string' && followup.trim() !== '' ? followup : null,
    prefill: typeof params?.prefill === 'string' ? params.prefill : '',
    autoStartFollowUp: params?.autoStart === true,
  };
}

/** Message timestamp; an unusable value renders as an empty string instead of throwing. */
export function messageTime(fmt: AssistantFormatter, iso: string): string {
  try {
    return fmt.time(iso);
  } catch {
    return '';
  }
}

/**
 * Inline notice under the conversation: the request error, or "your last message wasn't sent"
 * when the last user message failed and can be retried.
 */
export function chatErrorDescription(
  fmt: AssistantFormatter,
  state: { error: AppError | null; messages: readonly ChatMessage[]; canRetry: boolean },
  now: Date,
): ErrorDescription | null {
  if (state.error) return describeAssistantError(fmt, state.error, now);
  const last = state.messages[state.messages.length - 1];
  if (last?.role === 'user' && last.delivery === 'failed' && state.canRetry) {
    return { message: fmt.t('ai:errors.notSent'), recovery: 'retry' };
  }
  return null;
}

/** Suggestion chips of the latest assistant reply (hidden while a request runs). */
export function visibleSuggestions(messages: readonly ChatMessage[], isSending: boolean): string[] {
  if (isSending) return [];
  const last = messages[messages.length - 1];
  return last && last.role === 'assistant' ? last.suggestions : [];
}

/** "Get follow-up ideas" button: an external follow-up link never spends a request by itself. */
export function canStartFollowUp(state: {
  followUpMeetingId: string | null;
  autoStartFollowUp: boolean;
  isLoaded: boolean;
  isSending: boolean;
  followUpsRequested: readonly string[] | undefined;
}): boolean {
  return (
    state.followUpMeetingId !== null &&
    !state.autoStartFollowUp &&
    state.isLoaded &&
    !state.isSending &&
    !(state.followUpsRequested ?? []).includes(state.followUpMeetingId)
  );
}

/** Actions under review that can still be confirmed (proposed, or failed and retryable). */
export function reviewableStates(
  reviewIds: readonly string[] | null,
  actions: Readonly<Record<string, ProposedActionState>>,
): ProposedActionState[] {
  return (reviewIds ?? [])
    .map((id) => actions[id])
    .filter((state): state is ProposedActionState => state !== undefined && (state.status === 'proposed' || state.status === 'failed'));
}

/**
 * Snackbar after confirming: one result is described as is; several are summarized. Cancelled
 * shares (the user closed the share sheet) are not reported. null when there is nothing to say.
 */
export function summarizeResults(fmt: AssistantFormatter, results: readonly ActionResult[]): Feedback | null {
  const shown = results.filter((result) => !(result.status === 'failed' && result.error.code === 'cancelled'));
  if (shown.length === 0) return null;
  if (shown.length === 1 && shown[0]) return describeResult(fmt, shown[0]);
  const done = shown.filter((result) => result.status === 'done').length;
  if (done === shown.length) return { tone: 'success', message: fmt.t('ai:results.allDone', { count: done }) };
  return { tone: 'warning', message: fmt.t('ai:results.someFailed', { done, total: shown.length }) };
}

/** Text that may be sent: trimmed, non-empty, and only while the assistant is idle and loaded. */
export function sendableText(text: string, state: { isSending: boolean; isLoaded: boolean }): string | null {
  const trimmed = text.trim();
  if (!trimmed || state.isSending || !state.isLoaded) return null;
  return trimmed;
}
