import { NavigationContainer, type RouteProp } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { RootStackParamList, UseMeetingsResult } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import type { Meeting } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import type { AssistantHookResult, ChatMessage } from '../../../services/ai';
import { makeMeeting } from '../__fixtures__/meetings';
import { AIInsightsScreen } from '../AIInsightsScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

let mockMeetings: UseMeetingsResult = { meetings: [], isLoading: false, error: null, refresh: jest.fn() };
let mockOnline = true;
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    useMeetings: () => mockMeetings,
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
    useSyncState: () => ({ online: mockOnline, pendingWrites: 0, lastSyncedAt: null }),
    useEntitlement: () => ({ plan: 'free', isLoaded: true, entitlement: { plan: 'free' } }),
  };
});

let mockAssistant: Partial<AssistantHookResult>;
jest.mock('../../../services/ai', () => ({
  ...jest.requireActual('../../../services/ai/presentation'),
  createAssistantFormatter: jest.requireActual('../../../services/ai/formatter').createAssistantFormatter,
  useAssistant: () => mockAssistant,
}));

// Wednesday 30 September 2026, 10:00 UTC (only Date is faked; timers stay real).
const NOW = new Date('2026-09-30T10:00:00.000Z');

const Stack = createStackNavigator<RootStackParamList>();

function TargetStub({ route }: { route: RouteProp<RootStackParamList, keyof RootStackParamList> }) {
  return <Text testID={`target-${route.name}`}>{JSON.stringify(route.params ?? null)}</Text>;
}

async function renderInsights() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="AIInsights" component={AIInsightsScreen} />
            <Stack.Screen name="MeetingDetails" component={TargetStub} />
            <Stack.Screen name="AIChat" component={TargetStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

const MEETINGS: Meeting[] = [
  makeMeeting({ id: 'tue1', title: 'Planning', startAt: '2026-09-29T09:00:00.000Z', durationMinutes: 60, source: 'google' }),
  makeMeeting({ id: 'tue2', title: 'Hiring sync', startAt: '2026-09-29T09:30:00.000Z', durationMinutes: 90 }),
  makeMeeting({ id: 'wed', title: 'Customer call', startAt: '2026-09-30T15:00:00.000Z', durationMinutes: 30, source: 'ai_chat' }),
  makeMeeting({ id: 'wed2', title: 'Retro', startAt: '2026-09-30T15:30:00.000Z', durationMinutes: 30 }),
  makeMeeting({ id: 'oct', title: 'Offsite', startAt: '2026-10-20T09:00:00.000Z', durationMinutes: 120 }),
];

function assistantState(overrides: Partial<AssistantHookResult> = {}): Partial<AssistantHookResult> {
  return {
    messages: [],
    actions: {},
    isSending: false,
    error: null,
    usage: null,
    canRetry: false,
    send: jest.fn(async () => undefined),
    retry: jest.fn(async () => undefined),
    ...overrides,
  };
}

function confirmLastAlert() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1]?.[2] as { style?: string; onPress?: () => void }[];
  buttons.find((button) => button.style !== 'cancel')?.onPress?.();
}

