/**
 * SUMMARY COMMITMENTS service (owner: summaries-app; M11, docs/v2/M11-DESIGN.md sections 3 and 7).
 *
 * The app reads and decides a summary's suggested tasks ONLY through the summaryCommitments
 * callable (src/core/aiContract.ts, CALLABLES.summaryCommitments), with three ops:
 * - get(summaryId): the current suggestions; never calls the model, never charges.
 * - prepare(summaryId, mode): 'ai' sends the summary text to OpenAI through the server (one AI
 *   action per summary, the first time only; the screen shows the AI notice first), 'as_written'
 *   lists the action items exactly as written (free). It can answer 'preparing' (another device
 *   or WhatsApp holds the lease: poll get) or 'stale' with no list (the text changed meanwhile).
 * - decide(summaryId, decisions): accept, drop, restore, remove (Undo). The server writes the
 *   tasks in one transaction with deterministic ids, so a second tap or device answers
 *   already_added; the answer carries the updated list plus one result per decision, and "Added"
 *   is said from those results only. No offline accept: the server is the writer.
 *
 * - Transport: the shared Firebase Functions instance (src/config/firebase.ts) through an injected
 *   transport, with SUMMARY_COMMITMENTS_TIMEOUT_MS (one OpenAI call plus the transaction).
 * - zod on both sides: every request is parsed before it is sent (a bad one never leaves the phone:
 *   invalid_input with details.reason 'invalid_request') and every answer before it is used (a bad
 *   one is upstream_error; an answer for another op is too).
 * - Errors: details.reason (COMMITMENT_ERROR_CODES) mapped by commitmentsCore.mapCommitmentError.
 *   A function that is not deployed answers functions/not-found WITHOUT details: not_enabled.
 *   decide answering stale (another device re-prepared or switched the list) reloads the list with
 *   get before the stale error is thrown, so the screen shows the current list at once; a decide
 *   that timed out or failed upstream reloads too, since the server may have committed it.
 * - Session cache, memory only: the last answer per summary (state, list, the allowance after a
 *   charged preparation). Cleared on appEvents 'session:ended'. A get that was in flight when a
 *   prepare or decide answered never replaces that newer answer. not_found drops the entry.
 *   Nothing is written to AsyncStorage (the AI notice flag lives in ./commitmentsNotice.ts).
 * - After every answer with a list, onListFacts gets the summary's {state, open, accepted}, so the
 *   summaryRead rows ("Review commitments (5)") follow without a re-list.
 * - Privacy: never log or report summary content (titles, quotes, owners, addresses). Logs carry
 *   the op and AppError codes only; the AppErrors made here carry no `cause` (a raw callable error
 *   or a ZodError can hold titles and quotes, and Sentry links causes).
 */
