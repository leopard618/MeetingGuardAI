import { AppError } from '../../../core/errors';
import type { AppEventMap } from '../../../core/events';
import type { Logger } from '../../../core/logger';
import type { AuthUser } from '../../../core/types';
import { createSessionManager, type SessionManagerDeps } from '../sessionCore';

const userA: AuthUser = {
  uid: 'uid-a',
  email: null,
  displayName: 'A',
  photoURL: null,
  emailVerified: true,
  providerIds: ['google.com'],
};
const userB: AuthUser = { ...userA, uid: 'uid-b', displayName: 'B' };

const silentLogger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

interface Harness {
  deps: SessionManagerDeps;
  calls: string[];
  emitAuth(user: AuthUser | null): void;
  setCurrentUser(user: AuthUser | null): void;
  events: { name: keyof AppEventMap; payload: unknown }[];
}

function createHarness(): Harness {
  const calls: string[] = [];
  const events: { name: keyof AppEventMap; payload: unknown }[] = [];
  let authListener: ((user: AuthUser | null) => void) | null = null;
  let currentUser: AuthUser | null = null;
  let dataUid: string | null = null;

  const deps: SessionManagerDeps = {
    auth: {
      get currentUser() {
        return currentUser;
      },
      authReady: jest.fn(async () => currentUser),
      onAuthStateChanged: jest.fn((listener: (user: AuthUser | null) => void) => {
        authListener = listener;
        return () => {
          authListener = null;
        };
      }),
      signOutProviders: jest.fn(async () => {
        calls.push('auth.signOutProviders');
        currentUser = null;
      }),
      revokeGoogleAccess: jest.fn(async () => {
        calls.push('auth.revokeGoogleAccess');
      }),
      deleteAccountOnServer: jest.fn(async () => {
        calls.push('auth.deleteAccountOnServer');
      }),
    },
    data: {
      startSession: jest.fn(async (uid: string, options?: { mode?: 'foreground' | 'headless' }) => {
        calls.push(`data.startSession:${uid}:${options?.mode ?? 'foreground'}`);
        dataUid = uid;
      }),
      endSession: jest.fn(async (options: { wipeLocal: boolean }) => {
        calls.push(`data.endSession:wipe=${options.wipeLocal}`);
        dataUid = null;
      }),
      getActiveUid: jest.fn(() => dataUid),
      getPendingWriteCount: jest.fn(async () => 0),
    },
    userRepository: {
      ensureProfile: jest.fn(async (user: AuthUser) => {
        calls.push(`ensureProfile:${user.uid}`);
        return {
          uid: user.uid,
          email: null,
          displayName: user.displayName,
          photoURL: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastLoginAt: null,
          legacyMigratedAt: null,
        };
      }),
    },
    calendar: {
      start: jest.fn((uid: string) => {
        calls.push(`calendar.start:${uid}`);
      }),
      stop: jest.fn(() => {
        calls.push('calendar.stop');
      }),
    },
    alerts: {
      startSession: jest.fn(async (uid: string) => {
        calls.push(`alerts.startSession:${uid}`);
      }),
      endSession: jest.fn(async () => {
        calls.push('alerts.endSession');
      }),
    },
    events: {
      emit: jest.fn(<K extends keyof AppEventMap>(name: K, payload: AppEventMap[K]) => {
        calls.push(`emit:${name}`);
        events.push({ name, payload });
      }),
    },
    runCleanups: jest.fn(async ({ uid }: { uid: string }) => {
      calls.push(`cleanups:${uid}`);
      return [];
    }),
    logger: silentLogger,
    stableStateTimeoutMs: 200,
  };

  return {
    deps,
    calls,
    events,
    emitAuth(user) {
      currentUser = user;
      if (!authListener) throw new Error('not subscribed');
      authListener(user);
    },
    setCurrentUser(user) {
      currentUser = user;
    },
  };
}

/** Lets the not-awaited alerts.startSession promise run. */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

async function startActive(harness: Harness, user: AuthUser = userA) {
  const manager = createSessionManager(harness.deps);
  manager.init();
  harness.emitAuth(user);
  await manager.whenIdle();
  await flushMicrotasks();
  return manager;
}

