import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { ActionResult, ProposedActionState } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { createAction, deleteAction, listAction, makeMeeting, updateAction, usage } from '../../../services/ai/__fixtures__/aiTestKit';
import type { AiActionPreview, AssistantHookResult, ChatMessage } from '../../../services/ai/types';
import { AssistantScreen } from '../AssistantScreen';

jest.mock('../../../i18n', () => {
  const { createTranslator } = jest.requireActual('../../../services/ai/__fixtures__/aiTestKit');
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

let mockDarkMode = false;
jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: mockDarkMode, toggleTheme: jest.fn() }),
  // For useAppTheme (src/theme) in nested MG components (e.g. MeetingConfirmationModal).
  useOptionalTheme: () => ({ colorScheme: mockDarkMode ? 'dark' : 'light' }),
  resolveColorScheme: (_preference: string, system: 'light' | 'dark' | null | undefined) => system ?? 'light',
}));

jest.mock('../../../services/data', () => ({
  useEntitlement: jest.fn(() => ({ plan: 'free', isLoaded: true, entitlement: { plan: 'free' } })),
  useMeeting: jest.fn(() => ({ meeting: null, isLoading: false, error: null })),
  usePreferences: jest.fn(() => ({ preferences: { use24HourClock: true }, isLoaded: true, error: null })),
}));

jest.mock('../../../services/ai', () => ({ useAssistant: jest.fn() }));

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

interface MockAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providerIds: string[];
}
let mockAuthUser: MockAuthUser | null = null;
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({
    authUser: mockAuthUser,
    resendVerification: jest.fn(async () => ({ success: true })),
    refreshUser: jest.fn(async () => ({ success: true })),
  }),
  authService: {
    get currentUser() {
      return mockAuthUser;
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAssistant } = require('../../../services/ai') as { useAssistant: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useMeeting } = require('../../../services/data') as { useMeeting: jest.Mock };

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

function previewFor(action: ProposedActionState['action'], meetings = [makeMeeting('m1', { title: 'Weekly sync' })]): AiActionPreview {
  return { action, meetings, missingMeetingIds: [], warnings: [], overlapping: [], calendarConnected: null };
}

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };

type ScreenProps = Parameters<typeof AssistantScreen>[0];

