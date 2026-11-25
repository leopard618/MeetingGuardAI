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
 * - A2: matterDecide (approve or decline a card, accept or drop a commitment) and matterView (the
 *   open matters, or one matter with its pending cards and open commitments). The server reads
 *   them for the signed-in owner, so the app needs no Firestore rule for the cards.
 * - A3: matterSetStatus (pause, resume), matterChange (draft a change, then confirm it with its
 *   hash), matterAsk (a question or instruction by voice or text: the server only answers or
 *   names the action, the screen confirms it) and matterSpeak (the natural voice, demo only).
 * - A3 feedback: matterMessage (the owner's words become an email card to send) and matterMove (read the new
 *   time of the booked meeting, then move it on the time the owner confirmed). Neither sends: the
 *   owner sends the card with decide.
 * - A4: matterDelete (the owner removes a matter with its emails and history) and matterUsage (the
 *   usage meter). A rate_limited error keeps the limit it names in details.limit.
 */
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  MATTER_CALL_TIMEOUT_MS,
  matterCancelRequestSchema,
  matterCancelResponseSchema,
  matterDecideRequestSchema,
  matterDecideResponseSchema,
  matterViewRequestSchema,
  matterViewResponseSchema,
  matterAskRequestSchema,
  matterAskResponseSchema,
  matterChangeRequestSchema,
  matterSetStatusRequestSchema,
  matterSetStatusResponseSchema,
  matterSpeakRequestSchema,
  matterSpeakResponseSchema,
  matterMessageRequestSchema,
  matterMessageResponseSchema,
  matterMoveRequestSchema,
  matterMoveResponseSchema,
  matterDeleteRequestSchema,
  matterDeleteResponseSchema,
  matterUsageResponseSchema,
  matterConfirmRequestSchema,
  matterConfirmResponseSchema,
  matterDraftRequestSchema,
  matterDraftResponseSchema,
  matterErrorDetailsSchema,
  matterReviseRequestSchema,
  type Language,
  type MatterCancelResponse,
  type MatterConfirmResponse,
  type MatterDecideRequest,
  type MatterDecideResponse,
  type MatterDraftResponse,
  type MatterErrorCode,
  type MatterViewResponse,
  type MatterAskResponse,
  type MatterMessageResponse,
  type MatterMoveResponse,
  type MatterDeleteResponse,
  type MatterUsageResponse,
  type MatterSetStatusResponse,
  type MatterSpeakResponse,
  type MatterStatusAction,
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
  | typeof CALLABLES.matterCancel
  | typeof CALLABLES.matterDecide
  | typeof CALLABLES.matterView
  | typeof CALLABLES.matterSetStatus
  | typeof CALLABLES.matterChange
  | typeof CALLABLES.matterAsk
  | typeof CALLABLES.matterSpeak
  | typeof CALLABLES.matterMessage
  | typeof CALLABLES.matterMove
  | typeof CALLABLES.matterDelete
  | typeof CALLABLES.matterUsage;

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
  /** A2: approve or decline a card, accept or drop a proposed commitment. */
  decide(request: MatterDecideRequest): Promise<MatterDecideResponse>;
  /** A2: the signed-in user's active and paused matters, newest first (matterView). */
  listOpen(): Promise<MatterOpenItem[]>;
  /** A2: one matter with its pending cards and open commitments; null when it does not exist (matterView). */
  getPage(matterId: string): Promise<MatterPage | null>;
  /** A3: pause or resume a running matter. */
  setStatus(matterId: string, action: MatterStatusAction): Promise<MatterSetStatusResponse>;
  /** A3: draft a change of a running matter (or answer its questions); answers with its read-back and hash. */
  change(matterId: string, text: string): Promise<MatterDraftResponse>;
  /** A3: apply the drafted change the user read (its hash). */
  confirmChange(matterId: string, draftHash: string): Promise<MatterDraftResponse>;
  /** A3: a question or instruction about the matters, typed or spoken. */
  ask(input: { text: string; language: Language; matterId?: string }): Promise<MatterAskResponse>;
  /** A3: the natural voice (demo only): an MP3 of the text, base64. */
  speak(input: { text: string; language: Language; matterId?: string }): Promise<MatterSpeakResponse>;
  /** A3 feedback: the owner's words for an email to the contact: a card to send (or a question back). */
  message(matterId: string, text: string): Promise<MatterMessageResponse>;
  /** A3 feedback: reads the new time of the booked meeting from the owner's words; nothing changes. */
  readNewTime(matterId: string, text: string): Promise<MatterMoveResponse>;
  /** A3 feedback: moves the booked meeting to the time the owner confirmed; the email to the contact is a card. */
  moveMeeting(matterId: string, start: string): Promise<MatterMoveResponse>;
  /** A4: removes a matter with its emails and history (a running one stops first). */
  remove(matterId: string): Promise<MatterDeleteResponse>;
  /** A4: the usage meter (this month's allowance and today's limits). */
  usage(): Promise<MatterUsageResponse>;
}