describe('session start', () => {
  it('starts data, emits session:started (restored), then starts calendar and alerts', async () => {
    const harness = createHarness();
    const manager = createSessionManager(harness.deps);
    const statuses: string[] = [];
    manager.subscribe((state) => statuses.push(state.status));
    manager.init();
    manager.init(); // idempotent

    harness.emitAuth(userA);
    await manager.whenIdle();
    await flushMicrotasks();

    expect(harness.deps.auth.onAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(harness.calls).toEqual([
      'data.startSession:uid-a:foreground',
      'emit:session:started',
      'calendar.start:uid-a',
      'alerts.startSession:uid-a',
    ]);
    expect(harness.events[0]).toEqual({ name: 'session:started', payload: { uid: 'uid-a', restored: true } });
    expect(statuses).toEqual(['initializing', 'starting', 'active']);
    expect(manager.getState()).toEqual({ status: 'active', user: userA, error: null });
  });

  it('marks a sign-in after an empty start as not restored', async () => {
    const harness = createHarness();
    const manager = createSessionManager(harness.deps);
    manager.init();
    harness.emitAuth(null);
    await manager.whenIdle();
    expect(manager.getState().status).toBe('signed_out');

    harness.emitAuth(userA);
    await manager.whenIdle();
    expect(harness.events[0]).toEqual({ name: 'session:started', payload: { uid: 'uid-a', restored: false } });
  });

  it('stays active with an error when the data session fails to start', async () => {
    const harness = createHarness();
    (harness.deps.data.startSession as jest.Mock).mockRejectedValueOnce(new AppError('unknown', 'disk'));
    const manager = await startActive(harness);
    expect(manager.getState().status).toBe('active');
    expect(manager.getState().error?.code).toBe('unknown');
    expect(harness.calls).toContain('emit:session:started');
  });

  it('refreshes the profile (no restart) when the identity of the same user changes', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    harness.calls.length = 0;

    harness.emitAuth({ ...userA, displayName: 'A (renamed)' });
    await manager.whenIdle();
    await flushMicrotasks();

    expect(harness.calls).toEqual(['ensureProfile:uid-a']);
    expect(manager.getState().user?.displayName).toBe('A (renamed)');
  });
});

describe('sign-out', () => {
  it('shuts other areas down before wiping local data, signs out providers, then emits session:ended', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    harness.calls.length = 0;
    const statuses: string[] = [];
    manager.subscribe((state) => statuses.push(state.status));

    await manager.signOut();

    expect(harness.calls).toEqual([
      'alerts.endSession',
      'calendar.stop',
      'cleanups:uid-a',
      'data.endSession:wipe=true',
      'auth.signOutProviders',
      'emit:session:ended',
    ]);
    expect(harness.events.at(-1)).toEqual({ name: 'session:ended', payload: { uid: 'uid-a', reason: 'sign_out' } });
    expect(statuses).toEqual(['active', 'ending', 'signed_out']);
    expect(manager.getState()).toEqual({ status: 'signed_out', user: null, error: null });

    // Firebase then reports the signed-out user: nothing else happens.
    harness.emitAuth(null);
    await manager.whenIdle();
    expect(harness.calls.filter((call) => call === 'emit:session:ended')).toHaveLength(1);
  });

  it('refuses to drop unsynced writes unless forced', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    (harness.deps.data.getPendingWriteCount as jest.Mock).mockResolvedValue(3);

    await expect(manager.signOut()).rejects.toMatchObject({ code: 'pending_writes', details: { count: 3 } });
    expect(manager.getState().status).toBe('active');
    expect(harness.deps.data.endSession).not.toHaveBeenCalled();

    await manager.signOut({ force: true });
    expect(manager.getState().status).toBe('signed_out');
  });

  it('keeps going when a step fails and reports the first failure in the state', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    (harness.deps.alerts.endSession as jest.Mock).mockRejectedValueOnce(new Error('notifications'));

    await manager.signOut();

    expect(harness.deps.data.endSession).toHaveBeenCalledWith({ wipeLocal: true });
    expect(harness.deps.auth.signOutProviders).toHaveBeenCalled();
    expect(manager.getState().status).toBe('signed_out');
    expect(manager.getState().error?.code).toBe('unknown');
  });

  it('restarts the session when Firebase sign-out fails (still signed in)', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    (harness.deps.auth.signOutProviders as jest.Mock).mockRejectedValueOnce(new AppError('offline'));

    await expect(manager.signOut()).rejects.toMatchObject({ code: 'offline' });
    await manager.whenIdle();
    expect(manager.getState().status).toBe('active');
    expect(harness.deps.data.startSession).toHaveBeenCalledTimes(2);
  });

  it('waits for a running start before ending the session', async () => {
    const harness = createHarness();
    let releaseStart: () => void = () => undefined;
    (harness.deps.data.startSession as jest.Mock).mockImplementationOnce(
      (uid: string) =>
        new Promise<void>((resolve) => {
          harness.calls.push(`data.startSession:${uid}:slow`);
          releaseStart = resolve;
        }),
    );
    const manager = createSessionManager(harness.deps);
    manager.init();
    harness.emitAuth(userA);
    await flushMicrotasks();
    const signOut = manager.signOut();
    await flushMicrotasks();
    expect(harness.calls).not.toContain('alerts.endSession');

    releaseStart();
    await signOut;
    const startIndex = harness.calls.indexOf('emit:session:started');
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(harness.calls.indexOf('alerts.endSession')).toBeGreaterThan(startIndex);
  });
});

