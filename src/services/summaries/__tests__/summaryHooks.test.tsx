/**
 * The summary hooks over a real service with a fake transport (M10 section 9): the status gate,
 * the poll (paused on blur and in the background, with a catch-up ask on return), the refresh on
 * focus once stale, a failed ask's error dropped by a newer answer, `enabled: false` asking
 * nothing (summaryRead is never called while the feature is off), the cached answer shown at
 * once, and an action answer reaching every mounted hook.
 */
import { NavigationContext } from '@react-navigation/native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { CALLABLES, type SummaryDetail, type SummaryListItem, type SummaryStatusResponse } from '../../../core/aiContract';
import { createSummariesService, type SummariesTransport } from '../summariesService';
import { useSummary } from '../useSummary';
import { useSummaryList } from '../useSummaryList';
import { useSummaryStatus } from '../useSummaryStatus';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

const ID_A = 'a'.repeat(64);

const STATUS: SummaryStatusResponse = {
  enabled: true,
  allowed: true,
  ready: true,
  address: 'abcdefghijklmnopqrstuvwxyz@summaries.example.com',
  mailboxes: ['ana@example.com'],
  gmailRequests: [],
  inboxCount: 1,
  lastReceivedAt: null,
  lastRefused: null,
  refusedToday: null,
};

const ROW: SummaryListItem = {
  summaryId: ID_A,
  status: 'inbox',
  title: 'Weekly sync',
  summaryDate: '2026-11-12',
  receivedAt: '2026-11-12T10:00:00.000Z',
  tier: 'user_forwarded',
  recipientBound: false,
  fresh: true,
  inboxReason: 'user_forwarded',
  refusedReason: null,
  senderDomain: null,
  count: null,
  match: null,
  suggestions: [],
};

const DETAIL: SummaryDetail = {
  ...ROW,
  subject: 'Fwd: Weekly sync',
  titleLine: 'Weekly sync',
  fromAddress: 'ana@example.com',
  forwardedBy: 'ana@example.com',
  text: 'Weekly sync',
  sections: [],
};

