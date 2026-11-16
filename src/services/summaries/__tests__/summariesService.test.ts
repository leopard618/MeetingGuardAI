/**
 * SummariesService unit tests (M10 section 9): mocked callables through an injected transport.
 * Covers the contract schemas on both sides, the error mapping (every SUMMARY_ERROR_CODES value,
 * a missing function as not_enabled), the client timeouts, the offline probe, the cache patches
 * after summaryAction answers, and clearing the session cache. The default singleton's
 * Firebase / NetInfo wiring is not exercised here.
 */
import {
  CALLABLES,
  SUMMARIES_CALL_TIMEOUT_MS,
  SUMMARIES_READ_TIMEOUT_MS,
  SUMMARY_ERROR_CODES,
  type SummaryDetail,
  type SummaryErrorCode,
  type SummaryListItem,
  type SummaryStatusResponse,
} from '../../../core/aiContract';
import { AppError, type AppErrorCode } from '../../../core/errors';
import { createEventBus, type AppEventMap } from '../../../core/events';
import { createSummariesService, type SummariesTransport } from '../summariesService';
import {
  SUMMARIES_DISABLED_STATUS,
  isSummariesAvailable,
  isSummariesUnavailableError,
  mapSummaryError,
  summaryErrorReason,
} from '../summaryCore';

// The singleton's default wiring (not under test): firebase/* ships untransformed ESM.
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

// ---- fixtures ------------------------------------------------------------------------------------

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const SECRET_TITLE = 'Urpayroll launch readiness';

const STATUS: SummaryStatusResponse = {
  enabled: true,
  allowed: true,
  ready: true,
  address: 'abcdefghijklmnopqrstuvwxyz@summaries.example.com',
  mailboxes: ['ana@example.com'],
  gmailRequests: [],
  inboxCount: 1,
  lastReceivedAt: '2026-11-12T10:00:00.000Z',
  lastRefused: null,
  refusedToday: null,
};

function item(overrides: Partial<SummaryListItem> = {}): SummaryListItem {
  return {
    summaryId: ID_A,
    status: 'inbox',
    title: SECRET_TITLE,
    summaryDate: '2026-11-12',
    receivedAt: '2026-11-12T10:00:00.000Z',
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    inboxReason: 'needs_confirmation',
    refusedReason: null,
    senderDomain: 'notetaker.example.com',
    count: null,
    match: null,
    suggestions: [
      { meetingId: 'm1', occurrenceDate: null, title: 'Urpayroll weekly sync', startAt: '2026-11-12T08:00:00.000Z', score: 0.7 },
    ],
    ...overrides,
  };
}

function detail(overrides: Partial<SummaryDetail> = {}): SummaryDetail {
  return {
    ...item(),
    subject: `Fwd: ${SECRET_TITLE}`,
    titleLine: SECRET_TITLE,
    fromAddress: 'recap@notetaker.example.com',
    forwardedBy: null,
    text: `${SECRET_TITLE}\nAction items\n[ ] Send the APK (owner: Bish)`,
    sections: [],
    ...overrides,
  };
}

const MATCH = {
  meetingId: 'm1',
  occurrenceDate: null,
  method: 'user' as const,
  meetingSnapshot: { title: 'Urpayroll weekly sync', startAt: '2026-11-12T08:00:00.000Z', endAt: '2026-11-12T09:00:00.000Z', timezone: 'UTC' },
};

function listAnswer(view: string, items: SummaryListItem[], hasMore = false) {
  return { op: 'list', view, items, hasMore };
}

function actionAnswer(summary: unknown = null, status: SummaryStatusResponse = STATUS) {
  return { changed: true, status, summary };
}

interface HttpsLikeError extends Error {
  code?: string;
  details?: unknown;
}

function httpsError(code: string, reason?: string, message = 'boom'): HttpsLikeError {
  const error: HttpsLikeError = new Error(message);
  error.code = code;
  if (reason !== undefined) error.details = { reason };
  return error;
}

type Call = { name: string; request: unknown; timeoutMs: number };