export type MatterOpenItem = NonNullable<MatterViewResponse['matters']>[number];
export type MatterPage = NonNullable<MatterViewResponse['page']>;

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
      details: { reason: details.data.reason, providerCode, ...(details.data.limit ? { limit: details.data.limit } : {}) },
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
    decide: async (request) => call(CALLABLES.matterDecide, validated(matterDecideRequestSchema, request), (raw) => matterDecideResponseSchema.safeParse(raw)),
    listOpen: async () => (await call(CALLABLES.matterView, {}, (raw) => matterViewResponseSchema.safeParse(raw))).matters ?? [],
    getPage: async (matterId) =>
      (await call(CALLABLES.matterView, validated(matterViewRequestSchema, { matterId }), (raw) => matterViewResponseSchema.safeParse(raw))).page,
    setStatus: async (matterId, action) =>
      call(CALLABLES.matterSetStatus, validated(matterSetStatusRequestSchema, { matterId, action }), (raw) => matterSetStatusResponseSchema.safeParse(raw)),
    change: async (matterId, text) =>
      call(CALLABLES.matterChange, validated(matterChangeRequestSchema, { matterId, text: text.trim() }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    confirmChange: async (matterId, draftHash) =>
      call(CALLABLES.matterChange, validated(matterChangeRequestSchema, { matterId, draftHash }), (raw) => matterDraftResponseSchema.safeParse(raw)),
    ask: async (input) =>
      call(CALLABLES.matterAsk, validated(matterAskRequestSchema, { ...input, text: input.text.trim() }), (raw) => matterAskResponseSchema.safeParse(raw)),
    speak: async (input) =>
      call(CALLABLES.matterSpeak, validated(matterSpeakRequestSchema, { ...input, text: input.text.trim() }), (raw) => matterSpeakResponseSchema.safeParse(raw)),
    message: async (matterId, text) =>
      call(CALLABLES.matterMessage, validated(matterMessageRequestSchema, { matterId, text: text.trim() }), (raw) => matterMessageResponseSchema.safeParse(raw)),
    readNewTime: async (matterId, text) =>
      call(CALLABLES.matterMove, validated(matterMoveRequestSchema, { matterId, text: text.trim() }), (raw) => matterMoveResponseSchema.safeParse(raw)),
    moveMeeting: async (matterId, start) =>
      call(CALLABLES.matterMove, validated(matterMoveRequestSchema, { matterId, start }), (raw) => matterMoveResponseSchema.safeParse(raw)),
    remove: async (matterId) => call(CALLABLES.matterDelete, validated(matterDeleteRequestSchema, { matterId }), (raw) => matterDeleteResponseSchema.safeParse(raw)),
    usage: async () => call(CALLABLES.matterUsage, {}, (raw) => matterUsageResponseSchema.safeParse(raw)),
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
