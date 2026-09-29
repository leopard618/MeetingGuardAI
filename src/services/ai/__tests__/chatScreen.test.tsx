import { fireEvent, render, screen, within } from '@testing-library/react-native';
import React from 'react';

import type { ActionResult, ProposedActionState } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import MeetingConfirmationModal from '../../../components/MeetingConfirmationModal';
import AIChat from '../../../pages/AIChat';
import { createAction, deleteAction, makeMeeting, shareAction, updateAction, usage } from '../__fixtures__/aiTestKit';
import type { AiActionPreview, AssistantHookResult, ChatMessage } from '../types';

jest.mock('../../../i18n', () => {
  const { createTranslator } = jest.requireActual('../__fixtures__/aiTestKit');
  const t = createTranslator('en');
  return {
    t,
    useT: () => t,
    getLanguage: () => 'en',
    useLanguage: () => ({ language: 'en', setLanguage: jest.fn(), supportedLanguages: ['en', 'es'] }),
  };
});

jest.mock('../../../utils/format', () => ({
  formatMeetingTimeRange: (m: { startAt: string; durationMinutes: number }) => `${m.startAt.slice(0, 16)}+${m.durationMinutes}m`,
  formatDuration: (minutes: number) => `${minutes} min`,
  formatDateTime: (value: string) => value.slice(0, 16),
  formatTime: (value: string) => value.slice(11, 16),
  formatRelative: (value: string) => `at ${value}`,
  formatDate: (value: string) => value.slice(0, 10),
  uses24HourClock: () => true,
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleTheme: jest.fn() }),
}));

jest.mock('../../data', () => ({
  useEntitlement: jest.fn(() => ({ plan: 'free', isLoaded: true, entitlement: { plan: 'free' } })),
  useMeeting: jest.fn(() => ({ meeting: null, isLoading: false, error: null })),
}));

jest.mock('..', () => ({ useAssistant: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAssistant } = require('..') as { useAssistant: jest.Mock };

function assistantState(overrides: Partial<AssistantHookResult> = {}): AssistantHookResult {
  return {
    messages: [],
    actions: {},
    isSending: false,
    error: null,
    usage: null,
    isLoaded: true,
    canRetry: false,
    pendingActionIds: [],
    followUpInFlight: null,
    followUpsRequested: [],
    send: jest.fn(async () => undefined),
    startFollowUp: jest.fn(async () => undefined),
    confirm: jest.fn(
      async (actionId: string): Promise<ActionResult> => ({
        status: 'done',
        actionId,
        type: 'update_meeting',
        meetingIds: ['m1'],
        duplicate: false,
      }),
    ),
    confirmAll: jest.fn(async () => []),
    reject: jest.fn(),
    retry: jest.fn(async () => undefined),
    reset: jest.fn(async () => undefined),
    ...overrides,
  };
}

function chatMessage(id: string, role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, createdAt: '2030-03-10T09:15:00.000Z', actionIds: [], suggestions: [], ...extra };
}

function previewFor(state: ProposedActionState['action'], meetings = [makeMeeting('m1', { title: 'Weekly sync' })]): AiActionPreview {
  return { action: state, meetings, missingMeetingIds: [], warnings: [], overlapping: [], calendarConnected: null };
}

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AIChat screen', () => {
  it('shows the welcome message and localized examples when the thread is empty', async () => {
    const state = assistantState({ usage: usage({ used: 3 }) });
    useAssistant.mockReturnValue(state);
    await render(<AIChat navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByText(/Tell me what you need/)).toBeTruthy();
    expect(screen.getByText('3/5 today · Free')).toBeTruthy();

    await fireEvent.press(screen.getByText('What do I have this week?'));
    await fireEvent.press(screen.getByTestId('assistant-send'));
    expect(state.send).toHaveBeenCalledWith('What do I have this week?');
  });

  it('never auto-starts a follow-up from an external link: the user taps "Get follow-up ideas"', async () => {
    const state = assistantState();
    useAssistant.mockReturnValue(state);
    await render(<AIChat navigation={navigation} route={{ params: { followup: 'meeting_7', prefill: 'Draft text' } }} />);
    expect(useAssistant).toHaveBeenCalledWith({ followUpMeetingId: 'meeting_7', autoStartFollowUp: false });
    expect(screen.getByDisplayValue('Draft text')).toBeTruthy();
    expect(screen.getByText('Meeting follow-up')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-start-followup'));
    expect(state.startFollowUp).toHaveBeenCalledWith('meeting_7');
  });

  it('auto-starts the follow-up only when the app notification opened the chat', async () => {
    useAssistant.mockReturnValue(assistantState());
    await render(<AIChat navigation={navigation} route={{ params: { followup: 'meeting_7', autoStart: true } }} />);
    expect(useAssistant).toHaveBeenCalledWith({ followUpMeetingId: 'meeting_7', autoStartFollowUp: true });
    expect(screen.queryByTestId('assistant-start-followup')).toBeNull();
  });

  it('shows an update proposal, reviews it as a diff and confirms it', async () => {
    const action = updateAction('a1-1', 'm1', { startAt: '2030-03-11T17:00:00.000Z' });
    const state = assistantState({
      messages: [chatMessage('u1', 'user', 'Move my sync to 5pm'), chatMessage('a1', 'assistant', 'Here is the change', { actionIds: [action.id], suggestions: ['Also add a Meet link'] })],
      actions: { [action.id]: { action, status: 'proposed', preview: previewFor(action), result: null } },
    });
    useAssistant.mockReturnValue(state);
    await render(<AIChat navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByText('Move my sync to 5pm')).toBeTruthy();
    expect(screen.getByText('Needs confirmation')).toBeTruthy();
    expect(screen.getByText('Also add a Meet link')).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`action-review-${action.id}`));
    expect(screen.getByText('Save these changes?')).toBeTruthy();
    // Times are shown in the device zone, named when the meeting was planned in another zone.
    expect(screen.getByText(/^2030-03-11T15:00\+60m/)).toBeTruthy();
    expect(screen.getByText(/^2030-03-11T17:00\+60m/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('confirm-submit'));
    expect(state.confirm).toHaveBeenCalledWith(action.id);
    expect(await screen.findByText('Meeting updated.')).toBeTruthy();
  });

  it('sends a server suggestion as the next message', async () => {
    const state = assistantState({
      messages: [chatMessage('a1', 'assistant', 'Done', { suggestions: ['Share it with the team'] })],
    });
    useAssistant.mockReturnValue(state);
    await render(<AIChat navigation={navigation} route={{ params: {} }} />);
    await fireEvent.press(screen.getByText('Share it with the team'));
    // Model-written chip text is marked, so the server never treats it as typed by the user.
    expect(state.send).toHaveBeenCalledWith('Share it with the team', { origin: 'suggestion' });
  });

  it('offers an upgrade for quota errors and retry for transient ones', async () => {
    const quota = new AppError('quota_exceeded', 'x', { details: { reason: 'quota_exceeded', usage: usage({ used: 5 }) } });
    useAssistant.mockReturnValue(assistantState({ error: quota, messages: [chatMessage('u1', 'user', 'Hi', { delivery: 'failed' })] }));
    const { unmount } = await render(<AIChat navigation={navigation} route={{ params: {} }} />);
    expect(screen.getByText(/used all 5 assistant requests/)).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    await fireEvent.press(screen.getByText('See plans'));
    expect(navigation.navigate).toHaveBeenCalledWith('Pricing');
    await unmount();

    const offline = assistantState({ error: new AppError('offline'), canRetry: true });
    useAssistant.mockReturnValue(offline);
    await render(<AIChat navigation={navigation} route={{ params: {} }} />);
    expect(screen.getByText(/You're offline/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-retry'));
    expect(offline.retry).toHaveBeenCalled();
  });

  it('shows the typing indicator while sending and a review-all bar for several pending actions', async () => {
    const a = createAction('a1-1');
    const b = deleteAction('a1-2', 'm1');
    useAssistant.mockReturnValue(
      assistantState({
        isSending: true,
        messages: [chatMessage('a1', 'assistant', 'Two things', { actionIds: [a.id, b.id] })],
        actions: {
          [a.id]: { action: a, status: 'proposed', preview: null, result: null },
          [b.id]: { action: b, status: 'proposed', preview: previewFor(b), result: null },
        },
        pendingActionIds: [a.id, b.id],
      }),
    );
    await render(<AIChat navigation={navigation} route={{ params: {} }} />);
    expect(screen.getByTestId('typing-indicator')).toBeTruthy();
    expect(screen.getByText('2 actions waiting for your confirmation')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('assistant-review-all'));
    expect(screen.getByText('Confirm 2 actions')).toBeTruthy();
    expect(screen.getByText('Confirm all 2')).toBeTruthy();
  });
});

