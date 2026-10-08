/**
 * Assistant errors: `HttpsError(ASSISTANT_ERROR_HTTPS_CODES[reason], message, { reason, usage })`.
 * Messages are generic English (the app shows its own localized text from `details.reason`);
 * they never contain user data or upstream error bodies.
 */
import { HttpsError } from 'firebase-functions/https';

import {
  ASSISTANT_ERROR_HTTPS_CODES,
  type AssistantErrorCode,
  type AssistantErrorDetails,
  type AssistantUsage,
} from '../shared/aiContract';

const DEFAULT_MESSAGES: Readonly<Record<AssistantErrorCode, string>> = {
  quota_exceeded: 'Daily assistant limit reached.',
  unauthenticated: 'Sign in to use the assistant.',
  invalid_request: 'Invalid assistant request.',
  upstream_error: 'The assistant is temporarily unavailable. Please try again.',
};

export function assistantError(
  reason: AssistantErrorCode,
  message: string = DEFAULT_MESSAGES[reason],
  usage: AssistantUsage | null = null,
): HttpsError {
  const details: AssistantErrorDetails = { reason, usage };
  return new HttpsError(ASSISTANT_ERROR_HTTPS_CODES[reason], message, details);
}

/** Thrown by the LLM adapter; `kind` drives logging severity only (the client sees upstream_error). */
export class UpstreamError extends Error {
  constructor(
    readonly kind: 'configuration' | 'rate_limited' | 'timeout' | 'connection' | 'server' | 'bad_request' | 'unknown',
    readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(`Upstream error: ${kind}${status !== null ? ` (${status})` : ''}`, options);
    this.name = 'UpstreamError';
  }
}