function renderChat(params: { followup?: string; prefill?: string; autoStart?: boolean } | undefined = {}) {
  const props = { navigation, route: { key: 'AIChat-1', name: 'AIChat', params } } as unknown as ScreenProps;
  return render(<AssistantScreen {...props} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDarkMode = false;
  mockAuthUser = { uid: 'u1', email: 'ana@example.com', displayName: 'Ana', photoURL: null, emailVerified: true, providerIds: ['google.com'] };
  useMeeting.mockReturnValue({ meeting: null, isLoading: false, error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AssistantScreen', () => {
  it('shows the verification banner and the same gate message on the server rejection for an unverified email account', async () => {
    mockAuthUser = { uid: 'u1', email: 'ana@example.com', displayName: null, photoURL: null, emailVerified: false, providerIds: ['password'] };
    const state = assistantState({
      error: new AppError('unauthenticated'),
      messages: [chatMessage('m1', 'user', 'Hello')],
    });
    useAssistant.mockReturnValue(state);
    await renderChat();

    expect(screen.getByTestId('verify-email-banner')).toBeTruthy();
    // The mocked translator returns non-ai keys verbatim: banner body + inline error, same key.
    expect(screen.getAllByText('auth:verify.assistantBody').length).toBeGreaterThanOrEqual(2);
  });

  it('shows no verification banner for a Google account and keeps the generic session message', async () => {
    const state = assistantState({
      error: new AppError('unauthenticated'),
      messages: [chatMessage('m1', 'user', 'Hello')],
    });
    useAssistant.mockReturnValue(state);
    await renderChat();

    expect(screen.queryByTestId('verify-email-banner')).toBeNull();
    expect(screen.queryByText('auth:verify.assistantBody')).toBeNull();
  });

  it('shows the welcome message and localized examples when the thread is empty', async () => {
    const state = assistantState({ usage: usage({ used: 3 }) });
    useAssistant.mockReturnValue(state);
    await renderChat();

    expect(screen.getByText(/Tell me what you need/)).toBeTruthy();
    expect(screen.getByText('3/5 today · Free')).toBeTruthy();
    expect(screen.getByLabelText('3 of 5 assistant requests used today on the Free plan')).toBeTruthy();

    await fireEvent.press(screen.getByText('What do I have this week?'));
    await fireEvent.press(screen.getByTestId('assistant-send'));
    expect(state.send).toHaveBeenCalledWith('What do I have this week?');
  });

  it('shows a loading state until the conversation is loaded and cannot send meanwhile', async () => {
    const state = assistantState({ isLoaded: false });
    useAssistant.mockReturnValue(state);
    await renderChat({ prefill: 'Hello' });
    expect(screen.getByTestId('assistant-loading')).toBeTruthy();
    expect(screen.getByTestId('assistant-send').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(screen.getByTestId('assistant-send'));
    expect(state.send).not.toHaveBeenCalled();
  });

  it('never auto-starts a follow-up from an external link: the user taps "Get follow-up ideas"', async () => {
    const state = assistantState();
    useAssistant.mockReturnValue(state);
    useMeeting.mockReturnValue({ meeting: makeMeeting('meeting_7', { title: 'Budget review' }), isLoading: false, error: null });
    await renderChat({ followup: 'meeting_7', prefill: 'Draft text' });
    expect(useAssistant).toHaveBeenCalledWith({ followUpMeetingId: 'meeting_7', autoStartFollowUp: false });
    expect(screen.getByDisplayValue('Draft text')).toBeTruthy();
    expect(screen.getByText('Follow-up: Budget review')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-start-followup'));
    expect(state.startFollowUp).toHaveBeenCalledWith('meeting_7');
  });

  it('auto-starts the follow-up only when the app notification opened the chat', async () => {
    useAssistant.mockReturnValue(assistantState());
    await renderChat({ followup: 'meeting_7', autoStart: true });
    expect(useAssistant).toHaveBeenCalledWith({ followUpMeetingId: 'meeting_7', autoStartFollowUp: true });
    expect(screen.getByText('Meeting follow-up')).toBeTruthy();
    expect(screen.queryByTestId('assistant-start-followup')).toBeNull();
  });

  it('shows an update proposal, reviews it as a diff and confirms it', async () => {
    const action = updateAction('a1-1', 'm1', { startAt: '2030-03-11T17:00:00.000Z' });
    const state = assistantState({
      messages: [
        chatMessage('u1', 'user', 'Move my sync to 5pm'),
        chatMessage('a1', 'assistant', 'Here is the change', { actionIds: [action.id], suggestions: ['Also add a Meet link'] }),
      ],
      actions: { [action.id]: { action, status: 'proposed', preview: previewFor(action), result: null } },
    });
    useAssistant.mockReturnValue(state);
    await renderChat();

    expect(screen.getByText('Move my sync to 5pm')).toBeTruthy();
    expect(screen.getByLabelText('You, 09:15: Move my sync to 5pm')).toBeTruthy();
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

  it('sends a server suggestion as the next message, marked as model-written', async () => {
    const state = assistantState({
      messages: [chatMessage('a1', 'assistant', 'Done', { suggestions: ['Share it with the team'] })],
    });
    useAssistant.mockReturnValue(state);
    await renderChat();
    await fireEvent.press(screen.getByText('Share it with the team'));
    expect(state.send).toHaveBeenCalledWith('Share it with the team', { origin: 'suggestion' });
  });

  it('offers an upgrade for quota errors and retry for transient ones', async () => {
    const quota = new AppError('quota_exceeded', 'x', { details: { reason: 'quota_exceeded', usage: usage({ used: 5 }) } });
    useAssistant.mockReturnValue(assistantState({ error: quota, messages: [chatMessage('u1', 'user', 'Hi', { delivery: 'failed' })] }));
    const { unmount } = await renderChat();
    expect(screen.getByText(/used all 5 assistant requests/)).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    await fireEvent.press(screen.getByText('See plans'));
    expect(navigation.navigate).toHaveBeenCalledWith('Pricing');
    await unmount();

    const offline = assistantState({ error: new AppError('offline'), canRetry: true });
    useAssistant.mockReturnValue(offline);
    await renderChat();
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
    await renderChat();
    expect(screen.getByTestId('typing-indicator')).toBeTruthy();
    expect(screen.getByLabelText('Thinking...')).toBeTruthy();
    expect(screen.getByText('2 actions waiting for your confirmation')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('assistant-review-all'));
    expect(screen.getByText('Confirm 2 actions')).toBeTruthy();
    expect(screen.getByText('Confirm all 2')).toBeTruthy();
  });

  it('asks before clearing the conversation and clears it on confirmation', async () => {
    const state = assistantState({ messages: [chatMessage('u1', 'user', 'Hi')] });
    useAssistant.mockReturnValue(state);
    await renderChat();
    await fireEvent.press(screen.getByTestId('assistant-clear'));
    expect(Alert.alert).toHaveBeenCalledWith('Clear conversation?', expect.any(String), expect.any(Array));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((button) => button.style === 'destructive')?.onPress?.();
    });
    expect(state.reset).toHaveBeenCalled();
  });

  it('cannot clear an empty conversation', async () => {
    useAssistant.mockReturnValue(assistantState());
    await renderChat();
    expect(screen.getByTestId('assistant-clear').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('opens meetings from a list card and from a finished action', async () => {
    const list = listAction('l1', ['m1']);
    const done = updateAction('u1', 'm2', { title: 'Renamed' });
    useAssistant.mockReturnValue(
      assistantState({
        messages: [chatMessage('a1', 'assistant', 'Here you go', { actionIds: ['l1', 'u1'] })],
        actions: {
          l1: { action: list, status: 'done', preview: previewFor(list), result: null },
          u1: {
            action: done,
            status: 'done',
            preview: null,
            result: { status: 'done', actionId: 'u1', type: 'update_meeting', meetingIds: ['m2'], duplicate: false },
          },
        },
      }),
    );
    await renderChat();
    await fireEvent.press(screen.getByTestId('action-meeting-m1'));
    expect(navigation.navigate).toHaveBeenCalledWith('MeetingDetails', { meetingId: 'm1' });
    expect(screen.getByText('Meeting updated.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('action-open-u1'));
    expect(navigation.navigate).toHaveBeenCalledWith('MeetingDetails', { meetingId: 'm2' });
  });

  it('dismisses a proposal without running it', async () => {
    const action = deleteAction('d1', 'm1');
    const state = assistantState({
      messages: [chatMessage('a1', 'assistant', 'Delete it?', { actionIds: [action.id] })],
      actions: { [action.id]: { action, status: 'proposed', preview: previewFor(action), result: null } },
    });
    useAssistant.mockReturnValue(state);
    await renderChat();
    await fireEvent.press(screen.getByTestId(`action-dismiss-${action.id}`));
    expect(state.reject).toHaveBeenCalledWith(action.id);
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('renders in dark mode', async () => {
    mockDarkMode = true;
    useAssistant.mockReturnValue(assistantState());
    await renderChat();
    expect(screen.getByTestId('assistant-welcome')).toBeTruthy();
  });
});
