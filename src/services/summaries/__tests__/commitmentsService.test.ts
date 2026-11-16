/**
 * Summary commitments service unit tests (M11, docs/v2/M11-DESIGN.md sections 3, 7 and 8): the
 * summaryCommitments callable through an injected transport. Covers the contract schemas on both
 * sides, the error mapping of every COMMITMENT_ERROR_CODES value (a missing function as
 * not_enabled), the client timeout, the offline probe, stale reloading silently, the memory cache
 * (an older get never replaces a newer prepare or decide answer; cleared on session end), the row
 * facts handed to the summaries service, and that nothing from a summary reaches a log. The
 * default singleton's Firebase / NetInfo wiring is not exercised here.
 */
import {
  CALLABLES,
  COMMITMENT_ERROR_CODES,
  SUMMARY_COMMITMENTS_CALLABLE,
  SUMMARY_COMMITMENTS_TIMEOUT_MS,
  type CommitmentErrorCode,
  type CommitmentItem,
  type SummaryCommitments,
  type SummaryCommitmentsResponse,
  type SummaryListItem,
} from '../../../core/aiContract';
import { FUNCTIONS_CONTRACT } from '../../../core/contracts';
import { AppError, type AppErrorCode } from '../../../core/errors';
import { createEventBus, type AppEventMap } from '../../../core/events';
import { createCommitmentsService, type CommitmentsTransport } from '../commitments';
import {
  commitmentAppError,
  commitmentCounts,
  commitmentErrorMessageKey,
  commitmentErrorReason,
  commitmentErrorUsage,
  commitmentListFacts,
  isCommitmentsUnavailableError,
  mapCommitmentError,
} from '../commitmentsCore';
import { createSummariesService, type SummariesTransport } from '../summariesService';

// The singleton's default wiring (not under test): firebase/* ships untransformed ESM.
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

// ---- fixtures ------------------------------------------------------------------------------------

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const KEY = 'x_0123456789abcdef';
const KEY_2 = 'x_fedcba9876543210';
const SECRET_TITLE = 'Bish: Provide APK access to Urpayroll';
const SECRET_QUOTE = 'Provide APK access/files to Urpayroll (owner: Bish)';
const SECRET_MEETING = 'Urpayroll weekly sync';
const USAGE = { used: 3, limit: 10, plan: 'free' as const, resetsAt: '2026-11-13T00:00:00.000Z', period: 'window' as const };

function item(overrides: Partial<CommitmentItem> = {}): CommitmentItem {
  return {
    anchorId: 'i_0123456789ab',
    number: 1,
    anchorKind: 'item',
    sectionKind: 'action_items',
    sectionHeading: 'Action items',
    quote: SECRET_QUOTE,
    title: SECRET_TITLE,
    owner: { name: 'Bish', isUser: false, guess: false },
    due: null,
    confidence: 90,
    flags: [],
    preselected: true,
    status: 'open',
    taskId: null,
    taskExists: null,
    via: null,
    ...overrides,
  };
}

function commitments(overrides: Partial<SummaryCommitments> = {}): SummaryCommitments {
  return {
    key: KEY,
    mode: 'ai',
    preparedAt: '2026-11-12T10:00:00.000Z',
    preselect: { allowed: true, selectAll: true, reason: null },
    origin: {
      meetingId: 'mtgUrpayroll01',
      meetingTitle: SECRET_MEETING,
      occurrenceDate: null,
      localDate: '2026-10-16',
      tier: 'vendor_verified',
      senderDomain: 'notetaker.example',
      forwardedBy: null,
    },
    truncated: false,
    meetingChanged: false,
    items: [
      item(),
      item({ anchorId: 'i_111111111111', number: 2, status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true, via: 'app' }),
      item({ anchorId: 'i_222222222222', number: 3, status: 'dropped' }),
    ],
    ...overrides,
  };
}

