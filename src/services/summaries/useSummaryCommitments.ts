/**
 * useSummaryCommitments(summaryId) (owner: summaries-app; M11, docs/v2/M11-DESIGN.md sections 3
 * and 7): one summary's suggested tasks over the commitments service. Shows the cached answer at
 * once and asks get again on mount; re-renders whenever the cache changes (a prepare or decide
 * answer, a reload after stale, session end).
 *
 * - `enabled: false` asks nothing (pass useSummaryStatus().available: the review is shown only
 *   when summaryStatus says enabled and allowed). A summaryCommitments that is not deployed reads
 *   as not_enabled (isCommitmentsUnavailableError(error)).
 * - state: 'idle' (not enabled or no id), 'loading' (the first answer is in flight, nothing cached),
 *   'error' (the first ask failed and nothing is cached), else the server's CommitmentState of the
 *   cached answer ('none' | 'preparing' | 'ready' | 'empty' | 'stale'). A failed later call keeps
 *   the cached state and sets `error`.
 * - While the answer is 'preparing' (another device or WhatsApp holds the lease) it asks get every
 *   COMMITMENTS_POLL_MS, only while the screen is focused and the app is in the foreground (after a
 *   pause it asks once right away), at most COMMITMENTS_MAX_POLLS times; then `error` is a timeout
 *   with details.preparing true ("taking longer than usual", refresh() starts again), also when
 *   the last poll failed on the way (offline, timeout, upstream). Unmount, blur and the background
 *   stop it.
 * - When the cache is cleared (session end, or "Disconnect and delete") nothing is asked again
 *   and the state reads 'loading': the screen tells a deleted summary from summaryRead (its copy
 *   is dropped too), as the summary view does, never from this hook alone.
 * - prepare(mode) and decide(decisions) never throw: prepare resolves the answer or null (the
 *   failure is in `error`; quota_exceeded carries `usage`), decide resolves a DecideCommitmentsResult.
 *   A stale decide (another device re-prepared the list) resolves { status: 'stale' } with no error:
 *   the service already reloaded the list, so the screen shows the current one and asks again.
 * - The AI notice (decision 17) is the screen's job: call prepare('ai') only after it was seen
 *   (useCommitmentsAiNotice in ./commitmentsNotice.ts).
 * - Nothing here is stored outside memory, and nothing from the summary is logged.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type {
  AssistantUsage,
  CommitmentDecision,
  CommitmentDecisionResult,
  CommitmentMode,
  CommitmentState,
  SummaryCommitments,
  SummaryCommitmentsResponse,
} from '../../core/aiContract';
import { AppError, toAppError } from '../../core/errors';

import { commitmentsService, type DecideCommitmentsOptions, type SummaryCommitmentsService } from './commitments';
import { commitmentErrorReason, commitmentErrorUsage } from './commitmentsCore';
import { useScreenActive } from './useScreenActive';

/** How often get is asked while another device prepares the suggestions. */
export const COMMITMENTS_POLL_MS = 4_000;
/** Polls per 'preparing' stretch (30 x 4 s: past the server's 100 s lease). */
export const COMMITMENTS_MAX_POLLS = 30;

export type SummaryCommitmentsHookState = 'idle' | 'loading' | 'error' | CommitmentState;

/** What is in flight from this hook ('prepare' covers the whole AI call, up to 100 s). */
export type CommitmentsBusy = 'prepare' | 'decide' | null;

export type DecideCommitmentsResult =
  /** The server answered: one result per decision; say "Added" from these only. */
  | { status: 'done'; results: readonly CommitmentDecisionResult[]; response: SummaryCommitmentsResponse }
  /** The list changed on another device; it was reloaded. Nothing was decided: let the user look again. */
  | { status: 'stale' }
  /** Nothing is known to be decided (offline, timeout, upstream...); `error` holds it too. */
  | { status: 'failed'; error: AppError };

export interface UseSummaryCommitmentsOptions {
  /** false: ask nothing (default true). Pass useSummaryStatus().available. */
  enabled?: boolean;
  /** Tests only: a service made with createCommitmentsService. */
  service?: SummaryCommitmentsService;
  /** Tests only. */
  pollMs?: number;
  /** Tests only. */
  maxPolls?: number;
}

export interface UseSummaryCommitmentsResult {
  state: SummaryCommitmentsHookState;
  /** The suggestions of the cached answer (ready, empty, stale with the same text); else null. */
  data: SummaryCommitments | null;
  /** The last failure (a cached answer, if any, stays); cleared by the next success. */
  error: AppError | null;
  busy: CommitmentsBusy;
  /** The allowance: from a quota_exceeded error, else after the last charged AI preparation; else null. */
  usage: AssistantUsage | null;
  /** summaryCommitments prepare; resolves the answer, or null on failure (see `error`). */
  prepare(mode: CommitmentMode): Promise<SummaryCommitmentsResponse | null>;
  /** summaryCommitments decide with the key of `data` (or options.key). Never throws. */
  decide(decisions: readonly CommitmentDecision[], options?: DecideCommitmentsOptions): Promise<DecideCommitmentsResult>;
  /** Asks get again (also restarts a poll that gave up). Never throws. */
  refresh(): Promise<void>;
}

interface Failure {
  key: string;
  error: AppError;
}

/** The error `error` holds once the polls gave up while the answer still said 'preparing'. */
function stillPreparingError(): AppError {
  return new AppError('timeout', 'summary commitments still preparing', { details: { preparing: true } });
}

