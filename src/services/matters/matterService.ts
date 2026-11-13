/**
 * MATTERS service (executive assistant prototype, A1; docs/v1/ARCHITECTURE.md section 36).
 *
 * - Callables matterDraft / matterRevise / matterConfirm / matterCancel over the shared Firebase
 *   Functions instance (src/config/firebase.ts) with MATTER_CALL_TIMEOUT_MS. Requests and
 *   responses are validated with the zod schemas of the shared contract.
 * - HttpsError.details.reason maps to AppError codes; the server reason is kept in
 *   details.reason so the screen can word 'stale_draft' and 'not_allowed' itself.
 * - Shown only when env.mattersEnabled (EXPO_PUBLIC_MATTERS_ENABLED); the server also gates it.
 * - Never logs the user's words, addresses or email text: error codes only.
 */
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  MATTER_CALL_TIMEOUT_MS,
  matterCancelRequestSchema,
  matterCancelResponseSchema,
  matterConfirmRequestSchema,
  matterConfirmResponseSchema,
  matterDraftRequestSchema,
  matterDraftResponseSchema,
  matterErrorDetailsSchema,
  matterReviseRequestSchema,
  type Language,
  type MatterCancelResponse,
  type MatterConfirmResponse,
  type MatterDraftResponse,
  type MatterErrorCode,
} from '../../core/aiContract';
import { AppError, isAppError, toAppError, type AppErrorCode } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { env } from '../../config/env';
import { functions } from '../../config/firebase';

const log = createLogger('matters');

export type MatterCallableName =
  | typeof CALLABLES.matterDraft
  | typeof CALLABLES.matterRevise
  | typeof CALLABLES.matterConfirm
  | typeof CALLABLES.matterCancel;

export interface MatterTransport {
  call(name: MatterCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown>;
}

export interface MatterService {
  /** Whether this build shows the assistant's matters at all. */
  isEnabled(): boolean;
  draft(input: { text: string; source: 'text' | 'voice'; language: Language; timeZone: string }): Promise<MatterDraftResponse>;
  revise(matterId: string, answer: string): Promise<MatterDraftResponse>;
  confirm(matterId: string, draftHash: string): Promise<MatterConfirmResponse>;
  cancel(matterId: string): Promise<MatterCancelResponse>;
}

const REASON_TO_APP_CODE: Readonly<Record<MatterErrorCode, AppErrorCode>> = {
  not_configured: 'not_configured',
  unauthenticated: 'unauthenticated',
  invalid_request: 'invalid_input',
  not_found: 'not_found',
  stale_draft: 'conflict',
  not_allowed: 'permission_denied',
  rate_limited: 'quota_exceeded',
  upstream_error: 'upstream_error',
};

function readCode(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' ? code : null;
}

/** Normalizes anything a matter* callable throws into an AppError (details.reason = the server reason). */
export function mapMatterError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const providerCode = readCode(error);
  const rawDetails = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  const details = matterErrorDetailsSchema.safeParse(rawDetails);
  if (details.success) {
    return new AppError(REASON_TO_APP_CODE[details.data.reason], `matters ${details.data.reason}`, {
      cause: error,
      details: { reason: details.data.reason, providerCode },
    });
  }
  if (providerCode === 'functions/deadline-exceeded') {
    return new AppError('timeout', 'matters request timed out', { cause: error, details: { providerCode } });
  }
  return toAppError(error, 'upstream_error');
}

export interface MatterServiceDeps {
  getTransport(): MatterTransport | null;
  enabled(): boolean;
  timeoutMs?: number;
}

export function createMatterService(deps: MatterServiceDeps): MatterService {
  const timeoutMs = deps.timeoutMs ?? MATTER_CALL_TIMEOUT_MS;

  async function call<T>(name: MatterCallableName, request: unknown, parse: (raw: unknown) => { success: true; data: T } | { success: false }): Promise<T> {
    if (!deps.enabled()) throw new AppError('not_configured', 'The assistant is off in this build');
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    let raw: unknown;
    try {
      raw = await transport.call(name, request, { timeoutMs });
    } catch (error) {
      const mapped = mapMatterError(error);
      log.warn('matters call failed', { name, code: mapped.code });
      throw mapped;
    }
    const parsed = parse(raw);
    if (!parsed.success) throw new AppError('upstream_error', `invalid ${name} response`);
    return parsed.data;
  }

  function validated<S extends { safeParse(value: unknown): { success: boolean } }>(schema: S, value: unknown): unknown {
    if (!schema.safeParse(value).success) throw new AppError('invalid_input', 'invalid matter request');
    return value;
  }

  return {
    isEnabled: () => deps.enabled(),
    draft: async (input) =>
      call(CALLABLES.matterDraft, validated(matterDraftRequestSchema, { ...input, text: input.text.trim() }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    revise: async (matterId, answer) =>
      call(CALLABLES.matterRevise, validated(matterReviseRequestSchema, { matterId, answer: answer.trim() }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    confirm: async (matterId, draftHash) =>
      call(CALLABLES.matterConfirm, validated(matterConfirmRequestSchema, { matterId, draftHash }), (raw) => matterConfirmResponseSchema.safeParse(raw)),
    cancel: async (matterId) => call(CALLABLES.matterCancel, validated(matterCancelRequestSchema, { matterId }), (raw) => matterCancelResponseSchema.safeParse(raw)),
  };
}

/** The real transport: httpsCallable on the shared Functions instance. */
function firebaseTransport(): MatterTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(name, request, options) {
      const callable = httpsCallable(instance, name, { timeout: options.timeoutMs });
      return (await callable(request)).data;
    },
  };
}

export const matterService: MatterService = createMatterService({
  getTransport: firebaseTransport,
  enabled: () => env.mattersEnabled,
});
