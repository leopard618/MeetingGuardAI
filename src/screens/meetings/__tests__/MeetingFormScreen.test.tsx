import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { RootStackParamList } from '../../../core/contracts';
import { buildMeeting, type Meeting } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { MeetingFormScreen } from '../MeetingFormScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

// A meeting store the test can change while the form is open (a live update from sync).
let mockMeeting: Meeting | null = null;
const mockMeetingListeners = new Set<() => void>();
function setMeeting(next: Meeting): void {
  mockMeeting = next;
  mockMeetingListeners.forEach((listener) => listener());
}

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('../../../services/data', () => {
  const React = jest.requireActual('react');
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    useMeeting: (id: string | null) => {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setTick((value: number) => value + 1);
        mockMeetingListeners.add(listener);
        return () => {
          mockMeetingListeners.delete(listener);
        };
      }, []);
      return { meeting: id === null ? null : mockMeeting, isLoading: false, error: null };
    },
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
    meetingRepository: {
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  };
});

jest.mock('../../../services/calendar', () => ({
  useCalendarStatus: () => ({ google: { enabled: false, hasScope: false }, device: { enabled: false } }),
}));

const mockAttachments = {
  listForMeeting: jest.fn(),
  add: jest.fn(),
  remove: jest.fn(),
  linkToMeeting: jest.fn(),
};
jest.mock('../../../services/attachments', () => ({
  ...jest.requireActual('../../../services/attachments/fileTypes'),
  attachmentService: {
    listForMeeting: (...args: unknown[]) => mockAttachments.listForMeeting(...args),
    add: (...args: unknown[]) => mockAttachments.add(...args),
    remove: (...args: unknown[]) => mockAttachments.remove(...args),
    linkToMeeting: (...args: unknown[]) => mockAttachments.linkToMeeting(...args),
  },
}));

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}): Meeting {
  return buildMeeting(
    { title: 'Budget review', startAt: '2026-10-06T15:00:00.000Z', timezone: 'UTC', source: 'manual', ...overrides },
    { id: 'm1', userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

const Stack = createStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function Home() {
  return <Text testID="home">home</Text>;
}

function Details() {
  return <Text testID="details">details</Text>;
}

async function renderForm(target: 'CreateMeeting' | 'EditMeeting') {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Dashboard" component={Home} />
            <Stack.Screen name="CreateMeeting" component={MeetingFormScreen} />
            <Stack.Screen name="EditMeeting" component={MeetingFormScreen} />
            <Stack.Screen name="MeetingDetails" component={Details} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
  await act(async () => {
    if (target === 'EditMeeting') navigationRef.navigate('EditMeeting', { meetingId: 'm1' });
    else navigationRef.navigate('CreateMeeting', {});
  });
}

function lastAlert(): { title: string; buttons: { text?: string; style?: string; onPress?: () => void }[] } {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const call = calls[calls.length - 1] as [string, string, { text?: string; style?: string; onPress?: () => void }[]];
  return { title: call[0], buttons: call[2] };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockMeeting = meeting();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  Object.values(mockAttachments).forEach((fn) => fn.mockReset());
  mockAttachments.listForMeeting.mockResolvedValue([]);
  mockAttachments.remove.mockResolvedValue(undefined);
  mockAttachments.linkToMeeting.mockImplementation(async (id: string, meetingId: string) => ({ id, meetingId }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('labels the switches and the notes field for screen readers', async () => {
  await renderForm('CreateMeeting');
  expect(screen.getByLabelText('All day')).toBeTruthy();
  expect(screen.getByLabelText('Use my default reminders')).toBeTruthy();
  // The notes section title and the field's own label.
  expect(screen.getAllByText('Notes').length).toBeGreaterThanOrEqual(2);
});

it('leaves an unchanged form without asking', async () => {
  await renderForm('CreateMeeting');
  await act(async () => {
    navigationRef.goBack();
  });
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(await screen.findByTestId('home')).toBeTruthy();
});

it('asks before discarding changes on back, and deletes files picked in the form', async () => {
  mockAttachments.add.mockResolvedValue({ cancelled: false, added: [{ id: 'n1', name: 'photo.jpg', meetingId: null }], failures: [] });
  await renderForm('CreateMeeting');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Planning');
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Add photo'));
  });

  await act(async () => {
    navigationRef.goBack();
  });
  expect(lastAlert().title).toBe('Discard changes?');
  expect(screen.queryByTestId('home')).toBeNull();

  // Keep editing: nothing happens.
  await act(async () => {
    lastAlert().buttons.find((button) => button.style === 'cancel')?.onPress?.();
  });
  expect(screen.getByTestId('meeting-form-title')).toBeTruthy();

  await act(async () => {
    navigationRef.goBack();
  });
  await act(async () => {
    lastAlert().buttons.find((button) => button.style === 'destructive')?.onPress?.();
  });
  expect(await screen.findByTestId('home')).toBeTruthy();
  expect(mockAttachments.remove).toHaveBeenCalledWith('n1');
  expect(mockCreate).not.toHaveBeenCalled();
});

it('removes a saved attachment only when the edit is saved', async () => {
  mockAttachments.listForMeeting.mockResolvedValue([{ id: 'a1', name: 'Agenda.pdf', meetingId: 'm1' }]);
  await renderForm('EditMeeting');
  expect(await screen.findByTestId('meeting-form-attachment-a1')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-remove-attachment-a1'));
  });
  expect(screen.queryByTestId('meeting-form-attachment-a1')).toBeNull();
  expect(screen.getByTestId('meeting-form-attachments-removed')).toBeTruthy();
  expect(mockAttachments.remove).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-save'));
  });
  expect(mockAttachments.remove).toHaveBeenCalledWith('a1');
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(await screen.findByTestId('home')).toBeTruthy();
});

it('keeps a removed attachment when the edit is discarded', async () => {
  mockAttachments.listForMeeting.mockResolvedValue([{ id: 'a1', name: 'Agenda.pdf', meetingId: 'm1' }]);
  await renderForm('EditMeeting');
  await screen.findByTestId('meeting-form-attachment-a1');
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-remove-attachment-a1'));
  });
  await act(async () => {
    navigationRef.goBack();
  });
  await act(async () => {
    lastAlert().buttons.find((button) => button.style === 'destructive')?.onPress?.();
  });
  expect(await screen.findByTestId('home')).toBeTruthy();
  expect(mockAttachments.remove).not.toHaveBeenCalled();
});

