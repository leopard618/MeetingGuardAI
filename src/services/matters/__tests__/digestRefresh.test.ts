/**
 * A5: the assistant digest is refreshed when a session starts and when the app comes back, at most
 * every DIGEST_REFRESH_MIN_MS, only while the assistant is on and someone is signed in; a failure
 * is quiet.
 */
import type { MatterDigestResponse } from '../../../core/aiContract';
import { createEventBus, type AppEventMap } from '../../../core/events';
import { DIGEST_REFRESH_MIN_MS, startAssistantDigestRefresh, type DigestRefreshDeps } from '../digestRefresh';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false, auth: null }));
jest.mock('expo-notifications', () => ({ SchedulableTriggerInputTypes: { DATE: 'date' } }));

const DIGEST: MatterDigestResponse = {
  generatedAt: '2026-11-25T08:00:00.000Z',
  needsYou: 2,
  sections: { moved: [], needsYou: [], followUps: [], meetings: [] },
  spoken: '',
  briefings: [],
  briefingMinutes: 30,
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(overrides: Partial<DigestRefreshDeps> = {}) {
  let appListener: ((state: string) => void) | null = null;
  const clock = { now: 1_000_000 };
  const deps: DigestRefreshDeps = {
    enabled: () => true,
    signedIn: () => true,
    language: () => 'en',
    timeZone: () => 'Asia/Dubai',
    digest: jest.fn(async () => DIGEST),
    apply: jest.fn(async () => undefined),
    subscribeAppState: (listener) => {
      appListener = listener;
      return () => {
        appListener = null;
      };
    },
    now: () => clock.now,
    ...overrides,
  };
  const events = createEventBus<AppEventMap>();
  const onUpdated = jest.fn();
  const stop = startAssistantDigestRefresh({ onUpdated }, deps, events);
  return { deps, events, onUpdated, stop, clock, app: (state: string) => appListener?.(state) };
}

describe('startAssistantDigestRefresh', () => {
  it('refreshes at start, then on app open at most every 30 minutes, and on a new session', async () => {
    const ctx = setup();
    await flush();
    expect(ctx.deps.digest).toHaveBeenCalledWith('en', 'Asia/Dubai');
    expect(ctx.deps.apply).toHaveBeenCalledWith(DIGEST);
    expect(ctx.onUpdated).toHaveBeenCalledTimes(1);
    ctx.app('active');
    await flush();
    expect(ctx.deps.digest).toHaveBeenCalledTimes(1);
    ctx.clock.now += DIGEST_REFRESH_MIN_MS;
    ctx.app('background');
    ctx.app('active');
    await flush();
    expect(ctx.deps.digest).toHaveBeenCalledTimes(2);
    ctx.events.emit('session:started', { uid: 'u2' } as AppEventMap['session:started']);
    await flush();
    expect(ctx.deps.digest).toHaveBeenCalledTimes(3);
    ctx.stop();
    ctx.clock.now += DIGEST_REFRESH_MIN_MS;
    ctx.app('active');
    await flush();
    expect(ctx.deps.digest).toHaveBeenCalledTimes(3);
  });

  it('nothing while the assistant is off or nobody is signed in; a failure is quiet', async () => {
    const off = setup({ enabled: () => false });
    const out = setup({ signedIn: () => false });
    await flush();
    expect(off.deps.digest).not.toHaveBeenCalled();
    expect(out.deps.digest).not.toHaveBeenCalled();
    const failing = setup({ digest: jest.fn(async () => Promise.reject(new Error('offline'))) });
    await flush();
    expect(failing.deps.apply).not.toHaveBeenCalled();
    expect(failing.onUpdated).not.toHaveBeenCalled();
    // it is tried again on the next opening (the failed one did not count)
    failing.app('active');
    await flush();
    expect(failing.deps.digest).toHaveBeenCalledTimes(2);
  });
});
