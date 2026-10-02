/**
 * React auth bindings (owner: auth) - layer L6.
 *
 * AuthProvider initializes GoogleSignin + the session manager on mount and exposes
 * AuthContextValue through useAuth().
 *
 * - Session state comes only from sessionManager (Firebase onAuthStateChanged); nothing is read
 *   from or written to a persisted "user" key.
 * - Sign-in actions return `{ success, cancelled?, user?, error? }` with a localized message
 *   (auth namespace) plus `errorCode` / `errorReason`; they never throw.
 * - The entitlement (plan) is server-owned and read-only here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { AuthContextValue, AuthProviderProps, SessionState } from '../../core/contracts';
import { toAppError, type AppError, type AppErrorCode } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { DEFAULT_ENTITLEMENT, type AuthUser, type Entitlement } from '../../core/types';
import { t } from '../../i18n';
import { calendarSyncEngine, googleCalendarService } from '../calendar';
import { userRepository } from '../data';

import { authErrorMessageKey, getAuthErrorReason, isUnexpectedAuthError } from './authErrors';
import { authCancelled, authFailure, authSuccess, type AuthActionResult } from './authResults';
import { authService } from './authService';
import { sessionManager } from './sessionManager';

const log = createLogger('auth');

/** Result of actions that do not sign anybody in (password reset). */
export interface AuthSimpleResult {
  success: boolean;
  error?: string;
  errorCode?: AppErrorCode;
}

/** AuthContextValue plus the auth area's extensions. */
export interface AuthContextValueImpl extends AuthContextValue {
  signInWithGoogle(): Promise<AuthActionResult>;
  /** iOS only (§26): wraps authService.signInWithApple() like the Google action (cancel is quiet). */
  signInWithApple(): Promise<AuthActionResult>;
  signInWithEmail(email: string, password: string): Promise<AuthActionResult>;
  signUpWithEmail(email: string, password: string, name: string): Promise<AuthActionResult>;
  sendPasswordReset(email: string): Promise<AuthSimpleResult>;
  /** Re-sends the verification email to the signed-in user (verification gate, §25). */
  resendVerification(): Promise<AuthSimpleResult>;
  /**
   * Reloads the Firebase user so a just-clicked verification link is reflected ("I verified"
   * button): `authUser.emailVerified` updates through the session state on success.
   */
  refreshUser(): Promise<AuthSimpleResult>;
  /** Last session start/stop failure (the session may still run on cached data). */
  sessionError: AppError | null;
  /** Google Calendar sync is connected (Calendar scope granted and sync enabled). */
  calendarConnected: boolean;
  /**
   * Connects Google Calendar end to end (scope consent, sync enabled, first import) through the
   * calendar service. true when connected; false when the user cancelled or declined the scope.
   */
  requestCalendarAccess(): Promise<boolean>;
  /** Confirms the user again before a sensitive operation (account deletion). */
  reauthenticate(options?: { password?: string }): Promise<'done' | 'cancelled'>;
}

const AuthContext = createContext<AuthContextValueImpl | null>(null);

/** Value scoped to the uid it was read for, so a new session never shows the previous one's data. */
interface Scoped<T> {
  uid: string;
  value: T;
}

function valueFor<T>(scoped: Scoped<T> | null, uid: string | null, fallback: T): T {
  return scoped !== null && uid !== null && scoped.uid === uid ? scoped.value : fallback;
}

function toFailure(error: unknown, context: string): AuthActionResult {
  const appError = toAppError(error);
  if (appError.code === 'cancelled') return authCancelled();
  const reason = getAuthErrorReason(appError);
  if (isUnexpectedAuthError(appError)) {
    log.error(context, appError);
  } else {
    log.warn(context, appError.code, reason ?? '');
  }
  return authFailure(t(authErrorMessageKey(appError)), appError.code, reason);
}

