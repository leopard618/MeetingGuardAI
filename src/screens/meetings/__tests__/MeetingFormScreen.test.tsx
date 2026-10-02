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

// Mutable calendar status: the video-call section derives its copy from the LIVE value (§22).
let mockCalendar: {
  google: { enabled: boolean; hasScope: boolean; connected: boolean };
  device: { enabled: boolean };
  outlook?: { configured: boolean; connected: boolean };
} = { google: { enabled: false, hasScope: false, connected: false }, device: { enabled: false } };
jest.mock('../../../services/calendar', () => ({
  useCalendarStatus: () => mockCalendar,
}));

// §24: the session's zoomStatus answer (null = unknown) and the post-save zoom hooks.
let mockZoomConfigured: boolean | null = null;
const mockEnsureLink = jest.fn();
const mockSyncIfNeeded = jest.fn();
jest.mock('../../../services/zoom', () => ({
  useZoomStatus: () => ({ configured: mockZoomConfigured, refresh: jest.fn() }),
  zoomService: {
    ensureLink: (...args: unknown[]) => mockEnsureLink(...args),
    syncIfNeeded: (...args: unknown[]) => mockSyncIfNeeded(...args),
  },
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

function CalendarSyncStub() {
  return <Text testID="calendar-sync-screen">calendar sync</Text>;
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
            <Stack.Screen name="CalendarSync" component={CalendarSyncStub} />
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
  mockCalendar = { google: { enabled: false, hasScope: false, connected: false }, device: { enabled: false } };
  mockMeeting = meeting();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockZoomConfigured = null;
  mockEnsureLink.mockReset();
  mockEnsureLink.mockResolvedValue({ url: 'https://zoom.us/j/123', password: null, zoomMeetingId: '123' });
  mockSyncIfNeeded.mockReset();
  mockSyncIfNeeded.mockResolvedValue(undefined);
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
  expect(screen.getByText('Enter how often it repeats (1-99).')).toBeTruthy();
});

it('notes that editing a recurring meeting changes the whole series', async () => {
  mockMeeting = meeting({ recurrence: { freq: 'daily', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null } });
  await renderForm('EditMeeting');
  expect(screen.getByTestId('meeting-form-series-note')).toBeTruthy();
  expect(screen.getByTestId('meeting-form-repeat-summary').props.children).toBe('Repeats daily');
});

describe('video call section (§22)', () => {
  const pickProvider = async (choice: string): Promise<void> => {
    await act(async () => {
      fireEvent.press(screen.getByTestId(`meeting-form-conference-${choice}`));
    });
  };

  it('changes the helper text with the provider chips (nothing is connected)', async () => {
    await renderForm('CreateMeeting');
    expect(screen.queryByTestId('meeting-form-conference-hint')).toBeNull();
    expect(screen.queryByTestId('meeting-form-link')).toBeNull();

    await pickProvider('google_meet');
    expect(screen.getByText(/^Connect Google Calendar \(Settings/)).toBeTruthy();
    expect(screen.getByTestId('meeting-form-connect-calendar')).toBeTruthy();
    // Paper renders an outlined input's label twice (label + outline cutout).
    expect(screen.getAllByText('Existing link (optional)').length).toBeGreaterThan(0);

    await pickProvider('zoom');
    expect(screen.getByText(/^Paste the link from your Zoom/)).toBeTruthy();
    expect(screen.queryByTestId('meeting-form-connect-calendar')).toBeNull();
    // Status unknown (zoomStatus not answered): plain paste, no "not set up" note (§24).
    expect(screen.queryByTestId('meeting-form-conference-note')).toBeNull();
    expect(screen.getAllByText('Meeting link').length).toBeGreaterThan(0);

    // Outlook is hidden in this build: Teams never advertises an auto link.
    await pickProvider('teams');
    expect(screen.getByText(/^Paste the link from your Zoom/)).toBeTruthy();
    expect(screen.queryByTestId('meeting-form-connect-calendar')).toBeNull();

    await pickProvider('other');
    expect(screen.getByText(/^Paste the link from your Zoom/)).toBeTruthy();

    await pickProvider('none');
    expect(screen.queryByTestId('meeting-form-conference-hint')).toBeNull();
  });

  it('promises a real Meet link when Google Calendar is connected', async () => {
    mockCalendar = { google: { enabled: true, hasScope: true, connected: true }, device: { enabled: false } };
    await renderForm('CreateMeeting');
    await pickProvider('google_meet');
    expect(screen.getByText(/^A real Google Meet link will be created/)).toBeTruthy();
    expect(screen.queryByTestId('meeting-form-connect-calendar')).toBeNull();
  });

  it('promises a real Teams link when Outlook is configured and connected', async () => {
    mockCalendar = {
      google: { enabled: false, hasScope: false, connected: false },
      device: { enabled: false },
      outlook: { configured: true, connected: true },
    };
    await renderForm('CreateMeeting');
    await pickProvider('teams');
    expect(screen.getByText(/^A real Microsoft Teams link will be created/)).toBeTruthy();
    expect(screen.queryByTestId('meeting-form-connect-calendar')).toBeNull();
    expect(screen.getAllByText('Existing link (optional)').length).toBeGreaterThan(0);
  });

  it('asks to connect Outlook for Teams when configured but not connected, and opens calendar sync', async () => {
    mockCalendar = {
      google: { enabled: false, hasScope: false, connected: false },
      device: { enabled: false },
      outlook: { configured: true, connected: false },
    };
    await renderForm('CreateMeeting');
    await pickProvider('teams');
    expect(screen.getByText(/^Connect Outlook \(Settings/)).toBeTruthy();
    const connect = screen.getByTestId('meeting-form-connect-calendar');
    await act(async () => {
      fireEvent.press(connect);
    });
    expect(await screen.findByTestId('calendar-sync-screen')).toBeTruthy();
  });

  it('hides the hint once a link is pasted, and only then shows the passcode field', async () => {
    await renderForm('CreateMeeting');
    await pickProvider('zoom');
    expect(screen.getByTestId('meeting-form-conference-hint')).toBeTruthy();
    expect(screen.queryByTestId('meeting-form-passcode')).toBeNull();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('meeting-form-link'), 'https://zoom.us/j/42');
    });
    expect(screen.queryByTestId('meeting-form-conference-hint')).toBeNull();
    expect(screen.getByTestId('meeting-form-passcode')).toBeTruthy();
  });

  it('keeps a stored passcode editable when the meeting is edited', async () => {
    mockMeeting = meeting({ conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: 'pw1' } });
    await renderForm('EditMeeting');
    expect(screen.getByTestId('meeting-form-passcode').props.value).toBe('pw1');
  });

  it('promises a server-created Zoom link once the server said it is configured (§24)', async () => {
    mockZoomConfigured = true;
    await renderForm('CreateMeeting');
    await pickProvider('zoom');
    expect(screen.getByText('A Zoom link will be created when you save')).toBeTruthy();
    expect(screen.queryByTestId('meeting-form-conference-note')).toBeNull();
    // No connect CTA: only the project owner can configure the server side.
    expect(screen.queryByTestId('meeting-form-connect-calendar')).toBeNull();
    expect(screen.getAllByText('Existing link (optional)').length).toBeGreaterThan(0);
  });

  it('keeps the paste hint plus the muted note when the server said Zoom is not set up (§24)', async () => {
    mockZoomConfigured = false;
    await renderForm('CreateMeeting');
    await pickProvider('zoom');
    expect(screen.getByText(/^Paste the link from your Zoom/)).toBeTruthy();
    expect(screen.getByTestId('meeting-form-conference-note').props.children).toBe('Automatic Zoom links are not set up yet');
    expect(screen.getAllByText('Meeting link').length).toBeGreaterThan(0);
  });
});

