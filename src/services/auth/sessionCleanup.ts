/**
 * Session cleanup registry (owner: auth). PURE module (core imports only).
 *
 * The session manager runs every registered hook while a session ENDS, after the alert engine and
 * the calendar engine have stopped and BEFORE the data layer wipes the per-user cache
 * (`mg:{uid}:*`), so a hook can still read the user's local data if it needs to.
 *
 * Use it for per-user state that lives outside `mg:{uid}:*` or outside the data layer (in-memory
 * caches, legacy keys, files). Hooks must be idempotent; a failing hook is logged and never stops
 * the sign-out. Public through `src/services/auth/authService.ts` (`registerSessionCleanup`), so
 * lower layers (calendar, ai) can register without importing the auth barrel.
 */
import type { SessionEndedEvent, Unsubscribe } from '../../core/events';

export interface SessionCleanupContext {
  uid: string;
  reason: SessionEndedEvent['reason'];
}

export type SessionCleanupHook = (context: SessionCleanupContext) => void | Promise<void>;

export interface SessionCleanupFailure {
  name: string;
  error: unknown;
}

export interface SessionCleanupRegistry {
  /** Registers (or replaces) the hook called `name`. */
  register(name: string, hook: SessionCleanupHook): Unsubscribe;
  /** Runs every hook sequentially in registration order; resolves with the failures. */
  run(context: SessionCleanupContext): Promise<SessionCleanupFailure[]>;
  names(): string[];
}

export function createSessionCleanupRegistry(): SessionCleanupRegistry {
  const hooks = new Map<string, SessionCleanupHook>();

  return {
    register(name, hook) {
      hooks.delete(name);
      hooks.set(name, hook);
      return () => {
        if (hooks.get(name) === hook) hooks.delete(name);
      };
    },
    async run(context) {
      const failures: SessionCleanupFailure[] = [];
      for (const [name, hook] of [...hooks.entries()]) {
        try {
          await hook(context);
        } catch (error) {
          failures.push({ name, error });
        }
      }
      return failures;
    },
    names: () => [...hooks.keys()],
  };
}

/** The app-wide registry used by the session manager. */
export const sessionCleanupRegistry: SessionCleanupRegistry = createSessionCleanupRegistry();

/** Registers a per-user cleanup hook run on sign-out / account deletion / auth loss. */
export function registerSessionCleanup(name: string, hook: SessionCleanupHook): Unsubscribe {
  return sessionCleanupRegistry.register(name, hook);
}