function answer(op: 'get' | 'prepare' | 'decide', overrides: Partial<SummaryCommitmentsResponse> = {}): SummaryCommitmentsResponse {
  return { op, state: 'ready', commitments: commitments(), ...overrides };
}

interface HttpsLikeError extends Error {
  code?: string;
  details?: unknown;
}

function httpsError(code: string, details?: unknown, message = 'boom'): HttpsLikeError {
  const error: HttpsLikeError = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

type Call = { name: string; request: Record<string, unknown>; timeoutMs: number };

function fakeTransport(impl: (request: Record<string, unknown>) => Promise<unknown>): CommitmentsTransport & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    call(name, request, options) {
      calls.push({ name, request: request as Record<string, unknown>, timeoutMs: options.timeoutMs });
      return impl(request as Record<string, unknown>);
    },
  };
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected a rejection');
}

const ACCEPT = {
  anchorId: 'i_0123456789ab',
  decision: 'accept' as const,
  draft: { title: SECRET_TITLE, dueDate: '2026-11-13', dueTime: '09:00', reminderMinutesBefore: 0, owner: { name: 'Bish', isUser: false } },
};

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  // Nothing from a summary ever reaches a log line.
  const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
  for (const secret of [SECRET_TITLE, SECRET_QUOTE, SECRET_MEETING, 'Bish']) expect(logged).not.toContain(secret);
  jest.restoreAllMocks();
});

// ---- contract wiring -------------------------------------------------------------------------------

describe('contract wiring', () => {
  it('names the callable in CALLABLES with its FUNCTIONS_CONTRACT row', () => {
    expect(CALLABLES.summaryCommitments).toBe(SUMMARY_COMMITMENTS_CALLABLE);
    expect(FUNCTIONS_CONTRACT.summaryCommitments).toEqual({
      request: 'summaryCommitmentsRequestSchema',
      response: 'summaryCommitmentsResponseSchema',
    });
  });
});

// ---- requests and answers --------------------------------------------------------------------------

