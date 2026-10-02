/**
 * WhatsAppService unit tests (§27): mocked callables through an injected transport; the default
 * singleton's Firebase/NetInfo wiring is not exercised here (config-less builds resolve the
 * disabled status and that path is covered below via a null transport).
 */
import { CALLABLES, WHATSAPP_CALL_TIMEOUT_MS } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { createEventBus, type AppEventMap } from '../../../core/events';
import { createWhatsAppService, mapWhatsAppError, type WhatsAppTransport } from '../whatsappService';

// The singleton's default wiring (not under test): firebase/* ships untransformed ESM.
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

const ENABLED_STATUS = {
  enabled: true,
  linked: false,
  displayNumber: '15550253483',
  deepLink: 'https://wa.me/15550253483',
};

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

function fakeTransport(
  impl: (name: string, request: unknown) => Promise<unknown>,
): WhatsAppTransport & { calls: { name: string; request: unknown; timeoutMs: number }[] } {
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

describe('status (whatsappLinkStatus)', () => {
  it('asks once per session, caches the answer and exposes it synchronously', async () => {
    const transport = fakeTransport(async () => ENABLED_STATUS);
    const service = createWhatsAppService({ getTransport: () => transport });

    expect(service.getKnownStatus()).toBeNull();
    await expect(service.getStatus()).resolves.toEqual(ENABLED_STATUS);
    await expect(service.getStatus()).resolves.toEqual(ENABLED_STATUS);
    expect(service.getKnownStatus()).toEqual(ENABLED_STATUS);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({
      name: CALLABLES.whatsappLinkStatus,
      request: {},
      timeoutMs: WHATSAPP_CALL_TIMEOUT_MS,
    });
  });

  it('shares one in-flight status ask between concurrent callers', async () => {
    const transport = fakeTransport(async () => ENABLED_STATUS);
    const service = createWhatsAppService({ getTransport: () => transport });
    await expect(Promise.all([service.getStatus(), service.getStatus()])).resolves.toEqual([ENABLED_STATUS, ENABLED_STATUS]);
    expect(transport.calls).toHaveLength(1);
  });

  it('throws without caching when the call fails, so a later call retries', async () => {
    let fail = true;
    const transport = fakeTransport(async () => {
      if (fail) throw httpsError('functions/internal');
      return ENABLED_STATUS;
    });
    const service = createWhatsAppService({ getTransport: () => transport });

    await expect(service.getStatus()).rejects.toMatchObject({ name: 'AppError' });
    expect(service.getKnownStatus()).toBeNull();

    fail = false;
    await expect(service.getStatus()).resolves.toEqual(ENABLED_STATUS);
    expect(service.getKnownStatus()).toEqual(ENABLED_STATUS);
    expect(transport.calls).toHaveLength(2);
  });

  it('treats an invalid status response as upstream_error and a missing transport as disabled', async () => {
    const invalid = createWhatsAppService({ getTransport: () => fakeTransport(async () => ({ nope: 1 })) });
    await expect(invalid.getStatus()).rejects.toMatchObject({ code: 'upstream_error' });
    expect(invalid.getKnownStatus()).toBeNull();

    const unconfigured = createWhatsAppService({ getTransport: () => null });
    await expect(unconfigured.getStatus()).resolves.toEqual({
      enabled: false,
      linked: false,
      displayNumber: null,
      deepLink: null,
    });
    expect(unconfigured.getKnownStatus()).toBeNull();
  });

  it('notifies subscribers when the answer arrives; refresh keeps the old answer until the new one', async () => {
    let linked = false;
    const transport = fakeTransport(async () => ({ ...ENABLED_STATUS, linked }));
    const service = createWhatsAppService({ getTransport: () => transport });
    const seen: (boolean | null)[] = [];
    const unsubscribe = service.subscribeStatus(() => seen.push(service.getKnownStatus()?.linked ?? null));

    await service.getStatus();
    linked = true;
    // No null flicker between the old and the new answer.
    await service.refreshStatus();
    unsubscribe();
    await service.refreshStatus();

    expect(seen).toEqual([false, true]);
    expect(transport.calls).toHaveLength(3);
  });

  it('forgets the answer on session end (appEvents session:ended)', async () => {
    const events = createEventBus<AppEventMap>();
    const transport = fakeTransport(async () => ENABLED_STATUS);
    const service = createWhatsAppService({ getTransport: () => transport, events });

    await service.getStatus();
    expect(service.getKnownStatus()).not.toBeNull();
    events.emit('session:ended', { uid: 'u1', reason: 'sign_out' });
    expect(service.getKnownStatus()).toBeNull();
    await service.getStatus();
    expect(transport.calls).toHaveLength(2);
  });
});

describe('startLink (whatsappLinkStart)', () => {
  it('returns the one-time code after validating the response', async () => {
    const transport = fakeTransport(async (name) => {
      if (name === CALLABLES.whatsappLinkStart) {
        return { code: '004217', expiresAtIso: '2026-10-02T10:10:00.000Z' };
      }
      return ENABLED_STATUS;
    });
    const service = createWhatsAppService({ getTransport: () => transport });
    await expect(service.startLink()).resolves.toEqual({ code: '004217', expiresAtIso: '2026-10-02T10:10:00.000Z' });
  });

  it('rejects an invalid code response as upstream_error', async () => {
    const transport = fakeTransport(async () => ({ code: 'abc', expiresAtIso: 'x' }));
    const service = createWhatsAppService({ getTransport: () => transport });
    await expect(service.startLink()).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('maps the server rate limit to quota_exceeded and keeps details.reason', async () => {
    const transport = fakeTransport(async () => {
      throw httpsError('functions/resource-exhausted', 'rate_limited');
    });
    const service = createWhatsAppService({ getTransport: () => transport });
    await expect(service.startLink()).rejects.toMatchObject({
      code: 'quota_exceeded',
      details: expect.objectContaining({ reason: 'rate_limited' }),
    });
  });

  it('throws not_configured without a transport and offline when the device is known offline', async () => {
    const unconfigured = createWhatsAppService({ getTransport: () => null });
    await expect(unconfigured.startLink()).rejects.toMatchObject({ code: 'not_configured' });

    const transport = fakeTransport(async () => ENABLED_STATUS);
    const offline = createWhatsAppService({
      getTransport: () => transport,
      connectivity: { isOffline: async () => true },
    });
    await expect(offline.startLink()).rejects.toMatchObject({ code: 'offline' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('unlink (whatsappUnlink)', () => {
  it('flips the cached status to linked: false and notifies subscribers', async () => {
    const transport = fakeTransport(async (name) => {
      if (name === CALLABLES.whatsappUnlink) return { unlinked: true };
      return { ...ENABLED_STATUS, linked: true };
    });
    const service = createWhatsAppService({ getTransport: () => transport });
    await service.getStatus();
    expect(service.getKnownStatus()?.linked).toBe(true);

    const seen: (boolean | undefined)[] = [];
    const unsubscribe = service.subscribeStatus(() => seen.push(service.getKnownStatus()?.linked));
    await service.unlink();
    unsubscribe();

    expect(service.getKnownStatus()).toEqual({ ...ENABLED_STATUS, linked: false });
    expect(seen).toEqual([false]);
  });

  it('propagates failures as AppError without touching the cache', async () => {
    const transport = fakeTransport(async (name) => {
      if (name === CALLABLES.whatsappUnlink) throw httpsError('functions/unauthenticated', 'unauthenticated');
      return { ...ENABLED_STATUS, linked: true };
    });
    const service = createWhatsAppService({ getTransport: () => transport });
    await service.getStatus();
    await expect(service.unlink()).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(service.getKnownStatus()?.linked).toBe(true);
  });
});

describe('mapWhatsAppError', () => {
  it('keeps AppErrors and maps every details.reason to the app taxonomy', () => {
    const original = new AppError('offline');
    expect(mapWhatsAppError(original)).toBe(original);
    expect(mapWhatsAppError(httpsError('functions/failed-precondition', 'not_configured')).code).toBe('not_configured');
    expect(mapWhatsAppError(httpsError('functions/invalid-argument', 'invalid_request')).code).toBe('invalid_input');
    expect(mapWhatsAppError(httpsError('functions/resource-exhausted', 'rate_limited')).code).toBe('quota_exceeded');
    expect(mapWhatsAppError(httpsError('functions/unavailable', 'upstream_error')).code).toBe('upstream_error');
    expect(mapWhatsAppError(httpsError('functions/unauthenticated', 'unauthenticated')).code).toBe('unauthenticated');
  });

  it('maps transport-level failures like the zoom service does', () => {
    expect(mapWhatsAppError(httpsError('functions/deadline-exceeded')).code).toBe('timeout');
    expect(mapWhatsAppError(httpsError('functions/internal', undefined, 'internal [0]')).code).toBe('offline');
    expect(mapWhatsAppError(httpsError('functions/internal'), { offline: true }).code).toBe('offline');
    expect(mapWhatsAppError(new Error('Network request failed')).code).toBe('offline');
    expect(mapWhatsAppError(new Error('what')).code).toBe('upstream_error');
  });
});
