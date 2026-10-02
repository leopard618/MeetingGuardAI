/**
 * ZoomService unit tests (§24): mocked callables through an injected transport; the default
 * singleton's Firebase/NetInfo/data wiring is not exercised here (config-less builds resolve
 * "not available" and that path is covered below via a null transport).
 */
import { CALLABLES, ZOOM_CALL_TIMEOUT_MS } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { createEventBus, type AppEventMap } from '../../../core/events';
import { buildMeeting, type Meeting } from '../../../core/types';
import { createZoomService, mapZoomError, type ZoomTransport } from '../zoomService';

// The singleton's default wiring (not under test): firebase/* ships untransformed ESM.
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));
jest.mock('../../data', () => ({ meetingRepository: { flushOutbox: jest.fn(async () => ({ flushed: 0, pending: 0, rejected: 0 })) } }));

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}): Meeting {
  return buildMeeting(
    { title: 'Budget review', startAt: '2026-10-06T15:00:00.000Z', timezone: 'UTC', source: 'manual', ...overrides },
    { id: 'm1', userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

const LINK_RESPONSE = { url: 'https://zoom.us/j/123', password: 'pw1', zoomMeetingId: '123' };

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

function fakeTransport(impl: (name: string, request: unknown) => Promise<unknown>): ZoomTransport & { calls: { name: string; request: unknown; timeoutMs: number }[] } {
  const calls: { name: string; request: unknown; timeoutMs: number }[] = [];
  return {
    calls,
    call(name, request, options) {
      calls.push({ name, request, timeoutMs: options.timeoutMs });
      return impl(name, request);
    },
  };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('availability (zoomStatus)', () => {
  it('asks once per session, caches the answer and exposes it synchronously', async () => {
    const transport = fakeTransport(async () => ({ configured: true }));
    const service = createZoomService({ getTransport: () => transport });

    expect(service.getKnownAvailability()).toBeNull();
    await expect(service.isAvailable()).resolves.toBe(true);
    await expect(service.isAvailable()).resolves.toBe(true);
    expect(service.getKnownAvailability()).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({ name: CALLABLES.zoomStatus, request: {}, timeoutMs: ZOOM_CALL_TIMEOUT_MS });
  });

  it('shares one in-flight status ask between concurrent callers', async () => {
    const transport = fakeTransport(async () => ({ configured: false }));
    const service = createZoomService({ getTransport: () => transport });
    await expect(Promise.all([service.isAvailable(), service.isAvailable()])).resolves.toEqual([false, false]);
    expect(transport.calls).toHaveLength(1);
    expect(service.getKnownAvailability()).toBe(false);
  });

  it('resolves false without caching when the call fails, so a later call retries', async () => {
    let fail = true;
    const transport = fakeTransport(async () => {
      if (fail) throw httpsError('functions/internal');
      return { configured: true };
    });
    const service = createZoomService({ getTransport: () => transport });

    await expect(service.isAvailable()).resolves.toBe(false);
    expect(service.getKnownAvailability()).toBeNull();

    fail = false;
    await expect(service.isAvailable()).resolves.toBe(true);
    expect(service.getKnownAvailability()).toBe(true);
    expect(transport.calls).toHaveLength(2);
  });

  it('treats an invalid status response and a missing transport as "not available", un-cached', async () => {
    const invalid = createZoomService({ getTransport: () => fakeTransport(async () => ({ nope: 1 })) });
    await expect(invalid.isAvailable()).resolves.toBe(false);
    expect(invalid.getKnownAvailability()).toBeNull();

    const unconfigured = createZoomService({ getTransport: () => null });
    await expect(unconfigured.isAvailable()).resolves.toBe(false);
    expect(unconfigured.getKnownAvailability()).toBeNull();
  });

  it('notifies subscribers when the answer arrives and when it is refreshed', async () => {
    let configured = true;
    const transport = fakeTransport(async () => ({ configured }));
    const service = createZoomService({ getTransport: () => transport });
    const seen: (boolean | null)[] = [];
    const unsubscribe = service.subscribeAvailability(() => seen.push(service.getKnownAvailability()));

    await service.isAvailable();
    configured = false;
    await service.refreshAvailability();
    unsubscribe();
    await service.refreshAvailability();

    expect(seen).toEqual([true, null, false]);
    expect(transport.calls).toHaveLength(3);
  });
});

describe('ensureLink (zoomCreateMeeting)', () => {
  it('flushes the outbox first, validates the response and clears the failure record', async () => {
    const order: string[] = [];
    const transport = fakeTransport(async () => {
      order.push('call');
      return LINK_RESPONSE;
    });
    const flushOutbox = jest.fn(async () => {
      order.push('flush');
      return { flushed: 1, pending: 0, rejected: 0 };
    });
    const service = createZoomService({ getTransport: () => transport, flushOutbox });

    await expect(service.ensureLink('m1')).resolves.toEqual(LINK_RESPONSE);
    expect(order).toEqual(['flush', 'call']);
    expect(transport.calls[0]).toMatchObject({ name: CALLABLES.zoomCreateMeeting, request: { meetingId: 'm1' } });
    expect(service.linkFailure('m1')).toBeNull();
  });

  it('dedupes concurrent calls for the same meeting (one callable round trip)', async () => {
    let resolve!: (value: unknown) => void;
    const transport = fakeTransport(() => new Promise((res) => (resolve = res)));
    const service = createZoomService({ getTransport: () => transport });

    const first = service.ensureLink('m1');
    const second = service.ensureLink('m1');
    // Let the async chain (offline probe, outbox flush) reach the transport call.
    await new Promise((settle) => setImmediate(settle));
    resolve(LINK_RESPONSE);
    await expect(Promise.all([first, second])).resolves.toEqual([LINK_RESPONSE, LINK_RESPONSE]);
    expect(transport.calls).toHaveLength(1);
  });

  it('maps details.reason to AppError codes and remembers the failure for linkFailure()', async () => {
    const transport = fakeTransport(async () => {
      throw httpsError('functions/resource-exhausted', 'quota_exceeded');
    });
    const service = createZoomService({ getTransport: () => transport });

    await expect(service.ensureLink('m1')).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(service.linkFailure('m1')).toBe('quota_exceeded');
    expect(service.linkFailure('other')).toBeNull();
  });

  it('a later success clears the recorded failure', async () => {
    let fail = true;
    const transport = fakeTransport(async () => {
      if (fail) throw httpsError('functions/failed-precondition', 'not_configured');
      return LINK_RESPONSE;
    });
    const service = createZoomService({ getTransport: () => transport });

    await expect(service.ensureLink('m1')).rejects.toMatchObject({ code: 'not_configured' });
    expect(service.linkFailure('m1')).toBe('not_configured');
    fail = false;
    await expect(service.ensureLink('m1')).resolves.toEqual(LINK_RESPONSE);
    expect(service.linkFailure('m1')).toBeNull();
  });

  it('fails fast while offline (no callable round trip) and without Firebase', async () => {
    const transport = fakeTransport(async () => LINK_RESPONSE);
    const offline = createZoomService({ getTransport: () => transport, connectivity: { isOffline: async () => true } });
    await expect(offline.ensureLink('m1')).rejects.toMatchObject({ code: 'offline' });
    expect(transport.calls).toHaveLength(0);
    expect(offline.linkFailure('m1')).toBe('offline');

    const unconfigured = createZoomService({ getTransport: () => null });
    await expect(unconfigured.ensureLink('m1')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('rejects an invalid meeting id and an invalid server response', async () => {
    const service = createZoomService({ getTransport: () => fakeTransport(async () => ({ url: 'not-a-url' })) });
    await expect(service.ensureLink('bad id!')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.ensureLink('m1')).rejects.toMatchObject({ code: 'upstream_error' });
  });
});

describe('syncIfNeeded (zoomSyncMeeting)', () => {
  it('patches the Zoom meeting when the edit touched title/startAt/duration/timezone', async () => {
    const transport = fakeTransport(async () => ({ updated: true }));
    const service = createZoomService({ getTransport: () => transport });
    const linked = meeting({ external: { zoomMeetingId: '123' } });

    await service.syncIfNeeded(linked, { title: 'New title' });
    await service.syncIfNeeded(linked, { startAt: '2026-10-07T15:00:00.000Z' });
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0]).toMatchObject({ name: CALLABLES.zoomSyncMeeting, request: { meetingId: 'm1' } });
  });

  it('no-ops without a zoomMeetingId or when the patch touches nothing Zoom shows', async () => {
    const transport = fakeTransport(async () => ({ updated: true }));
    const service = createZoomService({ getTransport: () => transport });

    await service.syncIfNeeded(meeting(), { title: 'New title' });
    await service.syncIfNeeded(meeting({ external: { zoomMeetingId: '123' } }), { notes: 'notes only' });
    expect(transport.calls).toHaveLength(0);
  });

  it('never throws (best effort)', async () => {
    const transport = fakeTransport(async () => {
      throw httpsError('functions/internal');
    });
    const service = createZoomService({ getTransport: () => transport });
    await expect(service.syncIfNeeded(meeting({ external: { zoomMeetingId: '123' } }), { title: 'x' })).resolves.toBeUndefined();
  });
});

describe('onMeetingDeleted (zoomDeleteMeeting)', () => {
  it('deletes by the bare zoomMeetingId (the document is already tombstoned)', async () => {
    const transport = fakeTransport(async () => ({ deleted: true }));
    const service = createZoomService({ getTransport: () => transport });

    await service.onMeetingDeleted(meeting({ external: { zoomMeetingId: '123' } }));
    expect(transport.calls[0]).toMatchObject({
      name: CALLABLES.zoomDeleteMeeting,
      request: { meetingId: null, zoomMeetingId: '123' },
    });
  });

  it('no-ops without a zoomMeetingId and never throws on failure', async () => {
    const failing = fakeTransport(async () => {
      throw httpsError('functions/internal');
    });
    const service = createZoomService({ getTransport: () => failing });

    await expect(service.onMeetingDeleted(meeting())).resolves.toBeUndefined();
    expect(failing.calls).toHaveLength(0);
    await expect(service.onMeetingDeleted(meeting({ external: { zoomMeetingId: '123' } }))).resolves.toBeUndefined();
    expect(failing.calls).toHaveLength(1);
  });

  it('forgets a recorded link failure for the deleted meeting', async () => {
    const transport = fakeTransport(async (name) => {
      if (name === CALLABLES.zoomCreateMeeting) throw httpsError('functions/internal', 'upstream_error');
      return { deleted: true };
    });
    const service = createZoomService({ getTransport: () => transport });
    await expect(service.ensureLink('m1')).rejects.toMatchObject({ code: 'upstream_error' });
    expect(service.linkFailure('m1')).toBe('upstream_error');
    await service.onMeetingDeleted(meeting());
    expect(service.linkFailure('m1')).toBeNull();
  });
});

describe('session cache', () => {
  it("clears the status answer and the failures on the bus's session:ended", async () => {
    const events = createEventBus<AppEventMap>();
    const transport = fakeTransport(async (name) => {
      if (name === CALLABLES.zoomStatus) return { configured: true };
      throw httpsError('functions/resource-exhausted', 'quota_exceeded');
    });
    const service = createZoomService({ getTransport: () => transport, events });

    await service.isAvailable();
    await expect(service.ensureLink('m1')).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(service.getKnownAvailability()).toBe(true);
    expect(service.linkFailure('m1')).toBe('quota_exceeded');

    events.emit('session:ended', { uid: 'u1', reason: 'sign_out' });
    expect(service.getKnownAvailability()).toBeNull();
    expect(service.linkFailure('m1')).toBeNull();

    // The next session asks again.
    await expect(service.isAvailable()).resolves.toBe(true);
    expect(transport.calls.filter((call) => call.name === CALLABLES.zoomStatus)).toHaveLength(2);
  });

  it('a status answer from the previous session is never cached across the clear', async () => {
    const events = createEventBus<AppEventMap>();
    let resolve!: (value: unknown) => void;
    const transport = fakeTransport(() => new Promise((res) => (resolve = res)));
    const service = createZoomService({ getTransport: () => transport, events });

    const pending = service.isAvailable();
    events.emit('session:ended', { uid: 'u1', reason: 'sign_out' });
    resolve({ configured: true });
    await expect(pending).resolves.toBe(true);
    expect(service.getKnownAvailability()).toBeNull();
  });

  it("an ensureLink that settles after session:ended never writes the NEXT session's failure map", async () => {
    const events = createEventBus<AppEventMap>();
    let reject!: (reason: unknown) => void;
    const transport = fakeTransport(() => new Promise((_res, rej) => (reject = rej)));
    const service = createZoomService({ getTransport: () => transport, events });

    // User A fires the create, signs out mid-flight; user B's session starts on the device.
    const pending = service.ensureLink('m1');
    // Let doEnsureLink reach the transport (it awaits the offline probe and outbox flush first).
    await new Promise((settle) => setImmediate(settle));
    events.emit('session:ended', { uid: 'uA', reason: 'sign_out' });
    reject(httpsError('functions/resource-exhausted', 'quota_exceeded'));
    await expect(pending).rejects.toMatchObject({ code: 'quota_exceeded' });
    // The late failure must not leak into the new session (§24: the cache never crosses sessions).
    expect(service.linkFailure('m1')).toBeNull();
  });

  it("a late ensureLink SUCCESS never clears a failure the NEXT session recorded", async () => {
    const events = createEventBus<AppEventMap>();
    let resolveFirst!: (value: unknown) => void;
    let firstCall = true;
    const transport = fakeTransport(() => {
      if (firstCall) {
        firstCall = false;
        return new Promise((res) => (resolveFirst = res));
      }
      return Promise.reject(httpsError('functions/resource-exhausted', 'quota_exceeded'));
    });
    const service = createZoomService({ getTransport: () => transport, events });

    const pendingA = service.ensureLink('m1');
    await new Promise((settle) => setImmediate(settle));
    events.emit('session:ended', { uid: 'uA', reason: 'sign_out' });
    // The next session records a real failure for the same meeting id...
    await expect(service.ensureLink('m1')).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(service.linkFailure('m1')).toBe('quota_exceeded');
    // ...and session A's late success must not erase it.
    resolveFirst(LINK_RESPONSE);
    await expect(pendingA).resolves.toEqual(LINK_RESPONSE);
    expect(service.linkFailure('m1')).toBe('quota_exceeded');
  });
});

describe('mapZoomError', () => {
  it('keeps AppErrors, maps reasons, timeouts and offline shapes', () => {
    expect(mapZoomError(new AppError('offline')).code).toBe('offline');
    expect(mapZoomError(httpsError('functions/invalid-argument', 'invalid_request')).code).toBe('invalid_input');
    expect(mapZoomError(httpsError('functions/not-found', 'not_found')).code).toBe('not_found');
    expect(mapZoomError(httpsError('functions/unauthenticated', 'unauthenticated')).code).toBe('unauthenticated');
    expect(mapZoomError(httpsError('functions/deadline-exceeded')).code).toBe('timeout');
    expect(mapZoomError(httpsError('functions/internal', undefined, 'internal [0]')).code).toBe('offline');
    expect(mapZoomError(httpsError('functions/internal'), { offline: true }).code).toBe('offline');
    expect(mapZoomError(new Error('Network request failed')).code).toBe('offline');
    expect(mapZoomError(new Error('kaboom')).code).toBe('upstream_error');
  });
});
