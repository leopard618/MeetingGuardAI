import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { RootStackParamList } from '../../../core/contracts';
import { buildMeeting, type Meeting } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { MeetingDetailsScreen } from '../MeetingDetailsScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
// The attachments section has its own tests (src/screens/attachments/__tests__).
jest.mock('../../attachments/MeetingAttachmentsSection', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { MeetingAttachmentsSection: ({ meetingId }: { meetingId: string }) => <MockText testID={`attachments-${meetingId}`} /> };
});

let mockGoogleConnected = true;
jest.mock('../../../services/calendar', () => ({
  useCalendarStatus: () => ({ google: { enabled: mockGoogleConnected, hasScope: mockGoogleConnected }, device: { enabled: false } }),
}));

const mockRemove = jest.fn();
let mockMeeting: Meeting | null = null;
let mockUse24Hour: boolean | null = null;
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    useMeeting: () => ({ meeting: mockMeeting, isLoading: false, error: null }),
    usePreferences: () => ({
      preferences: { ...defaults({ language: 'en', timezone: 'UTC' }), use24HourClock: mockUse24Hour },
      isLoaded: true,
      error: null,
    }),
    meetingRepository: { remove: (...args: unknown[]) => mockRemove(...args) },
  };
});

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}): Meeting {
  return buildMeeting(
    {
      title: 'Budget review',
      startAt: '2026-10-06T15:00:00.000Z',
      timezone: 'UTC',
      source: 'google',
      preparationTips: ['Bring the Q3 numbers'],
      customAlertTimes: [30, 10],
      conference: { provider: 'zoom', url: 'https://zoom.us/j/42', password: 'pw1' },
      participants: [{ email: 'ana@example.com', name: 'Ana' }],
      external: { googleEventId: 'evt1', googleCalendarId: 'primary' },
      ...overrides,
    },
    { id: 'm1', userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

const Stack = createStackNavigator<RootStackParamList>();

function EditStub() {
  return <Text testID="edit-screen">edit</Text>;
}

function CalendarSyncStub() {
  return <Text testID="calendar-sync-screen">calendar sync</Text>;
}

async function renderDetails() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="MeetingDetails" component={MeetingDetailsScreen} initialParams={{ meetingId: 'm1' }} />
            <Stack.Screen name="EditMeeting" component={EditStub} />
            <Stack.Screen name="CalendarSync" component={CalendarSyncStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

function pressDestructive() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1]?.[2] as { style?: string; onPress?: () => void }[];
  buttons.find((button) => button.style === 'destructive')?.onPress?.();
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRemove.mockReset();
  mockUse24Hour = null;
  mockGoogleConnected = true;
  mockMeeting = meeting();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('shows everything the meeting holds and lets a Google meeting be edited', async () => {
  await renderDetails();
  expect(screen.getByTestId('meeting-title').props.children).toBe('Budget review');
  expect(screen.getByText('• Bring the Q3 numbers')).toBeTruthy();
  expect(screen.getByTestId('meeting-alert-times').props.children).toBe('Reminders for this meeting: 30 min before, 10 min before');
  expect(screen.getByText('Passcode: pw1')).toBeTruthy();
  expect(screen.getByText('Ana <ana@example.com>')).toBeTruthy();
  expect(screen.getByTestId('meeting-join')).toBeTruthy();
  expect(screen.getByTestId('attachments-m1')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-edit'));
  });
  expect(await screen.findByTestId('edit-screen')).toBeTruthy();
});

it('deletes a Google meeting (the calendar engine removes it from Google too)', async () => {
  mockRemove.mockResolvedValue(undefined);
  await renderDetails();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-delete'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Delete “Budget review”?', expect.stringContaining('Google Calendar'), expect.any(Array));
  await act(async () => {
    pressDestructive();
  });
  expect(mockRemove).toHaveBeenCalledWith('m1', { origin: 'user' });
});

it('explains that a device-calendar import stays in the device calendar', async () => {
  mockMeeting = meeting({ source: 'device', external: {} });
  await renderDetails();
  expect(screen.getByText(/your device calendar keeps its event/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-delete'));
  });
  expect(Alert.alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('device calendar keeps its event'), expect.any(Array));
});

it('formats the time in the UI language and the 24-hour preference', async () => {
  mockUse24Hour = true;
  await act(async () => {
    await i18n.changeLanguage('es');
  });
  await renderDetails();
  // (The year is shown only when it is not the current year.)
  expect(screen.getByTestId('meeting-when').props.children).toMatch(/^mar, 6 oct( 2026)? · 15:00 – 16:00$/);
});

it('promises a Meet link only when Google Calendar is connected, else offers to connect it', async () => {
  mockMeeting = meeting({ conference: { provider: 'google_meet', url: null, password: null }, source: 'manual', external: {} });
  await renderDetails();
  expect(screen.getByTestId('meeting-meet-pending')).toBeTruthy();
  expect(screen.queryByTestId('meeting-connect-calendar')).toBeNull();
});

it('asks to connect Google Calendar for a Meet meeting without sync', async () => {
  mockGoogleConnected = false;
  mockMeeting = meeting({ conference: { provider: 'google_meet', url: null, password: null }, source: 'manual', external: {} });
  await renderDetails();
  expect(screen.queryByTestId('meeting-meet-pending')).toBeNull();
  expect(screen.getByTestId('meeting-meet-needs-calendar')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-connect-calendar'));
  });
  expect(await screen.findByTestId('calendar-sync-screen')).toBeTruthy();
});


it('shows the repeat rule and the next occurrences of a recurring meeting', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  mockMeeting = meeting({
    source: 'manual',
    external: {},
    startAt: '2026-10-05T15:00:00.000Z',
    recurrence: { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null },
    recurrenceOverrides: { '2026-10-12': { status: 'cancelled', startAt: null, durationMinutes: null, title: null } },
  });
  try {
    await renderDetails();
    expect(screen.getByTestId('meeting-repeats-chip')).toBeTruthy();
    expect(screen.getByTestId('meeting-repeats-summary').props.children).toBe('Repeats weekly on Monday');
    // Oct 12 is cancelled, so the next three are Oct 5, 19 and 26.
    expect(screen.getByTestId('meeting-occurrence-2026-10-05')).toBeTruthy();
    expect(screen.queryByTestId('meeting-occurrence-2026-10-12')).toBeNull();
    expect(screen.getByTestId('meeting-occurrence-2026-10-19')).toBeTruthy();
    expect(screen.getByTestId('meeting-occurrence-2026-10-26')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it('warns that deleting a recurring meeting removes the whole series', async () => {
  mockRemove.mockResolvedValue(undefined);
  mockMeeting = meeting({
    source: 'manual',
    external: {},
    recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
  });
  await renderDetails();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-delete'));
  });
  expect(Alert.alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('whole series'), expect.any(Array));
  await act(async () => {
    pressDestructive();
  });
  expect(mockRemove).toHaveBeenCalledWith('m1', { origin: 'user' });
});
