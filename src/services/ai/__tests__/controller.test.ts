import type { AiAction, AssistantRequest, AssistantResponse } from '../../../core/aiContract';
import type { ActionResult, AssistantClient } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { USER_STORAGE, userStorageKey } from '../../../core/identifiers';
import {
  UID,
  createAction,
  deleteAction,
  listAction,
  memoryStorage,
  response,
  shareAction,
  usage,
} from '../__fixtures__/aiTestKit';
import type { AiActionExecutor } from '../actionExecutor';
import { createAssistantController, type SessionSource } from '../controller';
import { createThreadStore } from '../threadStore';
import type { AiActionPreview } from '../types';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeSession(initialUid: string | null = UID): SessionSource & { emit(uid: string | null): void } {
  let listener: ((uid: string | null) => void) | null = null;
  return {
    getActiveUid: () => initialUid,
    subscribe(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    emit(uid) {
      listener?.(uid);
    },
  };
}

function setup(options: { replies?: (AssistantResponse | Error | Deferred<AssistantResponse>)[]; initialUid?: string | null } = {}) {
  const replies = [...(options.replies ?? [])];
  const requests: AssistantRequest[] = [];
  const client: AssistantClient = {
    send: jest.fn(async (request: AssistantRequest) => {
      requests.push(request);
      const next = replies.shift() ?? response();
      if (next instanceof Error) throw next;
      if ('promise' in next) return next.promise;
      return next;
    }),
  };
  const executor: Pick<AiActionExecutor, 'preview' | 'execute'> & { execute: jest.Mock; preview: jest.Mock } = {
    preview: jest.fn(
      async (action: AiAction): Promise<AiActionPreview> => ({
        action,
        meetings: [],
        missingMeetingIds: [],
        warnings: [],
        overlapping: [],
        calendarConnected: null,
      }),
    ),
    execute: jest.fn(
      async (action: AiAction): Promise<ActionResult> => ({
        status: 'done',
        actionId: action.id,
        type: action.type,
        meetingIds: ['m1'],
        duplicate: false,
      }),
    ),
  };
  const storage = memoryStorage();
  const store = createThreadStore(storage);
  const session = fakeSession(options.initialUid === undefined ? UID : options.initialUid);
  const controller = createAssistantController({
    client,
    executor,
    store,
    session,
    getContext: () => ({ language: 'es', timezone: 'Europe/Madrid', now: new Date('2030-03-10T09:00:00.000Z') }),
  });
  return { controller, client, executor, storage, store, session, requests };
}

const threadKey = userStorageKey(UID, USER_STORAGE.assistantThread);

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('assistant controller', () => {
  it('loads the thread for the active user and sends chat requests with context', async () => {
    const { controller, requests } = setup({ replies: [response({ reply: 'Claro', suggestions: ['Añade un enlace'] })] });
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ uid: UID, isLoaded: true });

    await controller.send('  Programa una reunión mañana  ');

    expect(requests[0]).toMatchObject({
      messages: [{ role: 'user', content: 'Programa una reunión mañana' }],
      language: 'es',
      timezone: 'Europe/Madrid',
      mode: 'chat',
      followUpMeetingId: null,
      nowIso: '2030-03-10T09:00:00.000Z',
    });
    const { thread, isSending, error } = controller.getSnapshot();
    expect(isSending).toBe(false);
    expect(error).toBeNull();
    expect(thread.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Programa una reunión mañana'],
      ['assistant', 'Claro'],
    ]);
    expect(thread.messages[1]?.suggestions).toEqual(['Añade un enlace']);
  });

  it('waits for the stored thread before sending a message typed during the load', async () => {
    const { controller, requests } = setup();
    expect(controller.getSnapshot().isLoaded).toBe(false);
    await controller.send('Early message');
    expect(requests).toHaveLength(1);
    expect(controller.getSnapshot().thread.messages[0]?.content).toBe('Early message');
  });

  it('re-keys proposed actions, previews them and persists the thread', async () => {
    const { controller, executor, storage } = setup({ replies: [response({}, [createAction('act_1'), deleteAction('act_1', 'm1')])] });
    await flush();

    await controller.send('Do things');
    await flush();

    const { thread } = controller.getSnapshot();
    const reply = thread.messages[1]!;
    expect(reply.actionIds).toEqual([`${reply.id}-1`, `${reply.id}-2`]);
    expect(executor.preview).toHaveBeenCalledTimes(2);
    expect(thread.actions[`${reply.id}-1`]?.preview).not.toBeNull();
    const stored = JSON.parse(storage.data.get(threadKey) ?? '{}');
    expect(stored.messages).toHaveLength(2);
  });

  it('sends only the newest 12 messages', async () => {
    const { controller, requests } = setup();
    await flush();
    for (let i = 0; i < 8; i += 1) await controller.send(`message ${i}`);
    expect(controller.getSnapshot().thread.messages).toHaveLength(16);
    expect(requests[requests.length - 1]?.messages).toHaveLength(12);
    expect(requests[requests.length - 1]?.messages.at(-1)).toEqual({ role: 'user', content: 'message 7' });
  });

  it('keeps a failed message, shows the error and retries it', async () => {
    const { controller, client } = setup({ replies: [new AppError('offline'), response({ reply: 'Back online' })] });
    await flush();

    await controller.send('Hello');
    let snapshot = controller.getSnapshot();
    expect(snapshot.error?.code).toBe('offline');
    expect(snapshot.failedRequest).toEqual({ mode: 'chat' });
    expect(snapshot.thread.messages[0]?.delivery).toBe('failed');

    await controller.retry();
    snapshot = controller.getSnapshot();
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(snapshot.error).toBeNull();
    expect(snapshot.thread.messages.map((m) => m.delivery)).toEqual([undefined, undefined]);
    expect(snapshot.thread.messages[1]?.content).toBe('Back online');
  });

  it('records the usage carried by a quota error', async () => {
    const quota = usage({ used: 5, limit: 5 });
    const { controller } = setup({
      replies: [new AppError('quota_exceeded', 'limit', { details: { reason: 'quota_exceeded', usage: quota } })],
    });
    await flush();
    await controller.send('Hi');
    expect(controller.getSnapshot().thread.usage).toEqual(quota);
  });

  it('requests a meeting follow-up once, even when opened again', async () => {
    const { controller, requests } = setup({ replies: [response({ reply: 'How did it go?' })] });
    // Requested before the thread finished loading: runs after the load.
    const first = controller.startFollowUp('meeting_7');
    await first;
    await flush();
    await controller.startFollowUp('meeting_7');
    await controller.startFollowUp('meeting_7');

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ mode: 'followup', followUpMeetingId: 'meeting_7', messages: [] });
    const { thread } = controller.getSnapshot();
    expect(thread.followUpsRequested).toEqual(['meeting_7']);
    expect(thread.messages[0]).toMatchObject({ role: 'assistant', followUpMeetingId: 'meeting_7' });
  });

  it('retries a failed follow-up', async () => {
    const { controller, requests } = setup({ replies: [new AppError('timeout'), response()] });
    await flush();
    await controller.startFollowUp('meeting_7');
    expect(controller.getSnapshot().failedRequest).toEqual({ mode: 'followup', meetingId: 'meeting_7' });
    await controller.retry();
    expect(requests.map((r) => r.mode)).toEqual(['followup', 'followup']);
    expect(controller.getSnapshot().thread.followUpsRequested).toEqual(['meeting_7']);
  });

  it('executes a confirmed action once, even on double confirm', async () => {
    const { controller, executor } = setup({ replies: [response({}, [createAction('act_1')])] });
    await flush();
    await controller.send('Create it');
    const actionId = controller.getSnapshot().thread.messages[1]!.actionIds[0]!;

    const [a, b] = await Promise.all([controller.confirm(actionId), controller.confirm(actionId)]);
    const c = await controller.confirm(actionId);

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toEqual(a);
    expect(controller.getSnapshot().thread.actions[actionId]?.status).toBe('done');
  });

  it('confirm all runs the pending mutating actions in order and skips rejected ones', async () => {
    const actions = [createAction('x'), listAction('y', ['m1']), shareAction('z', 'm1'), deleteAction('w', 'm1')];
    const { controller, executor } = setup({ replies: [response({}, actions)] });
    await flush();
    await controller.send('All of it');
    const ids = controller.getSnapshot().thread.messages[1]!.actionIds;
    controller.reject(ids[3]!);

    const results = await controller.confirmAll();

    expect(results).toHaveLength(2);
    expect(executor.execute.mock.calls.map(([action]) => (action as AiAction).type)).toEqual(['create_meeting', 'share_meeting']);
    expect(controller.getSnapshot().thread.actions[ids[3]!]?.status).toBe('rejected');
  });

  it('puts an action back to proposed when the user cancels the share sheet', async () => {
    const { controller, executor } = setup({ replies: [response({}, [shareAction('s', 'm1')])] });
    await flush();
    await controller.send('Share');
    const actionId = controller.getSnapshot().thread.messages[1]!.actionIds[0]!;
    executor.execute.mockResolvedValueOnce({ status: 'failed', actionId, type: 'share_meeting', error: new AppError('cancelled') });

    await controller.confirm(actionId);

    expect(controller.getSnapshot().thread.actions[actionId]).toMatchObject({ status: 'proposed', result: null });
  });

  it('drops a reply that arrives after the conversation was reset', async () => {
    const pending = deferred<AssistantResponse>();
    const { controller } = setup({ replies: [pending] });
    await flush();

    const sending = controller.send('Slow question');
    await flush();
    await controller.reset();
    pending.resolve(response({ reply: 'Late answer' }));
    await sending;

    expect(controller.getSnapshot().thread.messages).toEqual([]);
    expect(controller.getSnapshot().isSending).toBe(false);
  });

  it('clears memory and the stored thread when the session ends, and loads the next user', async () => {
    const { controller, session, storage } = setup();
    await flush();
    await controller.send('Private question');
    await flush();
    expect(storage.data.has(threadKey)).toBe(true);

    session.emit(null);
    await flush();
    await flush();

    expect(controller.getSnapshot()).toMatchObject({ uid: null, isLoaded: false });
    expect(controller.getSnapshot().thread.messages).toEqual([]);
    expect(storage.data.has(threadKey)).toBe(false);

    session.emit('user_2');
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ uid: 'user_2', isLoaded: true });
  });

  it('restores a persisted thread with a failed last message as retryable', async () => {
    const { controller, store } = setup({ initialUid: null });
    await store.save(UID, {
      messages: [{ id: 'u1', role: 'user', content: 'Hi', createdAt: '2030-03-10T09:00:00.000Z', actionIds: [], suggestions: [], delivery: 'sending' }],
      actions: {},
      usage: null,
      followUpsRequested: [],
    });

    await controller.setUid(UID);

    const snapshot = controller.getSnapshot();
    expect(snapshot.thread.messages[0]?.delivery).toBe('failed');
    expect(snapshot.failedRequest).toEqual({ mode: 'chat' });
  });

  it('refuses to send without a session', async () => {
    const { controller, client } = setup({ initialUid: null });
    await controller.send('Hello');
    expect(controller.getSnapshot().error?.code).toBe('unauthenticated');
    expect(client.send).not.toHaveBeenCalled();
  });
});
