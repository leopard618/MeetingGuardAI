import { AI_LIMITS, type AiAction } from '../../../core/aiContract';
import type { ProposedActionState } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { createAction, deleteAction, listAction, shareAction, usage } from '../__fixtures__/aiTestKit';
import {
  MAX_REQUEST_MESSAGES,
  MAX_STORED_MESSAGES,
  assignActionIds,
  buildRequestMessages,
  createEmptyThread,
  detectFailedRequest,
  reviveThread,
  selectPendingActionIds,
  threadReducer,
  trimThread,
} from '../conversation';
import { deserializeThread, serializeThread } from '../threadStore';
import type { ChatMessage, ThreadState } from '../types';

function message(id: string, role: 'user' | 'assistant', content = `text ${id}`, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, createdAt: '2030-03-10T09:00:00.000Z', actionIds: [], suggestions: [], ...extra };
}

function proposed(action: ProposedActionState['action']): ProposedActionState {
  return { action, status: 'proposed', preview: null, result: null };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('trimming', () => {
  it('keeps the newest 30 messages and drops actions of removed messages', () => {
    const messages = Array.from({ length: 35 }, (_, i) => message(`m${i}`, i % 2 === 0 ? 'user' : 'assistant'));
    const oldAction = createAction('m1-1');
    const newAction = createAction('m33-1');
    messages[1] = { ...messages[1]!, actionIds: [oldAction.id] };
    messages[33] = { ...messages[33]!, actionIds: [newAction.id] };
    const thread: ThreadState = {
      ...createEmptyThread(),
      messages,
      actions: { [oldAction.id]: proposed(oldAction), [newAction.id]: proposed(newAction) },
    };

    const trimmed = trimThread(thread);

    expect(MAX_STORED_MESSAGES).toBe(30);
    expect(trimmed.messages).toHaveLength(30);
    expect(trimmed.messages[0]?.id).toBe('m5');
    expect(Object.keys(trimmed.actions)).toEqual([newAction.id]);
  });

  it('keeps an action that is still executing even if its message was trimmed', () => {
    const messages = Array.from({ length: 31 }, (_, i) => message(`m${i}`, 'user'));
    const running = createAction('m0-1');
    messages[0] = { ...messages[0]!, actionIds: [running.id] };
    const thread: ThreadState = { ...createEmptyThread(), messages, actions: { [running.id]: { ...proposed(running), status: 'executing' } } };
    expect(Object.keys(trimThread(thread).actions)).toEqual([running.id]);
  });

  it('sends only the newest 12 non-empty messages with capped content', () => {
    const messages = Array.from({ length: 20 }, (_, i) => message(`m${i}`, i % 2 === 0 ? 'user' : 'assistant'));
    messages[18] = message('empty', 'assistant', '   ');
    messages[19] = message('long', 'user', 'x'.repeat(AI_LIMITS.maxMessageChars + 50));

    const window = buildRequestMessages(messages);

    expect(MAX_REQUEST_MESSAGES).toBe(12);
    expect(window).toHaveLength(12);
    expect(window.some((m) => m.content.trim() === '')).toBe(false);
    expect(window[window.length - 1]).toEqual({ role: 'user', content: 'x'.repeat(AI_LIMITS.maxMessageChars) });
  });

  it('re-keys server action ids to be unique in the thread', () => {
    const ids = assignActionIds('a_xyz', [createAction('act_1'), deleteAction('act_1', 'm1')]).map((a) => a.id);
    expect(ids).toEqual(['a_xyz-1', 'a_xyz-2']);
  });

  describe('v6 same-turn meeting links', () => {
    function taskAction(id: string, meetingActionId: string | null): AiAction {
      return {
        type: 'create_task',
        id,
        summary: 'Add a task.',
        confidence: 90,
        task: {
          title: 'Prepare the proposal',
          description: '',
          dueDate: null,
          dueTime: null,
          reminderMinutesBefore: null,
          meetingId: null,
          meetingActionId,
          people: [],
        },
      };
    }

    it('remaps the link onto the re-keyed sibling, so it is never a dangling server id', () => {
      const [meeting, task] = assignActionIds('a_xyz', [createAction('act_1'), taskAction('act_2', 'act_1')]);
      expect(meeting?.id).toBe('a_xyz-1');
      expect(task?.type === 'create_task' && task.task.meetingActionId).toBe('a_xyz-1');
    });

    it('nulls a link that points outside this response', () => {
      const [, task] = assignActionIds('a_xyz', [createAction('act_1'), taskAction('act_2', 'act_99')]);
      expect(task?.type === 'create_task' && task.task.meetingActionId).toBeNull();
    });

    it('leaves a task without a link untouched', () => {
      const [task] = assignActionIds('a_xyz', [taskAction('act_1', null)]);
      expect(task?.type === 'create_task' && task.task.meetingActionId).toBeNull();
    });
  });
});

describe('threadReducer', () => {
  it('tracks delivery of a user message through a failed and a retried request', () => {
    let thread = threadReducer(createEmptyThread(), { type: 'user_message', message: message('u1', 'user') });
    thread = threadReducer(thread, { type: 'request_started', userMessageId: 'u1' });
    expect(thread.messages[0]?.delivery).toBe('sending');

    thread = threadReducer(thread, { type: 'request_failed', userMessageId: 'u1', usage: usage({ used: 5 }) });
    expect(thread.messages[0]?.delivery).toBe('failed');
    expect(thread.usage?.used).toBe(5);
    expect(detectFailedRequest(thread)).toEqual({ mode: 'chat' });

    const action = createAction('a1-1');
    thread = threadReducer(thread, {
      type: 'request_succeeded',
      userMessageId: 'u1',
      reply: message('a1', 'assistant', 'Here you go'),
      actions: [action],
      usage: usage({ used: 2 }),
      followUpMeetingId: null,
    });
    expect(thread.messages[0]?.delivery).toBeUndefined();
    expect(thread.messages[1]?.actionIds).toEqual(['a1-1']);
    expect(thread.actions['a1-1']?.status).toBe('proposed');
    expect(detectFailedRequest(thread)).toBeNull();
  });

  it('remembers follow-ups and keeps them (and usage) on reset', () => {
    let thread = threadReducer(createEmptyThread(), {
      type: 'request_succeeded',
      userMessageId: null,
      reply: message('a1', 'assistant'),
      actions: [],
      usage: usage(),
      followUpMeetingId: 'meeting_9',
    });
    expect(thread.followUpsRequested).toEqual(['meeting_9']);
    thread = threadReducer(thread, { type: 'reset' });
    expect(thread.messages).toEqual([]);
    expect(thread.followUpsRequested).toEqual(['meeting_9']);
    expect(thread.usage).not.toBeNull();
  });

  it('moves actions through executing, done, failed, rejected; a cancelled run stays proposed', () => {
    const action = shareAction('a1-1', 'm1');
    const start: ThreadState = { ...createEmptyThread(), messages: [message('a1', 'assistant', 'x', { actionIds: [action.id] })], actions: { [action.id]: proposed(action) } };

    let thread = threadReducer(start, { type: 'execute_started', actionId: action.id });
    expect(thread.actions[action.id]?.status).toBe('executing');

    thread = threadReducer(thread, {
      type: 'execute_finished',
      actionId: action.id,
      result: { status: 'failed', actionId: action.id, type: action.type, error: new AppError('cancelled') },
    });
    expect(thread.actions[action.id]).toMatchObject({ status: 'proposed', result: null });

    thread = threadReducer(thread, {
      type: 'execute_finished',
      actionId: action.id,
      result: { status: 'failed', actionId: action.id, type: action.type, error: new AppError('offline') },
    });
    expect(thread.actions[action.id]?.status).toBe('failed');

    thread = threadReducer(thread, { type: 'rejected', actionId: action.id });
    expect(thread.actions[action.id]?.status).toBe('rejected');
  });

  it('lists pending mutating actions in conversation order (list actions excluded)', () => {
    const a = createAction('a1-1');
    const b = listAction('a1-2', ['m1']);
    const c = deleteAction('a2-1', 'm1');
    const thread: ThreadState = {
      ...createEmptyThread(),
      messages: [message('a1', 'assistant', 'x', { actionIds: [a.id, b.id] }), message('a2', 'assistant', 'y', { actionIds: [c.id] })],
      actions: { [c.id]: proposed(c), [a.id]: proposed(a), [b.id]: proposed(b) },
    };
    expect(selectPendingActionIds(thread)).toEqual(['a1-1', 'a2-1']);
  });

  it('revives interrupted requests and executions after a restart', () => {
    const action = createAction('a1-1');
    const revived = reviveThread({
      ...createEmptyThread(),
      messages: [message('a1', 'assistant', 'x', { actionIds: [action.id] }), message('u2', 'user', 'y', { delivery: 'sending' })],
      actions: { [action.id]: { ...proposed(action), status: 'executing' } },
    });
    expect(revived.messages[1]?.delivery).toBe('failed');
    expect(revived.actions[action.id]?.status).toBe('proposed');
  });
});

describe('thread persistence', () => {
  it('round-trips messages, actions, results (AppError revived) and usage; previews are not stored', () => {
    const create = createAction('a1-1');
    const del = deleteAction('a1-2', 'm1');
    const thread: ThreadState = {
      messages: [message('u1', 'user'), message('a1', 'assistant', 'ok', { actionIds: [create.id, del.id], suggestions: ['More'] })],
      actions: {
        [create.id]: {
          action: create,
          status: 'done',
          preview: { action: create, meetings: [], missingMeetingIds: [], warnings: [] },
          result: { status: 'done', actionId: create.id, type: 'create_meeting', meetingIds: ['ai_x'], duplicate: false, meetLinkCreated: false },
        },
        [del.id]: {
          action: del,
          status: 'failed',
          preview: null,
          result: { status: 'failed', actionId: del.id, type: 'delete_meeting', error: new AppError('offline', 'x') },
        },
      },
      usage: usage(),
      followUpsRequested: ['m9'],
    };

    const restored = deserializeThread(serializeThread(thread));

    expect(restored.messages).toEqual(thread.messages);
    expect(restored.actions[create.id]).toMatchObject({ status: 'done', preview: null });
    const failed = restored.actions[del.id]?.result;
    expect(failed?.status === 'failed' && failed.error).toBeInstanceOf(AppError);
    expect(failed?.status === 'failed' && failed.error.code).toBe('offline');
    expect(restored.usage).toEqual(usage());
    expect(restored.followUpsRequested).toEqual(['m9']);
  });

  it('starts fresh for corrupt data and drops invalid entries individually', () => {
    expect(deserializeThread('{not json')).toEqual(createEmptyThread());
    expect(deserializeThread(JSON.stringify({ v: 99 }))).toEqual(createEmptyThread());

    const good = createAction('a1-1');
    const raw = JSON.stringify({
      v: 1,
      messages: [message('a1', 'assistant', 'x', { actionIds: [good.id, 'a1-2'] }), { id: 5 }],
      actions: {
        [good.id]: { action: good, status: 'proposed', result: null },
        'a1-2': { action: { type: 'nope' }, status: 'proposed', result: null },
      },
      usage: 'garbage',
      followUpsRequested: [],
    });
    const restored = deserializeThread(raw);
    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0]?.actionIds).toEqual([good.id]);
    expect(Object.keys(restored.actions)).toEqual([good.id]);
    expect(restored.usage).toBeNull();
  });
});
