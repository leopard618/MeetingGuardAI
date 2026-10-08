/**
 * Application error model.
 *
 * Conventions (all areas):
 * - Services throw `AppError` (never return fake success, never swallow and return []/null for a
 *   failure). "Nothing found" is a normal value (null / []); a failure is an AppError.
 * - Wrap unknown errors at module boundaries with `toAppError(e)`; keep the original as `cause`.
 * - UI shows `t(errorMessageKey(err.code))` ("common:errors.<code>", EN+ES in common.json).
 * - `cancelled` is not an error to display (user dismissed a dialog / sign-in sheet).
 * - Never put tokens, emails or meeting content in `message` / `details` (they reach logs/Sentry).
 */

export const APP_ERROR_CODES = [
  'not_configured',
  'not_implemented',
  'unauthenticated',
  'permission_denied',
  'offline',
  'timeout',
  'not_found',
  'invalid_input',
  'conflict',
  'quota_exceeded',
  'upstream_error',
  'cancelled',
  'unsupported',
  'pending_writes',
  'google_not_signed_in',
  'calendar_scope_missing',
  'calendar_not_connected',
  'calendar_permission_denied',
  'notification_permission_denied',
  'unknown',
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(APP_ERROR_CODES);

export interface AppErrorOptions {
  cause?: unknown;
  /** Small, non-sensitive diagnostic data (ids, counts, provider codes). */
  details?: Record<string, unknown>;
  /** Whether retrying the same operation later can succeed (defaults per code). */
  retryable?: boolean;
}

const RETRYABLE_BY_DEFAULT: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'offline',
  'timeout',
  'upstream_error',
  'conflict',
]);

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;
  override readonly cause: unknown;

  constructor(code: AppErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(code);
    this.cause = options.cause;
  }

  /** i18n key of the user-facing message ("common:errors.<code>"). */
  get messageKey(): string {
    return errorMessageKey(this.code);
  }
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AppError' &&
    isAppErrorCode((error as { code?: unknown }).code)
  );
}

/** i18n key for an error code; every code has an EN+ES entry in common.json under "errors". */
export function errorMessageKey(code: AppErrorCode): string {
  return `common:errors.${code}`;
}

/** Stub helper: throws `AppError('not_implemented', 'not implemented: <name>')`. */
export function notImplemented(name: string): never {
  throw new AppError('not_implemented', `not implemented: ${name}`);
}

/** Maps provider error codes (Firebase Auth/Firestore/Functions, network) to AppErrorCode. */
const PROVIDER_CODE_MAP: Readonly<Record<string, AppErrorCode>> = {
  // Firestore / Functions canonical codes (Functions arrive prefixed with "functions/").
  unauthenticated: 'unauthenticated',
  'permission-denied': 'permission_denied',
  'not-found': 'not_found',
  'invalid-argument': 'invalid_input',
  'failed-precondition': 'invalid_input',
  'out-of-range': 'invalid_input',
  'already-exists': 'conflict',
  aborted: 'conflict',
  'resource-exhausted': 'quota_exceeded',
  'deadline-exceeded': 'timeout',
  cancelled: 'cancelled',
  unavailable: 'offline',
  internal: 'upstream_error',
  unknown: 'unknown',
  'data-loss': 'upstream_error',
  unimplemented: 'unsupported',
  // Firebase Auth
  'auth/network-request-failed': 'offline',
  'auth/user-token-expired': 'unauthenticated',
  'auth/user-disabled': 'permission_denied',
  'auth/invalid-credential': 'unauthenticated',
  'auth/invalid-email': 'invalid_input',
  'auth/wrong-password': 'unauthenticated',
  'auth/user-not-found': 'unauthenticated',
  'auth/email-already-in-use': 'conflict',
  'auth/weak-password': 'invalid_input',
  'auth/too-many-requests': 'quota_exceeded',
  'auth/requires-recent-login': 'unauthenticated',
};

/** Functions-specific overrides (a server-side "unavailable" is an upstream failure, not offline). */
const FUNCTIONS_CODE_MAP: Readonly<Record<string, AppErrorCode>> = {
  unavailable: 'upstream_error',
};

function mapProviderCode(rawCode: string): AppErrorCode | undefined {
  if (rawCode.startsWith('functions/')) {
    const bare = rawCode.slice('functions/'.length);
    return FUNCTIONS_CODE_MAP[bare] ?? PROVIDER_CODE_MAP[bare];
  }
  if (rawCode.startsWith('firestore/')) {
    return PROVIDER_CODE_MAP[rawCode.slice('firestore/'.length)];
  }
  return PROVIDER_CODE_MAP[rawCode];
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /network request failed|failed to fetch|network error/i.test(error.message);
}

/**
 * Normalizes anything thrown into an AppError (returns AppErrors unchanged).
 * The original error is kept as `cause`; the provider code (if any) goes to `details.providerCode`.
 */
export function toAppError(error: unknown, fallback: AppErrorCode = 'unknown'): AppError {
  if (isAppError(error)) return error;

  const rawCode =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? ((error as { code: string }).code as string)
      : undefined;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;

  if (rawCode !== undefined) {
    const mapped = mapProviderCode(rawCode);
    if (mapped) {
      return new AppError(mapped, message ?? mapped, { cause: error, details: { providerCode: rawCode } });
    }
  }
  if (isNetworkFailure(error)) {
    return new AppError('offline', message, { cause: error });
  }
  return new AppError(fallback, message ?? fallback, {
    cause: error,
    details: rawCode !== undefined ? { providerCode: rawCode } : undefined,
  });
}
