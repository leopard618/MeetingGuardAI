/**
 * useSummaryStatus() (owner: summaries-app; M10 section 9). Asks summariesService.getStatus()
 * once on mount (the service caches the answer per session), exposes the known answer
 * synchronously for render and re-renders whenever it changes (another hook instance asked,
 * refresh(), a summaryAction answer, a list answer that changed the inbox count, session end).
 *
 * - `available` is the one gate for every summary surface: enabled AND allowed (the pilot).
 * - `pollMs` asks again that often, only while the screen is focused and the app is in the
 *   foreground (the connect screen passes SUMMARY_STATUS_POLL_MS while it waits for mail or a
 *   Gmail code). After a pause it asks once right away, then keeps the interval.
 * - `refreshOnFocus` asks again whenever the screen gains focus or the app comes back to the
 *   foreground with a cached answer older than SUMMARY_STATUS_STALE_MS (an available status; the
 *   Settings row's "N waiting for a meeting") or SUMMARY_STATUS_UNAVAILABLE_STALE_MS (the feature
 *   off or not in the pilot, so a user added later sees the row without signing out).
 * - `status` stays null while unknown; `error` carries the last failed ask so a screen can offer
 *   a retry instead of spinning forever. A failed poll keeps the last answer on screen. The error
 *   shows only while the status it failed next to is still the cached one: a newer answer (from
 *   any hook instance, a poll or an action) clears it.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { SummaryStatusResponse } from '../../core/aiContract';
import { toAppError, type AppError } from '../../core/errors';

import { summariesService, type SummariesService } from './summariesService';
import { isSummariesAvailable } from './summaryCore';
import { useScreenActive } from './useScreenActive';

/** The connect screen's poll while it waits (M10 section 9: every 8 s while focused). */
export const SUMMARY_STATUS_POLL_MS = 8_000;
/** refreshOnFocus: an available status older than this is asked again (one Firestore read). */
export const SUMMARY_STATUS_STALE_MS = 60_000;
/** refreshOnFocus: a status without the feature (off, or not in the pilot) is asked again this rarely. */
export const SUMMARY_STATUS_UNAVAILABLE_STALE_MS = 30 * 60_000;

export interface UseSummaryStatusOptions {
  /** Ask again this often while focused and in the foreground; null, undefined or 0: never. */
  pollMs?: number | null;
  /** Ask again on focus and on return to the foreground when the cached answer is stale. */
  refreshOnFocus?: boolean;
  /** Tests only: a service made with createSummariesService. */
  service?: SummariesService;
}

export interface UseSummaryStatusResult {
  /** null while unknown (first ask in flight or failed). */
  status: SummaryStatusResponse | null;
  /** status.enabled && status.allowed: show summary UI only when true. */
  available: boolean;
  /** Failure of the last ask (null while loading, after a success, or once a newer status arrived); refresh() retries. */
  error: AppError | null;
  /** Asks summaryStatus again; the cached answer stays visible until the new one arrives. */
  refresh(): Promise<void>;
}

/** A failed ask and the cached status it failed next to (the error shows only while that is current). */
interface Failure {
  error: AppError;
  status: SummaryStatusResponse | null;
}

export function useSummaryStatus(options: UseSummaryStatusOptions = {}): UseSummaryStatusResult {
  const service = options.service ?? summariesService;
  const pollMs = options.pollMs ?? null;
  const refreshOnFocus = options.refreshOnFocus ?? false;
  const status = useSyncExternalStore(service.subscribe, service.getKnownStatus, service.getKnownStatus);
  const [failure, setFailure] = useState<Failure | null>(null);
  const screenActive = useScreenActive();
  /** The poll was paused (screen blurred or app in the background) since it last ran. */
  const pausedRef = useRef(false);

  const settle = useCallback(
    (ask: Promise<unknown>, isActive: () => boolean): void => {
      ask.then(
        () => {
          if (isActive()) setFailure(null);
        },
        (caught: unknown) => {
          if (isActive()) setFailure({ error: toAppError(caught), status: service.getKnownStatus() });
        },
      );
    },
    [service],
  );

  useEffect(() => {
    let active = true;
    settle(service.getStatus(), () => active);
    return () => {
      active = false;
    };
  }, [service, settle]);

  useEffect(() => {
    if (!refreshOnFocus || !screenActive) return undefined;
    let active = true;
    const maxAgeMs = isSummariesAvailable(service.getKnownStatus()) ? SUMMARY_STATUS_STALE_MS : SUMMARY_STATUS_UNAVAILABLE_STALE_MS;
    settle(service.getStatus({ maxAgeMs }), () => active);
    return () => {
      active = false;
    };
  }, [service, settle, refreshOnFocus, screenActive]);

  const refresh = useCallback(async (): Promise<void> => {
    // The subscription delivers the new answer to every mounted hook instance.
    try {
      await service.refreshStatus();
      setFailure(null);
    } catch (caught: unknown) {
      setFailure({ error: toAppError(caught), status: service.getKnownStatus() });
    }
  }, [service]);

  useEffect(() => {
    if (pollMs === null || pollMs <= 0) return undefined;
    if (!screenActive) {
      pausedRef.current = true;
      return undefined;
    }
    const resumed = pausedRef.current;
    pausedRef.current = false;
    // Catch up right away after a pause (back from the Gmail settings page), then keep polling.
    const immediate = resumed ? setTimeout(() => void refresh(), 0) : null;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => {
      if (immediate !== null) clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [pollMs, screenActive, refresh]);

  const error = failure !== null && failure.status === status ? failure.error : null;
  return { status, available: isSummariesAvailable(status), error, refresh };
}
