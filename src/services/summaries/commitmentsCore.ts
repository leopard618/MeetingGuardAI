/**
 * Pure pieces of the summary commitments (owner: summaries-app; M11, docs/v2/M11-DESIGN.md
 * sections 3, 6 and 7): the error mapping of the summaryCommitments callable, the i18n key of a
 * failure, and the list facts ("Review commitments (5)") of an answer. No Firebase, no React:
 * screen models and their tests import this file directly.
 *
 * Error mapping (HttpsError.details.reason, COMMITMENT_ERROR_CODES, onto the existing AppError
 * codes; the reason is kept in details.reason and read back with commitmentErrorReason):
 *   unauthenticated -> unauthenticated      invalid_meeting -> invalid_input
 *   not_enabled     -> not_configured       rate_limited    -> quota_exceeded
 *   not_allowed     -> permission_denied    upstream_error  -> upstream_error
 *   not_ready       -> not_configured       quota_exceeded  -> quota_exceeded (details.usage kept)
 *   invalid_request -> invalid_input        stale           -> conflict (the app reloads)
 *   not_found       -> not_found
 * A callable that is not deployed answers functions/not-found WITHOUT details: not_enabled, exactly
 * as the M10 service reads a missing summaryRead. The AppErrors made here never carry the raw
 * error as `cause` and use a fixed message, so no summary content (titles, quotes, owners) can
 * reach logs or Sentry through them. details.usage holds only the allowance numbers.
 */
import {
  COMMITMENT_ERROR_CODES,
  assistantUsageSchema,
  commitmentErrorDetailsSchema,
  type AssistantUsage,
  type CommitmentErrorCode,
  type SummaryCommitments,
  type SummaryCommitmentsResponse,
  type SummaryListCommitments,
} from '../../core/aiContract';
import { AppError, errorMessageKey, isAppError, toAppError, type AppErrorCode } from '../../core/errors';

// ---- Errors --------------------------------------------------------------------------------------

const REASON_TO_APP_CODE: Readonly<Record<CommitmentErrorCode, AppErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_enabled: 'not_configured',
  not_allowed: 'permission_denied',
  not_ready: 'not_configured',
  invalid_request: 'invalid_input',
  not_found: 'not_found',
  invalid_meeting: 'invalid_input',
  rate_limited: 'quota_exceeded',
  upstream_error: 'upstream_error',
  quota_exceeded: 'quota_exceeded',
  stale: 'conflict',
};

const COMMITMENT_ERROR_CODE_SET: ReadonlySet<string> = new Set(COMMITMENT_ERROR_CODES);

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

/** The Firebase callable client reports a fetch that never reached the server as "internal [0]". */
function isStatusZero(message: string): boolean {
  return /\[0\]\s*$/.test(message);
}

function isNetworkMessage(message: string): boolean {
  return /network request failed|failed to fetch|network error|internet connection appears to be offline/i.test(message);
}

/** The AppError for one COMMITMENT_ERROR_CODES value (details.reason keeps it; usage for quota_exceeded). */
export function commitmentAppError(reason: CommitmentErrorCode, providerCode: string | null = null, usage?: AssistantUsage): AppError {
  const details: Record<string, unknown> = { reason, providerCode };
  if (usage !== undefined) details.usage = usage;
  return new AppError(REASON_TO_APP_CODE[reason], `summary commitments ${reason}`, { details });
}

/**
 * Normalizes anything summaryCommitments throws into an AppError (AppErrors pass unchanged).
 * `offline` is the connectivity probe's answer after the failure (improves the status-0
 * "internal" mapping).
 */