function fakeTransport(impl: (name: string, request: Record<string, unknown>) => Promise<unknown>): SummariesTransport & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    call(name, request, options) {
      calls.push({ name, request, timeoutMs: options.timeoutMs });
      return impl(name, request as Record<string, unknown>);
    },
  };
}

/** A transport answering each callable from a table (functions get the request). */
function routedTransport(routes: Partial<Record<string, (request: Record<string, unknown>) => unknown>>) {
  return fakeTransport(async (name, request) => {
    const route = routes[name];
    if (!route) throw new Error(`unexpected call ${name}`);
    return route(request);
  });
}

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- error mapping -------------------------------------------------------------------------------

describe('mapSummaryError', () => {
  const EXPECTED: Record<SummaryErrorCode, AppErrorCode> = {
    unauthenticated: 'unauthenticated',
    not_enabled: 'not_configured',
    not_allowed: 'permission_denied',
    not_ready: 'not_configured',
    invalid_request: 'invalid_input',
    not_found: 'not_found',
    invalid_meeting: 'invalid_input',
    rate_limited: 'quota_exceeded',
    upstream_error: 'upstream_error',
  };

  it.each(SUMMARY_ERROR_CODES)('maps details.reason %s and keeps it', (reason) => {
    const mapped = mapSummaryError(httpsError('functions/failed-precondition', reason, `${SECRET_TITLE} failed`));
    expect(mapped.code).toBe(EXPECTED[reason]);
    expect(summaryErrorReason(mapped)).toBe(reason);
    expect(mapped.details).toEqual({ reason, providerCode: 'functions/failed-precondition' });
    // Nothing the server or the transport wrote travels on (logs and Sentry see codes only).
    expect(mapped.message).toBe(`summaries ${reason}`);
    expect(mapped.cause).toBeUndefined();
  });

  it('treats a missing function (not-found without details) as not_enabled, a missing summary as not_found', () => {
    const missing = mapSummaryError(httpsError('functions/not-found'));
    expect(missing.code).toBe('not_configured');
    expect(summaryErrorReason(missing)).toBe('not_enabled');
    expect(isSummariesUnavailableError(missing)).toBe(true);

    const gone = mapSummaryError(httpsError('functions/not-found', 'not_found'));
    expect(gone.code).toBe('not_found');
    expect(summaryErrorReason(gone)).toBe('not_found');
    expect(isSummariesUnavailableError(gone)).toBe(false);
  });

  it('maps transport failures and keeps AppErrors', () => {
    const original = new AppError('offline');
    expect(mapSummaryError(original)).toBe(original);
    expect(mapSummaryError(httpsError('functions/deadline-exceeded')).code).toBe('timeout');
    expect(mapSummaryError(httpsError('functions/internal', undefined, 'internal [0]')).code).toBe('offline');
    expect(mapSummaryError(httpsError('functions/internal'), { offline: true }).code).toBe('offline');
    expect(mapSummaryError(new Error('Network request failed')).code).toBe('offline');
    expect(mapSummaryError(httpsError('functions/unauthenticated')).code).toBe('unauthenticated');
    expect(mapSummaryError(httpsError('functions/internal')).code).toBe('upstream_error');
    const unknown = mapSummaryError(new Error(SECRET_TITLE));
    expect(unknown.code).toBe('upstream_error');
    expect(unknown.message).not.toContain(SECRET_TITLE);
    expect(unknown.cause).toBeUndefined();
    expect(summaryErrorReason(unknown)).toBeNull();
  });

  it('ignores a details.reason outside the summary taxonomy', () => {
    const mapped = mapSummaryError(httpsError('functions/resource-exhausted', 'quota_exceeded'));
    expect(mapped.code).toBe('quota_exceeded');
    expect(summaryErrorReason(mapped)).toBeNull();
  });
});

describe('status gate', () => {
  it('is available only when enabled and allowed', () => {
    expect(isSummariesAvailable(null)).toBe(false);
    expect(isSummariesAvailable(SUMMARIES_DISABLED_STATUS)).toBe(false);
    expect(isSummariesAvailable({ ...STATUS, allowed: false })).toBe(false);
    expect(isSummariesAvailable({ ...STATUS, enabled: false })).toBe(false);
    expect(isSummariesAvailable(STATUS)).toBe(true);
  });
});

