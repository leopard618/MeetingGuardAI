/**
 * MEETING SUMMARIES service (owner: summaries-app; M10, docs/v2/M10-DESIGN.md section 9).
 *
 * The app reads and changes meeting summaries ONLY through the three summary* callables
 * (src/core/aiContract.ts): summaryStatus, summaryAction and summaryRead. Summary documents are
 * server-only and sealed with a server key, so there is no Firestore listener, no engine and no
 * outbox here, and nothing is written to AsyncStorage.
 *
 * - Transport: the shared Firebase Functions instance (src/config/firebase.ts, pinned to
 *   env.functionsRegion, emulator-aware) through an injected transport, with
 *   SUMMARIES_CALL_TIMEOUT_MS (status, actions) and SUMMARIES_READ_TIMEOUT_MS (reads).
 * - zod on both sides: every request is parsed with its contract schema before it is sent (a bad
 *   request never leaves the phone: invalid_input with details.reason 'invalid_request') and
 *   every response is parsed before it is used (a bad answer is upstream_error).
 * - Errors: HttpsError.details.reason (SUMMARY_ERROR_CODES) is mapped onto the existing AppError
 *   codes and kept in details.reason (summaryErrorReason reads it back). A function that is not
 *   deployed answers functions/not-found WITHOUT details: that is not_enabled (a missing summary
 *   carries details.reason 'not_found'). A missing summaryStatus resolves the disabled status,
 *   so the Settings row hides itself.
 * - Session cache, memory only: the status answer, the list answers per view (and per meeting)
 *   and the full summaries opened this session. Cleared on appEvents 'session:ended'. Every
 *   summaryAction answer carries the caller's new status, which replaces the cached one; attach,
 *   detach, keep and delete patch the cached lists and summaries in place, so the screens update
 *   without a second call. An answer to an ask that was in flight when an action answered never
 *   undoes that action: a status ask keeps the action's status, and a read answer gets the
 *   action's patches before it is cached (and then leaves the inbox count to the action).
 * - Privacy: never log or report summary content (titles, text, subjects, addresses, codes).
 *   Logs carry the callable name and AppError codes only, and the AppErrors made here carry no
 *   `cause` (a raw callable error or a ZodError can hold content and Sentry links causes).
 */
import NetInfo from '@react-native-community/netinfo';
import { httpsCallable } from 'firebase/functions';

