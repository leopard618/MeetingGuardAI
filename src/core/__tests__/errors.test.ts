import { AppError, errorMessageKey, isAppError, notImplemented, toAppError } from '../errors';

describe('AppError', () => {
  it('carries code, retryable default and message key', () => {
    const error = new AppError('offline');
    expect(error).toBeInstanceOf(Error);
    expect(error.retryable).toBe(true);
    expect(error.messageKey).toBe('common:errors.offline');
    expect(new AppError('invalid_input').retryable).toBe(false);
    expect(errorMessageKey('quota_exceeded')).toBe('common:errors.quota_exceeded');
  });

  it('notImplemented throws a not_implemented AppError with the documented message', () => {
    expect(() => notImplemented('x.y')).toThrow('not implemented: x.y');
    try {
      notImplemented('x.y');
    } catch (error) {
      expect(isAppError(error) && error.code).toBe('not_implemented');
    }
  });
});

describe('toAppError', () => {
  const withCode = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

  it('maps Firebase Functions, Firestore and Auth codes', () => {
    expect(toAppError(withCode('functions/resource-exhausted')).code).toBe('quota_exceeded');
    expect(toAppError(withCode('functions/unauthenticated')).code).toBe('unauthenticated');
    expect(toAppError(withCode('functions/unavailable')).code).toBe('upstream_error');
    expect(toAppError(withCode('unavailable')).code).toBe('offline');
    expect(toAppError(withCode('permission-denied')).code).toBe('permission_denied');
    expect(toAppError(withCode('auth/network-request-failed')).code).toBe('offline');
  });

  it('detects network failures and keeps the cause', () => {
    const cause = new TypeError('Network request failed');
    const error = toAppError(cause);
    expect(error.code).toBe('offline');
    expect(error.cause).toBe(cause);
  });

  it('returns AppErrors unchanged and uses the fallback otherwise', () => {
    const original = new AppError('conflict');
    expect(toAppError(original)).toBe(original);
    expect(toAppError('weird', 'upstream_error').code).toBe('upstream_error');
    expect(toAppError(withCode('SOME_SDK_CODE')).details).toEqual({ providerCode: 'SOME_SDK_CODE' });
  });
});
