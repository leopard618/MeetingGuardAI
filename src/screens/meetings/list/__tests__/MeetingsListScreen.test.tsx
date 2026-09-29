import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { RootStackParamList } from '../../../../core/contracts';
import { AppError } from '../../../../core/errors';
import { buildMeeting, type Meeting, type MeetingCreateInput } from '../../../../core/types';
import { I18nProvider, i18n } from '../../../../i18n';
import { MeetingsListScreen } from '../MeetingsListScreen';

// The user lives in Mexico City (UTC-6): 03:00 UTC on Oct 6 is still Oct 5, 21:00 there.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'America/Mexico_City', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../shared/useLiveNow', () => ({ useLiveNow: () => new Date('2026-10-06T03:00:00.000Z') }));

const mockRemove = jest.fn();
const mockRefresh = jest.fn();
const mockSyncNow = jest.fn();
let mockMeetings: Meeting[] = [];
let mockLoading = false;
let mockError: AppError | null = null;

jest.mock('../../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../../core/types');
  return {
    useMeetings: () => ({ meetings: mockMeetings, isLoading: mockLoading, error: mockError, refresh: mockRefresh }),
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
    meetingRepository: { remove: (...args: unknown[]) => mockRemove(...args) },
  };
});
jest.mock('../../../../services/calendar', () => ({
  calendarSyncEngine: { syncNow: (...args: unknown[]) => mockSyncNow(...args) },
}));

function meeting(id: string, input: Partial<MeetingCreateInput> & { startAt: string }): Meeting {
  return buildMeeting(
    { title: id, source: 'manual', timezone: 'America/Mexico_City', ...input },
    { id, userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

const TONIGHT = meeting('tonight', { title: 'Team dinner', startAt: '2026-10-06T03:30:00.000Z' });
const TOMORROW = meeting('tomorrow', { title: 'Budget review', startAt: '2026-10-06T16:00:00.000Z' });
const GOOGLE = meeting('google', {
  title: 'Client call',
  startAt: '2026-10-09T18:00:00.000Z',
  source: 'google',
  external: { googleEventId: 'evt1', googleCalendarId: 'primary' },
});
const PAST = meeting('past', { title: 'Retro', startAt: '2026-10-04T15:00:00.000Z' });

const Stack = createStackNavigator<RootStackParamList>();

function Stub({ route }: { route: { name: string; params?: { meetingId?: string } } }) {
  return <Text testID={`stub-${route.name}`}>{`${route.name}:${route.params?.meetingId ?? ''}`}</Text>;
}

async function renderList() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="TotalMeetings" component={MeetingsListScreen} />
            <Stack.Screen name="MeetingDetails" component={Stub} />
            <Stack.Screen name="EditMeeting" component={Stub} />
            <Stack.Screen name="ChooseCreationMethod" component={Stub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

function pressAlertButton(style: 'destructive' | 'cancel') {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1]?.[2] as { style?: string; onPress?: () => void }[];
  buttons.find((button) => button.style === style)?.onPress?.();
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockMeetings = [PAST, GOOGLE, TONIGHT, TOMORROW];
  mockLoading = false;
  mockError = null;
  mockRemove.mockReset();
  mockRefresh.mockReset().mockResolvedValue(undefined);
  mockSyncNow.mockReset().mockResolvedValue({ google: null, device: null, errors: [] });
  (Toast.show as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('groups upcoming meetings by local day with a correct "Today" outside UTC', async () => {
  await renderList();
  expect(screen.getByTestId('meetings-section-2026-10-05').props.children).toMatch(/^Today · October 5th, 2026$/);
  expect(screen.getByTestId('meetings-section-2026-10-06').props.children).toMatch(/^Tomorrow · /);
  expect(screen.getByTestId('meetings-section-2026-10-09').props.children).toBe('Friday, October 9th, 2026');
  expect(screen.getByTestId('meeting-row-time-tonight').props.children).toBe('9:30 PM – 10:30 PM');
  expect(screen.queryByTestId('meeting-row-past')).toBeNull();
  expect(screen.getByTestId('meetings-result-count').props.children).toBe('3 meetings');
  // No fake "Clear all".
  expect(screen.queryByText(/clear all/i)).toBeNull();
});

it('filters by time, source and search', async () => {
  await renderList();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meetings-time-past'));
  });
  expect(screen.getByTestId('meeting-row-past')).toBeTruthy();
  expect(screen.queryByTestId('meeting-row-tonight')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('meetings-time-all'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('meetings-source-google'));
  });
  expect(screen.getByTestId('meeting-row-google')).toBeTruthy();
  expect(screen.queryByTestId('meeting-row-tomorrow')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('meetings-source-all'));
  });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meetings-search'), 'budget');
  });
  expect(screen.getByTestId('meeting-row-tomorrow')).toBeTruthy();
  expect(screen.queryByTestId('meeting-row-tonight')).toBeNull();

  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meetings-search'), 'nothing like this');
  });
  expect(screen.getByTestId('meetings-empty-noMatches')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meetings-clear-filters'));
  });
  expect(screen.getByTestId('meeting-row-tonight')).toBeTruthy();
});