function makeService(status: SummaryStatusResponse = STATUS, options: { now?: () => number } = {}) {
  const calls: { name: string; request: Record<string, unknown> }[] = [];
  let currentStatus = status;
  const transport: SummariesTransport = {
    async call(name, request) {
      const body = request as Record<string, unknown>;
      calls.push({ name, request: body });
      if (name === CALLABLES.summaryStatus) return currentStatus;
      if (name === CALLABLES.summaryAction) return { changed: true, status: { ...currentStatus, inboxCount: 0 }, summary: null };
      if (body.op === 'get') return { op: 'get', summary: DETAIL };
      return { op: 'list', view: body.view, items: [ROW], hasMore: false };
    },
  };
  const service = createSummariesService({ getTransport: () => transport, now: options.now });
  return {
    service,
    calls,
    setStatus(next: SummaryStatusResponse) {
      currentStatus = next;
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stand-in for the screen's navigation object: focus and blur on demand. */
function fakeNavigation() {
  let focused = true;
  const listeners = new Map<string, Set<() => void>>();
  const navigation = {
    isFocused: () => focused,
    addListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
      return () => {
        set.delete(listener);
      };
    },
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return <NavigationContext.Provider value={navigation as never}>{children}</NavigationContext.Provider>;
  }
  return {
    wrapper: Wrapper,
    setFocused(next: boolean) {
      focused = next;
      for (const listener of listeners.get(next ? 'focus' : 'blur') ?? []) listener();
    },
  };
}

/** Captures the AppState 'change' listeners so a test can send the app to the background and back. */
function fakeAppState() {
  const handlers: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    handlers.push(handler as (state: AppStateStatus) => void);
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  return {
    emit(state: AppStateStatus) {
      for (const handler of handlers) handler(state);
    },
  };
}

describe('useSummaryStatus', () => {
  it('asks once, then reports available only when enabled and allowed', async () => {
    const { service, calls } = makeService();
    const { result } = await renderHook(() => useSummaryStatus({ service }));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    expect(result.current.available).toBe(true);
    expect(result.current.error).toBeNull();
    expect(calls).toHaveLength(1);

    const off = makeService({ ...STATUS, allowed: false });
    const second = await renderHook(() => useSummaryStatus({ service: off.service }));
    await waitFor(() => expect(second.result.current.status).not.toBeNull());
    expect(second.result.current.available).toBe(false);
  });

  it('polls when asked to, and not otherwise', async () => {
    const { service, calls } = makeService();
    const polled = await renderHook(() => useSummaryStatus({ service, pollMs: 20 }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(3));
    await polled.unmount();
    const after = calls.length;

    const quiet = makeService();
    await renderHook(() => useSummaryStatus({ service: quiet.service }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(quiet.calls).toHaveLength(1);
    // An unmounted hook stops polling.
    expect(calls.length).toBe(after);
  });

  it('stops polling in the background and asks once right away on return (T7)', async () => {
    const app = fakeAppState();
    const { service } = makeService();
    const refreshes = jest.spyOn(service, 'refreshStatus');
    await renderHook(() => useSummaryStatus({ service, pollMs: 100 }));
    await waitFor(() => expect(refreshes.mock.calls.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      app.emit('background');
    });
    const paused = refreshes.mock.calls.length;
    await act(async () => {
      await sleep(350);
    });
    expect(refreshes).toHaveBeenCalledTimes(paused);

    await act(async () => {
      app.emit('active');
    });
    await act(async () => {
      await sleep(30);
    });
    // The catch-up ask, well before the next interval.
    expect(refreshes).toHaveBeenCalledTimes(paused + 1);
  });

  it('stops polling while the screen is blurred and asks once right away on focus (T7)', async () => {
    const nav = fakeNavigation();
    const { service } = makeService();
    const refreshes = jest.spyOn(service, 'refreshStatus');
    await renderHook(() => useSummaryStatus({ service, pollMs: 100 }), { wrapper: nav.wrapper });
    await waitFor(() => expect(refreshes.mock.calls.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      nav.setFocused(false);
    });
    const paused = refreshes.mock.calls.length;
    await act(async () => {
      await sleep(350);
    });
    expect(refreshes).toHaveBeenCalledTimes(paused);

    await act(async () => {
      nav.setFocused(true);
    });
    await act(async () => {
      await sleep(30);
    });
    expect(refreshes).toHaveBeenCalledTimes(paused + 1);
  });

  it('refreshOnFocus asks again on focus only once the answer is stale (B3)', async () => {
    const nav = fakeNavigation();
    let clock = 1_000;
    const { service, calls, setStatus } = makeService(STATUS, { now: () => clock });
    const { result } = await renderHook(() => useSummaryStatus({ service, refreshOnFocus: true }), { wrapper: nav.wrapper });
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    expect(calls).toHaveLength(1);

    // Back on Settings 30 s later: the answer is fresh enough.
    await act(async () => {
      nav.setFocused(false);
    });
    clock += 30_000;
    await act(async () => {
      nav.setFocused(true);
    });
    expect(calls).toHaveLength(1);

    // A minute later a recap is waiting: the row learns it on focus.
    setStatus({ ...STATUS, inboxCount: 3 });
    await act(async () => {
      nav.setFocused(false);
    });
    clock += 31_000;
    await act(async () => {
      nav.setFocused(true);
    });
    await waitFor(() => expect(result.current.status?.inboxCount).toBe(3));
    expect(calls).toHaveLength(2);
  });

  it('refreshOnFocus asks rarely while the feature is off for this user (B3)', async () => {
    const nav = fakeNavigation();
    let clock = 1_000;
    const { service, calls, setStatus } = makeService({ ...STATUS, allowed: false }, { now: () => clock });
    const { result } = await renderHook(() => useSummaryStatus({ service, refreshOnFocus: true }), { wrapper: nav.wrapper });
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.available).toBe(false);

    await act(async () => {
      nav.setFocused(false);
    });
    clock += 5 * 60_000;
    await act(async () => {
      nav.setFocused(true);
    });
    expect(calls).toHaveLength(1);

    // Added to the pilot: the row appears without signing out.
    setStatus(STATUS);
    await act(async () => {
      nav.setFocused(false);
    });
    clock += 30 * 60_000;
    await act(async () => {
      nav.setFocused(true);
    });
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(calls).toHaveLength(2);
  });

  it('drops the error of a failed ask once a newer status arrives (B7)', async () => {
    let fail = false;
    const transport: SummariesTransport = {
      async call() {
        if (fail) throw Object.assign(new Error('boom'), { code: 'functions/deadline-exceeded' });
        return STATUS;
      },
    };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createSummariesService({ getTransport: () => transport });
    const { result } = await renderHook(() => useSummaryStatus({ service }));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));

    fail = true;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error?.code).toBe('timeout');
    expect(result.current.status).toEqual(STATUS);

    // Another hook instance (the connect screen's poller) gets a newer answer.
    fail = false;
    await act(async () => {
      await service.refreshStatus();
    });
    expect(result.current.error).toBeNull();
  });
});

describe('useSummaryList', () => {
  it('asks nothing while not enabled', async () => {
    const { service, calls } = makeService();
    const { result } = await renderHook(() => useSummaryList('inbox', null, { enabled: false, service }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ items: null, loading: false, error: null });
    expect(calls).toHaveLength(0);
  });

  it('needs a meeting id for the meeting view', async () => {
    const { service, calls } = makeService();
    const { result } = await renderHook(() => useSummaryList('meeting', null, { service }));
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('loads, shows the cached answer at once next time, and follows an action answer', async () => {
    const { service, calls } = makeService();
    const first = await renderHook(() => useSummaryList('inbox', null, { service }));
    await waitFor(() => expect(first.result.current.items).toEqual([ROW]));
    expect(first.result.current.loading).toBe(false);

    const second = await renderHook(() => useSummaryList('inbox', null, { service }));
    expect(second.result.current.items).toEqual([ROW]);
    expect(second.result.current.loading).toBe(false);
    await waitFor(() => expect(calls.filter((call) => call.name === CALLABLES.summaryRead)).toHaveLength(2));

    await act(async () => {
      await service.deleteSummary(ID_A);
    });
    expect(first.result.current.items).toEqual([]);
    expect(second.result.current.items).toEqual([]);
  });

  it('reports loading until the first answer, then the error of a failed ask', async () => {
    let fail: (error: unknown) => void = () => undefined;
    const transport: SummariesTransport = {
      call: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createSummariesService({ getTransport: () => transport });
    const { result } = await renderHook(() => useSummaryList('inbox', null, { service }));
    expect(result.current).toMatchObject({ items: null, loading: true, error: null });
    await act(async () => {
      fail(Object.assign(new Error('boom'), { code: 'functions/unavailable', details: { reason: 'upstream_error' } }));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.code).toBe('upstream_error');
    expect(result.current.items).toBeNull();
  });

  it('refresh asks again and reports refreshing meanwhile', async () => {
    const { service, calls } = makeService();
    const { result } = await renderHook(() => useSummaryList('recent', null, { service }));
    await waitFor(() => expect(result.current.items).not.toBeNull());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.refreshing).toBe(false);
    expect(calls.filter((call) => call.request.view === 'recent')).toHaveLength(2);
  });
});

describe('useSummary', () => {
  it('loads the full view, and asks nothing while not enabled', async () => {
    const { service, calls } = makeService();
    const idle = await renderHook(() => useSummary(ID_A, { enabled: false, service }));
    expect(idle.result.current).toMatchObject({ summary: null, loading: false });
    expect(calls).toHaveLength(0);

    const { result } = await renderHook(() => useSummary(ID_A, { service }));
    await waitFor(() => expect(result.current.summary).toEqual(DETAIL));
    expect(result.current.loading).toBe(false);
    expect(calls).toEqual([{ name: CALLABLES.summaryRead, request: { op: 'get', summaryId: ID_A } }]);
  });
});