describe('MeetingConfirmationModal', () => {
  it('uses destructive styling and wording for a delete', async () => {
    const action = deleteAction('d1', 'm1');
    const onConfirm = jest.fn();
    await render(
      <MeetingConfirmationModal
        visible
        actions={[{ action, status: 'proposed', preview: previewFor(action), result: null }]}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText('Delete this meeting?')).toBeTruthy();
    expect(screen.getByText('This meeting will be deleted and its alerts cancelled.')).toBeTruthy();
    expect(screen.getByText('Weekly sync')).toBeTruthy();
    expect(within(screen.getByTestId('confirm-submit')).getByText('Delete meeting')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-submit'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('lists every email recipient of a share and explains that nothing is sent automatically', async () => {
    const action = shareAction('s1', 'm1', { recipients: ['john@company.com', 'ana@x.io'], message: 'See you there' });
    await render(
      <MeetingConfirmationModal
        visible
        actions={[{ action, status: 'proposed', preview: previewFor(action), result: null }]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText('john@company.com')).toBeTruthy();
    expect(screen.getByText('ana@x.io')).toBeTruthy();
    expect(screen.getByText('Recipients (2)')).toBeTruthy();
    expect(screen.getByText(/Nothing is sent until you send it there/)).toBeTruthy();
    expect(screen.getByText('Write email')).toBeTruthy();
  });

  it('shows every field of a new meeting and its warnings', async () => {
    const action = createAction('c1', { conference: { provider: 'google_meet', url: null, password: null } });
    const preview: AiActionPreview = { ...previewFor(action, []), warnings: ['google_meet_needs_calendar'] };
    await render(
      <MeetingConfirmationModal
        visible
        actions={[{ action, status: 'proposed', preview, result: null }]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText('Budget review')).toBeTruthy();
    expect(screen.getByText(/Connect Google Calendar to create a real Google Meet link/)).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
  });
});
