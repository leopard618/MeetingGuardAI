/**
 * Minimal FIFO task queue (owner: auth). PURE.
 *
 * Used to serialize session transitions and native Google Sign-In calls (the native module rejects
 * a second concurrent call of the same kind with ASYNC_OP_IN_PROGRESS). A failing task never
 * blocks the tasks queued after it. Tasks must not enqueue into the same queue and await the
 * result (that would deadlock); internal helpers run unqueued inside a queued task.
 */
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Resolves once every task queued so far has settled (and none is pending). */
  idle(): Promise<void>;
  readonly size: number;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  function run<T>(task: () => Promise<T>): Promise<T> {
    pending += 1;
    const result = tail.then(
      () => task(),
      () => task(),
    );
    tail = result.then(
      () => {
        pending -= 1;
      },
      () => {
        pending -= 1;
      },
    );
    return result;
  }

  async function idle(): Promise<void> {
    // Loop: tasks may be queued while we wait for the current tail.
    while (pending > 0) {
      await tail.catch(() => undefined);
    }
  }

  return {
    run,
    idle,
    get size() {
      return pending;
    },
  };
}
