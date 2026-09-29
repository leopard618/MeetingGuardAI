/**
 * Session orchestration core (owner: auth). Dependency-injected so it is unit-tested without the
 * other areas; ./sessionManager.ts wires the real services.
 *
 * Firebase `onAuthStateChanged` is the ONLY session authority: there is no persisted "user" key.
 * Every transition (auth event, sign-out, account deletion) runs on one serial queue, so a sign-out
 * can never interleave with a session start. Order (contract: SessionManager in core/contracts.ts):
 *
 * START  state 'starting' -> await data.startSession(uid, { mode: 'foreground', user })
 *        (the data layer ensures the profile - no plan fields - and migrates legacy data)
 *        -> emit session:started { uid, restored } -> calendar.start(uid)
 *        -> alerts.startSession(uid) (not awaited) -> state 'active'
 * END    state 'ending' -> await alerts.endSession() -> calendar.stop() -> cleanup hooks
 *        -> await data.endSession({ wipeLocal: true }) -> await auth.signOutProviders() (not for
 *        auth_lost) -> emit session:ended { uid, reason } -> state 'signed_out'
 *
 * Other areas are shut down explicitly BEFORE the local data is wiped (alerts cancelled, calendar
 * stopped, cleanup hooks run), and `session:ended` is the final notification.
 */
import type {
  AlertEngine,
  CalendarSyncEngine,
  DataService,
  SessionManager,
  SessionState,
  UserRepository,
} from '../../core/contracts';
import { AppError, toAppError } from '../../core/errors';
import type { AppEventMap, EventBus, SessionEndedEvent, Unsubscribe } from '../../core/events';
import type { Logger } from '../../core/logger';
import type { AuthUser } from '../../core/types';

import { sameIdentity } from './legacyView';
import { createSerialQueue } from './serialQueue';
import type { SessionCleanupContext, SessionCleanupFailure } from './sessionCleanup';

export interface SessionAuthDeps {
  readonly currentUser: AuthUser | null;
  authReady(): Promise<AuthUser | null>;
  onAuthStateChanged(listener: (user: AuthUser | null) => void): Unsubscribe;
  signOutProviders(): Promise<void>;
  revokeGoogleAccess(): Promise<void>;
  deleteAccountOnServer(): Promise<void>;
}

export interface SessionManagerDeps {
  auth: SessionAuthDeps;
  data: Pick<DataService, 'startSession' | 'endSession' | 'getActiveUid' | 'getPendingWriteCount'>;
  userRepository: Pick<UserRepository, 'ensureProfile'>;
  calendar: Pick<CalendarSyncEngine, 'start' | 'stop'>;
  alerts: Pick<AlertEngine, 'startSession' | 'endSession'>;
  events: Pick<EventBus<AppEventMap>, 'emit'>;
  runCleanups(context: SessionCleanupContext): Promise<SessionCleanupFailure[]>;
  logger: Logger;
  /** Longest wait for a settled session state in withHeadlessSession (default 15 s). */
  stableStateTimeoutMs?: number;
}

export interface SessionManagerImpl extends SessionManager {
  /** Resolves once no transition is queued or running. */
  whenIdle(): Promise<void>;
}

type EndReason = SessionEndedEvent['reason'];

const DEFAULT_STABLE_STATE_TIMEOUT_MS = 15_000;