describe('auth lost and account switch', () => {
  it('ends the session without signing out providers when Firebase loses the user', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    harness.calls.length = 0;

    harness.emitAuth(null);
    await manager.whenIdle();

    expect(harness.calls).toEqual([
      'alerts.endSession',
      'calendar.stop',
      'cleanups:uid-a',
      'data.endSession:wipe=true',
      'emit:session:ended',
    ]);
    expect(harness.events.at(-1)?.payload).toEqual({ uid: 'uid-a', reason: 'auth_lost' });
    expect(harness.deps.auth.signOutProviders).not.toHaveBeenCalled();
  });

  it('closes the previous account before starting a different one', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    harness.calls.length = 0;

    harness.emitAuth(userB);
    await manager.whenIdle();
    await flushMicrotasks();

    expect(harness.calls).toEqual([
      'alerts.endSession',
      'calendar.stop',
      'cleanups:uid-a',
      'data.endSession:wipe=true',
      'emit:session:ended',
      'data.startSession:uid-b:foreground',
      'emit:session:started',
      'calendar.start:uid-b',
      'alerts.startSession:uid-b',
    ]);
    expect(manager.getState().user?.uid).toBe('uid-b');
  });
});

describe('deleteAccount', () => {
  it('deletes on the server, revokes Google, then ends the session', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    harness.calls.length = 0;

    await manager.deleteAccount();

    expect(harness.calls).toEqual([
      'calendar.stop',
      'auth.deleteAccountOnServer',
      'auth.revokeGoogleAccess',
      'alerts.endSession',
      'calendar.stop',
      'cleanups:uid-a',
      'data.endSession:wipe=true',
      'auth.signOutProviders',
      'emit:session:ended',
    ]);
    expect(harness.events.at(-1)?.payload).toEqual({ uid: 'uid-a', reason: 'account_deleted' });

    // The deleted user's still-valid token must never start a new session.
    harness.emitAuth(userA);
    await manager.whenIdle();
    expect(manager.getState().status).toBe('signed_out');
    expect(await manager.withHeadlessSession(async () => 'ran')).toBeNull();
  });

  it('keeps the session (and restarts calendar sync) when the server call fails', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    harness.calls.length = 0;
    (harness.deps.auth.deleteAccountOnServer as jest.Mock).mockRejectedValueOnce(new AppError('offline'));

    await expect(manager.deleteAccount()).rejects.toMatchObject({ code: 'offline' });
    expect(harness.calls).toEqual(['calendar.stop', 'calendar.start:uid-a']);
    expect(manager.getState().status).toBe('active');
  });

  it('still signs out locally when revoking Google access fails', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    (harness.deps.auth.revokeGoogleAccess as jest.Mock).mockRejectedValueOnce(new AppError('offline'));

    await manager.deleteAccount();
    expect(manager.getState().status).toBe('signed_out');
    expect(harness.deps.data.endSession).toHaveBeenCalledWith({ wipeLocal: true });
  });

  it('reports success once the server deleted the account, even if the local Firebase sign-out fails', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    (harness.deps.auth.signOutProviders as jest.Mock).mockRejectedValueOnce(new AppError('unknown'));

    await expect(manager.deleteAccount()).resolves.toBeUndefined();
    await manager.whenIdle();
    expect(manager.getState()).toMatchObject({ status: 'signed_out', error: { code: 'unknown' } });
    expect(harness.deps.data.startSession).toHaveBeenCalledTimes(1);
  });

  it('requires a signed-in user', async () => {
    const harness = createHarness();
    const manager = createSessionManager(harness.deps);
    await expect(manager.deleteAccount()).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('withHeadlessSession', () => {
  it('resolves null when nobody is signed in', async () => {
    const harness = createHarness();
    const manager = createSessionManager(harness.deps);
    const fn = jest.fn(async () => 'ran');
    await expect(manager.withHeadlessSession(fn)).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('starts a headless data session in a background runtime and never ends it', async () => {
    const harness = createHarness();
    harness.setCurrentUser(userA);
    const manager = createSessionManager(harness.deps);

    await expect(manager.withHeadlessSession(async (uid) => `ran:${uid}`)).resolves.toBe('ran:uid-a');
    await expect(manager.withHeadlessSession(async (uid) => `again:${uid}`)).resolves.toBe('again:uid-a');

    expect(harness.calls).toEqual(['data.startSession:uid-a:headless']);
    expect(harness.deps.data.endSession).not.toHaveBeenCalled();
  });

  it('skips the run when the data session belongs to another account', async () => {
    const harness = createHarness();
    harness.setCurrentUser(userA);
    (harness.deps.data.getActiveUid as jest.Mock).mockReturnValue('uid-b');
    const manager = createSessionManager(harness.deps);
    await expect(manager.withHeadlessSession(async () => 'ran')).resolves.toBeNull();
  });

  it('runs inside the live foreground session without starting another one', async () => {
    const harness = createHarness();
    const manager = await startActive(harness);
    (harness.deps.data.startSession as jest.Mock).mockClear();

    await expect(manager.withHeadlessSession(async (uid) => `ran:${uid}`)).resolves.toBe('ran:uid-a');
    expect(harness.deps.data.startSession).not.toHaveBeenCalled();
  });

  it('waits for the first auth event in a foreground runtime', async () => {
    const harness = createHarness();
    const manager = createSessionManager(harness.deps);
    manager.init();
    harness.setCurrentUser(userA);

    const run = manager.withHeadlessSession(async (uid) => `ran:${uid}`);
    await flushMicrotasks();
    harness.emitAuth(userA);

    await expect(run).resolves.toBe('ran:uid-a');
  });
});