export function mapCommitmentError(error: unknown, context: { offline?: boolean } = {}): AppError {
  if (isAppError(error)) return error;
  const providerCode = readCode(error);
  const message = readMessage(error);
  const rawDetails = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  const details = commitmentErrorDetailsSchema.safeParse(rawDetails);
  if (details.success) return commitmentAppError(details.data.reason, providerCode, details.data.usage);
  if (providerCode !== null && providerCode.startsWith('functions/')) {
    const bare = providerCode.slice('functions/'.length);
    // A callable that is not deployed (summaryCommitments ships only with SUMMARIES_ENABLED).
    if (bare === 'not-found') return commitmentAppError('not_enabled', providerCode);
    if (bare === 'deadline-exceeded') {
      return new AppError('timeout', 'summary commitments request timed out', { details: { providerCode } });
    }
    if (bare === 'internal' && (isStatusZero(message) || context.offline === true)) {
      return new AppError('offline', 'summary commitments unreachable', { details: { providerCode } });
    }
  }
  if (context.offline === true || isNetworkMessage(message)) {
    return new AppError('offline', 'summary commitments unreachable', { details: providerCode !== null ? { providerCode } : undefined });
  }
  const generic = toAppError(error, 'upstream_error');
  return new AppError(generic.code, `summary commitments ${generic.code}`, {
    details: providerCode !== null ? { providerCode } : undefined,
  });
}

/** The summaryCommitments taxonomy reason (COMMITMENT_ERROR_CODES) an AppError carries, or null. */
export function commitmentErrorReason(error: AppError | null | undefined): CommitmentErrorCode | null {
  const reason = error?.details?.reason;
  return typeof reason === 'string' && COMMITMENT_ERROR_CODE_SET.has(reason) ? (reason as CommitmentErrorCode) : null;
}

/** quota_exceeded: the allowance the server sent (used, limit, plan, resetsAt), else null. */
export function commitmentErrorUsage(error: AppError | null | undefined): AssistantUsage | null {
  if (commitmentErrorReason(error) !== 'quota_exceeded') return null;
  const parsed = assistantUsageSchema.safeParse(error?.details?.usage);
  return parsed.success ? parsed.data : null;
}

/** The feature is off (or summaryCommitments is not deployed) or the caller left the pilot: hide the UI. */
export function isCommitmentsUnavailableError(error: AppError | null | undefined): boolean {
  const reason = commitmentErrorReason(error);
  return reason === 'not_enabled' || reason === 'not_allowed';
}

/** Reasons with their own text under summaries:commitments.errors (the others use summaries:errors). */
const OWN_MESSAGE_REASONS: ReadonlySet<CommitmentErrorCode> = new Set<CommitmentErrorCode>([
  'quota_exceeded',
  'stale',
  'upstream_error',
  'not_found',
  'invalid_request',
]);

/**
 * i18n key for a failed summaryCommitments call: summaries:commitments.errors.<reason> for the
 * reasons M11 words itself, summaries:errors.<reason> for the other server reasons, the
 * commitments offline and timeout texts, else the generic one.
 */
export function commitmentErrorMessageKey(error: AppError): string {
  const reason = commitmentErrorReason(error);
  if (reason !== null) {
    return OWN_MESSAGE_REASONS.has(reason) ? `summaries:commitments.errors.${reason}` : `summaries:errors.${reason}`;
  }
  if (error.code === 'offline' || error.code === 'timeout') return `summaries:commitments.errors.${error.code}`;
  if (error.code === 'unauthenticated') return 'summaries:errors.unauthenticated';
  if (error.code === 'not_configured') return errorMessageKey('not_configured');
  return 'summaries:commitments.errors.generic';
}

// ---- List facts ----------------------------------------------------------------------------------

/** Open and accepted counts of a list of suggestions (what a summaryRead row carries). */
export function commitmentCounts(commitments: Pick<SummaryCommitments, 'items'>): { open: number; accepted: number } {
  let open = 0;
  let accepted = 0;
  for (const item of commitments.items) {
    if (item.status === 'open') open += 1;
    else if (item.status === 'accepted') accepted += 1;
  }
  return { open, accepted };
}

/**
 * The summaryRead row facts ("Review commitments (5)") an answer implies, or null when the answer
 * carries no list (none, preparing, or stale after the text changed): the row then keeps what the
 * server last listed.
 */
export function commitmentListFacts(response: Pick<SummaryCommitmentsResponse, 'state' | 'commitments'>): SummaryListCommitments | null {
  if (response.commitments === null) return null;
  return { state: response.state, ...commitmentCounts(response.commitments) };
}
