import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { RootStackParamList } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { buildMeeting, type Meeting, type MeetingCreateInput } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { CalendarScreen } from '../CalendarScreen';

// Mexico City (UTC-6): at 03:00 UTC on Oct 6 it is still Oct 5 there.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'America/Mexico_City', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../shared/useLiveNow', () => ({ useLiveNow: () => new Date('2026-10-06T03:00:00.000Z') }));

const mockRefresh = jest.fn();
const mockSyncNow = jest.fn();
let mockMeetings: Meeting[] = [];
let mockError: AppError | null = null;

jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    useMeetings: () => ({ meetings: mockMeetings, isLoading: false, error: mockError, refresh: mockRefresh }),
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
    useTasks: () => ({ tasks: [], isLoading: false, error: null, create: jest.fn(), update: jest.fn(), remove: jest.fn() }),
    meetingRepository: { remove: jest.fn() },
  };
});

// §24: the details screen and the row actions read the zoom service (zoomStatus + hooks).
jest.mock('../../../services/zoom', () => ({
  useZoomStatus: () => ({ configured: null, refresh: jest.fn() }),
  zoomService: {
    isAvailable: jest.fn(async () => false),
    getKnownAvailability: () => null,
    ensureLink: jest.fn(async () => ({ url: 'https://zoom.us/j/1', password: null, zoomMeetingId: '1' })),
    syncIfNeeded: jest.fn(async () => undefined),
    onMeetingDeleted: jest.fn(async () => undefined),
    linkFailure: () => null,
  },
}));

jest.mock('../../../services/calendar', () => ({
  calendarSyncEngine: { syncNow: (...args: unknown[]) => mockSyncNow(...args) },
}));

function meeting(id: string, input: Partial<MeetingCreateInput> & { startAt: string }): Meeting {
  return buildMeeting(
    { title: id, source: 'manual', timezone: 'America/Mexico_City', ...input },
    { id, userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

const TONIGHT = meeting('tonight', { title: 'Team dinner', startAt: '2026-10-06T03:30:00.000Z' });
const GOOGLE = meeting('google', { title: 'Client call', startAt: '2026-10-09T18:00:00.000Z', source: 'google' });
const DEVICE = meeting('device', { title: 'Dentist', startAt: '2026-11-03T16:00:00.000Z', source: 'device' });

const Stack = createStackNavigator<RootStackParamList>();

function Stub({ route }: { route: { name: string; params?: { meetingId?: string; date?: string } } }) {
  return <Text testID={`stub-${route.name}`}>{`${route.name}:${route.params?.meetingId ?? route.params?.date ?? ''}`}</Text>;
}

async function renderCalendar() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Calendar" component={CalendarScreen} />
            <Stack.Screen name="MeetingDetails" component={Stub} />
            <Stack.Screen name="EditMeeting" component={Stub} />
            <Stack.Screen name="CreateMeeting" component={Stub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockMeetings = [TONIGHT, GOOGLE, DEVICE];
  mockError = null;
  mockRefresh.mockReset().mockResolvedValue(undefined);
  mockSyncNow.mockReset().mockResolvedValue({ google: null, device: null, errors: [] });
});

it('shows the month with dots for every source and today\'s agenda in the user zone', async () => {
  await renderCalendar();
  expect(screen.getByTestId('calendar-month-title').props.children).toBe('October 2026');
  expect(screen.getByTestId('calendar-dot-2026-10-05-meetingguard')).toBeTruthy();
  expect(screen.getByTestId('calendar-dot-2026-10-09-google')).toBeTruthy();
  expect(screen.queryByTestId('calendar-dot-2026-10-06-meetingguard')).toBeNull();
  expect(screen.getByTestId('calendar-agenda-title').props.children).toBe('Today · October 5th, 2026');
  expect(screen.getByTestId('meeting-row-tonight')).toBeTruthy();
  expect(screen.getByTestId('calendar-day-2026-10-05').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  expect(screen.getByTestId('calendar-day-2026-10-05').props.accessibilityLabel).toBe('Monday, October 5th, 2026, 1 meeting, today');
});

it('shows the agenda of a picked day and creates a meeting on that day', async () => {
  await renderCalendar();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-day-2026-10-09'));
  });
  expect(screen.getByTestId('calendar-agenda-title').props.children).toBe('Friday, October 9th, 2026');
  expect(screen.getByTestId('meeting-row-google')).toBeTruthy();
  expect(screen.queryByTestId('meeting-row-tonight')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-create'));
  });
  expect((await screen.findByTestId('stub-CreateMeeting')).props.children).toBe('CreateMeeting:2026-10-09');
});

it('moves between months and back to today', async () => {
  await renderCalendar();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-next'));
  });
  expect(screen.getByTestId('calendar-month-title').props.children).toBe('November 2026');
  expect(screen.getByTestId('calendar-dot-2026-11-03-device')).toBeTruthy();
  expect(screen.getByTestId('calendar-empty-day')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-today'));
  });
  expect(screen.getByTestId('calendar-month-title').props.children).toBe('October 2026');
  expect(screen.getByTestId('meeting-row-tonight')).toBeTruthy();
});

it('opens a meeting from the agenda', async () => {
  await renderCalendar();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-row-tonight'));
  });
  expect((await screen.findByTestId('stub-MeetingDetails')).props.children).toBe('MeetingDetails:tonight');
});

it('speaks Spanish (Monday first) and shows a load error with a retry', async () => {
  mockMeetings = [];
  mockError = new AppError('offline');
  await i18n.changeLanguage('es');
  await renderCalendar();
  expect(screen.getByTestId('calendar-month-title').props.children).toBe('Octubre 2026');
  expect(screen.getAllByText(/^(Lu|Ma|Mi|Ju|Vi|Sá|Do)$/, { includeHiddenElements: true }).map((node) => node.props.children)).toEqual(['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']);
  expect(screen.getByTestId('calendar-error')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText('Reintentar'));
  });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockSyncNow).toHaveBeenCalledWith({ reason: 'manual' });
});