export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  const [session, setSession] = useState<SessionState>(() => sessionManager.getState());
  const [busy, setBusy] = useState(0);
  const [entitlementState, setEntitlementState] = useState<Scoped<Entitlement> | null>(null);
  const [scopeState, setScopeState] = useState<Scoped<boolean> | null>(null);
  const [calendarState, setCalendarState] = useState<Scoped<boolean> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    authService.init();
    sessionManager.init();
    const unsubscribe = sessionManager.subscribe((next) => {
      if (mountedRef.current) setSession(next);
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const activeUid = session.status === 'active' && session.user ? session.user.uid : null;

  // Server-owned entitlement (plan), live while the session is active.
  useEffect(() => {
    if (activeUid === null) return undefined;
    try {
      return userRepository.subscribeEntitlement((value) => {
        if (mountedRef.current) setEntitlementState({ uid: activeUid, value });
      });
    } catch (error) {
      log.error('Could not subscribe to the entitlement', toAppError(error));
      return undefined;
    }
  }, [activeUid]);

  // Calendar scope: checked at session start and whenever Google access changes.
  useEffect(() => {
    if (activeUid === null) return undefined;
    let cancelled = false;
    const check = (): void => {
      authService.hasCalendarScope().then(
        (value) => {
          if (!cancelled && mountedRef.current) setScopeState({ uid: activeUid, value });
        },
        (error: unknown) => log.warn('Could not check the Calendar scope', toAppError(error).code),
      );
    };
    check();
    const unsubscribe = authService.onGoogleAccessChanged(check);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeUid]);

  // Google Calendar connection (scope + sync enabled), from the calendar engine status.
  useEffect(() => {
    if (activeUid === null) return undefined;
    try {
      return calendarSyncEngine.subscribeStatus((status) => {
        if (mountedRef.current) setCalendarState({ uid: activeUid, value: status.google.connected });
      });
    } catch (error) {
      log.warn('Could not read the calendar status', toAppError(error).code);
      return undefined;
    }
  }, [activeUid]);

  const entitlement: Entitlement = valueFor<Entitlement>(entitlementState, activeUid, DEFAULT_ENTITLEMENT);
  const hasCalendarScope = valueFor(scopeState, activeUid, false);
  const calendarConnected = valueFor(calendarState, activeUid, false);

  const runBusy = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    setBusy((count) => count + 1);
    try {
      return await task();
    } finally {
      if (mountedRef.current) setBusy((count) => Math.max(0, count - 1));
    }
  }, []);

  const signInWithGoogle = useCallback(
    () =>
      runBusy(async (): Promise<AuthActionResult> => {
        try {
          const result = await authService.signInWithGoogle();
          return result.status === 'success' ? authSuccess(result.user) : authCancelled();
        } catch (error) {
          return toFailure(error, 'Google sign-in failed');
        }
      }),
    [runBusy],
  );

  const signInWithApple = useCallback(
    () =>
      runBusy(async (): Promise<AuthActionResult> => {
        try {
          const result = await authService.signInWithApple();
          return result.status === 'success' ? authSuccess(result.user) : authCancelled();
        } catch (error) {
          return toFailure(error, 'Apple sign-in failed');
        }
      }),
    [runBusy],
  );

  const signInWithEmail = useCallback(
    (email: string, password: string) =>
      runBusy(async (): Promise<AuthActionResult> => {
        try {
          return authSuccess(await authService.signInWithEmail(email, password));
        } catch (error) {
          return toFailure(error, 'Email sign-in failed');
        }
      }),
    [runBusy],
  );

  const signUpWithEmail = useCallback(
    (email: string, password: string, name: string) =>
      runBusy(async (): Promise<AuthActionResult> => {
        try {
          return authSuccess(await authService.signUpWithEmail(email, password, name));
        } catch (error) {
          return toFailure(error, 'Email sign-up failed');
        }
      }),
    [runBusy],
  );

  const sendPasswordReset = useCallback(async (email: string): Promise<AuthSimpleResult> => {
    try {
      await authService.sendPasswordReset(email);
      return { success: true };
    } catch (error) {
      const failure = toFailure(error, 'Password reset failed');
      return { success: false, error: failure.error, errorCode: failure.errorCode };
    }
  }, []);

  const resendVerification = useCallback(async (): Promise<AuthSimpleResult> => {
    try {
      await authService.resendVerification();
      return { success: true };
    } catch (error) {
      const failure = toFailure(error, 'Resending the verification email failed');
      return { success: false, error: failure.error, errorCode: failure.errorCode };
    }
  }, []);

  const refreshUser = useCallback(async (): Promise<AuthSimpleResult> => {
    try {
      await authService.reloadUser();
      return { success: true };
    } catch (error) {
      const failure = toFailure(error, 'Refreshing the account failed');
      return { success: false, error: failure.error, errorCode: failure.errorCode };
    }
  }, []);

  const signOut = useCallback((options?: { force?: boolean }) => sessionManager.signOut(options), []);

  const requestCalendarScope = useCallback(async (): Promise<boolean> => {
    const granted = await authService.requestCalendarScope();
    const uid = sessionManager.getState().user?.uid;
    if (uid && mountedRef.current) setScopeState({ uid, value: granted });
    return granted;
  }, []);

  const requestCalendarAccess = useCallback(async (): Promise<boolean> => {
    const result = await googleCalendarService.connect();
    return result.status === 'connected';
  }, []);

  const deleteAccount = useCallback(() => sessionManager.deleteAccount(), []);
  const reauthenticate = useCallback(
    (options?: { password?: string }) => authService.reauthenticate(options),
    [],
  );

  const authUser: AuthUser | null = session.user;

  const value = useMemo<AuthContextValueImpl>(
    () => ({
      status: session.status,
      isLoading:
        session.status === 'initializing' ||
        session.status === 'starting' ||
        session.status === 'ending' ||
        busy > 0,
      isAuthenticated: activeUid !== null,
      authUser,
      entitlement,
      hasCalendarScope,
      calendarConnected,
      sessionError: session.error,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      resendVerification,
      refreshUser,
      signOut,
      requestCalendarScope,
      requestCalendarAccess,
      deleteAccount,
      reauthenticate,
    }),
    [
      session.status,
      session.error,
      busy,
      activeUid,
      authUser,
      entitlement,
      hasCalendarScope,
      calendarConnected,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      resendVerification,
      refreshUser,
      signOut,
      requestCalendarScope,
      requestCalendarAccess,
      deleteAccount,
      reauthenticate,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValueImpl {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
