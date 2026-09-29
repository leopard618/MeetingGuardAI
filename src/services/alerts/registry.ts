/**
 * Fired / acknowledged alert registry (owner: alerts). PURE reducers + JSON (de)serialization.
 * Persisted per user in `mg:{uid}:alerts.state` (wiped with the user's local data at sign-out).
 *
 * Key = "<notification identifier>@<fireAt>": a rescheduled meeting (new fire time) is a new key,
 * so it alerts again; the same delivery seen twice (OS notification + in-app timer, or a re-render)
 * is shown only once.
 */
import { REGISTRY_RETENTION_MS } from './constants';

export interface RegistryEntry {
  /** When it was first shown / delivered (UTC ISO). */
  at: string;
  /** The user handled it (acknowledge / snooze / open). */
  ack: boolean;
}

export interface AlertRegistryState {
  v: 1;
  entries: Record<string, RegistryEntry>;
  lastReconcileAt: string | null;
}

export function emptyRegistry(): AlertRegistryState {
  return { v: 1, entries: {}, lastReconcileAt: null };
}

export function registryKey(identifier: string, fireAt: string): string {
  return `${identifier}@${fireAt}`;
}

export function hasFired(state: AlertRegistryState, key: string): boolean {
  return key in state.entries;
}

export function isAcknowledged(state: AlertRegistryState, key: string): boolean {
  return state.entries[key]?.ack === true;
}

export function markFired(state: AlertRegistryState, key: string, now: Date): AlertRegistryState {
  if (state.entries[key]) return state;
  return { ...state, entries: { ...state.entries, [key]: { at: now.toISOString(), ack: false } } };
}

export function markAcknowledged(state: AlertRegistryState, key: string, now: Date): AlertRegistryState {
  const current = state.entries[key];
  if (current?.ack) return state;
  return {
    ...state,
    entries: { ...state.entries, [key]: { at: current?.at ?? now.toISOString(), ack: true } },
  };
}

export function withLastReconcile(state: AlertRegistryState, now: Date): AlertRegistryState {
  return { ...state, lastReconcileAt: now.toISOString() };
}

/** Drops entries older than the retention window. */
export function pruneRegistry(state: AlertRegistryState, now: Date, retentionMs = REGISTRY_RETENTION_MS): AlertRegistryState {
  const cutoff = now.getTime() - retentionMs;
  const entries: Record<string, RegistryEntry> = {};
  let changed = false;
  for (const [key, entry] of Object.entries(state.entries)) {
    if (Date.parse(entry.at) >= cutoff) entries[key] = entry;
    else changed = true;
  }
  return changed ? { ...state, entries } : state;
}

/** Union of two registries (ack wins, earliest `at` wins). */
export function mergeRegistries(a: AlertRegistryState, b: AlertRegistryState): AlertRegistryState {
  const entries: Record<string, RegistryEntry> = { ...a.entries };
  for (const [key, entry] of Object.entries(b.entries)) {
    const current = entries[key];
    entries[key] = current
      ? { at: current.at <= entry.at ? current.at : entry.at, ack: current.ack || entry.ack }
      : entry;
  }
  const last = [a.lastReconcileAt, b.lastReconcileAt].filter((value): value is string => value !== null).sort();
  return { v: 1, entries, lastReconcileAt: last[last.length - 1] ?? null };
}

/** Tolerant parse of the stored JSON (invalid entries are skipped; invalid JSON => empty). */
export function parseRegistry(raw: string | null): AlertRegistryState {
  if (!raw) return emptyRegistry();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyRegistry();
  }
  if (typeof value !== 'object' || value === null) return emptyRegistry();
  const record = value as { entries?: unknown; lastReconcileAt?: unknown };
  const entries: Record<string, RegistryEntry> = {};
  if (typeof record.entries === 'object' && record.entries !== null) {
    for (const [key, entry] of Object.entries(record.entries as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { at, ack } = entry as { at?: unknown; ack?: unknown };
      if (typeof at === 'string' && Number.isFinite(Date.parse(at))) {
        entries[key] = { at, ack: ack === true };
      }
    }
  }
  const lastReconcileAt =
    typeof record.lastReconcileAt === 'string' && Number.isFinite(Date.parse(record.lastReconcileAt))
      ? record.lastReconcileAt
      : null;
  return { v: 1, entries, lastReconcileAt };
}

export function serializeRegistry(state: AlertRegistryState): string {
  return JSON.stringify(state);
}
