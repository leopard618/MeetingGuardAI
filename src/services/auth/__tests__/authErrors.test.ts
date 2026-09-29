import enAuth from '../../../i18n/locales/en/auth.json';
import esAuth from '../../../i18n/locales/es/auth.json';
import { AppError, isAppError } from '../../../core/errors';
import {
  AUTH_MESSAGE_KEYS,
  authErrorMessageKey,
  getAuthErrorReason,
  isUnexpectedAuthError,
  mapFirebaseAuthError,
  mapGoogleSignInError,
  type GoogleStatusCodes,
} from '../authErrors';

const ANDROID_CODES: GoogleStatusCodes = {
  SIGN_IN_CANCELLED: '12501',
  IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: '4',
  NULL_PRESENTER: 'NULL_PRESENTER',
};

const nativeError = (code: string, message = 'native failure') => Object.assign(new Error(message), { code });

type Json = { [key: string]: Json | string };

function lookup(table: Json, path: string): Json | string | undefined {
  return path.split('.').reduce<Json | string | undefined>(
    (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
    table,
  );
}

function flattenKeys(table: Json, prefix = ''): string[] {
  return Object.entries(table).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flattenKeys(value, `${prefix}${key}.`),
  );
}

describe('mapGoogleSignInError', () => {
  it('maps cancellation, in-progress and Play Services codes', () => {
    expect(mapGoogleSignInError(nativeError('12501'), ANDROID_CODES).code).toBe('cancelled');
    expect(mapGoogleSignInError(nativeError('16'), ANDROID_CODES).code).toBe('cancelled');

    const inProgress = mapGoogleSignInError(nativeError('ASYNC_OP_IN_PROGRESS'), ANDROID_CODES);
    expect(inProgress.code).toBe('conflict');
    expect(getAuthErrorReason(inProgress)).toBe('in_progress');

    const noPlay = mapGoogleSignInError(nativeError('PLAY_SERVICES_NOT_AVAILABLE'), ANDROID_CODES);
    expect(noPlay.code).toBe('unsupported');
    expect(getAuthErrorReason(noPlay)).toBe('play_services_unavailable');
  });

  it('maps developer, network, sign-in-required and token recovery errors', () => {
    const developer = mapGoogleSignInError(nativeError('10', 'DEVELOPER_ERROR'), ANDROID_CODES);
    expect(developer.code).toBe('not_configured');
    expect(getAuthErrorReason(developer)).toBe('google_developer_error');
    expect(developer.details?.providerCode).toBe('10');

    expect(mapGoogleSignInError(nativeError('7'), ANDROID_CODES).code).toBe('offline');
    expect(mapGoogleSignInError(nativeError('-1009'), ANDROID_CODES).code).toBe('offline');
    expect(mapGoogleSignInError(nativeError('-1001'), ANDROID_CODES).code).toBe('timeout');
    expect(mapGoogleSignInError(nativeError('4'), ANDROID_CODES).code).toBe('google_not_signed_in');
    expect(
      mapGoogleSignInError(nativeError('getTokens', 'getTokens requires a user to be signed in'), ANDROID_CODES).code,
    ).toBe('google_not_signed_in');

    const recovery = mapGoogleSignInError(
      nativeError('getTokens', 'Failed authentication recovery attempt, probably user-rejected.'),
      ANDROID_CODES,
    );
    expect(recovery.code).toBe('google_not_signed_in');
    expect(getAuthErrorReason(recovery)).toBe('auth_recovery_required');
  });

  it('falls back to a retryable upstream error and keeps AppErrors unchanged', () => {
    const unknown = mapGoogleSignInError(nativeError('12500'), ANDROID_CODES);
    expect(unknown.code).toBe('upstream_error');
    expect(unknown.retryable).toBe(true);
    expect(getAuthErrorReason(unknown)).toBe('google_sign_in_failed');

    const noCode = mapGoogleSignInError(new Error('Network request failed'), ANDROID_CODES);
    expect(noCode.code).toBe('offline');

    const existing = new AppError('cancelled');
    expect(mapGoogleSignInError(existing, ANDROID_CODES)).toBe(existing);
  });
});

describe('mapFirebaseAuthError', () => {
  it('maps credential and account errors with a precise reason', () => {
    const invalid = mapFirebaseAuthError(nativeError('auth/invalid-credential'));
    expect(invalid.code).toBe('unauthenticated');
    expect(getAuthErrorReason(invalid)).toBe('invalid_credentials');

    expect(getAuthErrorReason(mapFirebaseAuthError(nativeError('auth/email-already-in-use')))).toBe('email_in_use');
    expect(getAuthErrorReason(mapFirebaseAuthError(nativeError('auth/weak-password')))).toBe('weak_password');
    expect(mapFirebaseAuthError(nativeError('auth/operation-not-allowed')).code).toBe('not_configured');
    expect(mapFirebaseAuthError(nativeError('auth/network-request-failed')).code).toBe('offline');
  });

  it('uses the shared core mapping for Functions errors', () => {
    const quota = mapFirebaseAuthError(nativeError('functions/unauthenticated'));
    expect(isAppError(quota)).toBe(true);
    expect(quota.code).toBe('unauthenticated');
    expect(getAuthErrorReason(quota)).toBeNull();
  });
});

describe('authErrorMessageKey', () => {
  it('prefers the reason, then the code-level auth key, then common:errors', () => {
    expect(authErrorMessageKey(mapFirebaseAuthError(nativeError('auth/wrong-password')))).toBe(
      'auth:errors.invalidCredentials',
    );
    expect(authErrorMessageKey(new AppError('offline'))).toBe('auth:errors.offline');
    expect(authErrorMessageKey(new AppError('not_found'))).toBe('common:errors.not_found');
    expect(authErrorMessageKey(new Error('boom'))).toBe('auth:errors.unknown');
  });

  it('flags configuration and unknown failures as unexpected (reported), user errors as expected', () => {
    expect(isUnexpectedAuthError(mapGoogleSignInError(nativeError('10'), ANDROID_CODES))).toBe(true);
    expect(isUnexpectedAuthError(mapFirebaseAuthError(nativeError('auth/invalid-credential')))).toBe(false);
    expect(isUnexpectedAuthError(new AppError('offline'))).toBe(false);
  });
});

describe('auth namespace resources', () => {
  it.each([
    ['en', enAuth],
    ['es', esAuth],
  ])('defines every message key used by the auth area in %s', (_language, table) => {
    const missing = AUTH_MESSAGE_KEYS.map((key) => key.replace(/^auth:/, '')).filter(
      (key) => typeof lookup(table as Json, key) !== 'string',
    );
    expect(missing).toEqual([]);
    for (const key of ['signOut.pendingTitle', 'signOut.pendingMessage_one', 'signOut.pendingMessage_other']) {
      expect(typeof lookup(table as Json, key)).toBe('string');
    }
  });

  it('has the same keys in English and Spanish', () => {
    expect(flattenKeys(esAuth as Json).sort()).toEqual(flattenKeys(enAuth as Json).sort());
  });
});
