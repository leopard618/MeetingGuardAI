/**
 * useSummary(summaryId) (owner: summaries-app; M10 section 9): the full view of one summary
 * (summaryRead get). Shows the cached copy at once and asks again on mount; re-renders whenever
 * the cache changes (an attach / detach / keep answer patches the filing state, a list answer
 * refreshes it, a delete removes the copy, session end).
 *
 * - `enabled: false` asks nothing (pass useSummaryStatus().available).
 * - After the summary was deleted (here or on another device) `summary` is null and `error` is
 *   not_found (summaryErrorReason(error) === 'not_found'), or both are null right after this
 *   device deleted it; the view screen goes back in either case.
 * - The text is shown as plain Text only: links stay plain text, nothing is rendered as HTML,
 *   and nothing from the summary is ever logged.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { SummaryDetail } from '../../core/aiContract';
import { toAppError, type AppError } from '../../core/errors';

import { summariesService, type SummariesService } from './summariesService';

export interface UseSummaryOptions {
  /** false: ask nothing and return no summary (default true). */
  enabled?: boolean;
  /** Tests only: a service made with createSummariesService. */
  service?: SummariesService;
}

export interface UseSummaryResult {
  /** null until the first answer, while not enabled, or after a delete. */
  summary: SummaryDetail | null;
  /** Failure of the last ask (a cached copy, if any, stays); refresh() retries. */
  error: AppError | null;
  /** The first load is in flight (nothing to show yet). */
  loading: boolean;
  /** Asks summaryRead get again. Never throws. */
  refresh(): Promise<void>;
}

interface RequestState {
  key: string | null;
  error: AppError | null;
  settled: boolean;
}

const IDLE: RequestState = { key: null, error: null, settled: false };

export function useSummary(summaryId: string | null | undefined, options: UseSummaryOptions = {}): UseSummaryResult {
  const service = options.service ?? summariesService;
  const key = (options.enabled ?? true) && typeof summaryId === 'string' && summaryId !== '' ? summaryId : null;

  const getSnapshot = useCallback(() => (key !== null ? service.getKnownSummary(key) : null), [service, key]);
  const summary = useSyncExternalStore(service.subscribe, getSnapshot, getSnapshot);
  const [request, setRequest] = useState<RequestState>(IDLE);

  useEffect(() => {
    if (key === null) return undefined;
    let active = true;
    service.getSummary(key).then(
      () => {
        if (active) setRequest({ key, error: null, settled: true });
      },
      (caught: unknown) => {
        if (active) setRequest({ key, error: toAppError(caught), settled: true });
      },
    );
    return () => {
      active = false;
    };
  }, [service, key]);

  const refresh = useCallback(async (): Promise<void> => {
    if (key === null) return;
    try {
      await service.getSummary(key);
      setRequest({ key, error: null, settled: true });
    } catch (caught: unknown) {
      setRequest({ key, error: toAppError(caught), settled: true });
    }
  }, [service, key]);

  const current = key !== null && request.key === key;
  return {
    summary,
    error: current ? request.error : null,
    loading: key !== null && summary === null && !(current && request.settled),
    refresh,
  };
}