export function createSessionManager(deps: SessionManagerDeps): SessionManagerImpl {
  const log = deps.logger;
  const queue = createSerialQueue();
  const listeners = new Set<(state: SessionState) => void>();
  const stateWaiters = new Set<() => void>();

  let state: SessionState = { status: 'initializing', user: null, error: null };
  let initialized = false;
  let latestAuthUser: AuthUser | null = null;
  let firstAuthEventSeen = false;
  /** uid of the persisted session found at app start (session:started.restored). */
  let restoreCandidateUid: string | null = null;
  /** uid whose session is running (data session started, areas notified). */
  let activeUid: string | null = null;
  /** A deleted account must never get a new session from its still-valid ID token. */
  let deletedUid: string | null = null;

  function setState(next: Partial<SessionState>): void {
    state = { ...state, ...next };
    const snapshot = state;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        log.error('Session state listener failed', error);
      }
    }
    for (const wake of [...stateWaiters]) wake();
  }

  function waitForStateChange(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        stateWaiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, Math.max(0, timeoutMs));
      stateWaiters.add(wake);
    });
  }

  /** Runs one END step; failures are reported and never stop the remaining steps. */
  async function step(name: string, run: () => void | Promise<void>): Promise<AppError | null> {
    try {
      await run();
      return null;
    } catch (error) {
      const appError = toAppError(error);
      log.error(`Session step failed: ${name}`, appError);
      return appError;
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    return queue.run(task);
  }

  async function startSession(user: AuthUser): Promise<void> {
    const uid = user.uid;
    const restored = restoreCandidateUid === uid;
    restoreCandidateUid = null;
    setState({ status: 'starting', user, error: null });

    let startError: AppError | null = null;
    try {
      await deps.data.startSession(uid, { mode: 'foreground', user });
    } catch (error) {
      // The user is authenticated; keep the session so sign-out and retries work, and surface
      // the failure through state.error (the data hooks report their own errors too).
      startError = toAppError(error);
      log.error('Data session failed to start', startError);
    }
    activeUid = uid;

    deps.events.emit('session:started', { uid, restored });

    try {
      deps.calendar.start(uid);
    } catch (error) {
      log.error('Calendar sync failed to start', toAppError(error));
    }
    void Promise.resolve()
      .then(() => deps.alerts.startSession(uid))
      .catch((error: unknown) => log.error('Alert engine failed to start', toAppError(error)));

    setState({ status: 'active', user, error: startError });
  }

  async function endSession(reason: EndReason, options: { signOutProviders: boolean }): Promise<void> {
    const uid = activeUid;
    setState({ status: 'ending', error: null });

    let firstError: AppError | null = null;
    const note = (error: AppError | null): void => {
      if (error && !firstError) firstError = error;
    };

    if (uid !== null) {
      note(await step('alerts.endSession', () => deps.alerts.endSession()));
      note(await step('calendar.stop', () => deps.calendar.stop()));
      note(
        await step('cleanup hooks', async () => {
          const failures = await deps.runCleanups({ uid, reason });
          for (const failure of failures) {
            log.error(`Session cleanup "${failure.name}" failed`, toAppError(failure.error));
          }
        }),
      );
      note(await step('data.endSession', () => deps.data.endSession({ wipeLocal: true })));
    }
    activeUid = null;

    const providerError = options.signOutProviders
      ? await step('auth.signOutProviders', () => deps.auth.signOutProviders())
      : null;

    if (uid !== null) deps.events.emit('session:ended', { uid, reason });
    setState({ status: 'signed_out', user: null, error: providerError ?? firstError });

    if (providerError && reason === 'sign_out') {
      // Firebase still has the user: follow the real auth state again (restarts the session) and
      // tell the caller the sign-out did not happen. After an account deletion the account is gone
      // either way (deletedUid blocks a restart), so that case only records the error in the state.
      latestAuthUser = deps.auth.currentUser;
      void enqueue(reconcileWithAuth).catch((error: unknown) =>
        log.error('Session transition failed', toAppError(error)),
      );
      throw providerError;
    }
  }

  async function reconcileWithAuth(): Promise<void> {
    const user = latestAuthUser;

    if (user && user.uid !== deletedUid) {
      if (activeUid === user.uid) {
        if (!sameIdentity(state.user, user)) {
          setState({ user });
          // Identity changed (e.g. display name set right after sign-up): refresh the profile.
          void Promise.resolve()
            .then(() => deps.userRepository.ensureProfile(user))
            .catch((error: unknown) => log.warn('Profile refresh failed', toAppError(error).code));
        }
        return;
      }
      if (activeUid !== null) {
        // A different account signed in without a sign-out: close the previous session first.
        await endSession('auth_lost', { signOutProviders: false });
      }
      await startSession(user);
      return;
    }

    if (activeUid !== null) {
      await endSession('auth_lost', { signOutProviders: false });
      return;
    }
    if (state.status !== 'signed_out' || state.user !== null) {
      setState({ status: 'signed_out', user: null });
    }
  }

  function onAuthEvent(user: AuthUser | null): void {
    latestAuthUser = user;
    if (!firstAuthEventSeen) {
      firstAuthEventSeen = true;
      restoreCandidateUid = user?.uid ?? null;
    }
    void enqueue(reconcileWithAuth).catch((error: unknown) =>
      log.error('Session transition failed', toAppError(error)),
    );
  }

  /** Foreground runtime: waits until the session is settled ('active' or 'signed_out'). */
  async function waitForSettledState(): Promise<boolean> {
    const deadline = Date.now() + (deps.stableStateTimeoutMs ?? DEFAULT_STABLE_STATE_TIMEOUT_MS);
    for (;;) {
      await queue.idle();
      if ((state.status === 'active' || state.status === 'signed_out') && queue.size === 0) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await waitForStateChange(remaining);
    }
  }

  const manager: SessionManagerImpl = {
    init(): void {
      if (initialized) return;
      initialized = true;
      deps.auth.onAuthStateChanged(onAuthEvent);
    },

    getState(): SessionState {
      return state;
    },

    subscribe(listener: (state: SessionState) => void): Unsubscribe {
      listeners.add(listener);
      try {
        listener(state);
      } catch (error) {
        log.error('Session state listener failed', error);
      }
      return () => {
        listeners.delete(listener);
      };
    },

    async signOut(options: { force?: boolean } = {}): Promise<void> {
      if (!options.force) {
        let pending = 0;
        try {
          pending = await deps.data.getPendingWriteCount();
        } catch (error) {
          const appError = toAppError(error);
          // No data session => nothing can be pending. Anything else is a real failure.
          if (appError.code !== 'unauthenticated') throw appError;
        }
        if (pending > 0) {
          throw new AppError('pending_writes', `${pending} local change(s) not synced yet`, {
            details: { count: pending },
          });
        }
      }
      await enqueue(() => endSession('sign_out', { signOutProviders: true }));
    },

    async deleteAccount(): Promise<void> {
      await enqueue(async () => {
        const uid = activeUid ?? deps.auth.currentUser?.uid ?? null;
        if (uid === null) throw new AppError('unauthenticated', 'Nobody is signed in');

        // No calendar import may write user data while the server deletes it.
        const sessionUid = activeUid;
        if (sessionUid !== null) await step('calendar.stop', () => deps.calendar.stop());
        try {
          await deps.auth.deleteAccountOnServer();
        } catch (error) {
          if (sessionUid !== null) {
            await step('calendar.start', () => deps.calendar.start(sessionUid));
          }
          throw toAppError(error);
        }
        deletedUid = uid;

        try {
          await deps.auth.revokeGoogleAccess();
        } catch (error) {
          // The account is already gone; the local sign-out below must still happen.
          log.warn('Google access could not be revoked after account deletion', toAppError(error).code);
        }
        await endSession('account_deleted', { signOutProviders: true });
      });
    },

    async withHeadlessSession<T>(fn: (uid: string) => Promise<T>): Promise<T | null> {
      const user = await deps.auth.authReady();
      if (!user || user.uid === deletedUid) return null;

      if (initialized) {
        // Foreground runtime: only run inside the live session, never start a second one.
        const settled = await waitForSettledState();
        if (!settled) {
          log.warn('Headless run skipped: the session did not settle in time');
          return null;
        }
        if (state.status !== 'active' || activeUid !== user.uid) return null;
        return fn(user.uid);
      }

      const dataUid = deps.data.getActiveUid();
      if (dataUid !== null && dataUid !== user.uid) {
        log.warn('Headless run skipped: the data session belongs to another account');
        return null;
      }
      if (dataUid === null) {
        await deps.data.startSession(user.uid, { mode: 'headless', user });
      }
      return fn(user.uid);
    },

    whenIdle(): Promise<void> {
      return queue.idle();
    },
  };

  return manager;
}
