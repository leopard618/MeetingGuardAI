/**
 * Connect Fathom, app side (src/services/summaries/fathom.ts): the return URL parser, the status
 * mapping (a server without Connect Fathom is "not offered", never an error) and the connect flow
 * through a fake transport and auth session.
 */
import { AppError } from '../../../core/errors';
import { FATHOM_UNAVAILABLE, createFathomService, parseFathomReturn, type FathomTransport } from '../fathom';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

const OFFERED = { available: true, connected: false, connectedAt: null, lastEventAt: null };

function transport(answer: (request: { op: string }) => unknown): FathomTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(request) {
      calls.push(request.op);
      return answer(request);
    },
  };
}

describe('parseFathomReturn', () => {
  it('reads connected, cancelled and error reasons', () => {
    expect(parseFathomReturn('meetingguardai://fathom?result=connected')).toEqual({ result: 'connected' });
    expect(parseFathomReturn('meetingguardai://fathom?result=cancelled')).toEqual({ result: 'cancelled' });
    expect(parseFathomReturn('meetingguardai://fathom?result=error&reason=expired')).toEqual({ result: 'error', reason: 'expired' });
    expect(parseFathomReturn('meetingguardai://fathom/?result=connected')).toEqual({ result: 'connected' });
  });

  it('an unknown reason or another URL is an error without a reason', () => {
    expect(parseFathomReturn('meetingguardai://fathom?result=error&reason=whatever')).toEqual({ result: 'error', reason: null });
    expect(parseFathomReturn('https://example.com/?result=connected')).toEqual({ result: 'error', reason: null });
  });
});

describe('createFathomService', () => {
  it('status: a server without fathomConnect (functions/not-found) is not offered', async () => {
    const service = createFathomService({
      getTransport: () =>
        transport(() => {
          throw Object.assign(new Error('not found'), { code: 'functions/not-found' });
        }),
      openSession: jest.fn(),
    });
    await expect(service.status()).resolves.toEqual(FATHOM_UNAVAILABLE);
  });

  it('status: no Firebase in this build is not offered', async () => {
    const service = createFathomService({ getTransport: () => null, openSession: jest.fn() });
    await expect(service.status()).resolves.toEqual(FATHOM_UNAVAILABLE);
  });

  it('status: an answer that breaks the contract is an upstream error', async () => {
    const service = createFathomService({ getTransport: () => transport(() => ({ nope: true })), openSession: jest.fn() });
    await expect(service.status()).rejects.toBeInstanceOf(AppError);
  });

  it('connect: start, then the auth session to the return URL, then its result', async () => {
    const t = transport(() => ({ status: OFFERED, authorizeUrl: 'https://fathom.video/external/v1/oauth2/authorize?state=s', remoteRemoved: null }));
    const openSession = jest.fn(async () => ({ type: 'success' as const, url: 'meetingguardai://fathom?result=connected' }));
    const service = createFathomService({ getTransport: () => t, openSession });
    await expect(service.connect()).resolves.toEqual({ result: 'connected' });
    expect(t.calls).toEqual(['start']);
    expect(openSession).toHaveBeenCalledWith('https://fathom.video/external/v1/oauth2/authorize?state=s', 'meetingguardai://fathom');
  });

  it('connect: closing the browser is cancelled', async () => {
    const t = transport(() => ({ status: OFFERED, authorizeUrl: 'https://fathom.video/x', remoteRemoved: null }));
    const service = createFathomService({ getTransport: () => t, openSession: async () => ({ type: 'cancel' }) });
    await expect(service.connect()).resolves.toEqual({ result: 'cancelled' });
  });

  it('disconnect: answers the new status and whether Fathom was told', async () => {
    const t = transport(() => ({ status: OFFERED, authorizeUrl: null, remoteRemoved: false }));
    const service = createFathomService({ getTransport: () => t, openSession: jest.fn() });
    await expect(service.disconnect()).resolves.toEqual({ status: OFFERED, remoteRemoved: false });
    expect(t.calls).toEqual(['disconnect']);
  });
});