export function useSummaryCommitments(summaryId: string | null | undefined, options: UseSummaryCommitmentsOptions = {}): UseSummaryCommitmentsResult {
  const service = options.service ?? commitmentsService;
  const pollMs = options.pollMs ?? COMMITMENTS_POLL_MS;
  const maxPolls = options.maxPolls ?? COMMITMENTS_MAX_POLLS;
  const key = (options.enabled ?? true) && typeof summaryId === 'string' && summaryId !== '' ? summaryId : null;

  const getSnapshot = useCallback(() => (key !== null ? service.getKnown(key) : null), [service, key]);
  const snapshot = useSyncExternalStore(service.subscribe, getSnapshot, getSnapshot);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** The key whose first get settled (success or failure). */
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<CommitmentsBusy>(null);
  const [pollTick, setPollTick] = useState(0);
  const screenActive = useScreenActive();
  const mountedRef = useRef(true);
  const pollsRef = useRef(0);
  const pausedRef = useRef(false);
  /** The key the latest call is for: an answer for an older key never sets this one's error. */
  const keyRef = useRef(key);

  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const succeeded = useCallback((forKey: string): void => {
    if (!mountedRef.current || keyRef.current !== forKey) return;
    setFailure((current) => (current !== null && current.key === forKey ? null : current));
    setSettledKey(forKey);
  }, []);

  const failed = useCallback((forKey: string, caught: unknown): AppError => {
    const error = toAppError(caught);
    if (mountedRef.current && keyRef.current === forKey) {
      setFailure({ key: forKey, error });
      setSettledKey(forKey);
    }
    return error;
  }, []);

  // The first ask for this summary (the cached answer, if any, shows meanwhile).
  useEffect(() => {
    if (key === null) return undefined;
    pollsRef.current = 0;
    service.get(key).then(
      () => succeeded(key),
      (caught: unknown) => {
        failed(key, caught);
      },
    );
    return undefined;
  }, [service, key, succeeded, failed]);

  const preparing = key !== null && snapshot?.state === 'preparing';

  // Poll get while another device prepares; only while focused and in the foreground, bounded.
  useEffect(() => {
    if (!preparing || key === null) {
      pollsRef.current = 0;
      return undefined;
    }
    if (!screenActive) {
      pausedRef.current = true;
      return undefined;
    }
    if (pollsRef.current >= maxPolls) return undefined;
    const resumed = pausedRef.current;
    pausedRef.current = false;
    let active = true;
    const timer = setTimeout(
      () => {
        pollsRef.current += 1;
        const attempt = pollsRef.current;
        service.get(key).then(
          (answer) => {
            succeeded(key);
            if (answer.state === 'preparing' && attempt >= maxPolls && mountedRef.current && keyRef.current === key) {
              setFailure({ key, error: stillPreparingError() });
            }
          },
          (caught: unknown) => {
            const error = failed(key, caught);
            // The last poll failed on the way (offline, a timeout, upstream): say "taking longer"
            // with Try again too, so the card never waits on polls that stopped. Any other reason
            // (not_found, a refusal) is kept: it changes what the screen shows.
            const reason = commitmentErrorReason(error);
            if (
              attempt >= maxPolls &&
              (reason === null || reason === 'upstream_error') &&
              service.getKnown(key)?.state === 'preparing' &&
              mountedRef.current &&
              keyRef.current === key
            ) {
              setFailure({ key, error: stillPreparingError() });
            }
          },
        ).finally(() => {
          if (active && mountedRef.current) setPollTick((tick) => tick + 1);
        });
      },
      resumed ? 0 : pollMs,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [service, key, preparing, screenActive, pollMs, maxPolls, pollTick, succeeded, failed]);

  const refresh = useCallback(async (): Promise<void> => {
    if (key === null) return;
    pollsRef.current = 0;
    try {
      await service.get(key);
      succeeded(key);
    } catch (caught: unknown) {
      failed(key, caught);
    }
    if (mountedRef.current) setPollTick((tick) => tick + 1);
  }, [service, key, succeeded, failed]);

  const prepare = useCallback(
    async (mode: CommitmentMode): Promise<SummaryCommitmentsResponse | null> => {
      if (key === null) return null;
      pollsRef.current = 0;
      if (mountedRef.current) setBusy('prepare');
      try {
        const answer = await service.prepare(key, mode);
        succeeded(key);
        return answer;
      } catch (caught: unknown) {
        failed(key, caught);
        return null;
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [service, key, succeeded, failed],
  );

  const decide = useCallback(
    async (decisions: readonly CommitmentDecision[], decideOptions?: DecideCommitmentsOptions): Promise<DecideCommitmentsResult> => {
      if (key === null) return { status: 'failed', error: new AppError('invalid_input', 'summary commitments not enabled') };
      if (mountedRef.current) setBusy('decide');
      try {
        const response = await service.decide(key, decisions, decideOptions);
        succeeded(key);
        return { status: 'done', results: response.results ?? [], response };
      } catch (caught: unknown) {
        const error = toAppError(caught);
        if (commitmentErrorReason(error) === 'stale') {
          // The service reloaded the list: no error to show, the screen asks the user again.
          succeeded(key);
          return { status: 'stale' };
        }
        return { status: 'failed', error: failed(key, error) };
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [service, key, succeeded, failed],
  );

  const error = key !== null && failure !== null && failure.key === key ? failure.error : null;
  const state: SummaryCommitmentsHookState =
    key === null ? 'idle' : snapshot !== null ? snapshot.state : settledKey === key && error !== null ? 'error' : 'loading';

  return {
    state,
    data: snapshot?.commitments ?? null,
    error,
    busy,
    usage: commitmentErrorUsage(error) ?? snapshot?.usage ?? null,
    prepare,
    decide,
    refresh,
  };
}
