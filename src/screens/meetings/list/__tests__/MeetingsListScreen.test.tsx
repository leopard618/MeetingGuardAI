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
const mockCancelOccurrence = jest.fn();
const mockUpdateOccurrence = jest.fn();
const mockRestoreOccurrence = jest.fn();
const mockEditFollowing = jest.fn();
const mockDeleteFollowing = jest.fn();
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
    meetingRepository: {
      remove: (...args: unknown[]) => mockRemove(...args),
      cancelOccurrence: (...args: unknown[]) => mockCancelOccurrence(...args),
      updateOccurrence: (...args: unknown[]) => mockUpdateOccurrence(...args),
      restoreOccurrence: (...args: unknown[]) => mockRestoreOccurrence(...args),
      editFollowing: (...args: unknown[]) => mockEditFollowing(...args),
      deleteFollowing: (...args: unknown[]) => mockDeleteFollowing(...args),
    },
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
  mockCancelOccurrence.mockReset();
  mockUpdateOccurrence.mockReset();
  mockRestoreOccurrence.mockReset();
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


it('shows one row per occurrence of a recurring meeting and deletes with a scope', async () => {
  mockCancelOccurrence.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
  // Weekly standup, Tuesdays 10:00 Mexico City (Oct 6, 2026 is a Tuesday).
  mockMeetings = [
    meeting('series', {
      title: 'Weekly standup',
      startAt: '2026-10-06T16:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    }),
  ];
  await renderList();
  // Several rows exist for the same series (one per Tuesday), each flagged as repeating.
  expect(screen.getAllByTestId('meeting-row-series').length).toBeGreaterThan(1);
  expect(screen.getAllByTestId('meeting-row-repeats-series').length).toBeGreaterThan(1);

  await act(async () => {
    fireEvent.press(screen.getAllByTestId('meeting-row-more-series')[0]!);
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-delete'));
  });
  // The scope question replaces the plain confirmation; nothing ran yet.
  expect(Alert.alert).toHaveBeenCalledWith(
    'Delete repeating meeting',
    expect.stringContaining('repeats'),
    expect.any(Array),
    { cancelable: true },
  );
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockCancelOccurrence).not.toHaveBeenCalled();
  await act(async () => {
    pressAlertButton('destructive'); // first destructive button = "This meeting only"
  });
  expect(mockCancelOccurrence).toHaveBeenCalledWith('series', '2026-10-06', { origin: 'user' });
  expect(mockRemove).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
});

it('asks the scope when editing an occurrence: series opens the form, occurrence opens the sheet', async () => {
  mockMeetings = [
    meeting('series', {
      title: 'Weekly standup',
      startAt: '2026-10-06T16:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    }),
  ];
  await renderList();
  await act(async () => {
    fireEvent(screen.getAllByTestId('meeting-row-series')[0]!, 'longPress');
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-edit'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Edit repeating meeting', expect.any(String), expect.any(Array), { cancelable: true });
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.text === 'This meeting only')?.onPress?.();
  });
  // The occurrence edit sheet opens with the occurrence values.
  expect(await screen.findByTestId('occurrence-edit-sheet')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('occurrence-edit-cancel'));
  });

  await act(async () => {
    fireEvent(screen.getAllByTestId('meeting-row-series')[0]!, 'longPress');
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-edit'));
  });
  const seriesButtons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    seriesButtons.find((button) => button.text === 'The whole series')?.onPress?.();
  });
  expect((await screen.findByTestId('stub-EditMeeting')).props.children).toBe('EditMeeting:series');
});

it('deletes "this and following" through deleteFollowing with origin user', async () => {
  mockDeleteFollowing.mockResolvedValue(null);
  mockMeetings = [
    meeting('series', {
      title: 'Weekly standup',
      startAt: '2026-10-06T16:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    }),
  ];
  await renderList();
  await act(async () => {
    fireEvent.press(screen.getAllByTestId('meeting-row-more-series')[0]!);
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-delete'));
  });
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'This meeting only', 'This and following', 'The whole series']);
  await act(async () => {
    buttons.find((button) => button.text === 'This and following')?.onPress?.();
  });
  expect(mockDeleteFollowing).toHaveBeenCalledWith('series', '2026-10-06', { origin: 'user' });
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockCancelOccurrence).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'success', text1: 'This and the following occurrences were deleted.' }),
  );
});

it('edits "this and following" through the sheet: editFollowing gets the patch with origin user', async () => {
  mockEditFollowing.mockResolvedValue({ master: null, created: null });
  mockMeetings = [
    meeting('series', {
      title: 'Weekly standup',
      startAt: '2026-10-06T16:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    }),
  ];
  await renderList();
  await act(async () => {
    fireEvent(screen.getAllByTestId('meeting-row-series')[0]!, 'longPress');
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-edit'));
  });
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.text === 'This and following')?.onPress?.();
  });
  // The sheet opens in following mode (its own heading, shared recurrence phrasing).
  await screen.findByTestId('occurrence-edit-sheet');
  expect(screen.getByText('This and following')).toBeTruthy();
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('occurrence-edit-title'), 'Standup v2');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('occurrence-edit-save'));
  });
  expect(mockEditFollowing).toHaveBeenCalledWith('series', '2026-10-06', { title: 'Standup v2' }, { origin: 'user' });
  expect(mockUpdateOccurrence).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'success', text1: 'This and the following occurrences were updated.' }),
  );
});

it('saves an occurrence edit through updateOccurrence with origin user', async () => {
  mockUpdateOccurrence.mockResolvedValue(undefined);
  mockMeetings = [
    meeting('series', {
      title: 'Weekly standup',
      startAt: '2026-10-06T16:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null },
    }),
  ];
  await renderList();
  await act(async () => {
    fireEvent(screen.getAllByTestId('meeting-row-series')[0]!, 'longPress');
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('meeting-action-edit'));
  });
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.text === 'This meeting only')?.onPress?.();
  });
  await screen.findByTestId('occurrence-edit-sheet');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('occurrence-edit-title'), 'Standup (moved)');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('occurrence-edit-save'));
  });
  expect(mockUpdateOccurrence).toHaveBeenCalledWith('series', '2026-10-06', { title: 'Standup (moved)' }, { origin: 'user' });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
});