it('keeps a file picked in the edit form when the meeting changes meanwhile, and links it on save', async () => {
  mockAttachments.add.mockResolvedValue({ cancelled: false, added: [{ id: 'n1', name: 'photo.jpg', meetingId: null }], failures: [] });
  mockUpdate.mockImplementation(async () => mockMeeting);
  await renderForm('EditMeeting');
  await act(async () => {
    fireEvent.press(screen.getByText('Add photo'));
  });
  expect(screen.getByTestId('meeting-form-attachment-n1')).toBeTruthy();

  // The Google write-back (Meet link) arrives while the form is open.
  await act(async () => {
    setMeeting({ ...meeting(), updatedAt: '2026-10-01T00:05:00.000Z', external: { ...meeting().external, googleEventId: 'evt1' } });
  });
  expect(screen.getByTestId('meeting-form-attachment-n1')).toBeTruthy();
  expect(mockAttachments.listForMeeting).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-save'));
  });
  expect(mockAttachments.linkToMeeting).toHaveBeenCalledWith('n1', 'm1');
  expect(await screen.findByTestId('home')).toBeTruthy();
});

it('opens the new meeting after a create without asking to discard', async () => {
  mockCreate.mockImplementation(async () => meeting({ title: 'Planning' }));
  await renderForm('CreateMeeting');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Planning');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-save'));
  });
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Planning' }), { origin: 'user' });
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(await screen.findByTestId('details')).toBeTruthy();
});


it('creates a weekly meeting through the repeat picker (own weekday preselected)', async () => {
  mockCreate.mockImplementation(async (input: unknown) => meeting(input as Partial<Parameters<typeof buildMeeting>[0]>));
  await renderForm('CreateMeeting');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Standup');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-repeat-weekly'));
  });
  // The meeting's own weekday chip is preselected and the summary describes the rule.
  expect(screen.getByTestId('meeting-form-repeat-summary').props.children).toMatch(/^Repeats weekly on /);
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-repeat-end-afterCount'));
  });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meeting-form-repeat-count'), '8');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-save'));
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const input = mockCreate.mock.calls[0]![0] as { recurrence: unknown };
  expect(input.recurrence).toMatchObject({ freq: 'weekly', interval: 1, count: 8, until: null });
});

it('rejects an invalid repeat interval instead of saving', async () => {
  await renderForm('CreateMeeting');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Standup');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-repeat-daily'));
  });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meeting-form-repeat-interval'), '0');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-form-save'));
  });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(screen.getByText('Enter how often it repeats (1–99).')).toBeTruthy();
});

it('notes that editing a recurring meeting changes the whole series', async () => {
  mockMeeting = meeting({ recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null } });
  await renderForm('EditMeeting');
  expect(screen.getByTestId('meeting-form-series-note')).toBeTruthy();
  expect(screen.getByTestId('meeting-form-repeat-summary').props.children).toBe('Repeats daily');
});
