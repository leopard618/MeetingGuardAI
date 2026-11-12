/**
 * useSummaryCommitments and useCommitmentsAiNotice over a real service with a fake transport (M11,
 * docs/v2/M11-DESIGN.md sections 3, 7 and 8): `enabled: false` asks nothing, the states, the poll
 * while another device prepares (paused on blur and in the background, stopped on unmount, bounded
 * with a "still preparing" timeout), prepare and decide never throwing, a stale decide reloading
 * silently, quota_exceeded carrying the allowance, session end clearing the memory cache, and the
 * one AsyncStorage key (the boolean AI notice flag) being the only thing on the phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContext } from '@react-navigation/native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { CommitmentItem, SummaryCommitments, SummaryCommitmentsResponse } from '../../../core/aiContract';
import { createEventBus, type AppEventMap } from '../../../core/events';
import { createCommitmentsService, type CommitmentsTransport } from '../commitments';
import { isCommitmentsUnavailableError } from '../commitmentsCore';
import {
  COMMITMENTS_AI_NOTICE_KEY,
  hasSeenCommitmentsAiNotice,
  markCommitmentsAiNoticeSeen,
  resetCommitmentsAiNoticeForTests,
  useCommitmentsAiNotice,
  type CommitmentsNoticeStorage,
} from '../commitmentsNotice';
import { useSummaryCommitments } from '../useSummaryCommitments';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

const ID_A = 'a'.repeat(64);
const KEY = 'x_0123456789abcdef';
const KEY_2 = 'x_fedcba9876543210';
const TASK_ID = 'sm_0123456789abcdef0123456789abcdef';
const SECRET_TITLE = 'Bish: Provide APK access to Urpayroll';
const SECRET_QUOTE = 'Provide APK access/files to Urpayroll (owner: Bish)';
const USAGE = { used: 10, limit: 10, plan: 'free' as const, resetsAt: '2026-11-13T00:00:00.000Z', period: 'window' as const };

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
      meetingTitle: 'Urpayroll weekly sync',
      occurrenceDate: null,
      localDate: '2026-10-16',
      tier: 'vendor_verified',
      senderDomain: 'notetaker.example',
      forwardedBy: null,
    },
    truncated: false,
    meetingChanged: false,
    items: [item()],
    ...overrides,
  };
}

const READY = (op: 'get' | 'prepare' | 'decide', extra: Partial<SummaryCommitmentsResponse> = {}): SummaryCommitmentsResponse => ({
  op,
  state: 'ready',
  commitments: commitments(),
  ...extra,
});
const PREPARING = (op: 'get' | 'prepare'): SummaryCommitmentsResponse => ({ op, state: 'preparing', commitments: null });

function httpsError(code: string, details?: unknown): Error {
  return Object.assign(new Error('boom'), { code, ...(details !== undefined ? { details } : {}) });
}

type Handler = (request: Record<string, unknown>) => Promise<unknown> | unknown;

function makeService(handler: Handler, extra: { events?: ReturnType<typeof createEventBus<AppEventMap>> } = {}) {
  const calls: Record<string, unknown>[] = [];
  const transport: CommitmentsTransport = {
    async call(_name, request) {
      const body = request as Record<string, unknown>;
      calls.push(body);
      return handler(body);
    },
  };
  const service = createCommitmentsService({ getTransport: () => transport, timeZone: () => 'Europe/Madrid', language: () => 'en', events: extra.events });
  return { service, calls };
}

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

let warn: jest.SpyInstance;

beforeEach(async () => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetCommitmentsAiNoticeForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  expect(JSON.stringify(warn.mock.calls)).not.toContain('Urpayroll');
  jest.restoreAllMocks();
});

// ---- useSummaryCommitments -------------------------------------------------------------------------

describe('useSummaryCommitments', () => {
  it('asks nothing while not enabled (summaryStatus not enabled and allowed)', async () => {
    const { service, calls } = makeService(() => READY('get'));
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { enabled: false, service }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ state: 'idle', data: null, error: null, busy: null });
    expect(calls).toHaveLength(0);
    expect((await result.current.decide([{ anchorId: 'i_0123456789ab', decision: 'drop' }])).status).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('loads (loading, then the answer) and shows the cached answer at once next time', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, calls } = makeService(async () => {
      await gate;
      return READY('get');
    });
    const first = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    expect(first.result.current.state).toBe('loading');
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(first.result.current.state).toBe('ready'));
    expect(first.result.current.data?.items[0]?.title).toBe(SECRET_TITLE);
    await first.unmount();

    const second = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    expect(second.result.current.state).toBe('ready');
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('a first ask that fails is state error; refresh() retries and clears it', async () => {
    let fail = true;
    const { service } = makeService(() => {
      if (fail) throw httpsError('functions/unavailable', { reason: 'upstream_error' });
      return READY('get');
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error?.code).toBe('upstream_error');
    fail = false;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('a summaryCommitments that is not deployed reads as unavailable (not_enabled)', async () => {
    const { service } = makeService(() => {
      throw httpsError('functions/not-found');
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(isCommitmentsUnavailableError(result.current.error)).toBe(true);
  });

  it('polls get while another device prepares, and stops once the list is there', async () => {
    let gets = 0;
    const { service, calls } = makeService(() => {
      gets += 1;
      return gets < 3 ? PREPARING('get') : READY('get');
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service, pollMs: 20 }));
    await waitFor(() => expect(result.current.state).toBe('preparing'));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const settled = calls.length;
    expect(settled).toBe(3);
    await act(async () => {
      await sleep(100);
    });
    expect(calls).toHaveLength(settled);
    expect(result.current.error).toBeNull();
  });

  it('gives up after maxPolls with a "still preparing" timeout; refresh() starts again', async () => {
    const { service, calls } = makeService(() => PREPARING('get'));
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service, pollMs: 10, maxPolls: 3 }));
    await waitFor(() => expect(result.current.error?.details?.preparing).toBe(true));
    expect(result.current.error?.code).toBe('timeout');
    expect(result.current.state).toBe('preparing');
    expect(calls).toHaveLength(4);
    await act(async () => {
      await sleep(80);
    });
    expect(calls).toHaveLength(4);

    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(calls.length).toBeGreaterThan(5));
  });

  it('also says "still preparing" when the last poll failed on the way, so Try again shows', async () => {
    let gets = 0;
    const { service, calls } = makeService(() => {
      gets += 1;
      if (gets === 1) return PREPARING('get');
      throw httpsError('functions/deadline-exceeded');
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service, pollMs: 10, maxPolls: 3 }));
    await waitFor(() => expect(result.current.error?.details?.preparing).toBe(true));
    expect(result.current.state).toBe('preparing');
    expect(calls).toHaveLength(4);
    await act(async () => {
      await sleep(80);
    });
    expect(calls).toHaveLength(4);
  });

  it('keeps a not_found from the last poll (the screen goes back), never "still preparing"', async () => {
    let gets = 0;
    const { service } = makeService(() => {
      gets += 1;
      if (gets === 1) return PREPARING('get');
      throw httpsError('functions/not-found', { reason: 'not_found' });
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service, pollMs: 10, maxPolls: 1 }));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error?.details?.reason).toBe('not_found');
  });

  it('never asks again by itself after the cache was cleared ("Disconnect and delete"): it reads loading, the screen decides', async () => {
    const { service, calls } = makeService(() => READY('get'));
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await act(async () => {
      service.clearSessionCache();
    });
    await act(async () => {
      await sleep(50);
    });
    expect(result.current).toMatchObject({ state: 'loading', data: null, error: null });
    expect(calls).toHaveLength(1);
  });

  it('stops polling while the screen is blurred and asks once right away on focus', async () => {
    const nav = fakeNavigation();
    const { service, calls } = makeService(() => PREPARING('get'));
    await renderHook(() => useSummaryCommitments(ID_A, { service, pollMs: 40, maxPolls: 100 }), { wrapper: nav.wrapper });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await act(async () => {
      nav.setFocused(false);
    });
    const paused = calls.length;
    await act(async () => {
      await sleep(200);
    });
    expect(calls).toHaveLength(paused);
    await act(async () => {
      nav.setFocused(true);
    });
    await act(async () => {
      await sleep(15);
    });
    expect(calls).toHaveLength(paused + 1);
  });

  it('stops polling in the background and on unmount', async () => {
    const app = fakeAppState();
    const { service, calls } = makeService(() => PREPARING('get'));
    const hook = await renderHook(() => useSummaryCommitments(ID_A, { service, pollMs: 30, maxPolls: 100 }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await act(async () => {
      app.emit('background');
    });
    const paused = calls.length;
    await act(async () => {
      await sleep(150);
    });
    expect(calls).toHaveLength(paused);
    await act(async () => {
      app.emit('active');
    });
    await waitFor(() => expect(calls.length).toBeGreaterThan(paused));
    await hook.unmount();
    const atUnmount = calls.length;
    await act(async () => {
      await sleep(150);
    });
    expect(calls.length).toBeLessThanOrEqual(atUnmount + 1);
    const settled = calls.length;
    await act(async () => {
      await sleep(100);
    });
    expect(calls).toHaveLength(settled);
  });

  it('prepare resolves the answer (busy meanwhile); quota_exceeded resolves null with the allowance', async () => {
    let quota = false;
    let release: (() => void) | null = null;
    const { service } = makeService(async (request) => {
      if (request.op === 'get') return { op: 'get', state: 'none', commitments: null };
      if (quota) throw httpsError('functions/resource-exhausted', { reason: 'quota_exceeded', usage: USAGE });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return READY('prepare', { commitments: commitments({ mode: 'as_written' }) });
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.state).toBe('none'));

    let pending: Promise<SummaryCommitmentsResponse | null> | null = null;
    await act(async () => {
      pending = result.current.prepare('as_written');
      await Promise.resolve();
    });
    expect(result.current.busy).toBe('prepare');
    await act(async () => {
      release?.();
      await pending;
    });
    expect(result.current.busy).toBeNull();
    expect(result.current.state).toBe('ready');
    expect(result.current.data?.mode).toBe('as_written');

    quota = true;
    let answer: SummaryCommitmentsResponse | null = READY('prepare');
    await act(async () => {
      answer = await result.current.prepare('ai');
    });
    expect(answer).toBeNull();
    expect(result.current.error?.code).toBe('quota_exceeded');
    expect(result.current.usage).toEqual(USAGE);
    // The as-written list stays on screen.
    expect(result.current.state).toBe('ready');
  });

  it('decide resolves the results; "Added" comes from them only', async () => {
    const added = commitments({ items: [item({ status: 'accepted', taskId: TASK_ID, taskExists: true, via: 'app' })] });
    const { service, calls } = makeService((request) =>
      request.op === 'decide' ? READY('decide', { commitments: added, results: [{ anchorId: 'i_0123456789ab', outcome: 'added', taskId: TASK_ID }] }) : READY('get'),
    );
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    let outcome: Awaited<ReturnType<typeof result.current.decide>> | null = null;
    await act(async () => {
      outcome = await result.current.decide([
        {
          anchorId: 'i_0123456789ab',
          decision: 'accept',
          draft: { title: SECRET_TITLE, dueDate: '2026-11-13', dueTime: '09:00', reminderMinutesBefore: 0, owner: { name: 'Bish', isUser: false } },
        },
      ]);
    });
    expect(outcome).toMatchObject({ status: 'done', results: [{ anchorId: 'i_0123456789ab', outcome: 'added', taskId: TASK_ID }] });
    expect(calls[1]).toMatchObject({ op: 'decide', key: KEY, timezone: 'Europe/Madrid', language: 'en' });
    expect(result.current.data?.items[0]?.status).toBe('accepted');
  });

  it('a stale decide reloads silently: status stale, no error, the new list on screen', async () => {
    let reloaded = false;
    const { service } = makeService((request) => {
      if (request.op === 'decide') throw httpsError('functions/failed-precondition', { reason: 'stale' });
      if (reloaded) return READY('get', { commitments: commitments({ key: KEY_2 }) });
      reloaded = true;
      return READY('get');
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.data?.key).toBe(KEY));
    let outcome: Awaited<ReturnType<typeof result.current.decide>> | null = null;
    await act(async () => {
      outcome = await result.current.decide([{ anchorId: 'i_0123456789ab', decision: 'drop' }]);
    });
    expect(outcome).toEqual({ status: 'stale' });
    expect(result.current.error).toBeNull();
    expect(result.current.data?.key).toBe(KEY_2);
  });

  it('a failed decide resolves failed with the error (nothing is said to be added)', async () => {
    const { service } = makeService((request) => {
      if (request.op === 'decide') throw httpsError('functions/permission-denied', { reason: 'not_allowed' });
      return READY('get');
    });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    let outcome: Awaited<ReturnType<typeof result.current.decide>> | null = null;
    await act(async () => {
      outcome = await result.current.decide([{ anchorId: 'i_0123456789ab', decision: 'drop' }]);
    });
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(result.current.error?.code).toBe('permission_denied');
    expect(result.current.busy).toBeNull();
  });

  it('forgets everything on session end, and writes nothing to AsyncStorage', async () => {
    const events = createEventBus<AppEventMap>();
    const { service } = makeService(() => READY('get'), { events });
    const { result } = await renderHook(() => useSummaryCommitments(ID_A, { service }));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await act(async () => {
      events.emit('session:ended', { uid: 'u1', reason: 'sign_out' });
    });
    expect(result.current.data).toBeNull();
    expect(service.getKnown(ID_A)).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });
});

// ---- the AI notice flag ------------------------------------------------------------------------------

describe('the AI notice flag (decision 17)', () => {
  it('absent means not seen; marking it stores exactly one boolean key and nothing else', async () => {
    expect(await hasSeenCommitmentsAiNotice()).toBe(false);
    const { result } = await renderHook(() => useCommitmentsAiNotice());
    await waitFor(() => expect(result.current.seen).toBe(false));
    await act(async () => {
      await result.current.markSeen();
    });
    expect(result.current.seen).toBe(true);
    expect(await AsyncStorage.getAllKeys()).toEqual([COMMITMENTS_AI_NOTICE_KEY]);
    expect(await AsyncStorage.getItem(COMMITMENTS_AI_NOTICE_KEY)).toBe('1');

    // A new run reads it back from storage.
    resetCommitmentsAiNoticeForTests();
    expect(await hasSeenCommitmentsAiNotice()).toBe(true);
    const next = await renderHook(() => useCommitmentsAiNotice());
    await waitFor(() => expect(next.result.current.seen).toBe(true));
  });

  it('an unreadable flag reads as not seen, and a failed write never throws (seen for the rest of the run)', async () => {
    const broken: CommitmentsNoticeStorage = {
      getItem: () => Promise.reject(new Error('storage broken')),
      setItem: () => Promise.reject(new Error('storage broken')),
    };
    expect(await hasSeenCommitmentsAiNotice(broken)).toBe(false);
    await expect(markCommitmentsAiNoticeSeen(broken)).resolves.toBeUndefined();
    expect(await hasSeenCommitmentsAiNotice(broken)).toBe(true);
    const odd: CommitmentsNoticeStorage = { getItem: async () => 'yes please', setItem: async () => undefined };
    resetCommitmentsAiNoticeForTests();
    expect(await hasSeenCommitmentsAiNotice(odd)).toBe(false);
  });
});
