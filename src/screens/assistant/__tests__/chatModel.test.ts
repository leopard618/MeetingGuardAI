import type { ActionResult, ProposedActionState } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { createAction, createTestFormatter, deleteAction } from '../../../services/ai/__fixtures__/aiTestKit';
import type { ChatMessage } from '../../../services/ai/types';
import {
  canStartFollowUp,
  chatErrorDescription,
  messageTime,
  parseChatParams,
  reviewableStates,
  sendableText,
  confirmInOrder,
  summarizeResults,
  visibleSuggestions,
} from '../chatModel';

const fmt = createTestFormatter();
const NOW = new Date('2030-03-10T10:00:00.000Z');

function message(id: string, role: 'user' | 'assistant', extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content: 'text', createdAt: '2030-03-10T09:15:00.000Z', actionIds: [], suggestions: [], ...extra };
}

function done(actionId: string): ActionResult {
  return { status: 'done', actionId, type: 'create_meeting', meetingIds: ['m1'], duplicate: false };
}

function failed(actionId: string, code: 'cancelled' | 'offline'): ActionResult {
  return { status: 'failed', actionId, type: 'share_meeting', error: new AppError(code) } as ActionResult;
}

describe('parseChatParams', () => {
  it('reads the follow-up meeting, the prefill and the notification-only autoStart flag', () => {
    expect(parseChatParams({ followup: 'm1', prefill: 'Hi', autoStart: true })).toEqual({
      followUpMeetingId: 'm1',
      prefill: 'Hi',
      autoStartFollowUp: true,
    });
  });

  it('treats missing or blank values as absent', () => {
    expect(parseChatParams(undefined)).toEqual({ followUpMeetingId: null, prefill: '', autoStartFollowUp: false });
    expect(parseChatParams({ followup: '  ' })).toEqual({ followUpMeetingId: null, prefill: '', autoStartFollowUp: false });
  });
});

describe('messageTime', () => {
  it('never throws for an unusable timestamp', () => {
    const throwing = { ...fmt, time: () => { throw new Error('bad'); } };
    expect(messageTime(throwing, 'x')).toBe('');
    expect(messageTime(fmt, '2030-03-10T09:15:00.000Z')).toBe('09:15');
  });
});

describe('chatErrorDescription', () => {
  it('describes the request error first', () => {
    const description = chatErrorDescription(fmt, { error: new AppError('offline'), messages: [], canRetry: true }, NOW);
    expect(description).toEqual({ message: expect.stringContaining('offline'), recovery: 'retry' });
  });

  it('says the last message was not sent when it failed and can be retried', () => {
    const messages = [message('u1', 'user', { delivery: 'failed' })];
    expect(chatErrorDescription(fmt, { error: null, messages, canRetry: true }, NOW)).toEqual({
      message: "Your last message wasn't sent.",
      recovery: 'retry',
    });
    expect(chatErrorDescription(fmt, { error: null, messages, canRetry: false }, NOW)).toBeNull();
    expect(chatErrorDescription(fmt, { error: null, messages: [message('a1', 'assistant')], canRetry: true }, NOW)).toBeNull();
  });
});

describe('visibleSuggestions', () => {
  it('shows the chips of the latest assistant reply only while idle', () => {
    const messages = [message('a1', 'assistant', { suggestions: ['One', 'Two'] })];
    expect(visibleSuggestions(messages, false)).toEqual(['One', 'Two']);
    expect(visibleSuggestions(messages, true)).toEqual([]);
    expect(visibleSuggestions([...messages, message('u2', 'user')], false)).toEqual([]);
    expect(visibleSuggestions([], false)).toEqual([]);
  });
});

describe('canStartFollowUp', () => {
  const base = { followUpMeetingId: 'm1', autoStartFollowUp: false, isLoaded: true, isSending: false, followUpsRequested: [] };

  it('offers the button for an external follow-up link that was not requested yet', () => {
    expect(canStartFollowUp(base)).toBe(true);
  });

  it('hides it when auto-started, busy, not loaded, already requested or not in follow-up mode', () => {
    expect(canStartFollowUp({ ...base, autoStartFollowUp: true })).toBe(false);
    expect(canStartFollowUp({ ...base, isSending: true })).toBe(false);
    expect(canStartFollowUp({ ...base, isLoaded: false })).toBe(false);
    expect(canStartFollowUp({ ...base, followUpsRequested: ['m1'] })).toBe(false);
    expect(canStartFollowUp({ ...base, followUpMeetingId: null })).toBe(false);
    expect(canStartFollowUp({ ...base, followUpsRequested: undefined })).toBe(true);
  });
});

describe('reviewableStates', () => {
  it('keeps the proposed and failed actions under review, in order', () => {
    const a = createAction('a');
    const b = deleteAction('b', 'm1');
    const c = createAction('c');
    const actions: Record<string, ProposedActionState> = {
      a: { action: a, status: 'proposed', preview: null, result: null },
      b: { action: b, status: 'failed', preview: null, result: null },
      c: { action: c, status: 'done', preview: null, result: null },
    };
    expect(reviewableStates(['b', 'a', 'c', 'missing'], actions).map((state) => state.action.id)).toEqual(['b', 'a']);
    expect(reviewableStates(null, actions)).toEqual([]);
  });
});

describe('summarizeResults', () => {
  it('describes a single result as is', () => {
    expect(summarizeResults(fmt, [done('a')])).toEqual({ tone: 'success', message: 'Meeting created.' });
  });

  it('does not report a cancelled share', () => {
    expect(summarizeResults(fmt, [failed('a', 'cancelled')])).toBeNull();
    expect(summarizeResults(fmt, [failed('a', 'cancelled'), done('b')])).toEqual({ tone: 'success', message: 'Meeting created.' });
  });

  it('summarizes several results', () => {
    expect(summarizeResults(fmt, [done('a'), done('b')])).toEqual({ tone: 'success', message: 'All 2 actions completed.' });
    expect(summarizeResults(fmt, [done('a'), failed('b', 'offline')])).toEqual({
      tone: 'warning',
      message: '1 of 2 actions completed. Check the ones that failed.',
    });
  });
});

describe('sendableText', () => {
  it('sends trimmed, non-empty text only while idle and loaded', () => {
    expect(sendableText('  hi  ', { isSending: false, isLoaded: true })).toBe('hi');
    expect(sendableText('   ', { isSending: false, isLoaded: true })).toBeNull();
    expect(sendableText('hi', { isSending: true, isLoaded: true })).toBeNull();
    expect(sendableText('hi', { isSending: false, isLoaded: false })).toBeNull();
  });
});

describe('confirmInOrder', () => {
  it('runs the actions in order and turns a rejection into a failed result', async () => {
    const order: string[] = [];
    const confirm = jest.fn(async (id: string): Promise<ActionResult> => {
      order.push(id);
      if (id === 'b') throw new AppError('not_found', 'action no longer in the thread');
      return { status: 'done', actionId: id, type: 'create_meeting', meetingIds: ['m1'], duplicate: false };
    });
    const results = await confirmInOrder(
      [
        { id: 'a', type: 'create_meeting' },
        { id: 'b', type: 'share_meeting' },
        { id: 'c', type: 'create_meeting' },
      ],
      confirm,
    );
    expect(order).toEqual(['a', 'b', 'c']);
    expect(results.map((result) => result.status)).toEqual(['done', 'failed', 'done']);
    const failed = results[1];
    expect(failed).toMatchObject({ status: 'failed', actionId: 'b', type: 'share_meeting' });
    expect(failed?.status === 'failed' ? failed.error.code : null).toBe('not_found');
  });
});