describe('get, prepare and decide', () => {
  it('sends each op with the client timeout and caches the parsed answer', async () => {
    const transport = fakeTransport(async (request) => answer(request.op as 'get'));
    const service = createCommitmentsService({ getTransport: () => transport });
    expect(service.getKnown(ID_A)).toBeNull();

    const got = await service.get(ID_A);
    expect(got.state).toBe('ready');
    expect(transport.calls[0]).toEqual({ name: 'summaryCommitments', request: { op: 'get', summaryId: ID_A }, timeoutMs: SUMMARY_COMMITMENTS_TIMEOUT_MS });
    expect(service.getKnown(ID_A)).toEqual({ summaryId: ID_A, state: 'ready', commitments: got.commitments, usage: null });

    await service.prepare(ID_A, 'as_written');
    expect(transport.calls[1]?.request).toEqual({ op: 'prepare', summaryId: ID_A, mode: 'as_written' });
  });

  it('decide sends the cached key, the device zone and the language, and resolves the results', async () => {
    const transport = fakeTransport(async (request) =>
      request.op === 'decide'
        ? answer('decide', { results: [{ anchorId: ACCEPT.anchorId, outcome: 'added', taskId: 'sm_0123456789abcdef0123456789abcdef' }] })
        : answer('get'),
    );
    const service = createCommitmentsService({ getTransport: () => transport, timeZone: () => 'America/Mexico_City', language: () => 'es' });
    await service.get(ID_A);
    const decided = await service.decide(ID_A, [ACCEPT]);
    expect(transport.calls[1]?.request).toEqual({
      op: 'decide',
      summaryId: ID_A,
      key: KEY,
      timezone: 'America/Mexico_City',
      language: 'es',
      decisions: [ACCEPT],
    });
    expect(decided.results).toEqual([{ anchorId: ACCEPT.anchorId, outcome: 'added', taskId: 'sm_0123456789abcdef0123456789abcdef' }]);

    // An explicit key (the list the user saw) wins over the cached one.
    await service.decide(ID_A, [{ anchorId: ACCEPT.anchorId, decision: 'drop' }], { key: KEY_2, timezone: 'UTC', language: 'en' }).catch(() => undefined);
    expect(transport.calls[2]?.request).toMatchObject({ key: KEY_2, timezone: 'UTC', language: 'en' });
  });

  it('never sends a request the contract rejects (invalid_input, reason invalid_request)', async () => {
    const transport = fakeTransport(async () => answer('get'));
    const service = createCommitmentsService({ getTransport: () => transport });
    const bad = [
      caught(service.get('not a valid id!')),
      caught(service.prepare(ID_A, 'magic' as never)),
      // No list was ever loaded, so no key is known.
      caught(service.decide(ID_A, [ACCEPT])),
      caught(service.decide(ID_A, [], { key: KEY })),
      caught(service.decide(ID_A, [ACCEPT, ACCEPT], { key: KEY })),
      caught(service.decide(ID_A, [{ ...ACCEPT, draft: { ...ACCEPT.draft, dueDate: null } }], { key: KEY })),
    ];
    for (const failure of await Promise.all(bad)) {
      expect(failure).toBeInstanceOf(AppError);
      expect(failure.code).toBe('invalid_input');
      expect(commitmentErrorReason(failure)).toBe('invalid_request');
    }
    expect(transport.calls).toHaveLength(0);
  });

  it('treats an answer that does not match the contract, or is for another op, as upstream_error without its content', async () => {
    /** A service whose every answer is `bad` (a get after a failed decide gets it too). */
    const serviceAnswering = (bad: unknown) => createCommitmentsService({ getTransport: () => fakeTransport(async () => bad) });
    const badKey = await caught(serviceAnswering({ op: 'get', state: 'ready', commitments: { ...commitments(), key: 'nope' } }).get(ID_A));
    expect(badKey.code).toBe('upstream_error');
    expect(badKey.message).not.toContain(SECRET_TITLE);
    expect((await caught(serviceAnswering(answer('prepare')).get(ID_A))).code).toBe('upstream_error');
    // decide without one result per decision, or with results for anchors it was not sent.
    const noResults = serviceAnswering(answer('decide'));
    expect((await caught(noResults.decide(ID_A, [ACCEPT], { key: KEY }))).code).toBe('upstream_error');
    expect(noResults.getKnown(ID_A)).toBeNull();
    const foreign = serviceAnswering(answer('decide', { results: [{ anchorId: 'i_999999999999', outcome: 'added', taskId: null }] }));
    expect((await caught(foreign.decide(ID_A, [ACCEPT], { key: KEY }))).code).toBe('upstream_error');
    expect(foreign.getKnown(ID_A)).toBeNull();
  });

  it('keeps an unknown flag or banner reason from a later server out of the answer instead of failing it', async () => {
    const later = {
      op: 'get',
      state: 'ready',
      commitments: { ...commitments({ items: [item()] }), preselect: { allowed: false, selectAll: false, reason: 'a_new_reason' } },
    };
    (later.commitments.items[0] as unknown as { flags: unknown[] }).flags = ['payment_like', 'a_new_flag'];
    const service = createCommitmentsService({ getTransport: () => fakeTransport(async () => later) });
    const got = await service.get(ID_A);
    expect(got.commitments?.items[0]?.flags).toEqual(['payment_like']);
    expect(got.commitments?.preselect.reason).toBeNull();
  });

  it('shares an in-flight get for the same summary', async () => {
    const gate = deferred<unknown>();
    const transport = fakeTransport(() => gate.promise);
    const service = createCommitmentsService({ getTransport: () => transport });
    const one = service.get(ID_A);
    const two = service.get(ID_A);
    gate.resolve(answer('get'));
    await Promise.all([one, two]);
    expect(transport.calls).toHaveLength(1);
  });

  it('keeps the allowance after a charged AI preparation', async () => {
    const transport = fakeTransport(async (request) => (request.op === 'prepare' ? answer('prepare', { usage: USAGE }) : answer('get')));
    const service = createCommitmentsService({ getTransport: () => transport });
    await service.prepare(ID_A, 'ai');
    expect(service.getKnown(ID_A)?.usage).toEqual(USAGE);
    await service.get(ID_A);
    expect(service.getKnown(ID_A)?.usage).toEqual(USAGE);
  });

  it('stores preparing and stale answers with no list', async () => {
    const answers = [answer('prepare', { state: 'preparing', commitments: null }), answer('get', { state: 'stale', commitments: null })];
    const service = createCommitmentsService({ getTransport: () => fakeTransport(async () => answers.shift()) });
    await service.prepare(ID_A, 'ai');
    expect(service.getKnown(ID_A)).toMatchObject({ state: 'preparing', commitments: null });
    await service.get(ID_A);
    expect(service.getKnown(ID_A)).toMatchObject({ state: 'stale', commitments: null });
  });
});

