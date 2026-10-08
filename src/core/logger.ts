/**
 * Tiny scoped logger.
 *
 * - debug/info: development builds only (console.log; also stripped from production bundles by
 *   babel transform-remove-console).
 * - warn/error: always (console.warn / console.error). `error` also forwards to the registered
 *   error reporter (Sentry), set once at app start with `setErrorReporter(captureException)`.
 * - NEVER log tokens, emails, meeting titles/descriptions, chat text or notification bodies at
 *   any level. Log ids, counts and error codes instead.
 */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export type ErrorReporter = (error: unknown, context: { scope: string; message: string }) => void;

let reporter: ErrorReporter | null = null;

/** Registers the crash reporter (e.g. `captureException` from src/services/sentry). Pass null to clear. */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    debug(message, ...args) {
      if (isDev()) console.log(prefix, message, ...args);
    },
    info(message, ...args) {
      if (isDev()) console.log(prefix, message, ...args);
    },
    warn(message, ...args) {
      console.warn(prefix, message, ...args);
    },
    error(message, ...args) {
      console.error(prefix, message, ...args);
      if (!reporter) return;
      const errorArg = args.find((arg) => arg instanceof Error);
      try {
        reporter(errorArg ?? new Error(`${prefix} ${message}`), { scope, message });
      } catch {
        // Reporting must never break the caller.
      }
    },
  };
}
