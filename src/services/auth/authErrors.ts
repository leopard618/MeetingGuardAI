/**
 * Auth error mapping (owner: auth). PURE: no React Native, Expo or Firebase imports, so it is
 * unit-tested directly.
 *
 * - Google Sign-In (native module) and Firebase Auth errors become `AppError`s whose
 *   `details.reason` (an `AuthErrorReason`) says precisely what went wrong, on top of the generic
 *   `AppErrorCode`.
 * - `authErrorMessageKey(error)` picks the friendliest translation key: the reason-specific
 *   `auth:errors.*` key when there is one, otherwise the code-level `auth:` key, otherwise the
 *   shared `common:errors.<code>` key.
 * - Messages never include tokens or emails (they reach logs and Sentry).
 */
import { AppError, isAppError, toAppError, type AppErrorCode } from '../../core/errors';

export const AUTH_ERROR_REASONS = [
  'firebase_not_configured',
  'google_not_configured',
  'google_developer_error',
  'google_sign_in_unavailable',
  'missing_id_token',
  'play_services_unavailable',
  'in_progress',
  'no_presenter',
  'google_sign_in_failed',
  'auth_recovery_required',
  'invalid_credentials',
  'invalid_email',
  'missing_password',
  'email_in_use',
  'weak_password',
  'user_disabled',
  'too_many_requests',
  'account_exists_different_credential',
  'provider_disabled',
  'session_expired',
  'invalid_server_response',
  'requires_recent_login',
  'user_mismatch',
  'apple_sign_in_unavailable',
  'apple_sign_in_failed',
  'apple_sign_in_rejected',
] as const;
export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

const REASON_SET: ReadonlySet<string> = new Set(AUTH_ERROR_REASONS);

/** The status codes exported by @react-native-google-signin/google-signin (read from native constants). */
export interface GoogleStatusCodes {
  SIGN_IN_CANCELLED: string;
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
  SIGN_IN_REQUIRED: string;
  NULL_PRESENTER: string;
}

/** Builds an AppError tagged with an auth reason (keeps the provider code for diagnostics). */
export function authError(
  code: AppErrorCode,
  reason: AuthErrorReason | null,
  message?: string,
  options: { cause?: unknown; providerCode?: string; retryable?: boolean } = {},
): AppError {
  const details: Record<string, unknown> = {};
  if (reason) details.reason = reason;
  if (options.providerCode !== undefined) details.providerCode = options.providerCode;
  return new AppError(code, message ?? reason ?? code, {
    cause: options.cause,
    details: Object.keys(details).length > 0 ? details : undefined,
    retryable: options.retryable,
  });
}

export function getAuthErrorReason(error: unknown): AuthErrorReason | null {
  if (!isAppError(error)) return null;
  const reason = error.details?.reason;
  return typeof reason === 'string' && REASON_SET.has(reason) ? (reason as AuthErrorReason) : null;
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  return undefined;
}

function errorMessageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Firebase Auth
// ---------------------------------------------------------------------------------------------

