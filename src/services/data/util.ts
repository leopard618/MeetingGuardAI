/**
 * Small pure helpers used across the data layer (no React Native / Firebase imports).
 */
import { AppError } from '../../core/errors';

/** Rejects with AppError('timeout') when `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('timeout', `${what} timed out after ${ms} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Serializes async tasks (FIFO). A failing task does not block the ones queued after it. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Resolves once every task queued so far has settled. */
  drain(): Promise<void> {
    return this.tail;
  }
}

/** Epoch milliseconds of an ISO-8601 instant, or null when the value is not a valid date string. */
export function isoMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** First argument that is a valid ISO instant, normalized with toISOString(); null if none. */
export function firstValidIso(...values: unknown[]): string | null {
  for (const value of values) {
    const ms = isoMs(value);
    if (ms !== null) return new Date(ms).toISOString();
  }
  return null;
}

/** Later of two ISO instants (null-safe). */
export function maxIso(a: string | null, b: string | null): string | null {
  const aMs = isoMs(a);
  const bMs = isoMs(b);
  if (aMs === null) return bMs === null ? null : new Date(bMs).toISOString();
  if (bMs === null) return new Date(aMs).toISOString();
  return new Date(Math.max(aMs, bMs)).toISOString();
}

/**
 * Timestamp for a new local write: `now`, or 1 ms after `previous` when the device clock is not
 * ahead of the version being edited (keeps last-writer-wins correct under small clock skew).
 */
export function nextTimestamp(now: Date, previous?: string | null): string {
  const nowMs = now.getTime();
  const previousMs = isoMs(previous);
  const ms = previousMs !== null && previousMs >= nowMs ? previousMs + 1 : nowMs;
  return new Date(ms).toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON-like values (object key order is ignored). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const aKeys = Object.keys(a).filter((key) => a[key] !== undefined);
    const bKeys = Object.keys(b).filter((key) => b[key] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/** Deep check used before writes: Firestore rejects `undefined` values (report #8). */
export function findUndefinedPath(value: unknown, path = ''): string | null {
  if (value === undefined) return path || '(root)';
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findUndefinedPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const found = findUndefinedPath(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return null;
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Stable 64-bit (two FNV-1a 32-bit lanes) hex digest; used for deterministic document ids. */
export function stableHash(input: string): string {
  const a = fnv1a32(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a32(`${input.length}:${input}`, 0x01000193).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

/** Sort comparator: startAt ascending, then id (stable order for equal starts). */
export function compareByStart(a: { startAt: string; id: string }, b: { startAt: string; id: string }): number {
  if (a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