import {
  CALLABLES,
  SUMMARIES_CALL_TIMEOUT_MS,
  SUMMARIES_READ_TIMEOUT_MS,
  summaryActionRequestSchema,
  summaryActionResponseSchema,
  summaryReadGetResponseSchema,
  summaryReadListResponseSchema,
  summaryReadRequestSchema,
  summaryStatusRequestSchema,
  summaryStatusResponseSchema,
  type SummaryActionRequest,
  type SummaryActionResponse,
  type SummaryDetail,
  type SummaryListItem,
  type SummaryListView,
  type SummaryReadGetResponse,
  type SummaryState,
  type SummaryStatusResponse,
} from '../../core/aiContract';
import { AppError, isAppError } from '../../core/errors';
import { appEvents, type AppEventMap, type EventBus, type Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import { functions } from '../../config/firebase';

import {
  SUMMARIES_DISABLED_STATUS,
  isSummariesUnavailableError,
  mapSummaryError,
  summaryAppError,
  summaryErrorReason,
} from './summaryCore';

const log = createLogger('summaries');

// ---- Types ---------------------------------------------------------------------------------------

/** The three summary* callable names (CALLABLES in src/core/aiContract.ts). */
export type SummariesCallableName =
  | typeof CALLABLES.summaryStatus
  | typeof CALLABLES.summaryAction
  | typeof CALLABLES.summaryRead;

/** Sends one request to a summary* callable and resolves with the raw `data`. */
export interface SummariesTransport {
  call(name: SummariesCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown>;
}

export interface SummariesServiceDeps {
  /** null when Firebase is not configured in this build. */
  getTransport(): SummariesTransport | null;
  /** true only when the device is KNOWN to be offline (unknown => false). */
  connectivity?: { isOffline(): Promise<boolean> };
  /** When given, the session cache is cleared on its 'session:ended' event (appEvents). */
  events?: Pick<EventBus<AppEventMap>, 'on'>;
  /** summaryStatus and summaryAction; defaults to SUMMARIES_CALL_TIMEOUT_MS. */
  callTimeoutMs?: number;
  /** summaryRead; defaults to SUMMARIES_READ_TIMEOUT_MS. */
  readTimeoutMs?: number;
  /** The clock for getStatus({ maxAgeMs }); defaults to Date.now (tests inject one). */
  now?: () => number;
}

/** One cached summaryRead list answer (newest first). */
export interface SummaryListSnapshot {
  view: SummaryListView;
  /** The meeting of a 'meeting' view (the master id for a series); null for the other views. */
  meetingId: string | null;
  items: readonly SummaryListItem[];
  /** More rows exist than the server returns in one answer (SUMMARY_LIMITS.maxListItems). */
  hasMore: boolean;
}

/** summaryAction attach: file an inbox or kept summary under a meeting, or move a filed one. */
export interface AttachSummaryRequest {
  summaryId: string;
  /** The meeting id; the MASTER id for a series. */
  meetingId: string;
  /** A series: the ORIGINAL local date (YYYY-MM-DD) of the occurrence; null for a one-off. */
  occurrenceDate: string | null;
}

export interface SummariesService {
  /**
   * The caller's status, cached per session (the first call per session asks summaryStatus).
   * Resolves the disabled status in a build without Firebase or when summaryStatus is not
   * deployed. Throws AppError (offline | timeout | unauthenticated | upstream_error ...) when the
   * ask fails; a failure is never cached, so a later call retries.
   * `maxAgeMs`: a cached answer older than this is asked again (it stays visible meanwhile).
   */
  getStatus(options?: { maxAgeMs?: number }): Promise<SummaryStatusResponse>;
  /** The cached status synchronously for render; null before the first answer this session. */
  getKnownStatus(): SummaryStatusResponse | null;
  /** Asks summaryStatus again; the cached answer stays visible until the new one arrives. */
  refreshStatus(): Promise<SummaryStatusResponse>;

  // summaryAction. Each resolves the full answer ({changed, status, summary}) after the cache
  // took it in. Throws AppError; details.reason carries the SUMMARY_ERROR_CODES value.
  /** Idempotent: an existing address comes back unchanged (changed: false). */
  createAddress(): Promise<SummaryActionResponse>;
  /** Only after the user confirmed: mail to the old address is dropped from then on. */
  regenerateAddress(): Promise<SummaryActionResponse>;
  /** Replaces the whole list (max SUMMARY_LIMITS.maxMailboxes; the server lowercases). */
  setMailboxes(mailboxes: readonly string[]): Promise<SummaryActionResponse>;
  dismissGmail(gmailAddress: string): Promise<SummaryActionResponse>;
  attach(request: AttachSummaryRequest): Promise<SummaryActionResponse>;
  /** "Not this meeting": back to the inbox; that meeting is not suggested for it again. */
  detach(summaryId: string): Promise<SummaryActionResponse>;
  /** "Keep without a meeting". */
  keep(summaryId: string): Promise<SummaryActionResponse>;
  /** Hard delete; an already deleted summary answers changed: false. */
  deleteSummary(summaryId: string): Promise<SummaryActionResponse>;
  /** Deletes the address and the mailbox list, and every summary when deleteSummaries (M11 button). */
  disconnect(deleteSummaries: boolean): Promise<SummaryActionResponse>;

  // summaryRead. Each call asks the server (in-flight asks for the same key are shared) and
  // replaces the cached answer; read the cache with getKnownList / getKnownSummary.
  /** A list view; 'meeting' needs meetingId (the master id for a series), the others must not get one. */
  listSummaries(view: SummaryListView, meetingId?: string | null): Promise<SummaryListSnapshot>;
  /** The full view of one summary. A refused row or a deleted summary throws not_found. */
  getSummary(summaryId: string): Promise<SummaryDetail>;
  getKnownList(view: SummaryListView, meetingId?: string | null): SummaryListSnapshot | null;
  getKnownSummary(summaryId: string): SummaryDetail | null;

  /** Notifies whenever anything getKnown* returns may have changed. */
  subscribe(listener: () => void): Unsubscribe;
  /** Session end: forget everything (also bound to appEvents 'session:ended'). */
  clearSessionCache(): void;
}

/** A request the contract schema rejects never leaves the phone (invalid_input, reason invalid_request). */
function invalidRequest(): AppError {
  return summaryAppError('invalid_request');
}

// ---- Cache helpers (pure) ------------------------------------------------------------------------

function listKey(view: SummaryListView, meetingId: string | null): string {
  return view === 'meeting' ? `meeting:${meetingId ?? ''}` : view;
}

/** Whether a row with this state belongs in a list view (the server's view definitions). */
export function belongsInList(snapshot: Pick<SummaryListSnapshot, 'view' | 'meetingId'>, item: Pick<SummaryListItem, 'status' | 'match'>): boolean {
  switch (snapshot.view) {
    case 'inbox':
      return item.status === 'inbox';
    case 'recent':
      return item.status === 'matched' || item.status === 'kept';
    case 'refused':
      return item.status === 'refused';
    case 'meeting':
      return item.status === 'matched' && item.match !== null && item.match.meetingId === snapshot.meetingId;
  }
}

function receivedTime(item: SummaryListItem): number {
  const value = Date.parse(item.receivedAt);
  return Number.isNaN(value) ? 0 : value;
}

/** Newest first, like the server; ties keep their order. */
function newestFirst(items: readonly SummaryListItem[]): SummaryListItem[] {
  return [...items].sort((a, b) => receivedTime(b) - receivedTime(a));
}

/** The list-row part of a full summary (lists never hold the text). */
function listItemOf(item: SummaryListItem | SummaryDetail): SummaryListItem {
  return {
    summaryId: item.summaryId,
    status: item.status,
    title: item.title,
    summaryDate: item.summaryDate,
    receivedAt: item.receivedAt,
    tier: item.tier,
    recipientBound: item.recipientBound,
    fresh: item.fresh,
    inboxReason: item.inboxReason,
    refusedReason: item.refusedReason,
    senderDomain: item.senderDomain,
    count: item.count,
    match: item.match,
    suggestions: item.suggestions,
  };
}

/** A row after an attach, detach or keep answer (suggestions exist only on inbox rows). */
function withState<T extends SummaryListItem>(item: T, state: SummaryState): T {
  const previousMeetingId = item.match?.meetingId ?? null;
  const suggestions =
    state.status === 'inbox' ? item.suggestions.filter((suggestion) => suggestion.meetingId !== previousMeetingId) : [];
  return { ...item, status: state.status, inboxReason: state.inboxReason, match: state.match, suggestions };
}

/**
 * A cache change made by a summaryAction answer, kept while reads are in flight: a read answer
 * the server built before that action committed gets the same change before it is cached, so a
 * slow list or get never puts back a row the user just filed, kept or deleted (finding B2).
 */
type CachePatch =
  | { seq: number; kind: 'state'; state: SummaryState; patched: SummaryListItem | null }
  | { seq: number; kind: 'delete'; summaryId: string }
  | { seq: number; kind: 'clear' };

/** A list answer with the later patches applied; null when the summaries were all deleted since. */
function replayOnSnapshot(snapshot: SummaryListSnapshot, patches: readonly CachePatch[]): SummaryListSnapshot | null {
  let items: readonly SummaryListItem[] = snapshot.items;
  for (const patch of patches) {
    if (patch.kind === 'clear') return null;
    if (patch.kind === 'delete') {
      items = items.filter((item) => item.summaryId !== patch.summaryId);
      continue;
    }
    const row = items.find((item) => item.summaryId === patch.state.summaryId);
    const patched = row ? withState(row, patch.state) : patch.patched;
    const others = items.filter((item) => item.summaryId !== patch.state.summaryId);
    items = patched && belongsInList(snapshot, patched) ? newestFirst([patched, ...others]) : others;
  }
  return items === snapshot.items ? snapshot : { ...snapshot, items };
}

/** A full view with the later patches applied; null when it was deleted since. */
function replayOnDetail(detail: SummaryDetail, patches: readonly CachePatch[]): SummaryDetail | null {
  let current = detail;
  for (const patch of patches) {
    if (patch.kind === 'clear') return null;
    if (patch.kind === 'delete') {
      if (patch.summaryId === current.summaryId) return null;
      continue;
    }
    if (patch.state.summaryId === current.summaryId) current = withState(current, patch.state);
  }
  return current;
}

// ---- Service -------------------------------------------------------------------------------------

export function createSummariesService(deps: SummariesServiceDeps): SummariesService {
  const callTimeoutMs = deps.callTimeoutMs ?? SUMMARIES_CALL_TIMEOUT_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? SUMMARIES_READ_TIMEOUT_MS;
  const now = deps.now ?? ((): number => Date.now());

  let status: SummaryStatusResponse | null = null;
  /** When `status` last came from a full answer (summaryStatus or summaryAction), for maxAgeMs. */
  let statusAtMs = 0;
  let statusPromise: Promise<SummaryStatusResponse> | null = null;
  const lists = new Map<string, SummaryListSnapshot>();
  const listPromises = new Map<string, Promise<SummaryListSnapshot>>();
  const details = new Map<string, SummaryDetail>();
  const detailPromises = new Map<string, Promise<SummaryDetail>>();
  /** Bumped on clearSessionCache so a stale in-flight answer is never cached cross-session. */
  let sessionEpoch = 0;
  /**
   * Bumped by every summaryAction answer taken in. A status or read ask that started before the
   * last action may describe the server before that action committed: its status is not stored
   * over the action's (B1), and its rows get the action's patches first (B2).
   */
  let actionSeq = 0;
  /** The cache patches made while reads were in flight (emptied when none are left). */
  let patches: CachePatch[] = [];
  const listeners = new Set<() => void>();

  function readsInFlight(): boolean {
    return listPromises.size > 0 || detailPromises.size > 0;
  }

  function patchesSince(seq: number): CachePatch[] {
    return patches.filter((patch) => patch.seq > seq);
  }

  function readSettled(): void {
    if (!readsInFlight()) patches = [];
  }

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

  async function callValidated<T>(
    name: SummariesCallableName,
    request: unknown,
    parse: (raw: unknown) => { success: true; data: T } | { success: false },
    timeoutMs: number,
  ): Promise<T> {
    const transport = deps.getTransport();
    if (!transport) throw new AppError('not_configured', 'Firebase is not configured in this build');
    if (await probeOffline()) throw new AppError('offline', 'Device is offline');
    let raw: unknown;
    try {
      raw = await transport.call(name, request, { timeoutMs });
    } catch (error) {
      const mapped = mapSummaryError(error, { offline: await probeOffline() });
      log.warn('summaries call failed', { name, code: mapped.code, reason: summaryErrorReason(mapped) });
      throw mapped;
    }
    const parsed = parse(raw);
    if (!parsed.success) {
      // Never the ZodError: its message can quote titles from the answer.
      log.warn('summaries answer did not match the contract', { name });
      throw new AppError('upstream_error', `invalid ${name} response`);
    }
    return parsed.data;
  }

  // ---- status ----

  async function askStatus(): Promise<SummaryStatusResponse> {
    const epoch = sessionEpoch;
    const seq = actionSeq;
    if (!deps.getTransport()) return SUMMARIES_DISABLED_STATUS;
    let answer: SummaryStatusResponse;
    try {
      answer = await callValidated(
        CALLABLES.summaryStatus,
        summaryStatusRequestSchema.parse({}),
        (raw) => summaryStatusResponseSchema.safeParse(raw),
        callTimeoutMs,
      );
    } catch (error) {
      // summaryStatus not deployed (functions/not-found without details): the feature is off.
      if (!isSummariesUnavailableError(mapSummaryError(error))) throw error;
      answer = SUMMARIES_DISABLED_STATUS;
    }
    if (epoch !== sessionEpoch) return answer;
    // An action answered while this ask was in flight: its status is at least as new (B1), so a
    // poll never puts back the old address or mailbox list after "Get a new address" or Save.
    if (seq !== actionSeq && status !== null) return status;
    status = answer;
    statusAtMs = now();
    notify();
    return answer;
  }

  function getStatus(options?: { maxAgeMs?: number }): Promise<SummaryStatusResponse> {
    const maxAgeMs = options?.maxAgeMs;
    if (status !== null && (maxAgeMs === undefined || now() - statusAtMs < maxAgeMs)) return Promise.resolve(status);
    if (status !== null) return refreshStatus();
    if (statusPromise) return statusPromise;
    const promise = askStatus().finally(() => {
      if (statusPromise === promise) statusPromise = null;
    });
    statusPromise = promise;
    return promise;
  }

  async function refreshStatus(): Promise<SummaryStatusResponse> {
    // Unlike session end, a refresh keeps the old answer visible until the new one arrives.
    const promise = statusPromise ?? askStatus();
    statusPromise = promise;
    try {
      return await promise;
    } finally {
      if (statusPromise === promise) statusPromise = null;
    }
  }

  // ---- cache patches ----

  /** Any cached copy of a summary (the full view first, else a list row). */
  function findCopy(summaryId: string): SummaryListItem | null {
    const detail = details.get(summaryId);
    if (detail) return listItemOf(detail);
    for (const snapshot of lists.values()) {
      const row = snapshot.items.find((item) => item.summaryId === summaryId);
      if (row) return row;
    }
    return null;
  }

  function applyState(state: SummaryState): void {
    const copy = findCopy(state.summaryId);
    const patched = copy ? withState(copy, state) : null;
    if (readsInFlight()) patches.push({ seq: actionSeq, kind: 'state', state, patched });
    for (const [key, snapshot] of lists) {
      const present = snapshot.items.some((item) => item.summaryId === state.summaryId);
      const others = snapshot.items.filter((item) => item.summaryId !== state.summaryId);
      if (patched && belongsInList(snapshot, patched)) {
        lists.set(key, { ...snapshot, items: newestFirst([patched, ...others]) });
      } else if (present) {
        lists.set(key, { ...snapshot, items: others });
      }
    }
    const detail = details.get(state.summaryId);
    if (detail) details.set(state.summaryId, withState(detail, state));
  }

  function removeSummary(summaryId: string): boolean {
    let changed = details.delete(summaryId);
    for (const [key, snapshot] of lists) {
      if (!snapshot.items.some((item) => item.summaryId === summaryId)) continue;
      lists.set(key, { ...snapshot, items: snapshot.items.filter((item) => item.summaryId !== summaryId) });
      changed = true;
    }
    return changed;
  }

  /** A fresh list answer also refreshes the filing state of the full summaries opened earlier. */
  function syncDetailsFrom(items: readonly SummaryListItem[]): void {
    for (const item of items) {
      const detail = details.get(item.summaryId);
      if (!detail) continue;
      details.set(item.summaryId, {
        ...detail,
        status: item.status,
        inboxReason: item.inboxReason,
        match: item.match,
        suggestions: item.suggestions,
      });
    }
  }

  // ---- summaryAction ----

  async function act(request: SummaryActionRequest): Promise<SummaryActionResponse> {
    const parsedRequest = summaryActionRequestSchema.safeParse(request);
    if (!parsedRequest.success) throw invalidRequest();
    const epoch = sessionEpoch;
    const answer = await callValidated(
      CALLABLES.summaryAction,
      parsedRequest.data,
      (raw) => summaryActionResponseSchema.safeParse(raw),
      callTimeoutMs,
    );
    if (epoch !== sessionEpoch) return answer;
    actionSeq += 1;
    status = answer.status;
    statusAtMs = now();
    const op = parsedRequest.data;
    if (op.op === 'delete') {
      if (readsInFlight()) patches.push({ seq: actionSeq, kind: 'delete', summaryId: op.summaryId });
      removeSummary(op.summaryId);
    } else if (op.op === 'disconnect' && op.deleteSummaries) {
      if (readsInFlight()) patches.push({ seq: actionSeq, kind: 'clear' });
      lists.clear();
      details.clear();
    } else if (answer.summary !== null) {
      applyState(answer.summary);
    }
    notify();
    return answer;
  }

  // ---- summaryRead ----

  function listSummaries(view: SummaryListView, meetingId?: string | null): Promise<SummaryListSnapshot> {
    const meeting = meetingId ?? null;
    const request = meeting !== null ? { op: 'list', view, meetingId: meeting } : { op: 'list', view };
    const parsedRequest = summaryReadRequestSchema.safeParse(request);
    if (!parsedRequest.success) return Promise.reject(invalidRequest());
    const key = listKey(view, meeting);
    const inFlight = listPromises.get(key);
    if (inFlight) return inFlight;
    const epoch = sessionEpoch;
    const seq = actionSeq;
    const promise = (async (): Promise<SummaryListSnapshot> => {
      const answer = await callValidated(
        CALLABLES.summaryRead,
        parsedRequest.data,
        (raw) => summaryReadListResponseSchema.safeParse(raw),
        readTimeoutMs,
      );
      if (answer.view !== view) throw new AppError('upstream_error', `invalid ${CALLABLES.summaryRead} response`);
      const answered: SummaryListSnapshot = { view, meetingId: meeting, items: answer.items, hasMore: answer.hasMore };
      if (epoch !== sessionEpoch) return answered;
      // An action answered while this read was in flight: apply its change first (B2).
      const stale = seq !== actionSeq;
      const snapshot = stale ? replayOnSnapshot(answered, patchesSince(seq)) : answered;
      if (snapshot === null) return { ...answered, items: [] };
      lists.set(key, snapshot);
      syncDetailsFrom(snapshot.items);
      // The full inbox is the inbox count (the Settings row subtitle follows a re-match). After an
      // action the action's own status count is the newer one.
      if (!stale && view === 'inbox' && !snapshot.hasMore && status !== null && status.inboxCount !== snapshot.items.length) {
        status = { ...status, inboxCount: snapshot.items.length };
      }
      notify();
      return snapshot;
    })().finally(() => {
      if (listPromises.get(key) === promise) listPromises.delete(key);
      readSettled();
    });
    listPromises.set(key, promise);
    return promise;
  }

  function getSummary(summaryId: string): Promise<SummaryDetail> {
    const parsedRequest = summaryReadRequestSchema.safeParse({ op: 'get', summaryId });
    if (!parsedRequest.success) return Promise.reject(invalidRequest());
    const inFlight = detailPromises.get(summaryId);
    if (inFlight) return inFlight;
    const epoch = sessionEpoch;
    const seq = actionSeq;
    const promise = (async (): Promise<SummaryDetail> => {
      let answer: SummaryReadGetResponse;
      try {
        answer = await callValidated(
          CALLABLES.summaryRead,
          parsedRequest.data,
          (raw) => summaryReadGetResponseSchema.safeParse(raw),
          readTimeoutMs,
        );
      } catch (error) {
        // Deleted elsewhere (another device): forget the stale copies too.
        if (epoch === sessionEpoch && isAppError(error) && summaryErrorReason(error) === 'not_found' && removeSummary(summaryId)) {
          notify();
        }
        throw error;
      }
      if (answer.summary.summaryId !== summaryId) {
        throw new AppError('upstream_error', `invalid ${CALLABLES.summaryRead} response`);
      }
      if (epoch !== sessionEpoch) return answer.summary;
      // An action answered while this read was in flight: apply its change first (B2). A summary
      // deleted meanwhile is gone, exactly as if the server had said so.
      const summary = seq !== actionSeq ? replayOnDetail(answer.summary, patchesSince(seq)) : answer.summary;
      if (summary === null) throw summaryAppError('not_found');
      details.set(summaryId, summary);
      notify();
      return summary;
    })().finally(() => {
      if (detailPromises.get(summaryId) === promise) detailPromises.delete(summaryId);
      readSettled();
    });
    detailPromises.set(summaryId, promise);
    return promise;
  }

  function clearSessionCache(): void {
    sessionEpoch += 1;
    status = null;
    statusAtMs = 0;
    statusPromise = null;
    patches = [];
    lists.clear();
    listPromises.clear();
    details.clear();
    detailPromises.clear();
    notify();
  }

  // Everything here belongs to ONE session (like the whatsapp and zoom answers).
  deps.events?.on('session:ended', () => clearSessionCache());

  return {
    getStatus,
    getKnownStatus: () => status,
    refreshStatus,
    createAddress: () => act({ op: 'create_address' }),
    regenerateAddress: () => act({ op: 'regenerate_address' }),
    setMailboxes: (mailboxes) => act({ op: 'set_mailboxes', mailboxes: [...mailboxes] }),
    dismissGmail: (gmailAddress) => act({ op: 'dismiss_gmail', gmailAddress }),
    attach: ({ summaryId, meetingId, occurrenceDate }) => act({ op: 'attach', summaryId, meetingId, occurrenceDate }),
    detach: (summaryId) => act({ op: 'detach', summaryId }),
    keep: (summaryId) => act({ op: 'keep', summaryId }),
    deleteSummary: (summaryId) => act({ op: 'delete', summaryId }),
    disconnect: (deleteSummaries) => act({ op: 'disconnect', deleteSummaries }),
    listSummaries,
    getSummary,
    getKnownList: (view, meetingId) => lists.get(listKey(view, meetingId ?? null)) ?? null,
    getKnownSummary: (summaryId) => details.get(summaryId) ?? null,
    subscribe(listener: () => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearSessionCache,
  };
}

function getDefaultTransport(): SummariesTransport | null {
  const instance = functions;
  if (!instance) return null;
  return {
    async call(name: SummariesCallableName, request: unknown, options: { timeoutMs: number }): Promise<unknown> {
      const callable = httpsCallable<unknown, unknown>(instance, name, { timeout: options.timeoutMs });
      const result = await callable(request);
      return result.data;
    },
  };
}

export const summariesService: SummariesService = createSummariesService({
  getTransport: getDefaultTransport,
  connectivity: {
    async isOffline(): Promise<boolean> {
      const state = await NetInfo.fetch();
      return state.isConnected === false;
    },
  },
  events: appEvents,
});