beforeEach(async () => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  await i18n.changeLanguage('en');
  mockMeetings = { meetings: MEETINGS, isLoading: false, error: null, refresh: jest.fn() };
  mockOnline = true;
  mockAssistant = assistantState();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('shows the week: totals, busiest day, load by day, sources and conflicts', async () => {
  await renderInsights();
  expect(screen.getByTestId('insights-range').props.children).toBe('Sep 27, 2026 – Oct 3, 2026');
  expect(within(screen.getByTestId('stat-meetings')).getByText('4')).toBeTruthy();
  expect(within(screen.getByTestId('stat-time')).getByText('3 h 30 min')).toBeTruthy();
  expect(within(screen.getByTestId('stat-busiest')).getByText('Sep 29, 2026 · 2 meetings · 2 h 30 min')).toBeTruthy();
  expect(screen.getByTestId('load-2026-09-29').props.accessibilityLabel).toBe('Tuesday, September 29th, 2026: 2 meetings, 2 h 30 min');
  expect(within(screen.getByTestId('insights-sources')).getByText('Google Calendar')).toBeTruthy();
  expect(screen.getByTestId('pair-overlaps-tue1-tue2')).toBeTruthy();
  expect(screen.getByTestId('pair-backToBack-wed-wed2')).toBeTruthy();
  expect(screen.getByText('2 meetings have no link or place')).toBeTruthy();
});

it('switches to the month and opens a meeting from a conflict', async () => {
  await renderInsights();
  await act(async () => {
    fireEvent.press(screen.getByText('This month'));
  });
  expect(screen.getByTestId('insights-range').props.children).toBe('Sep 1, 2026 – Sep 30, 2026');
  expect(screen.getByTestId('load-weekday-2').props.accessibilityLabel).toBe('Tuesday: 2 meetings, 2 h 30 min');

  await act(async () => {
    fireEvent.press(screen.getByLabelText('Open Hiring sync'));
  });
  expect(JSON.parse(String((await screen.findByTestId('target-MeetingDetails')).props.children))).toEqual({ meetingId: 'tue2' });
});

it('shows the loading state', async () => {
  mockMeetings = { meetings: [], isLoading: true, error: null, refresh: jest.fn() };
  await renderInsights();
  expect(screen.getByTestId('insights-loading')).toBeTruthy();
});

it('shows a load failure with Retry instead of an empty period', async () => {
  const refresh = jest.fn(async () => undefined);
  mockMeetings = { meetings: [], isLoading: false, error: new AppError('offline', 'no cache'), refresh };
  await renderInsights();
  expect(screen.getByTestId('insights-error')).toBeTruthy();
  expect(screen.queryByTestId('insights-empty')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('insights-retry'));
  });
  expect(refresh).toHaveBeenCalled();
});

it('shows an empty period without AI suggestions', async () => {
  mockMeetings = { meetings: [MEETINGS[4]!], isLoading: false, error: null, refresh: jest.fn() };
  await renderInsights();
  expect(screen.getByTestId('insights-empty')).toBeTruthy();
  expect(screen.queryByTestId('ai-suggestions')).toBeNull();
});

it('explains the AI request (quota and processing) before sending it, then shows the reply', async () => {
  const send = jest.fn(async () => undefined);
  mockAssistant = assistantState({ send, usage: { used: 2, limit: 5, plan: 'free', resetsAt: '2026-10-01T00:00:00.000Z' } });
  await renderInsights();
  expect(screen.getByTestId('ai-usage').props.children).toMatch(/2/);

  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-suggestions-button'));
  });
  const [title, message] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string];
  expect(title).toBe('Get AI suggestions?');
  expect(message).toContain('daily AI limit');
  expect(message).toContain('OpenAI');
  expect(send).not.toHaveBeenCalled();

  await act(async () => {
    confirmLastAlert();
  });
  expect(send).toHaveBeenCalledWith(expect.stringContaining('this week'), { origin: 'suggestion' });

  // The shared conversation now holds the question and the reply (with one proposed change).
  const prompt = (send.mock.calls[0] as unknown as [string])[0];
  const messages: ChatMessage[] = [
    { id: 'u_1', role: 'user', content: prompt, createdAt: NOW.toISOString(), actionIds: [], suggestions: [], origin: 'suggestion' },
    { id: 'a_1', role: 'assistant', content: 'Move the hiring sync to 11:00.', createdAt: NOW.toISOString(), actionIds: ['a_1:0'], suggestions: [] },
  ];
  mockAssistant = assistantState({ send, messages });
  // Re-render (the mocked hook is not reactive): switching the period keeps the request state.
  await act(async () => {
    fireEvent.press(screen.getByText('This month'));
  });
  expect(within(screen.getByTestId('ai-suggestions-reply')).getByText('Move the hiring sync to 11:00.')).toBeTruthy();
  expect(screen.getByText(/The assistant proposed 1 change/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-open-chat'));
  });
  expect(await screen.findByTestId('target-AIChat')).toBeTruthy();
});

it('reports a failed AI request and disables it offline', async () => {
  const send = jest.fn(async () => {
    mockAssistant = assistantState({ send, error: new AppError('offline', 'no network') });
  });
  mockAssistant = assistantState({ send });
  await renderInsights();
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-suggestions-button'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  expect(screen.getByTestId('ai-suggestions-error')).toBeTruthy();
});

it('disables AI suggestions offline', async () => {
  mockOnline = false;
  await renderInsights();
  expect(screen.getByTestId('ai-suggestions-button').props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByText('AI suggestions need an internet connection.')).toBeTruthy();
});

it('renders in Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderInsights();
  expect(screen.getByText('Carga por día')).toBeTruthy();
  expect(screen.getByText('Reuniones que se solapan')).toBeTruthy();
});
