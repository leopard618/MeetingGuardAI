/**
 * Serialized + debounced task runner (owner: alerts). Pure JS (timers injected).
 *
 * - At most one run at a time.
 * - Requests made while a run is in progress are coalesced into ONE follow-up run.
 * - Every request resolves with the result of the first run that STARTED after the request
 *   (so a caller never gets a result computed from state older than its request).
 * - `immediate` skips the debounce (explicit calls: background task, manual, snooze).
 */
import type { TimerPort } from './types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface CoalescingRunner<T> {
  request(options?: { immediate?: boolean }): Promise<T>;
  /** Resolves when no run is in progress or queued. */
  idle(): Promise<void>;
  isBusy(): boolean;
}

export function createCoalescingRunner<T>(
  task: () => Promise<T>,
  options: { delayMs: number; timers: TimerPort },
): CoalescingRunner<T> {
  let waiting: Deferred<T> | null = null;
  let running: Promise<void> | null = null;
  let timer: unknown = null;
  let timerImmediate = false;
  const idleWaiters: (() => void)[] = [];

  function notifyIdle(): void {
    if (running || waiting) return;
    idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  function arm(immediate: boolean): void {
    if (running) return; // the running task re-arms when it finishes
    if (timer !== null) {
      if (!immediate || timerImmediate) return;
      options.timers.clearTimeout(timer);
    }
    timerImmediate = immediate;
    timer = options.timers.setTimeout(start, immediate ? 0 : options.delayMs);
  }

  function start(): void {
    timer = null;
    if (running || !waiting) return;
    const current = waiting;
    waiting = null;
    running = (async () => {
      try {
        current.resolve(await task());
      } catch (error) {
        current.reject(error);
      }
    })().finally(() => {
      running = null;
      if (waiting) arm(true);
      else notifyIdle();
    });
  }

  return {
    request(requestOptions = {}) {
      if (!waiting) waiting = deferred<T>();
      const promise = waiting.promise;
      arm(requestOptions.immediate === true);
      return promise;
    },
    idle() {
      if (!running && !waiting) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    isBusy() {
      return running !== null || waiting !== null;
    },
  };
}
