/**
 * AuthProvider / useAuth with the session manager and services mocked.
 */
import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { AppError } from '../../../core/errors';
import type { SessionState } from '../../../core/contracts';
import { AuthProvider, useAuth, type AuthContextValueImpl } from '../AuthProvider';

jest.mock('../sessionManager', () => {
  let state = { status: 'initializing', user: null, error: null };
  const listeners = new Set<(mockNext: unknown) => void>();
  return {
    sessionManager: {
      init: jest.fn(),
      getState: jest.fn(() => state),
      subscribe: jest.fn((listener: (mockNext: unknown) => void) => {
        listeners.add(listener);
        listener(state);
        return () => listeners.delete(listener);
      }),
      signOut: jest.fn(async () => undefined),
      deleteAccount: jest.fn(async () => undefined),
      withHeadlessSession: jest.fn(),
      setMockState: (next: typeof state) => {
        state = next;
        listeners.forEach((listener) => listener(state));
      },
    },
  };
});

jest.mock('../authService', () => ({
  authService: {
    init: jest.fn(),
    signInWithGoogle: jest.fn(),
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    sendPasswordReset: jest.fn(),
    resendVerification: jest.fn(),
    reloadUser: jest.fn(),
    hasCalendarScope: jest.fn(async () => true),
    requestCalendarScope: jest.fn(async () => true),
    onGoogleAccessChanged: jest.fn(() => () => undefined),
  },
}));

jest.mock('../../data', () => ({
  userRepository: {
    subscribeEntitlement: jest.fn((listener: (mockValue: unknown) => void) => {
      listener({ plan: 'pro', status: 'active', expiresAt: null, source: 'manual', updatedAt: null });
      return () => undefined;
    }),
    getEntitlement: jest.fn(),
  },
}));

jest.mock('../../calendar', () => ({
  calendarSyncEngine: {
    subscribeStatus: jest.fn((listener: (mockStatus: unknown) => void) => {
      listener({ google: { connected: true } });
      return () => undefined;
    }),
  },
  googleCalendarService: { connect: jest.fn(async () => ({ status: 'connected', initialSync: null })) },
}));

jest.mock('../../../i18n', () => ({
  t: (key: string, options?: { count?: number }) => (options?.count !== undefined ? `${key}#${options.count}` : key),
}));

interface SessionManagerMock {
  init: jest.Mock;
  signOut: jest.Mock;
  setMockState(next: SessionState): void;
}
interface AuthServiceMock {
  init: jest.Mock;
  signInWithGoogle: jest.Mock;
  resendVerification: jest.Mock;
  reloadUser: jest.Mock;
}

const { sessionManager } = jest.requireMock('../sessionManager') as { sessionManager: SessionManagerMock };
const { authService } = jest.requireMock('../authService') as { authService: AuthServiceMock };

const activeUser = {
  uid: 'uid-1',
  email: 'ana@example.com',
  displayName: 'Ana',
  photoURL: null,
  emailVerified: true,
  providerIds: ['google.com'],
};

let captured: AuthContextValueImpl | null = null;

function capture(value: AuthContextValueImpl): void {
  captured = value;
}

function Probe() {
  const value = useAuth();
  useEffect(() => {
    capture(value);
  });
  return <Text>{`status:${value.status}`}</Text>;
}

function current(): AuthContextValueImpl {
  if (!captured) throw new Error('not rendered');
  return captured;
}

beforeEach(() => {
  captured = null;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  sessionManager.setMockState({ status: 'initializing', user: null, error: null });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderActive() {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await act(async () => {
    sessionManager.setMockState({ status: 'active', user: activeUser, error: null });
  });
}

describe('AuthProvider', () => {
  it('initializes the services and reflects the session state', async () => {
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(authService.init).toHaveBeenCalled();
    expect(sessionManager.init).toHaveBeenCalled();
    expect(screen.getByText('status:initializing')).toBeTruthy();
    expect(current()).toMatchObject({ isLoading: true, isAuthenticated: false, authUser: null, entitlement: { plan: 'free' } });

    await act(async () => {
      sessionManager.setMockState({ status: 'active', user: activeUser, error: null });
    });
    expect(current()).toMatchObject({
      status: 'active',
      isLoading: false,
      isAuthenticated: true,
      authUser: { uid: 'uid-1', displayName: 'Ana', email: 'ana@example.com' },
      entitlement: { plan: 'pro' },
      hasCalendarScope: true,
      calendarConnected: true,
    });

    await act(async () => {
      sessionManager.setMockState({ status: 'signed_out', user: null, error: null });
    });
    expect(current()).toMatchObject({ isAuthenticated: false, authUser: null, entitlement: { plan: 'free' }, hasCalendarScope: false });
  });

  it('maps sign-in results to success / cancelled / localized errors', async () => {
    await renderActive();

    authService.signInWithGoogle.mockResolvedValueOnce({ status: 'success', user: activeUser });
    await expect(current().signInWithGoogle()).resolves.toMatchObject({ success: true, user: { uid: 'uid-1' } });

    authService.signInWithGoogle.mockResolvedValueOnce({ status: 'cancelled' });
    await expect(current().signInWithGoogle()).resolves.toEqual({ success: false, cancelled: true });

    authService.signInWithGoogle.mockRejectedValueOnce(
      new AppError('unauthenticated', 'bad', { details: { reason: 'invalid_credentials' } }),
    );
    await expect(current().signInWithGoogle()).resolves.toEqual({
      success: false,
      error: 'auth:errors.invalidCredentials',
      errorCode: 'unauthenticated',
      errorReason: 'invalid_credentials',
    });
  });

  it('wraps resendVerification and refreshUser into simple results with localized errors', async () => {
    await renderActive();

    authService.resendVerification.mockResolvedValueOnce(undefined);
    await expect(current().resendVerification()).resolves.toEqual({ success: true });

    authService.resendVerification.mockRejectedValueOnce(new AppError('quota_exceeded'));
    await expect(current().resendVerification()).resolves.toEqual({
      success: false,
      error: 'auth:errors.tooManyRequests',
      errorCode: 'quota_exceeded',
    });

    authService.reloadUser.mockResolvedValueOnce(activeUser);
    await expect(current().refreshUser()).resolves.toEqual({ success: true });

    authService.reloadUser.mockRejectedValueOnce(new AppError('offline'));
    await expect(current().refreshUser()).resolves.toEqual({
      success: false,
      error: 'auth:errors.offline',
      errorCode: 'offline',
    });
  });

  it('useAuth throws outside the provider', async () => {
    function Orphan() {
      useAuth();
      return null;
    }
    await expect(render(<Orphan />)).rejects.toThrow('useAuth must be used inside <AuthProvider>');
  });
});