// ---- errors ----------------------------------------------------------------------------------------

describe('error mapping', () => {
  const EXPECTED: Record<CommitmentErrorCode, AppErrorCode> = {
    unauthenticated: 'unauthenticated',
    not_enabled: 'not_configured',
    not_allowed: 'permission_denied',
    not_ready: 'not_configured',
    invalid_request: 'invalid_input',
    not_found: 'not_found',
    invalid_meeting: 'invalid_input',
    rate_limited: 'quota_exceeded',
    upstream_error: 'upstream_error',
    quota_exceeded: 'quota_exceeded',
    stale: 'conflict',
  };

  it.each(COMMITMENT_ERROR_CODES.map((reason) => [reason]))('maps details.reason %s onto an existing AppError code', async (reason) => {
    const transport = fakeTransport(async () => {
      throw httpsError(`functions/${reason}`, { reason }, `${SECRET_TITLE} failed`);
    });
    const service = createCommitmentsService({ getTransport: () => transport });
    const failure = await caught(service.get(ID_A));
    expect(failure.code).toBe(EXPECTED[reason]);
    expect(commitmentErrorReason(failure)).toBe(reason);
    expect(failure.message).not.toContain(SECRET_TITLE);
    expect(failure.cause).toBeUndefined();
  });

  it('reads a missing function (functions/not-found WITHOUT details) as not_enabled, as M10 reads summaryRead', () => {
    const failure = mapCommitmentError(httpsError('functions/not-found'));
    expect(commitmentErrorReason(failure)).toBe('not_enabled');
    expect(isCommitmentsUnavailableError(failure)).toBe(true);
    // A missing summary carries its reason: not the same thing.
    const missing = mapCommitmentError(httpsError('functions/not-found', { reason: 'not_found' }));
    expect(commitmentErrorReason(missing)).toBe('not_found');
    expect(isCommitmentsUnavailableError(missing)).toBe(false);
    expect(isCommitmentsUnavailableError(mapCommitmentError(httpsError('functions/permission-denied', { reason: 'not_allowed' })))).toBe(true);
  });

  it('maps the client timeout, a status-0 failure and a known-offline device', async () => {
    expect(mapCommitmentError(httpsError('functions/deadline-exceeded')).code).toBe('timeout');
    expect(mapCommitmentError(httpsError('functions/internal', undefined, 'internal [0]')).code).toBe('offline');
    expect(mapCommitmentError(new Error('Network request failed')).code).toBe('offline');
    expect(mapCommitmentError(httpsError('functions/internal'), { offline: true }).code).toBe('offline');
    const unknown = mapCommitmentError(new Error(SECRET_QUOTE));
    expect(unknown.code).toBe('upstream_error');
    expect(unknown.message).not.toContain(SECRET_QUOTE);
  });

  it('keeps the allowance of quota_exceeded, so the screen can offer the items as written and the plans', () => {
    const failure = mapCommitmentError(httpsError('functions/resource-exhausted', { reason: 'quota_exceeded', usage: USAGE }));
    expect(failure.code).toBe('quota_exceeded');
    expect(commitmentErrorUsage(failure)).toEqual(USAGE);
    expect(commitmentErrorUsage(commitmentAppError('upstream_error'))).toBeNull();
  });

  it('probes the connectivity before sending: offline never reaches the server', async () => {
    const transport = fakeTransport(async () => answer('get'));
    const service = createCommitmentsService({ getTransport: () => transport, connectivity: { isOffline: async () => true } });
    expect((await caught(service.get(ID_A))).code).toBe('offline');
    expect(transport.calls).toHaveLength(0);
    // A build without Firebase.
    expect((await caught(createCommitmentsService({ getTransport: () => null }).get(ID_A))).code).toBe('not_configured');
  });

  it('gives each failure its i18n key', () => {
    expect(commitmentErrorMessageKey(commitmentAppError('quota_exceeded'))).toBe('summaries:commitments.errors.quota_exceeded');
    expect(commitmentErrorMessageKey(commitmentAppError('stale'))).toBe('summaries:commitments.errors.stale');
    expect(commitmentErrorMessageKey(commitmentAppError('upstream_error'))).toBe('summaries:commitments.errors.upstream_error');
    expect(commitmentErrorMessageKey(commitmentAppError('not_found'))).toBe('summaries:commitments.errors.not_found');
    expect(commitmentErrorMessageKey(commitmentAppError('not_allowed'))).toBe('summaries:errors.not_allowed');
    expect(commitmentErrorMessageKey(new AppError('offline'))).toBe('summaries:commitments.errors.offline');
    expect(commitmentErrorMessageKey(new AppError('timeout'))).toBe('summaries:commitments.errors.timeout');
    expect(commitmentErrorMessageKey(new AppError('unknown'))).toBe('summaries:commitments.errors.generic');
  });

  it('logs the op and the codes only', async () => {
    const transport = fakeTransport(async () => {
      throw httpsError('functions/unavailable', { reason: 'upstream_error' }, `${SECRET_TITLE} ${SECRET_QUOTE}`);
    });
    const service = createCommitmentsService({ getTransport: () => transport });
    await caught(service.get(ID_A));
    expect(warn).toHaveBeenCalledWith('[summaries.commitments]', 'summaryCommitments call failed', {
      op: 'get',
      code: 'upstream_error',
      reason: 'upstream_error',
    });
  });
});

