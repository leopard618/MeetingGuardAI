/**
 * Assistant callable client (transport-agnostic core; the Firebase transport lives in
 * ./firebaseTransport.ts so this module stays pure and unit-testable).
 *
 * - Validates the request (assistantRequestSchema) before sending and the response after receiving
 *   it. An invalid envelope (reply, suggestions, usage) is an upstream error, never a
 *   partially-trusted result. Each proposed action is validated on its own (aiActionSchema): an
 *   action this app version does not understand (a kind or enum value added on the server later)
 *   is dropped and logged, so a newer server never breaks older installs (docs/DEPLOYMENT.md §6).
 * - Maps every failure to AppError:
 *     quota_exceeded (details.usage from HttpsError.details), unauthenticated, invalid_input,
 *     upstream_error, offline, timeout; not_configured when Firebase is not set up in this build.
 * - Never logs message content (only error codes / issue paths).
 */
import { z } from 'zod';

import {
  AI_LIMITS,
  ASSISTANT_CALL_TIMEOUT_MS,
  aiActionSchema,
  assistantErrorCodeFromFunctionsCode,
  assistantErrorDetailsSchema,
  assistantRequestSchema,
  assistantResponseSchema,
  type AiAction,
  type AssistantErrorCode,
  type AssistantRequest,
  type AssistantResponse,
  type AssistantUsage,
} from '../../core/aiContract';
import type { AssistantClient } from '../../core/contracts';
import { AppError, isAppError, type AppErrorCode } from '../../core/errors';
import { createLogger } from '../../core/logger';

const log = createLogger('ai.client');

/** Sends a validated request to the "assistant" callable and resolves with the raw `data`. */
export interface AssistantTransport {
  call(request: AssistantRequest, options: { timeoutMs: number }): Promise<unknown>;
}

export interface ConnectivityProbe {
  /** true only when the device is known to be offline (unknown => false). */
  isOffline(): Promise<boolean>;
}

export interface AssistantClientDeps {
  /** null when Firebase is not configured in this build. */
  getTransport(): AssistantTransport | null;
  connectivity?: ConnectivityProbe;
  timeoutMs?: number;
}

const REASON_TO_APP_CODE: Readonly<Record<AssistantErrorCode, AppErrorCode>> = {
  quota_exceeded: 'quota_exceeded',
  unauthenticated: 'unauthenticated',
  invalid_request: 'invalid_input',
  upstream_error: 'upstream_error',
};

function issuePaths(issues: readonly { path: readonly PropertyKey[]; code: string }[]): { path: string; code: string }[] {
  return issues.slice(0, 10).map((issue) => ({ path: issue.path.map(String).join('.'), code: issue.code }));
}

function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return typeof error === 'string' ? error : '';
}

/**
 * The Firebase callable client turns a fetch that never reached the server into
 * `functions/internal` with the message "internal [0]" (HTTP status 0).
 */
function isStatusZero(message: string): boolean {
  return /\[0\]\s*$/.test(message);
}

function isNetworkMessage(message: string): boolean {
  return /network request failed|failed to fetch|network error|internet connection appears to be offline/i.test(message);
}

/**
 * Normalizes anything the callable throws into an AppError.
 * `offline` = the connectivity probe's answer after the failure (improves status-0 mapping).
 */
