/**
 * React auth bindings (owner: auth) - layer L6.
 *
 * AuthProvider initializes GoogleSignin + the session manager on mount and exposes
 * AuthContextValue through useAuth(). src/contexts/AuthContext.jsx re-exports this module (it
 * stays .jsx because stage-3 screens import it with the extension).
 *
 * - Session state comes only from sessionManager (Firebase onAuthStateChanged); nothing is read
 *   from or written to a persisted "user" key.
 * - Sign-in helpers return the legacy `{ success, cancelled?, user?, error? }` shape with a
 *   localized message (auth namespace) plus `errorCode` / `errorReason`.
 * - The plan comes from the server-owned entitlement (read-only here).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import type { AuthContextValue, AuthProviderProps, SessionState } from '../../core/contracts';
import { toAppError, type AppError, type AppErrorCode } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { DEFAULT_ENTITLEMENT, effectivePlan, type AuthUser, type Entitlement, type Plan } from '../../core/types';
import { t } from '../../i18n';
import { calendarSyncEngine, googleCalendarService } from '../calendar';
import { userRepository } from '../data';

import { authErrorMessageKey, getAuthErrorReason, isUnexpectedAuthError } from './authErrors';
import { authService } from './authService';
import {
  legacyCancelled,
  legacyFailure,
  legacySuccess,
  toLegacyAuthUserView,
  type AuthActionResult,
} from './legacyView';
import { sessionManager } from './sessionManager';

const log = createLogger('auth');

/** Result of actions that do not sign anybody in (password reset). */
export interface AuthSimpleResult {
  success: boolean;
  error?: string;
  errorCode?: AppErrorCode;
}

/** AuthContextValue plus backward-compatible extensions. */
export interface AuthContextValueImpl extends AuthContextValue {
  signInWithGoogle(): Promise<AuthActionResult>;
  signInWithEmail(email: string, password: string): Promise<AuthActionResult>;
  signUpWithEmail(email: string, password: string, name: string): Promise<AuthActionResult>;
  sendPasswordReset(email: string): Promise<AuthSimpleResult>;
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
  if (appError.code === 'cancelled') return legacyCancelled();
  const reason = getAuthErrorReason(appError);
  if (isUnexpectedAuthError(appError)) {
    log.error(context, appError);
  } else {
    log.warn(context, appError.code, reason ?? '');
  }
  return legacyFailure(t(authErrorMessageKey(appError)), appError.code, reason);
}

function confirmDiscardPendingWrites(count: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t('auth:signOut.pendingTitle'),
      t('auth:signOut.pendingMessage', { count }),
      [
        { text: t('auth:signOut.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('auth:signOut.confirm'), style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function reportSignOutFailure(error: unknown): void {
  const appError = toAppError(error);
  log.error('Sign-out failed', appError);
  Alert.alert(t('auth:signOut.failedTitle'), t(authErrorMessageKey(appError)));
}

function pendingCount(error: AppError): number {
  const count = error.details?.count;
  return typeof count === 'number' && count > 0 ? count : 1;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const entitlementRef = useRef(entitlement);
  useEffect(() => {
    entitlementRef.current = entitlement;
  }, [entitlement]);
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
          return result.status === 'success' ? legacySuccess(result.user) : legacyCancelled();
        } catch (error) {
          return toFailure(error, 'Google sign-in failed');
        }
      }),
    [runBusy],
  );

  const signInWithEmail = useCallback(
    (email: string, password: string) =>
      runBusy(async (): Promise<AuthActionResult> => {
        try {
          return legacySuccess(await authService.signInWithEmail(email, password));
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
          return legacySuccess(await authService.signUpWithEmail(email, password, name));
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

  const signOut = useCallback((options?: { force?: boolean }) => sessionManager.signOut(options), []);

  /** Compat: never rejects; asks before discarding unsynced changes and shows failures. */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await sessionManager.signOut();
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'pending_writes') {
        reportSignOutFailure(appError);
        return;
      }
      const confirmed = await confirmDiscardPendingWrites(pendingCount(appError));
      if (!confirmed) return;
      try {
        await sessionManager.signOut({ force: true });
      } catch (forcedError) {
        reportSignOutFailure(forcedError);
      }
    }
  }, []);

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

  const refreshUserPlan = useCallback(async (delayMs: number = 0): Promise<Plan> => {
    const uid = sessionManager.getState().status === 'active' ? sessionManager.getState().user?.uid : undefined;
    if (!uid) return 'free';
    if (delayMs > 0) await delay(delayMs);
    try {
      const value = await userRepository.getEntitlement();
      if (mountedRef.current) setEntitlementState({ uid, value });
      return effectivePlan(value);
    } catch (error) {
      // The live subscription keeps the plan current; report the failed re-read and keep it.
      log.warn('Could not refresh the plan', toAppError(error).code);
      return effectivePlan(entitlementRef.current);
    }
  }, []);

  const forceRefreshUserPlan = useCallback(() => refreshUserPlan(0), [refreshUserPlan]);

  const authUser: AuthUser | null = session.user;
  const legacyUser = useMemo(() => (authUser ? toLegacyAuthUserView(authUser) : null), [authUser]);

  const value = useMemo<AuthContextValueImpl>(
    () => ({
      status: session.status,
      isLoading:
        session.status === 'initializing' ||
        session.status === 'starting' ||
        session.status === 'ending' ||
        busy > 0,
      isAuthenticated: activeUid !== null,
      user: legacyUser,
      authUser,
      entitlement,
      userPlan: effectivePlan(entitlement),
      hasCalendarScope,
      calendarConnected,
      sessionError: session.error,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      signOut,
      logout,
      requestCalendarScope,
      requestCalendarAccess,
      deleteAccount,
      reauthenticate,
      refreshUserPlan,
      forceRefreshUserPlan,
    }),
    [
      session.status,
      session.error,
      busy,
      activeUid,
      legacyUser,
      authUser,
      entitlement,
      hasCalendarScope,
      calendarConnected,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      signOut,
      logout,
      requestCalendarScope,
      requestCalendarAccess,
      deleteAccount,
      reauthenticate,
      refreshUserPlan,
      forceRefreshUserPlan,
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