const FIREBASE_AUTH_CODES: Readonly<Record<string, { code: AppErrorCode; reason: AuthErrorReason | null }>> = {
  'auth/invalid-credential': { code: 'unauthenticated', reason: 'invalid_credentials' },
  'auth/invalid-login-credentials': { code: 'unauthenticated', reason: 'invalid_credentials' },
  'auth/wrong-password': { code: 'unauthenticated', reason: 'invalid_credentials' },
  'auth/user-not-found': { code: 'unauthenticated', reason: 'invalid_credentials' },
  'auth/invalid-email': { code: 'invalid_input', reason: 'invalid_email' },
  'auth/missing-email': { code: 'invalid_input', reason: 'invalid_email' },
  'auth/missing-password': { code: 'invalid_input', reason: 'missing_password' },
  'auth/email-already-in-use': { code: 'conflict', reason: 'email_in_use' },
  'auth/weak-password': { code: 'invalid_input', reason: 'weak_password' },
  'auth/user-disabled': { code: 'permission_denied', reason: 'user_disabled' },
  'auth/too-many-requests': { code: 'quota_exceeded', reason: 'too_many_requests' },
  'auth/account-exists-with-different-credential': {
    code: 'conflict',
    reason: 'account_exists_different_credential',
  },
  'auth/credential-already-in-use': { code: 'conflict', reason: 'account_exists_different_credential' },
  'auth/operation-not-allowed': { code: 'not_configured', reason: 'provider_disabled' },
  'auth/invalid-api-key': { code: 'not_configured', reason: 'firebase_not_configured' },
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': { code: 'not_configured', reason: 'firebase_not_configured' },
  'auth/app-not-authorized': { code: 'not_configured', reason: 'firebase_not_configured' },
  'auth/user-token-expired': { code: 'unauthenticated', reason: 'session_expired' },
  'auth/requires-recent-login': { code: 'unauthenticated', reason: 'requires_recent_login' },
  'auth/user-mismatch': { code: 'permission_denied', reason: 'user_mismatch' },
  'auth/network-request-failed': { code: 'offline', reason: null },
  'auth/internal-error': { code: 'upstream_error', reason: null },
};

/** Firebase Auth (and Functions) errors -> AppError with an auth reason where one applies. */
export function mapFirebaseAuthError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const providerCode = errorCodeOf(error);
  const known = providerCode ? FIREBASE_AUTH_CODES[providerCode] : undefined;
  if (known) {
    return authError(known.code, known.reason, providerCode, { cause: error, providerCode });
  }
  // Anything else (functions/*, firestore/*, network failures) uses the shared core mapping.
  return toAppError(error);
}

// ---------------------------------------------------------------------------------------------
// Google Sign-In (native)
// ---------------------------------------------------------------------------------------------

/** Android CommonStatusCodes / GoogleSignInStatusCodes and iOS NSURLError codes seen as strings. */
const ANDROID_NETWORK_ERROR = '7';
const ANDROID_DEVELOPER_ERROR = '10';
const ANDROID_INTERNAL_ERROR = '8';
const ANDROID_SIGN_IN_FAILED = '12500';
const ANDROID_CANCELED = '16';
const ANDROID_INVALID_ACCOUNT = '5';
const IOS_OFFLINE_CODES: ReadonlySet<string> = new Set(['-1009', '-1004', '-1005', '-1020']);
const IOS_TIMEOUT_CODE = '-1001';
/** The native module rejects getTokens with code "getTokens" when nobody is signed in or recovery failed. */
const GET_TOKENS_CODE = 'getTokens';

/**
 * Maps a rejection of the Google Sign-In native module. `codes` are the library's `statusCodes`
 * (their values come from native constants, so they are passed in rather than hard-coded).
 */