// ---- summaryStatus -------------------------------------------------------------------------------

describe('getStatus (summaryStatus)', () => {
  it('asks once per session with the call timeout and exposes the answer synchronously', async () => {
    const transport = routedTransport({ [CALLABLES.summaryStatus]: () => STATUS });
    const service = createSummariesService({ getTransport: () => transport });

    expect(service.getKnownStatus()).toBeNull();
    await expect(Promise.all([service.getStatus(), service.getStatus()])).resolves.toEqual([STATUS, STATUS]);
    await expect(service.getStatus()).resolves.toEqual(STATUS);
    expect(service.getKnownStatus()).toEqual(STATUS);
    expect(transport.calls).toEqual([{ name: CALLABLES.summaryStatus, request: {}, timeoutMs: SUMMARIES_CALL_TIMEOUT_MS }]);
  });

  it('parses a status without refusedToday (older server) as null', async () => {
    const older: Partial<SummaryStatusResponse> = { ...STATUS };
    delete older.refusedToday;
    const service = createSummariesService({ getTransport: () => routedTransport({ [CALLABLES.summaryStatus]: () => older }) });
    await expect(service.getStatus()).resolves.toEqual({ ...STATUS, refusedToday: null });
  });

  it('rejects an answer that breaks the contract as upstream_error, without caching or logging content', async () => {
    const transport = routedTransport({ [CALLABLES.summaryStatus]: () => ({ ...STATUS, address: SECRET_TITLE }) });
    const service = createSummariesService({ getTransport: () => transport });
    await expect(service.getStatus()).rejects.toMatchObject({ code: 'upstream_error' });
    expect(service.getKnownStatus()).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET_TITLE);
  });

  it('resolves the disabled status without Firebase and when summaryStatus is not deployed', async () => {
    const unconfigured = createSummariesService({ getTransport: () => null });
    await expect(unconfigured.getStatus()).resolves.toEqual(SUMMARIES_DISABLED_STATUS);

    const transport = fakeTransport(async () => {
      throw httpsError('functions/not-found');
    });
    const undeployed = createSummariesService({ getTransport: () => transport });
    await expect(undeployed.getStatus()).resolves.toEqual(SUMMARIES_DISABLED_STATUS);
    expect(undeployed.getKnownStatus()).toEqual(SUMMARIES_DISABLED_STATUS);
    await undeployed.getStatus();
    expect(transport.calls).toHaveLength(1);
  });

  it('throws a failed ask without caching it, so a later call retries', async () => {
    let fail = true;
    const transport = fakeTransport(async () => {
      if (fail) throw httpsError('functions/unavailable', 'upstream_error');
      return STATUS;
    });
    const service = createSummariesService({ getTransport: () => transport });
    await expect(service.getStatus()).rejects.toMatchObject({ code: 'upstream_error' });
    expect(service.getKnownStatus()).toBeNull();
    fail = false;
    await expect(service.getStatus()).resolves.toEqual(STATUS);
  });

  it('refresh keeps the old answer visible until the new one arrives', async () => {
    let inboxCount = 1;
    const transport = routedTransport({ [CALLABLES.summaryStatus]: () => ({ ...STATUS, inboxCount }) });
    const service = createSummariesService({ getTransport: () => transport });
    const seen: (number | null)[] = [];
    service.subscribe(() => seen.push(service.getKnownStatus()?.inboxCount ?? null));
    await service.getStatus();
    inboxCount = 3;
    await service.refreshStatus();
    expect(seen).toEqual([1, 3]);
  });

  it('asks nothing while the device is known to be offline', async () => {
    const transport = routedTransport({ [CALLABLES.summaryStatus]: () => STATUS });
    const service = createSummariesService({ getTransport: () => transport, connectivity: { isOffline: async () => true } });
    await expect(service.getStatus()).rejects.toMatchObject({ code: 'offline' });
    expect(transport.calls).toHaveLength(0);
  });
});

// ---- summaryAction -------------------------------------------------------------------------------