// ---- stale and reloads -----------------------------------------------------------------------------

describe('stale and reloads', () => {
  it('a stale decide reloads the list with get first, then throws stale (conflict)', async () => {
    const fresh = commitments({ key: KEY_2 });
    const transport = fakeTransport(async (request) => {
      if (request.op === 'decide') throw httpsError('functions/failed-precondition', { reason: 'stale' });
      return transport.calls.length === 1 ? answer('get') : answer('get', { commitments: fresh });
    });
    const service = createCommitmentsService({ getTransport: () => transport });
    await service.get(ID_A);
    const failure = await caught(service.decide(ID_A, [ACCEPT]));
    expect(failure.code).toBe('conflict');
    expect(commitmentErrorReason(failure)).toBe('stale');
    expect(transport.calls.map((call) => call.request.op)).toEqual(['get', 'decide', 'get']);
    expect(service.getKnown(ID_A)?.commitments?.key).toBe(KEY_2);
  });

  it('a decide that timed out or failed upstream reloads too (the server may have committed it)', async () => {
    const accepted = commitments({ items: [item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true, via: 'app' })] });
    let decides = 0;
    const transport = fakeTransport(async (request) => {
      if (request.op === 'decide') {
        decides += 1;
        throw decides === 1 ? httpsError('functions/deadline-exceeded') : httpsError('functions/unavailable', { reason: 'upstream_error' });
      }
      return answer('get', { commitments: accepted });
    });
    const service = createCommitmentsService({ getTransport: () => transport });
    expect((await caught(service.decide(ID_A, [ACCEPT], { key: KEY }))).code).toBe('timeout');
    expect(service.getKnown(ID_A)?.commitments?.items[0]?.status).toBe('accepted');
    expect((await caught(service.decide(ID_A, [ACCEPT], { key: KEY }))).code).toBe('upstream_error');
    expect(transport.calls.map((call) => call.request.op)).toEqual(['decide', 'get', 'decide', 'get']);
  });

  it('does not reload after an invalid request, a refusal or offline', async () => {
    const refusals: [HttpsLikeError, string][] = [
      [httpsError('functions/invalid-argument', { reason: 'invalid_request' }), 'invalid_input'],
      [httpsError('functions/permission-denied', { reason: 'not_allowed' }), 'permission_denied'],
      [httpsError('functions/failed-precondition', { reason: 'not_enabled' }), 'not_configured'],
      // summaryCommitments not deployed (no details): not_enabled.
      [httpsError('functions/not-found'), 'not_configured'],
      // The callable client's "never reached the server" (status 0): offline.
      [httpsError('functions/internal', undefined, 'internal [0]'), 'offline'],
    ];
    for (const [error, code] of refusals) {
      const transport = fakeTransport(async () => {
        throw error;
      });
      const service = createCommitmentsService({ getTransport: () => transport });
      expect((await caught(service.decide(ID_A, [ACCEPT], { key: KEY }))).code).toBe(code);
      expect(transport.calls.map((call) => call.request.op)).toEqual(['decide']);
    }

    // Known offline before sending: nothing leaves the phone, so nothing is reloaded either.
    const transport = fakeTransport(async () => answer('get'));
    const offline = createCommitmentsService({ getTransport: () => transport, connectivity: { isOffline: async () => true } });
    expect((await caught(offline.decide(ID_A, [ACCEPT], { key: KEY }))).code).toBe('offline');
    expect(transport.calls).toHaveLength(0);
  });

  it('not_found drops the cached entry (deleted, or moved back to the inbox)', async () => {
    let gone = false;
    const transport = fakeTransport(async () => {
      if (gone) throw httpsError('functions/not-found', { reason: 'not_found' });
      return answer('get');
    });
    const service = createCommitmentsService({ getTransport: () => transport });
    await service.get(ID_A);
    gone = true;
    const listener = jest.fn();
    service.subscribe(listener);
    expect(commitmentErrorReason(await caught(service.get(ID_A)))).toBe('not_found');
    expect(service.getKnown(ID_A)).toBeNull();
    expect(listener).toHaveBeenCalled();
  });
});

