/**
 * Calendar status store (calendar-internal). Every provider operation reports here, so the
 * status the UI shows is the same whether the engine, the UI or the AI executor ran the operation.
 * Snapshots are immutable: a new object on every change (useSyncExternalStore-friendly).
 */
import type { CalendarStatus, PermissionState, ProviderStatus } from '../../core/contracts';
import type { AppErrorCode } from '../../core/errors';
import type { Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';

const log = createLogger('calendar');

export type CalendarProvider = 'google' | 'device';

export function initialCalendarStatus(): CalendarStatus {
  return {
    google: { enabled: false, syncing: false, lastSyncAt: null, lastError: null, connected: false, hasScope: false },
    device: {
      enabled: false,
      syncing: false,
      lastSyncAt: null,
      lastError: null,
      permission: 'undetermined',
      importCalendarIds: [],
      exportCalendarId: null,
    },
  };
}

export interface GoogleStatusPatch {
  enabled?: boolean;
  hasScope?: boolean;
  lastSyncAt?: string | null;
  lastError?: AppErrorCode | null;
}

export interface DeviceStatusPatch {
  enabled?: boolean;
  permission?: PermissionState;
  importCalendarIds?: string[];
  exportCalendarId?: string | null;
  lastSyncAt?: string | null;
  lastError?: AppErrorCode | null;
}

export interface CalendarStatusStore {
  get(): CalendarStatus;
  subscribe(listener: (status: CalendarStatus) => void): Unsubscribe;
  patchGoogle(patch: GoogleStatusPatch): void;
  patchDevice(patch: DeviceStatusPatch): void;
  /** Marks a provider operation as running; call the returned function when it settles. */
  beginSync(provider: CalendarProvider): () => void;
  /** Back to the signed-out state (session end). */
  reset(): void;
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function createCalendarStatusStore(): CalendarStatusStore {
  let status = initialCalendarStatus();
  const running: Record<CalendarProvider, number> = { google: 0, device: 0 };
  const listeners = new Set<(status: CalendarStatus) => void>();

  function publish(next: CalendarStatus): void {
    status = next;
    for (const listener of [...listeners]) {
      try {
        listener(status);
      } catch (error) {
        log.error('Calendar status listener failed', error);
      }
    }
  }

  function withGoogle(patch: Partial<CalendarStatus['google']>): void {
    const current = status.google;
    const merged = { ...current, ...patch };
    merged.connected = merged.enabled && merged.hasScope;
    const changed = (Object.keys(merged) as (keyof typeof merged)[]).some((key) => merged[key] !== current[key]);
    if (changed) publish({ ...status, google: merged });
  }

  function withDevice(patch: Partial<CalendarStatus['device']>): void {
    const current = status.device;
    const merged = { ...current, ...patch };
    const changed = (Object.keys(merged) as (keyof typeof merged)[]).some((key) => {
      const a = merged[key];
      const b = current[key];
      if (Array.isArray(a) && Array.isArray(b)) return !sameArray(a, b);
      return a !== b;
    });
    if (changed) publish({ ...status, device: merged });
  }

  function setSyncing(provider: CalendarProvider): void {
    const syncing = running[provider] > 0;
    if (provider === 'google') withGoogle({ syncing } satisfies Partial<ProviderStatus>);
    else withDevice({ syncing });
  }

  return {
    get: () => status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },
    patchGoogle: (patch) => withGoogle(patch),
    patchDevice: (patch) => withDevice(patch),
    beginSync(provider) {
      running[provider] += 1;
      setSyncing(provider);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        running[provider] = Math.max(0, running[provider] - 1);
        setSyncing(provider);
      };
    },
    reset() {
      running.google = 0;
      running.device = 0;
      publish(initialCalendarStatus());
    },
  };
}