describe('actions (summaryAction)', () => {
  it('sends each op as the contract says, with the call timeout, and caches the returned status', async () => {
    const created = { ...STATUS, address: 'zyxwvutsrqponmlkjihgfedcba@summaries.example.com' };
    const transport = routedTransport({ [CALLABLES.summaryAction]: () => actionAnswer(null, created) });
    const service = createSummariesService({ getTransport: () => transport });

    await service.createAddress();
    expect(service.getKnownStatus()).toEqual(created);
    await service.regenerateAddress();
    await service.setMailboxes(['Ana@Example.com', 'ana@work.example.com']);
    await service.dismissGmail('ana@gmail.com');
    await service.disconnect(false);

    expect(transport.calls.map((call) => call.request)).toEqual([
      { op: 'create_address' },
      { op: 'regenerate_address' },
      { op: 'set_mailboxes', mailboxes: ['Ana@Example.com', 'ana@work.example.com'] },
      { op: 'dismiss_gmail', gmailAddress: 'ana@gmail.com' },
      { op: 'disconnect', deleteSummaries: false },
    ]);
    expect(transport.calls.every((call) => call.name === CALLABLES.summaryAction && call.timeoutMs === SUMMARIES_CALL_TIMEOUT_MS)).toBe(true);
  });

  it('never sends a request the contract rejects', async () => {
    const transport = routedTransport({ [CALLABLES.summaryAction]: () => actionAnswer() });
    const service = createSummariesService({ getTransport: () => transport });
    const invalid = { code: 'invalid_input', details: expect.objectContaining({ reason: 'invalid_request' }) };
    await expect(service.setMailboxes(['Ana <ana@example.com>'])).rejects.toMatchObject(invalid);
    await expect(service.setMailboxes(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'])).rejects.toMatchObject(invalid);
    await expect(service.detach('not:an:id')).rejects.toMatchObject(invalid);
    await expect(service.attach({ summaryId: ID_A, meetingId: 'm1', occurrenceDate: '12/11/2026' })).rejects.toMatchObject(invalid);
    expect(transport.calls).toHaveLength(0);
  });

  it('maps the server taxonomy (rate_limited stays readable in details.reason)', async () => {
    const transport = fakeTransport(async () => {
      throw httpsError('functions/resource-exhausted', 'rate_limited');
    });
    const service = createSummariesService({ getTransport: () => transport });
    const error = await service.regenerateAddress().catch((caught: unknown) => caught as AppError);
    expect(error).toMatchObject({ code: 'quota_exceeded' });
    expect(summaryErrorReason(error as AppError)).toBe('rate_limited');
  });

  it('rejects an answer that breaks the contract', async () => {
    const transport = routedTransport({ [CALLABLES.summaryAction]: () => ({ changed: true, status: STATUS }) });
    const service = createSummariesService({ getTransport: () => transport });
    await expect(service.keep(ID_A)).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('attach moves a cached inbox row to the recent and meeting lists and patches the full view', async () => {
    const state = { summaryId: ID_A, status: 'matched', inboxReason: null, match: MATCH };
    const transport = routedTransport({
      [CALLABLES.summaryStatus]: () => STATUS,
      [CALLABLES.summaryRead]: (request) => {
        if (request.op === 'get') return { op: 'get', summary: detail() };
        if (request.view === 'inbox') return listAnswer('inbox', [item()]);
        if (request.view === 'recent') return listAnswer('recent', [item({ summaryId: ID_B, status: 'kept', inboxReason: null, suggestions: [], receivedAt: '2026-11-11T10:00:00.000Z' })]);
        return listAnswer('meeting', []);
      },
      [CALLABLES.summaryAction]: () => actionAnswer(state, { ...STATUS, inboxCount: 0 }),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.getStatus();
    await service.listSummaries('inbox');
    await service.listSummaries('recent');
    await service.listSummaries('meeting', 'm1');
    await service.getSummary(ID_A);

    await service.attach({ summaryId: ID_A, meetingId: 'm1', occurrenceDate: null });

    expect(transport.calls.at(-1)?.request).toEqual({ op: 'attach', summaryId: ID_A, meetingId: 'm1', occurrenceDate: null });
    expect(service.getKnownList('inbox')?.items).toEqual([]);
    expect(service.getKnownList('recent')?.items.map((row) => row.summaryId)).toEqual([ID_A, ID_B]);
    expect(service.getKnownList('meeting', 'm1')?.items).toEqual([
      expect.objectContaining({ summaryId: ID_A, status: 'matched', match: MATCH, suggestions: [] }),
    ]);
    // Lists never hold the text.
    expect(service.getKnownList('meeting', 'm1')?.items[0]).not.toHaveProperty('text');
    expect(service.getKnownSummary(ID_A)).toMatchObject({ status: 'matched', match: MATCH, text: detail().text });
    expect(service.getKnownStatus()?.inboxCount).toBe(0);
  });

  it('detach puts a filed row back in the inbox without that meeting as a suggestion', async () => {
    const filed = item({ status: 'matched', inboxReason: null, match: MATCH, suggestions: [] });
    const transport = routedTransport({
      [CALLABLES.summaryRead]: (request) => listAnswer(String(request.view), request.view === 'inbox' ? [] : [filed]),
      [CALLABLES.summaryAction]: () => actionAnswer({ summaryId: ID_A, status: 'inbox', inboxReason: 'needs_confirmation', match: null }),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.listSummaries('inbox');
    await service.listSummaries('meeting', 'm1');

    await service.detach(ID_A);

    expect(service.getKnownList('meeting', 'm1')?.items).toEqual([]);
    expect(service.getKnownList('inbox')?.items).toEqual([
      expect.objectContaining({ summaryId: ID_A, status: 'inbox', inboxReason: 'needs_confirmation', match: null, suggestions: [] }),
    ]);
  });

  it('delete removes the summary from every list and the full view', async () => {
    const transport = routedTransport({
      [CALLABLES.summaryRead]: (request) => (request.op === 'get' ? { op: 'get', summary: detail() } : listAnswer('inbox', [item()])),
      [CALLABLES.summaryAction]: () => actionAnswer(null, { ...STATUS, inboxCount: 0 }),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.listSummaries('inbox');
    await service.getSummary(ID_A);
    const seen = jest.fn();
    service.subscribe(seen);

    await service.deleteSummary(ID_A);

    expect(transport.calls.at(-1)?.request).toEqual({ op: 'delete', summaryId: ID_A });
    expect(service.getKnownList('inbox')?.items).toEqual([]);
    expect(service.getKnownSummary(ID_A)).toBeNull();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('disconnect with deleteSummaries forgets every cached summary', async () => {
    const transport = routedTransport({
      [CALLABLES.summaryRead]: () => listAnswer('inbox', [item()]),
      [CALLABLES.summaryAction]: () => actionAnswer(null, { ...STATUS, address: null, inboxCount: 0 }),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.listSummaries('inbox');
    await service.disconnect(true);
    expect(service.getKnownList('inbox')).toBeNull();
    expect(service.getKnownStatus()?.address).toBeNull();
  });
});

// ---- summaryRead ---------------------------------------------------------------------------------

describe('reads (summaryRead)', () => {
  it('lists a view with the read timeout, shares in-flight asks and caches the answer', async () => {
    const transport = routedTransport({ [CALLABLES.summaryRead]: () => listAnswer('inbox', [item()], true) });
    const service = createSummariesService({ getTransport: () => transport });

    const [first, second] = await Promise.all([service.listSummaries('inbox'), service.listSummaries('inbox')]);
    expect(first).toBe(second);
    expect(first).toEqual({ view: 'inbox', meetingId: null, items: [item()], hasMore: true });
    expect(service.getKnownList('inbox')).toBe(first);
    expect(service.getKnownList('recent')).toBeNull();
    expect(transport.calls).toEqual([{ name: CALLABLES.summaryRead, request: { op: 'list', view: 'inbox' }, timeoutMs: SUMMARIES_READ_TIMEOUT_MS }]);
  });

  it('asks the meeting view with its meeting id and keeps one cache entry per meeting', async () => {
    const transport = routedTransport({ [CALLABLES.summaryRead]: () => listAnswer('meeting', []) });
    const service = createSummariesService({ getTransport: () => transport });
    await service.listSummaries('meeting', 'm1');
    expect(transport.calls[0]?.request).toEqual({ op: 'list', view: 'meeting', meetingId: 'm1' });
    expect(service.getKnownList('meeting', 'm1')).not.toBeNull();
    expect(service.getKnownList('meeting', 'm2')).toBeNull();
  });

  it('rejects a list request the contract rejects without calling', async () => {
    const transport = routedTransport({ [CALLABLES.summaryRead]: () => listAnswer('inbox', []) });
    const service = createSummariesService({ getTransport: () => transport });
    await expect(service.listSummaries('meeting')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.listSummaries('inbox', 'm1')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.getSummary('')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects an answer for another view or an invalid row as upstream_error', async () => {
    const wrongView = createSummariesService({ getTransport: () => routedTransport({ [CALLABLES.summaryRead]: () => listAnswer('recent', []) }) });
    await expect(wrongView.listSummaries('inbox')).rejects.toMatchObject({ code: 'upstream_error' });
    expect(wrongView.getKnownList('inbox')).toBeNull();

    const badRow = createSummariesService({
      getTransport: () => routedTransport({ [CALLABLES.summaryRead]: () => listAnswer('inbox', [item({ summaryId: 'has:colon' })]) }),
    });
    await expect(badRow.listSummaries('inbox')).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('keeps the inbox count in step with a complete inbox answer (the Settings row)', async () => {
    const transport = routedTransport({
      [CALLABLES.summaryStatus]: () => ({ ...STATUS, inboxCount: 3 }),
      [CALLABLES.summaryRead]: () => listAnswer('inbox', [item()]),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.getStatus();
    await service.listSummaries('inbox');
    expect(service.getKnownStatus()?.inboxCount).toBe(1);
  });

  it('treats a missing summaryRead (not-found without details) as not_enabled', async () => {
    const transport = fakeTransport(async () => {
      throw httpsError('functions/not-found');
    });
    const service = createSummariesService({ getTransport: () => transport });
    const error = await service.listSummaries('inbox').catch((caught: unknown) => caught as AppError);
    expect(isSummariesUnavailableError(error as AppError)).toBe(true);
    expect(summaryErrorReason(error as AppError)).toBe('not_enabled');
  });

  it('gets one summary and forgets every copy when the server says it is gone', async () => {
    let gone = false;
    const transport = routedTransport({
      [CALLABLES.summaryRead]: (request) => {
        if (request.op === 'list') return listAnswer('inbox', [item()]);
        if (gone) throw httpsError('functions/not-found', 'not_found');
        return { op: 'get', summary: detail() };
      },
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.listSummaries('inbox');
    await expect(service.getSummary(ID_A)).resolves.toEqual(detail());
    expect(transport.calls.at(-1)).toMatchObject({ request: { op: 'get', summaryId: ID_A }, timeoutMs: SUMMARIES_READ_TIMEOUT_MS });

    gone = true;
    await expect(service.getSummary(ID_A)).rejects.toMatchObject({ code: 'not_found' });
    expect(service.getKnownSummary(ID_A)).toBeNull();
    expect(service.getKnownList('inbox')?.items).toEqual([]);
  });

  it('rejects a full view for another summary or with offsets outside the text', async () => {
    const other = createSummariesService({
      getTransport: () => routedTransport({ [CALLABLES.summaryRead]: () => ({ op: 'get', summary: detail({ summaryId: ID_B }) }) }),
    });
    await expect(other.getSummary(ID_A)).rejects.toMatchObject({ code: 'upstream_error' });

    const section = { id: 's1', kind: 'body', heading: null, derived: false, start: 0, end: 99_999, items: [] };
    const badSpans = createSummariesService({
      getTransport: () => routedTransport({ [CALLABLES.summaryRead]: () => ({ op: 'get', summary: detail({ sections: [section] as SummaryDetail['sections'] }) }) }),
    });
    await expect(badSpans.getSummary(ID_A)).rejects.toMatchObject({ code: 'upstream_error' });
    expect(badSpans.getKnownSummary(ID_A)).toBeNull();
  });
});

// ---- session -------------------------------------------------------------------------------------

describe('session cache', () => {
  it('forgets the status, the lists and the full views on session end', async () => {
    const events = createEventBus<AppEventMap>();
    const transport = routedTransport({
      [CALLABLES.summaryStatus]: () => STATUS,
      [CALLABLES.summaryRead]: (request) => (request.op === 'get' ? { op: 'get', summary: detail() } : listAnswer('inbox', [item()])),
    });
    const service = createSummariesService({ getTransport: () => transport, events });
    await service.getStatus();
    await service.listSummaries('inbox');
    await service.getSummary(ID_A);
    const seen = jest.fn();
    service.subscribe(seen);

    events.emit('session:ended', { uid: 'u1', reason: 'sign_out' });

    expect(seen).toHaveBeenCalledTimes(1);
    expect(service.getKnownStatus()).toBeNull();
    expect(service.getKnownList('inbox')).toBeNull();
    expect(service.getKnownSummary(ID_A)).toBeNull();
    await service.getStatus();
    expect(transport.calls.filter((call) => call.name === CALLABLES.summaryStatus)).toHaveLength(2);
  });

  it('never caches an answer that arrives after the session ended', async () => {
    let release: (value: unknown) => void = () => undefined;
    const transport = fakeTransport(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const service = createSummariesService({ getTransport: () => transport });
    const pending = service.listSummaries('inbox');
    // Let the call reach the transport (the offline probe runs first).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.calls).toHaveLength(1);
    service.clearSessionCache();
    release(listAnswer('inbox', [item()]));
    await pending;
    expect(service.getKnownList('inbox')).toBeNull();
  });
});

// ---- asks in flight while an action answers (review findings B1, B2, B3) --------------------------

/** A promise the test resolves by hand. */
function deferred<T = unknown>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets an ask reach the transport (the offline probe runs first). */
async function reachTransport(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('asks in flight while an action answers', () => {
  it('a status ask that started before an action never puts back the old address (B1)', async () => {
    const NEW_ADDRESS = 'bbbbbbbbbbbbbbbbbbbbbbbbbb@summaries.example.com';
    const held = deferred();
    let statusAsks = 0;
    const transport = routedTransport({
      [CALLABLES.summaryStatus]: () => {
        statusAsks += 1;
        return statusAsks === 1 ? STATUS : held.promise;
      },
      [CALLABLES.summaryAction]: () => actionAnswer(null, { ...STATUS, address: NEW_ADDRESS }),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.getStatus();

    // A poll is in flight when the user confirms "Get a new address".
    const poll = service.refreshStatus();
    await reachTransport();
    await service.regenerateAddress();
    expect(service.getKnownStatus()?.address).toBe(NEW_ADDRESS);

    // The poll's answer was read before the regenerate committed: it still names the old address.
    held.resolve(STATUS);
    await expect(poll).resolves.toMatchObject({ address: NEW_ADDRESS });
    expect(service.getKnownStatus()?.address).toBe(NEW_ADDRESS);

    // The next ask, started after the action, is taken in as usual.
    await service.refreshStatus();
    expect(service.getKnownStatus()?.address).toBe(STATUS.address);
  });

  it('an inbox answer read before an attach never brings the filed card back (B2)', async () => {
    const held = deferred();
    let inboxReads = 0;
    const filed = { summaryId: ID_A, status: 'matched', inboxReason: null, match: MATCH };
    const transport = routedTransport({
      [CALLABLES.summaryStatus]: () => STATUS,
      [CALLABLES.summaryRead]: (request) => {
        if (request.view === 'inbox') {
          inboxReads += 1;
          if (inboxReads === 1) return listAnswer('inbox', [item()]);
          return inboxReads === 2 ? held.promise : listAnswer('inbox', [item({ summaryId: ID_B })]);
        }
        return listAnswer(String(request.view), []);
      },
      [CALLABLES.summaryAction]: () => actionAnswer(filed, { ...STATUS, inboxCount: 0 }),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.getStatus();
    await service.listSummaries('inbox');
    await service.listSummaries('recent');

    // Second visit: the cards come from the cache while the re-ask (which re-matches) is slow.
    const reask = service.listSummaries('inbox');
    await reachTransport();
    await service.attach({ summaryId: ID_A, meetingId: 'm1', occurrenceDate: null });
    expect(service.getKnownList('inbox')?.items).toEqual([]);

    held.resolve(listAnswer('inbox', [item()]));
    const answered = await reask;
    expect(answered.items).toEqual([]);
    expect(service.getKnownList('inbox')?.items).toEqual([]);
    expect(service.getKnownList('recent')?.items.map((row) => row.summaryId)).toEqual([ID_A]);
    // The action's count stands (the Settings row): not the stale answer's length.
    expect(service.getKnownStatus()?.inboxCount).toBe(0);

    // A later read with no action in between is cached as answered.
    await service.listSummaries('inbox');
    expect(service.getKnownList('inbox')?.items.map((row) => row.summaryId)).toEqual([ID_B]);
    expect(service.getKnownStatus()?.inboxCount).toBe(1);
  });

  it('a recent answer read before an attach still gets the filed row (B2)', async () => {
    const held = deferred();
    const filed = { summaryId: ID_A, status: 'matched', inboxReason: null, match: MATCH };
    const transport = routedTransport({
      [CALLABLES.summaryRead]: (request) => (request.view === 'recent' ? held.promise : listAnswer('inbox', [item()])),
      [CALLABLES.summaryAction]: () => actionAnswer(filed),
    });
    const service = createSummariesService({ getTransport: () => transport });
    await service.listSummaries('inbox');
    const recent = service.listSummaries('recent');
    await reachTransport();
    await service.attach({ summaryId: ID_A, meetingId: 'm1', occurrenceDate: null });
    held.resolve(listAnswer('recent', []));
    await recent;
    expect(service.getKnownList('recent')?.items).toEqual([
      expect.objectContaining({ summaryId: ID_A, status: 'matched', match: MATCH, suggestions: [] }),
    ]);
  });

  it('a full view read before a detach or a delete keeps that change (B2)', async () => {
    const firstGet = deferred();
    const secondGet = deferred();
    let gets = 0;
    const filed = detail({ status: 'matched', inboxReason: null, match: MATCH, suggestions: [] });
    const transport = routedTransport({
      [CALLABLES.summaryRead]: () => {
        gets += 1;
        return gets === 1 ? firstGet.promise : secondGet.promise;
      },
      [CALLABLES.summaryAction]: (request) =>
        request.op === 'detach'
          ? actionAnswer({ summaryId: ID_A, status: 'inbox', inboxReason: 'needs_confirmation', match: null })
          : actionAnswer(null),
    });
    const service = createSummariesService({ getTransport: () => transport });

    const get = service.getSummary(ID_A);
    await reachTransport();
    await service.detach(ID_A);
    firstGet.resolve({ op: 'get', summary: filed });
    await expect(get).resolves.toMatchObject({ status: 'inbox', match: null });
    expect(service.getKnownSummary(ID_A)).toMatchObject({ status: 'inbox', match: null, text: filed.text });

    const again = service.getSummary(ID_A);
    await reachTransport();
    await service.deleteSummary(ID_A);
    secondGet.resolve({ op: 'get', summary: filed });
    await expect(again).rejects.toMatchObject({ code: 'not_found', details: { reason: 'not_found' } });
    expect(service.getKnownSummary(ID_A)).toBeNull();
  });

  it('getStatus asks again once the cached answer is older than maxAgeMs (B3)', async () => {
    let clock = 1_000;
    let inbox = 0;
    const transport = routedTransport({ [CALLABLES.summaryStatus]: () => ({ ...STATUS, inboxCount: inbox }) });
    const service = createSummariesService({ getTransport: () => transport, now: () => clock });
    await service.getStatus();
    inbox = 1;
    clock += 30_000;
    await expect(service.getStatus({ maxAgeMs: 60_000 })).resolves.toMatchObject({ inboxCount: 0 });
    expect(transport.calls).toHaveLength(1);
    clock += 31_000;
    await expect(service.getStatus({ maxAgeMs: 60_000 })).resolves.toMatchObject({ inboxCount: 1 });
    expect(transport.calls).toHaveLength(2);
    // Without maxAgeMs the session answer stands.
    clock += 600_000;
    await service.getStatus();
    expect(transport.calls).toHaveLength(2);
  });
});