export function mapGoogleSignInError(error: unknown, codes: GoogleStatusCodes): AppError {
  if (isAppError(error)) return error;
  const providerCode = errorCodeOf(error);
  const message = errorMessageOf(error) ?? '';
  const opts = { cause: error, providerCode };

  switch (providerCode) {
    case undefined:
      break;
    case codes.SIGN_IN_CANCELLED:
    case ANDROID_CANCELED:
      return authError('cancelled', null, 'Google sign-in was cancelled', opts);
    case codes.IN_PROGRESS:
      return authError('conflict', 'in_progress', 'A Google sign-in operation is already in progress', {
        ...opts,
        retryable: true,
      });
    case codes.PLAY_SERVICES_NOT_AVAILABLE:
      return authError('unsupported', 'play_services_unavailable', 'Google Play Services is not available', opts);
    case codes.SIGN_IN_REQUIRED:
    case ANDROID_INVALID_ACCOUNT:
      return authError('google_not_signed_in', null, 'No Google account is signed in', opts);
    case codes.NULL_PRESENTER:
      return authError('unknown', 'no_presenter', 'The Google sign-in UI could not be presented', opts);
    case ANDROID_DEVELOPER_ERROR:
      return authError('not_configured', 'google_developer_error', 'Google Sign-In DEVELOPER_ERROR', opts);
    case ANDROID_NETWORK_ERROR:
      return authError('offline', null, 'Network error during Google sign-in', opts);
    case IOS_TIMEOUT_CODE:
      return authError('timeout', null, 'Google sign-in timed out', opts);
    case ANDROID_SIGN_IN_FAILED:
    case ANDROID_INTERNAL_ERROR:
      return authError('upstream_error', 'google_sign_in_failed', 'Google sign-in failed', {
        ...opts,
        retryable: true,
      });
    case GET_TOKENS_CODE:
      if (/signed in/i.test(message)) {
        return authError('google_not_signed_in', null, 'No Google account is signed in', opts);
      }
      if (/recover/i.test(message)) {
        return authError('google_not_signed_in', 'auth_recovery_required', 'Google needs the user to re-authenticate', opts);
      }
      break;
    default:
      if (IOS_OFFLINE_CODES.has(providerCode)) {
        return authError('offline', null, 'Network error during Google sign-in', opts);
      }
  }

  if (/network|internet connection|offline/i.test(message)) {
    return authError('offline', null, 'Network error during Google sign-in', opts);
  }
  if (/recover/i.test(message)) {
    return authError('google_not_signed_in', 'auth_recovery_required', 'Google needs the user to re-authenticate', opts);
  }
  return authError('upstream_error', 'google_sign_in_failed', 'Google sign-in failed', {
    ...opts,
    retryable: true,
  });
}

// ---------------------------------------------------------------------------------------------
// Sign in with Apple (expo-apple-authentication; iOS only - docs/v1/ARCHITECTURE.md §26)
// ---------------------------------------------------------------------------------------------

/** expo-apple-authentication rejection codes (CodedError.code). */
const APPLE_CANCELED = 'ERR_REQUEST_CANCELED';
const APPLE_UNKNOWN = 'ERR_REQUEST_UNKNOWN';
const APPLE_FAILED = 'ERR_REQUEST_FAILED';
const APPLE_NOT_HANDLED = 'ERR_REQUEST_NOT_HANDLED';
const APPLE_NOT_INTERACTIVE = 'ERR_REQUEST_NOT_INTERACTIVE';
const APPLE_INVALID_RESPONSE = 'ERR_INVALID_RESPONSE';
const APPLE_INVALID_SCOPE = 'ERR_INVALID_SCOPE';
const APPLE_INVALID_OPERATION = 'ERR_INVALID_OPERATION';

/**
 * Maps a rejection of expo-apple-authentication (signInAsync / getCredentialStateAsync).
 * ERR_REQUEST_UNKNOWN also fires when no Apple ID is signed in on the device, so it stays a
 * retryable user-facing failure, not a developer error.
 */
export function mapAppleSignInError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const providerCode = errorCodeOf(error);
  const opts = { cause: error, providerCode };
  switch (providerCode) {
    case APPLE_CANCELED:
      return authError('cancelled', null, 'Apple sign-in was cancelled', opts);
    case APPLE_INVALID_SCOPE:
    case APPLE_INVALID_OPERATION:
      return authError('unsupported', 'apple_sign_in_unavailable', 'Apple sign-in is not available', opts);
    case APPLE_UNKNOWN:
    case APPLE_FAILED:
    case APPLE_NOT_HANDLED:
    case APPLE_NOT_INTERACTIVE:
    case APPLE_INVALID_RESPONSE:
      return authError('upstream_error', 'apple_sign_in_failed', 'Apple sign-in failed', {
        ...opts,
        retryable: true,
      });
    default:
      return toAppError(error);
  }
}