// ---- cache -----------------------------------------------------------------------------------------

describe('session cache', () => {
  it('a get that was in flight when a decide answered never replaces the newer answer', async () => {
    const slowGet = deferred<unknown>();
    const afterDecide = commitments({ items: [item({ status: 'accepted', taskId: 'sm_0123456789abcdef0123456789abcdef', taskExists: true, via: 'app' })] });
    const transport = fakeTransport(async (request) => {
      if (request.op === 'get') return slowGet.promise;
      return answer('decide', { commitments: afterDecide, results: [{ anchorId: ACCEPT.anchorId, outcome: 'added', taskId: 'sm_0123456789abcdef0123456789abcdef' }] });
    });
    const service = createCommitmentsService({ getTransport: () => transport });
    const pending = service.get(ID_A);
    await service.decide(ID_A, [ACCEPT], { key: KEY });
    slowGet.resolve(answer('get'));
    const older = await pending;
    expect(older.commitments?.items).toHaveLength(3);
    expect(service.getKnown(ID_A)?.commitments).toEqual(afterDecide);
  });

  it('is cleared on session end, and an answer still in flight is not cached for the next session', async () => {
    const events = createEventBus<AppEventMap>();
    const slow = deferred<unknown>();
    let first = true;
    const transport = fakeTransport(async () => {
      if (first) {
        first = false;
        return answer('get');
      }
      return slow.promise;
    });
    const service = createCommitmentsService({ getTransport: () => transport, events });
    await service.get(ID_A);
    const listener = jest.fn();
    service.subscribe(listener);
    const pending = service.get(ID_B);
    events.emit('session:ended', { uid: 'u1', reason: 'sign_out' });
    expect(service.getKnown(ID_A)).toBeNull();
    expect(listener).toHaveBeenCalled();
    slow.resolve(answer('get'));
    await pending;
    expect(service.getKnown(ID_B)).toBeNull();
  });

  it('hands the row facts to the summaries service after every answer with a list', async () => {
    const facts = jest.fn();
    const answers = [answer('get'), answer('prepare', { state: 'preparing', commitments: null })];
    const service = createCommitmentsService({ getTransport: () => fakeTransport(async () => answers.shift()), onListFacts: facts });
    await service.get(ID_A);
    expect(facts).toHaveBeenCalledWith(ID_A, { state: 'ready', open: 1, accepted: 1 });
    await service.prepare(ID_A, 'ai');
    expect(facts).toHaveBeenCalledTimes(1);
    expect(commitmentListFacts({ state: 'stale', commitments: null })).toBeNull();
    expect(commitmentCounts(commitments())).toEqual({ open: 1, accepted: 1 });
  });

  it('a failing row patch never fails the answer', async () => {
    const service = createCommitmentsService({
      getTransport: () => fakeTransport(async () => answer('get')),
      onListFacts: () => {
        throw new Error('broken');
      },
    });
    await expect(service.get(ID_A)).resolves.toMatchObject({ state: 'ready' });
  });
});