export function mapAssistantError(error: unknown, context: { offline?: boolean } = {}): AppError {
  if (isAppError(error)) return error;

  const providerCode = readCode(error);
  const message = readMessage(error);
  const rawDetails = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  const details = assistantErrorDetailsSchema.safeParse(rawDetails);

  if (details.success) {
    const code = REASON_TO_APP_CODE[details.data.reason];
    return new AppError(code, `assistant ${details.data.reason}`, {
      cause: error,
      details: { reason: details.data.reason, usage: details.data.usage, providerCode },
    });
  }

  if (providerCode !== null && providerCode.startsWith('functions/')) {
    const bare = providerCode.slice('functions/'.length);
    if (bare === 'deadline-exceeded') {
      return new AppError('timeout', 'assistant request timed out', { cause: error, details: { providerCode } });
    }
    if (bare === 'internal' && (isStatusZero(message) || context.offline === true)) {
      return new AppError('offline', 'assistant unreachable', { cause: error, details: { providerCode } });
    }
    const reason = assistantErrorCodeFromFunctionsCode(providerCode);
    return new AppError(REASON_TO_APP_CODE[reason], `assistant ${reason}`, {
      cause: error,
      details: { reason, usage: null, providerCode },
    });
  }

  if (context.offline === true || isNetworkMessage(message)) {
    return new AppError('offline', 'assistant unreachable', { cause: error });
  }
  return new AppError('upstream_error', 'assistant request failed', {
    cause: error,
    details: providerCode !== null ? { providerCode } : undefined,
  });
}

/** Usage attached to a quota_exceeded AppError (null when the server did not send it). */
export function quotaUsageFromError(error: AppError | null | undefined): AssistantUsage | null {
  if (!error || error.code !== 'quota_exceeded') return null;
  const usage = error.details?.usage;
  return usage && typeof usage === 'object' ? (usage as AssistantUsage) : null;
}

/** The response envelope with the actions still unchecked (they are validated one by one). */
const responseEnvelopeSchema = assistantResponseSchema.extend({
  actions: z.array(z.unknown()).max(AI_LIMITS.maxActions),
});

function actionTypeOf(value: unknown): string {
  const type = typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined;
  return typeof type === 'string' && /^[a-z_]{1,40}$/.test(type) ? type : 'unknown';
}

/**
 * Validates a raw callable result. Throws AppError('upstream_error') when the envelope breaks the
 * contract; drops (and logs) the actions that do not validate, keeping the valid ones.
 */
export function parseAssistantResponse(raw: unknown): AssistantResponse {
  const parsed = responseEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = issuePaths(parsed.error.issues);
    log.warn('assistant response failed validation', issues);
    throw new AppError('upstream_error', 'Invalid assistant response', { details: { issues } });
  }
  const actions: AiAction[] = [];
  const dropped: string[] = [];
  for (const candidate of parsed.data.actions) {
    const action = aiActionSchema.safeParse(candidate);
    if (action.success) actions.push(action.data);
    else dropped.push(actionTypeOf(candidate));
  }
  if (dropped.length > 0) {
    // Only the action kinds (contract enum values), never their content.
    log.warn('dropped assistant actions this version cannot use', dropped);
  }
  return { ...parsed.data, actions };
}

export function createAssistantClient(deps: AssistantClientDeps): AssistantClient {
  const timeoutMs = deps.timeoutMs ?? ASSISTANT_CALL_TIMEOUT_MS;

  async function probeOffline(): Promise<boolean> {
    if (!deps.connectivity) return false;
    try {
      return await deps.connectivity.isOffline();
    } catch {
      return false;
    }
  }

  return {
    async send(request: AssistantRequest): Promise<AssistantResponse> {
      const checked = assistantRequestSchema.safeParse(request);
      if (!checked.success) {
        throw new AppError('invalid_input', 'Invalid assistant request', {
          details: { issues: issuePaths(checked.error.issues) },
        });
      }
      const transport = deps.getTransport();
      if (!transport) {
        throw new AppError('not_configured', 'Firebase is not configured in this build');
      }
      if (await probeOffline()) {
        throw new AppError('offline', 'Device is offline');
      }

      let raw: unknown;
      try {
        raw = await transport.call(checked.data, { timeoutMs });
      } catch (error) {
        const mapped = mapAssistantError(error, { offline: await probeOffline() });
        if (mapped.code === 'upstream_error' || mapped.code === 'unknown') {
          log.warn('assistant call failed', { code: mapped.code, providerCode: mapped.details?.providerCode ?? null });
        }
        throw mapped;
      }
      return parseAssistantResponse(raw);
    },
  };
}
