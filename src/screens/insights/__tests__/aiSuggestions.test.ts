import type { AssistantChatMessage } from '../../../core/contracts';
import { suggestionState, type SuggestionRequest } from '../aiSuggestions';
import { barFraction } from '../meetingInsights';

function message(id: string, role: 'user' | 'assistant', content: string, extra: Partial<AssistantChatMessage> & { delivery?: 'sending' | 'failed' } = {}) {
  return { id, role, content, createdAt: '2026-09-30T10:00:00.000Z', actionIds: [], suggestions: [], ...extra };
}

const OLD = [message('u_0', 'user', 'Review my week'), message('a_0', 'assistant', 'Old reply')];
const REQUEST: SuggestionRequest = { prompt: 'Review my week', beforeIds: new Set(['u_0', 'a_0']) };

describe('suggestionState', () => {
  it('is idle without a request', () => {
    expect(suggestionState(OLD, null, { isSending: false, settled: true })).toEqual({ status: 'idle', reply: null });
  });

  it('ignores older identical questions and waits for the new reply', () => {
    const messages = [...OLD, message('u_1', 'user', 'Review my week', { delivery: 'sending' })];
    expect(suggestionState(messages, REQUEST, { isSending: true, settled: false }).status).toBe('sending');
  });

  it('returns the first new assistant reply after the question', () => {
    const messages = [...OLD, message('u_1', 'user', 'Review my week'), message('a_1', 'assistant', 'New reply', { actionIds: ['x'] })];
    const state = suggestionState(messages, REQUEST, { isSending: false, settled: true });
    expect(state.status).toBe('done');
    expect(state.reply?.content).toBe('New reply');
  });

  it('fails when the question failed, or when the request ended without a reply', () => {
    const failed = [...OLD, message('u_1', 'user', 'Review my week', { delivery: 'failed' })];
    expect(suggestionState(failed, REQUEST, { isSending: false, settled: true }).status).toBe('failed');
    expect(suggestionState(OLD, REQUEST, { isSending: false, settled: true }).status).toBe('failed');
    expect(suggestionState(OLD, REQUEST, { isSending: false, settled: false }).status).toBe('sending');
  });
});

describe('barFraction', () => {
  it('scales by minutes, or by count when no day has meeting time', () => {
    const days = [
      { key: 'a', date: null, weekday: 1, count: 1, minutes: 30 },
      { key: 'b', date: null, weekday: 2, count: 3, minutes: 120 },
      { key: 'c', date: null, weekday: 3, count: 0, minutes: 0 },
    ];
    expect(days.map((day) => barFraction(day, days))).toEqual([0.25, 1, 0]);
    const allDayOnly = [
      { key: 'a', date: null, weekday: 1, count: 1, minutes: 0 },
      { key: 'b', date: null, weekday: 2, count: 2, minutes: 0 },
    ];
    expect(allDayOnly.map((day) => barFraction(day, allDayOnly))).toEqual([0.5, 1]);
  });
});
