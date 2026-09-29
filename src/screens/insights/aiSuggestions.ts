/**
 * PURE helpers of the optional "Get AI suggestions" request on the insights screen. The request
 * goes through the app-wide assistant conversation (so the reply and any proposed changes are
 * also in the assistant chat, where changes are confirmed); these helpers find this screen's
 * request and reply among the conversation's messages.
 */
import type { AssistantChatMessage } from '../../core/contracts';

export type SuggestionStatus = 'idle' | 'sending' | 'done' | 'failed';

export interface SuggestionRequest {
  prompt: string;
  /** Ids of the conversation's messages before the request was sent. */
  beforeIds: ReadonlySet<string>;
}

export interface SuggestionState {
  status: SuggestionStatus;
  reply: AssistantChatMessage | null;
}

/**
 * The reply to `request`: the first NEW assistant message after the new user message with the
 * request's text. 'sending' until the send call has returned (`settled`) and the assistant is no
 * longer busy; 'failed' when it is over without a reply (error, the user message marked failed,
 * or the conversation was reset meanwhile).
 */
export function suggestionState(
  messages: readonly (AssistantChatMessage & { delivery?: 'sending' | 'failed' })[],
  request: SuggestionRequest | null,
  assistant: { isSending: boolean; settled: boolean },
): SuggestionState {
  if (request === null) return { status: 'idle', reply: null };
  const fresh = messages.filter((message) => !request.beforeIds.has(message.id));
  const questionIndex = fresh.findIndex((message) => message.role === 'user' && message.content === request.prompt);
  const reply = questionIndex >= 0 ? (fresh.slice(questionIndex + 1).find((message) => message.role === 'assistant') ?? null) : null;
  if (reply) return { status: 'done', reply };
  if (questionIndex >= 0 && fresh[questionIndex]?.delivery === 'failed') return { status: 'failed', reply: null };
  if (!assistant.settled || assistant.isSending) return { status: 'sending', reply: null };
  return { status: 'failed', reply: null };
}