describe('zoom save hooks (§24)', () => {
  const zoomDraftMeeting = (url: string | null) => meeting({ conference: { provider: 'zoom', url, password: null } });

  it('requests the server-created link after saving a zoom meeting without a pasted link', async () => {
    mockZoomConfigured = true;
    mockCreate.mockImplementation(async () => zoomDraftMeeting(null));
    await renderForm('CreateMeeting');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Zoom sync');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-form-conference-zoom'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-form-save'));
    });
    expect(mockEnsureLink).toHaveBeenCalledWith('m1');
    expect(mockSyncIfNeeded).not.toHaveBeenCalled();
  });

  it('never requests a link when one was pasted, or while the status is unknown/not configured', async () => {
    // Pasted link wins (even with the integration configured).
    mockZoomConfigured = true;
    mockCreate.mockImplementation(async () => zoomDraftMeeting('https://zoom.us/j/7'));
    await renderForm('CreateMeeting');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Pasted');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-form-conference-zoom'));
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('meeting-form-link'), 'https://zoom.us/j/7');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-form-save'));
    });
    expect(mockEnsureLink).not.toHaveBeenCalled();

    // Status unknown: saving a link-less zoom meeting stays paste-only (no server call).
    mockZoomConfigured = null;
    mockCreate.mockImplementation(async () => zoomDraftMeeting(null));
    await renderForm('CreateMeeting');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Unknown status');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-form-conference-zoom'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-form-save'));
    });
    expect(mockEnsureLink).not.toHaveBeenCalled();
  });

  it('syncs the existing Zoom meeting after an edit (the service checks the patch itself)', async () => {
    mockMeeting = meeting({
      conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: null },
      external: { zoomMeetingId: '123' },
    });
    mockUpdate.mockImplementation(async (id: unknown, patch: unknown) => ({ ...mockMeeting, ...(patch as object) }));
    await renderForm('EditMeeting');
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('meeting-form-title'), 'Renamed');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-form-save'));
    });
    expect(mockUpdate).toHaveBeenCalledWith('m1', expect.objectContaining({ title: 'Renamed' }), { origin: 'user' });
    expect(mockSyncIfNeeded).toHaveBeenCalledTimes(1);
    expect(mockSyncIfNeeded.mock.calls[0]![0]).toMatchObject({ id: 'm1' });
    expect(mockSyncIfNeeded.mock.calls[0]![1]).toMatchObject({ title: 'Renamed' });
    expect(mockEnsureLink).not.toHaveBeenCalled();
  });
});