it('opens a meeting on tap', async () => {
  await renderList();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-row-tomorrow'));
  });
  expect((await screen.findByTestId('stub-MeetingDetails')).props.children).toBe('MeetingDetails:tomorrow');
});

it('edits from the action sheet', async () => {
  await renderList();
  await act(async () => {
    fireEvent(screen.getByTestId('meeting-row-tonight'), 'longPress');
  });
  const sheet = await screen.findByTestId('meeting-actions-sheet');
  expect(within(sheet).getByText('Team dinner')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-action-edit'));
  });
  expect((await screen.findByTestId('stub-EditMeeting')).props.children).toBe('EditMeeting:tonight');
});

it('deletes a Google meeting only after confirmation, and reports the real outcome', async () => {
  mockRemove.mockResolvedValue(undefined);
  await renderList();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-row-more-google'));
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-delete'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Delete “Client call”?', expect.stringContaining('Google Calendar'), expect.any(Array));
  expect(mockRemove).not.toHaveBeenCalled();
  await act(async () => {
    pressAlertButton('destructive');
  });
  expect(mockRemove).toHaveBeenCalledWith('google', { origin: 'user' });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Meeting deleted.' }));
});

it('shows a failed delete as an error', async () => {
  mockRemove.mockRejectedValue(new AppError('offline'));
  await renderList();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-row-more-tonight'));
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-delete'));
  });
  await act(async () => {
    pressAlertButton('destructive');
  });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  expect(Toast.show).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
});

it('pull-to-refresh re-reads the meetings, syncs the calendars and reports sync errors', async () => {
  mockSyncNow.mockResolvedValue({ google: null, device: null, errors: [{ provider: 'google', code: 'calendar_scope_missing' }] });
  await renderList();
  // The Jest ScrollView mock renders RefreshControl without props: call the list's control directly.
  const refreshControl = screen.getByTestId('meetings-list').props.refreshControl as { props: { onRefresh(): void } };
  await act(async () => {
    refreshControl.props.onRefresh();
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockSyncNow).toHaveBeenCalledWith({ reason: 'manual' });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'Google Calendar could not be synced' }));
});

it('shows a loading state until the first cache load', async () => {
  mockMeetings = [];
  mockLoading = true;
  await renderList();
  expect(screen.getByTestId('meetings-loading')).toBeTruthy();
});

it('shows the error state with a retry when the meetings could not be loaded', async () => {
  mockMeetings = [];
  mockError = new AppError('permission_denied');
  await renderList();
  expect(screen.getByTestId('meetings-error')).toBeTruthy();
});

it('invites to create the first meeting when there are none (in Spanish too)', async () => {
  mockMeetings = [];
  await i18n.changeLanguage('es');
  await renderList();
  expect(screen.getByTestId('meetings-empty-none')).toBeTruthy();
  expect(screen.getByText('Aún no tienes reuniones')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meetings-new'));
  });
  expect(await screen.findByTestId('stub-ChooseCreationMethod')).toBeTruthy();
});