import NetInfo from '@react-native-community/netinfo';
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  SUMMARY_COMMITMENTS_TIMEOUT_MS,
  summaryCommitmentsRequestSchema,
  summaryCommitmentsResponseSchema,
  type AssistantUsage,
  type CommitmentDecision,
  type CommitmentMode,
  type CommitmentState,
  type SummaryCommitments,
  type SummaryCommitmentsRequest,
  type SummaryCommitmentsResponse,
  type SummaryListCommitments,
} from '../../core/aiContract';
import { AppError, isAppError } from '../../core/errors';
import { appEvents, type AppEventMap, type EventBus, type Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import { getDeviceTimeZone } from '../../core/time';
import { functions } from '../../config/firebase';
import { getLanguage } from '../../i18n';

import { commitmentAppError, commitmentErrorReason, commitmentListFacts, mapCommitmentError } from './commitmentsCore';
import { summariesService } from './summariesService';

const log = createLogger('summaries.commitments');

// ---- Types ---------------------------------------------------------------------------------------

/** The callable name (CALLABLES.summaryCommitments, equal to SUMMARY_COMMITMENTS_CALLABLE). */
export type SummaryCommitmentsCallableName = typeof CALLABLES.summaryCommitments;

/** Sends one request to summaryCommitments and resolves with the raw `data`. */
export interface CommitmentsTransport {
  call(name: SummaryCommitmentsCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown>;
}

export interface CommitmentsServiceDeps {
  /** null when Firebase is not configured in this build. */
  getTransport(): CommitmentsTransport | null;
  /** true only when the device is KNOWN to be offline (unknown => false). */
  connectivity?: { isOffline(): Promise<boolean> };
  /** When given, the session cache is cleared on its 'session:ended' event (appEvents). */
  events?: Pick<EventBus<AppEventMap>, 'on'>;
  /** Defaults to SUMMARY_COMMITMENTS_TIMEOUT_MS. */
  timeoutMs?: number;
  /** The device zone decide sends (the tasks' zone and reminders); defaults to getDeviceTimeZone. */
  timeZone?: () => string;
  /** The language of the tasks' origin line; defaults to the app language. */
  language?: () => string;
  /** A summary's row facts after an answer with a list (the default instance patches summariesService). */
  onListFacts?: (summaryId: string, facts: SummaryListCommitments) => void;
}

/** The last answer for one summary this session. */
export interface CommitmentsSnapshot {
  summaryId: string;
  state: CommitmentState;
  /** ready, empty and stale (same text): the list; none, preparing and stale after a text change: null. */
  commitments: SummaryCommitments | null;
  /** The allowance after the last charged AI preparation this session, else null. */
  usage: AssistantUsage | null;
}

export interface DecideCommitmentsOptions {
  /** The extraction key of the list the user saw (defaults to the cached list's key). */
  key?: string;
  /** Defaults to the device zone. */
  timezone?: string;
  /** Defaults to the app language. */
  language?: string;
}

export interface SummaryCommitmentsService {
  /** summaryCommitments get. In-flight asks for the same summary are shared. Throws AppError. */
  get(summaryId: string): Promise<SummaryCommitmentsResponse>;
  /** summaryCommitments prepare. Mode 'ai' only after the user saw the AI notice. Throws AppError. */
  prepare(summaryId: string, mode: CommitmentMode): Promise<SummaryCommitmentsResponse>;
  /**
   * summaryCommitments decide, 1 to COMMITMENT_LIMITS.maxDecisionsPerCall decisions, one per
   * anchorId. Resolves the full answer (results included). Throws AppError; stale (details.reason
   * 'stale', code conflict) after the list was reloaded.
   */
  decide(summaryId: string, decisions: readonly CommitmentDecision[], options?: DecideCommitmentsOptions): Promise<SummaryCommitmentsResponse>;
  /** The cached answer synchronously for render; null before the first answer this session. */
  getKnown(summaryId: string): CommitmentsSnapshot | null;
  /** Notifies whenever anything getKnown returns may have changed. */
  subscribe(listener: () => void): Unsubscribe;
  /** Session end: forget everything (also bound to appEvents 'session:ended'). */
  clearSessionCache(): void;
}

/** Codes after which a decide may have committed on the server: the list is reloaded. */
const RELOAD_AFTER_DECIDE: ReadonlySet<string> = new Set(['timeout', 'upstream_error']);

// ---- Service -------------------------------------------------------------------------------------

export function createCommitmentsService(deps: CommitmentsServiceDeps): SummaryCommitmentsService {
  const timeoutMs = deps.timeoutMs ?? SUMMARY_COMMITMENTS_TIMEOUT_MS;
  const timeZone = deps.timeZone ?? getDeviceTimeZone;
  const language = deps.language ?? getLanguage;

  const entries = new Map<string, CommitmentsSnapshot>();
  const getPromises = new Map<string, Promise<SummaryCommitmentsResponse>>();
  /** Per summary, bumped by every prepare or decide answer taken in (an older get never replaces it). */
  const writeSeq = new Map<string, number>();
  /** Bumped on clearSessionCache so a stale in-flight answer is never cached cross-session. */
  let sessionEpoch = 0;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // One broken subscriber must not stop the others.
      }
    }
  }

  async function probeOffline(): Promise<boolean> {
    if (!deps.connectivity) return false;
    try {
      return await deps.connectivity.isOffline();
    } catch {
      return false;
    }
  }

  function seqOf(summaryId: string): number {
    return writeSeq.get(summaryId) ?? 0;
  }

  function store(summaryId: string, response: SummaryCommitmentsResponse): void {
    const previous = entries.get(summaryId);
    entries.set(summaryId, {
      summaryId,
      state: response.state,
      commitments: response.commitments,
      usage: response.usage ?? previous?.usage ?? null,
    });
    const facts = commitmentListFacts(response);
    if (facts !== null && deps.onListFacts) {
      try {
        deps.onListFacts(summaryId, facts);
      } catch {
        // The row counts are a convenience; a failure never fails the answer.
      }
    }
    notify();
  }

  function forget(summaryId: string): void {
    if (entries.delete(summaryId)) notify();
  }

  /** Validates, sends and parses one request. Never logs content; never wraps the raw error. */
  async function call(request: SummaryCommitmentsRequest): Promise<SummaryCommitmentsResponse> {
    const parsedRequest = summaryCommitmentsRequestSchema.safeParse(request);
    if (!parsedRequest.success) throw commitmentAppError('invalid_request');
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    if (await probeOffline()) throw new AppError('offline', 'Device is offline');
    const epoch = sessionEpoch;
    let raw: unknown;
    try {
      raw = await transport.call(CALLABLES.summaryCommitments, parsedRequest.data, { timeoutMs });
    } catch (error) {
      const mapped = mapCommitmentError(error, { offline: await probeOffline() });
      log.warn('summaryCommitments call failed', { op: request.op, code: mapped.code, reason: commitmentErrorReason(mapped) });
      if (epoch === sessionEpoch && commitmentErrorReason(mapped) === 'not_found') forget(request.summaryId);
      throw mapped;
    }
    const parsed = summaryCommitmentsResponseSchema.safeParse(raw);
    // Never the ZodError: its message can quote titles and quotes from the answer.
    if (!parsed.success || parsed.data.op !== request.op || !resultsFit(request, parsed.data)) {
      log.warn('summaryCommitments answer did not match the contract', { op: request.op });
      throw new AppError('upstream_error', `invalid ${CALLABLES.summaryCommitments} response`);
    }
    return parsed.data;
  }

  function get(summaryId: string): Promise<SummaryCommitmentsResponse> {
    const inFlight = getPromises.get(summaryId);
    if (inFlight) return inFlight;
    const epoch = sessionEpoch;
    const seq = seqOf(summaryId);
    const promise = (async (): Promise<SummaryCommitmentsResponse> => {
      const answer = await call({ op: 'get', summaryId });
      // A prepare or decide answered while this get was in flight: its answer is the newer one.
      if (epoch === sessionEpoch && seq === seqOf(summaryId)) store(summaryId, answer);
      return answer;
    })().finally(() => {
      if (getPromises.get(summaryId) === promise) getPromises.delete(summaryId);
    });
    getPromises.set(summaryId, promise);
    return promise;
  }

  function takeWrite(summaryId: string, answer: SummaryCommitmentsResponse, epoch: number): void {
    if (epoch !== sessionEpoch) return;
    writeSeq.set(summaryId, seqOf(summaryId) + 1);
    store(summaryId, answer);
  }

  async function prepare(summaryId: string, mode: CommitmentMode): Promise<SummaryCommitmentsResponse> {
    const epoch = sessionEpoch;
    const answer = await call({ op: 'prepare', summaryId, mode });
    takeWrite(summaryId, answer, epoch);
    return answer;
  }

  async function reloadQuietly(summaryId: string): Promise<void> {
    try {
      await get(summaryId);
    } catch {
      // The caller reports the decide failure; the reload is best effort.
    }
  }

  async function decide(
    summaryId: string,
    decisions: readonly CommitmentDecision[],
    options: DecideCommitmentsOptions = {},
  ): Promise<SummaryCommitmentsResponse> {
    const key = options.key ?? entries.get(summaryId)?.commitments?.key;
    // No list was ever shown: nothing can be decided (a programming error, never sent).
    if (key === undefined) throw commitmentAppError('invalid_request');
    const epoch = sessionEpoch;
    let answer: SummaryCommitmentsResponse;
    try {
      answer = await call({
        op: 'decide',
        summaryId,
        key,
        timezone: options.timezone ?? timeZone(),
        language: options.language ?? language(),
        decisions: [...decisions],
      });
    } catch (error) {
      const mapped = isAppError(error) ? error : mapCommitmentError(error);
      if (epoch === sessionEpoch && (commitmentErrorReason(mapped) === 'stale' || RELOAD_AFTER_DECIDE.has(mapped.code))) {
        await reloadQuietly(summaryId);
      }
      throw mapped;
    }
    takeWrite(summaryId, answer, epoch);
    return answer;
  }

  function clearSessionCache(): void {
    sessionEpoch += 1;
    entries.clear();
    getPromises.clear();
    writeSeq.clear();
    notify();
  }

  // Everything here belongs to ONE session (like the summaries, whatsapp and zoom answers).
  deps.events?.on('session:ended', () => clearSessionCache());

  return {
    get,
    prepare,
    decide,
    getKnown: (summaryId) => entries.get(summaryId) ?? null,
    subscribe(listener: () => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearSessionCache,
  };
}

/** decide answers one result per decision, for the anchors it was sent; the other ops none. */
function resultsFit(request: SummaryCommitmentsRequest, response: SummaryCommitmentsResponse): boolean {
  if (request.op !== 'decide') return true;
  const results = response.results;
  if (results === undefined || results.length !== request.decisions.length) return false;
  const sent = new Set(request.decisions.map((decision) => decision.anchorId));
  return results.every((result) => sent.has(result.anchorId));
}

function getDefaultTransport(): CommitmentsTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(name: SummaryCommitmentsCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown> {
      const callable = httpsCallable<unknown, unknown>(instance, name, { timeout: options.timeoutMs });
      const result = await callable(request);
      return result.data;
    },
  };
}

export const commitmentsService: SummaryCommitmentsService = createCommitmentsService({
  getTransport: getDefaultTransport,
  connectivity: {
    async isOffline(): Promise<boolean> {
      const state = await NetInfo.fetch();
      return state.isConnected === false;
    },
  },
  events: appEvents,
  onListFacts: (summaryId, facts) => summariesService.applyCommitments(summaryId, facts),
});
