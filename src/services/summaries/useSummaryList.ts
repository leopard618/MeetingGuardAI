/**
 * useSummaryList(view, meetingId?) (owner: summaries-app; M10 section 9). Shows the cached list
 * answer at once and asks summaryRead again on mount (the inbox view re-matches on the server,
 * so a meeting imported after the recap arrived gets its summary). Re-renders whenever the
 * cache changes: refresh(), another hook instance, an attach / detach / keep / delete answer
 * (patched in place), session end.
 *
 * - view 'meeting' needs meetingId (the master id for a series); without it nothing is asked.
 * - `enabled: false` asks nothing and returns no items: pass the status gate
 *   (useSummaryStatus().available) so summaryRead is never called while the feature is off.
 * - `loading` is the first load only (no items yet); `refreshing` is a refresh() in flight, for
 *   pull to refresh. A failed ask keeps the cached items and sets `error`; check
 *   isSummariesUnavailableError(error) to hide the surface (summaryRead not deployed).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { SummaryListItem, SummaryListView } from '../../core/aiContract';
import { toAppError, type AppError } from '../../core/errors';

import { summariesService, type SummariesService } from './summariesService';

export interface UseSummaryListOptions {
  /** false: ask nothing and return no items (default true). */
  enabled?: boolean;
  /** Tests only: a service made with createSummariesService. */
  service?: SummariesService;
}

export interface UseSummaryListResult {
  /** Newest first; null until the first answer (or while not enabled). */
  items: readonly SummaryListItem[] | null;
  /** More rows exist than one answer holds (SUMMARY_LIMITS.maxListItems). */
  hasMore: boolean;
  /** Failure of the last ask (cached items, if any, stay); refresh() retries. */
  error: AppError | null;
  /** The first load is in flight (no items to show yet). */
  loading: boolean;
  /** A refresh() is in flight (pull to refresh). */
  refreshing: boolean;
  /** Asks summaryRead again (the inbox view re-matches first). Never throws. */
  refresh(): Promise<void>;
}

interface RequestState {
  key: string | null;
  error: AppError | null;
  settled: boolean;
}

const IDLE: RequestState = { key: null, error: null, settled: false };

export function useSummaryList(
  view: SummaryListView,
  meetingId?: string | null,
  options: UseSummaryListOptions = {},
): UseSummaryListResult {
  const service = options.service ?? summariesService;
  const meeting = meetingId ?? null;
  const usable = (options.enabled ?? true) && (view !== 'meeting' || meeting !== null);
  const key = usable ? `${view}|${meeting ?? ''}` : null;

  const getSnapshot = useCallback(
    () => (usable ? service.getKnownList(view, meeting) : null),
    [service, usable, view, meeting],
  );
  const snapshot = useSyncExternalStore(service.subscribe, getSnapshot, getSnapshot);
  const [request, setRequest] = useState<RequestState>(IDLE);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (key === null) return undefined;
    let active = true;
    service.listSummaries(view, meeting).then(
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
  }, [service, key, view, meeting]);

  const refresh = useCallback(async (): Promise<void> => {
    if (key === null) return;
    setRefreshing(true);
    try {
      await service.listSummaries(view, meeting);
      setRequest({ key, error: null, settled: true });
    } catch (caught: unknown) {
      setRequest({ key, error: toAppError(caught), settled: true });
    } finally {
      setRefreshing(false);
    }
  }, [service, key, view, meeting]);

  const current = key !== null && request.key === key;
  return {
    items: snapshot?.items ?? null,
    hasMore: snapshot?.hasMore ?? false,
    error: current ? request.error : null,
    loading: key !== null && snapshot === null && !(current && request.settled),
    refreshing,
    refresh,
  };
}
