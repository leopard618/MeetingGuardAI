/**
 * Pure pieces of the summaries area (owner: summaries-app; M10 section 9): the status gate and
 * the error mapping. No Firebase, no React: screen models and their tests import this file
 * directly without mocking the transport.
 *
 * Error mapping (HttpsError.details.reason, SUMMARY_ERROR_CODES, onto the existing AppError
 * codes; the reason is kept in details.reason and read back with summaryErrorReason):
 *   unauthenticated -> unauthenticated      not_found       -> not_found
 *   not_enabled     -> not_configured       invalid_meeting -> invalid_input
 *   not_allowed     -> permission_denied    rate_limited    -> quota_exceeded
 *   not_ready       -> not_configured       upstream_error  -> upstream_error
 *   invalid_request -> invalid_input
 * A callable that is not deployed answers functions/not-found WITHOUT details: not_enabled.
 * The AppErrors made here never carry the raw error as `cause` and use a fixed message, so no
 * summary content (titles, addresses, codes) can reach logs or Sentry through them.
 */
import { SUMMARY_ERROR_CODES, summaryErrorDetailsSchema, type SummaryErrorCode, type SummaryStatusResponse } from '../../core/aiContract';
import { AppError, isAppError, toAppError, type AppErrorCode } from '../../core/errors';

// ---- Status gate ---------------------------------------------------------------------------------

/** What a build without Firebase, or a project without the summary functions, answers. */
export const SUMMARIES_DISABLED_STATUS: SummaryStatusResponse = {
  enabled: false,
  allowed: false,
  ready: false,
  address: null,
  mailboxes: [],
  gmailRequests: [],
  inboxCount: 0,
  lastReceivedAt: null,
  lastRefused: null,
  refusedToday: null,
};

/** The feature is switched on AND the caller is in the pilot: only then is any summary UI shown. */
export function isSummariesAvailable(status: SummaryStatusResponse | null | undefined): boolean {
  return status !== null && status !== undefined && status.enabled && status.allowed;
}

// ---- Errors --------------------------------------------------------------------------------------

const REASON_TO_APP_CODE: Readonly<Record<SummaryErrorCode, AppErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_enabled: 'not_configured',
  not_allowed: 'permission_denied',
  not_ready: 'not_configured',
  invalid_request: 'invalid_input',
  not_found: 'not_found',
  invalid_meeting: 'invalid_input',
  rate_limited: 'quota_exceeded',
  upstream_error: 'upstream_error',
};

const SUMMARY_ERROR_CODE_SET: ReadonlySet<string> = new Set(SUMMARY_ERROR_CODES);

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

/** The AppError for one SUMMARY_ERROR_CODES value (details.reason keeps it). */
export function summaryAppError(reason: SummaryErrorCode, providerCode: string | null = null): AppError {
  return new AppError(REASON_TO_APP_CODE[reason], `summaries ${reason}`, { details: { reason, providerCode } });
}

/**
 * Normalizes anything a summary* callable throws into an AppError (AppErrors pass unchanged).
 * `offline` is the connectivity probe's answer after the failure (improves the status-0
 * "internal" mapping).
 */
export function mapSummaryError(error: unknown, context: { offline?: boolean } = {}): AppError {
  if (isAppError(error)) return error;
  const providerCode = readCode(error);
  const message = readMessage(error);
  const rawDetails = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  const details = summaryErrorDetailsSchema.safeParse(rawDetails);
  if (details.success) return summaryAppError(details.data.reason, providerCode);
  if (providerCode !== null && providerCode.startsWith('functions/')) {
    const bare = providerCode.slice('functions/'.length);
    // A callable that is not deployed (summaryRead ships only with SUMMARIES_ENABLED).
    if (bare === 'not-found') return summaryAppError('not_enabled', providerCode);
    if (bare === 'deadline-exceeded') {
      return new AppError('timeout', 'summaries request timed out', { details: { providerCode } });
    }
    if (bare === 'internal' && (isStatusZero(message) || context.offline === true)) {
      return new AppError('offline', 'summaries unreachable', { details: { providerCode } });
    }
  }
  if (context.offline === true || isNetworkMessage(message)) {
    return new AppError('offline', 'summaries unreachable', { details: providerCode !== null ? { providerCode } : undefined });
  }
  const generic = toAppError(error, 'upstream_error');
  return new AppError(generic.code, `summaries ${generic.code}`, {
    details: providerCode !== null ? { providerCode } : undefined,
  });
}

/** The summary* taxonomy reason (SUMMARY_ERROR_CODES) an AppError carries, or null. */
export function summaryErrorReason(error: AppError | null | undefined): SummaryErrorCode | null {
  const reason = error?.details?.reason;
  return typeof reason === 'string' && SUMMARY_ERROR_CODE_SET.has(reason) ? (reason as SummaryErrorCode) : null;
}

/** The feature is off (or not deployed) or the caller is not in the pilot: hide the summary UI. */
export function isSummariesUnavailableError(error: AppError | null | undefined): boolean {
  const reason = summaryErrorReason(error);
  return reason === 'not_enabled' || reason === 'not_allowed';
}