// ---- the summaries service takes the facts -----------------------------------------------------------

describe('summariesService.applyCommitments', () => {
  const ROW: SummaryListItem = {
    summaryId: ID_A,
    status: 'matched',
    title: SECRET_MEETING,
    summaryDate: '2026-10-16',
    receivedAt: '2026-10-16T21:00:00.000Z',
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    inboxReason: null,
    refusedReason: null,
    senderDomain: 'notetaker.example',
    count: null,
    match: {
      meetingId: 'mtgUrpayroll01',
      occurrenceDate: null,
      method: 'auto',
      meetingSnapshot: { title: SECRET_MEETING, startAt: '2026-10-16T20:00:00.000Z', endAt: '2026-10-16T21:00:00.000Z', timezone: 'UTC' },
    },
    suggestions: [],
    commitments: { state: 'ready', open: 5, accepted: 0 },
  };

  it('patches the cached rows and the full view, so "Review commitments (5)" follows', async () => {
    const transport: SummariesTransport = {
      async call(_name, request) {
        const body = request as Record<string, unknown>;
        if (body.op === 'get') {
          return { op: 'get', summary: { ...ROW, subject: null, titleLine: null, fromAddress: null, forwardedBy: null, text: 'x', sections: [] } };
        }
        return { op: 'list', view: body.view, items: [ROW], hasMore: false };
      },
    };
    const summaries = createSummariesService({ getTransport: () => transport });
    await summaries.listSummaries('meeting', 'mtgUrpayroll01');
    await summaries.getSummary(ID_A);
    const listener = jest.fn();
    summaries.subscribe(listener);

    summaries.applyCommitments(ID_A, { state: 'ready', open: 0, accepted: 5 });
    expect(summaries.getKnownList('meeting', 'mtgUrpayroll01')?.items[0]?.commitments).toEqual({ state: 'ready', open: 0, accepted: 5 });
    expect(summaries.getKnownSummary(ID_A)?.commitments).toEqual({ state: 'ready', open: 0, accepted: 5 });
    expect(listener).toHaveBeenCalledTimes(1);

    // The same facts again change nothing; another summary is not touched.
    summaries.applyCommitments(ID_A, { state: 'ready', open: 0, accepted: 5 });
    summaries.applyCommitments(ID_B, { state: 'ready', open: 1, accepted: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