// ---------------------------------------------------------------------------------------------
// User-facing message keys
// ---------------------------------------------------------------------------------------------

const REASON_MESSAGE_KEYS: Readonly<Record<AuthErrorReason, string>> = {
  firebase_not_configured: 'auth:errors.notConfigured',
  google_not_configured: 'auth:errors.googleNotConfigured',
  google_developer_error: 'auth:errors.googleDeveloperError',
  google_sign_in_unavailable: 'auth:errors.googleSignInUnavailable',
  missing_id_token: 'auth:errors.googleNotConfigured',
  play_services_unavailable: 'auth:errors.playServicesUnavailable',
  in_progress: 'auth:errors.inProgress',
  no_presenter: 'auth:errors.noPresenter',
  google_sign_in_failed: 'auth:errors.googleSignInFailed',
  auth_recovery_required: 'auth:errors.authRecoveryRequired',
  invalid_credentials: 'auth:errors.invalidCredentials',
  invalid_email: 'auth:errors.invalidEmail',
  missing_password: 'auth:errors.missingPassword',
  email_in_use: 'auth:errors.emailInUse',
  weak_password: 'auth:errors.weakPassword',
  user_disabled: 'auth:errors.userDisabled',
  too_many_requests: 'auth:errors.tooManyRequests',
  account_exists_different_credential: 'auth:errors.accountExistsDifferentCredential',
  provider_disabled: 'auth:errors.providerDisabled',
  session_expired: 'auth:errors.sessionExpired',
  invalid_server_response: 'auth:errors.invalidServerResponse',
  requires_recent_login: 'auth:errors.requiresRecentLogin',
  user_mismatch: 'auth:errors.userMismatch',
  apple_sign_in_unavailable: 'auth:errors.appleSignInUnavailable',
  apple_sign_in_failed: 'auth:errors.appleSignInFailed',
  apple_sign_in_rejected: 'auth:errors.appleSignInRejected',
};

const CODE_MESSAGE_KEYS: Partial<Readonly<Record<AppErrorCode, string>>> = {
  cancelled: 'auth:errors.cancelled',
  offline: 'auth:errors.offline',
  timeout: 'auth:errors.timeout',
  not_configured: 'auth:errors.notConfigured',
  unauthenticated: 'auth:errors.sessionExpired',
  google_not_signed_in: 'auth:errors.googleNotSignedIn',
  calendar_scope_missing: 'auth:errors.calendarScopeMissing',
  pending_writes: 'auth:errors.pendingWrites',
  quota_exceeded: 'auth:errors.tooManyRequests',
  unsupported: 'auth:errors.unsupported',
  upstream_error: 'auth:errors.upstreamError',
  unknown: 'auth:errors.unknown',
};

/** Every translation key authErrorMessageKey can return from the auth namespace (tests check EN/ES). */
export const AUTH_MESSAGE_KEYS: readonly string[] = [
  ...new Set([...Object.values(REASON_MESSAGE_KEYS), ...Object.values(CODE_MESSAGE_KEYS)]),
];

/** Translation key of the friendliest message for an auth-related error. */
export function authErrorMessageKey(error: unknown): string {
  const appError = isAppError(error) ? error : toAppError(error);
  const reason = getAuthErrorReason(appError);
  if (reason) return REASON_MESSAGE_KEYS[reason];
  return CODE_MESSAGE_KEYS[appError.code] ?? `common:errors.${appError.code}`;
}

/** Whether the error is worth reporting to Sentry (as opposed to an expected user/network condition). */
export function isUnexpectedAuthError(error: AppError): boolean {
  const reason = getAuthErrorReason(error);
  if (
    reason === 'google_developer_error' ||
    reason === 'google_sign_in_unavailable' ||
    reason === 'missing_id_token' ||
    reason === 'invalid_server_response'
  ) {
    return true;
  }
  return error.code === 'unknown' || error.code === 'not_configured' || error.code === 'upstream_error';
}
