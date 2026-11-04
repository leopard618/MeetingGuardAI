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
// Absent by default, like a build without EXPO_PUBLIC_MSAL_CLIENT_ID (§22).
let mockOutlook: { configured: boolean; connected: boolean } | undefined;
jest.mock('../../../services/calendar', () => ({
  useCalendarStatus: () => ({
    google: { enabled: mockGoogleConnected, hasScope: mockGoogleConnected, connected: mockGoogleConnected },
    device: { enabled: false },
    ...(mockOutlook ? { outlook: mockOutlook } : {}),
  }),
}));

// §24: zoomStatus answer (null = unknown), the per-session failure map and the zoom calls.
let mockZoomConfigured: boolean | null = null;
const mockZoomFailures = new Map<string, string>();
const mockEnsureLink = jest.fn();
const mockOnMeetingDeleted = jest.fn();
jest.mock('../../../services/zoom', () => ({
  useZoomStatus: () => ({ configured: mockZoomConfigured, refresh: jest.fn() }),
  zoomService: {
    ensureLink: (...args: unknown[]) => mockEnsureLink(...args),
    linkFailure: (id: string) => mockZoomFailures.get(id) ?? null,
    onMeetingDeleted: (...args: unknown[]) => mockOnMeetingDeleted(...args),
  },
}));

// §25: the signed-in account (needsEmailVerification gates the zoom promise; default verified).
let mockAuthUser: { uid: string; email: string | null; displayName: string | null; photoURL: string | null; emailVerified: boolean; providerIds: string[] } | null = null;
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({ authUser: mockAuthUser }),
}));

// M9: the running-late sheet is a global host; the screen only opens it.
const mockOpenRunningLate = jest.fn();
jest.mock('../RunningLateSheet', () => ({ openRunningLate: (...args: unknown[]) => mockOpenRunningLate(...args) }));

const mockRemove = jest.fn();
const mockUpdate = jest.fn();
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
    meetingRepository: { remove: (...args: unknown[]) => mockRemove(...args), update: (...args: unknown[]) => mockUpdate(...args) },
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

function ChatStub({ route }: { route: { params?: Record<string, unknown> } }) {
  return <Text testID="chat-screen">{JSON.stringify(route.params)}</Text>;
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
            <Stack.Screen name="AIChat" component={ChatStub} />
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
  mockOutlook = undefined;
  mockZoomConfigured = null;
  mockAuthUser = { uid: 'u1', email: 'a@b.c', displayName: null, photoURL: null, emailVerified: true, providerIds: ['google.com'] };
  mockZoomFailures.clear();
  mockEnsureLink.mockReset();
  mockEnsureLink.mockResolvedValue({ url: 'https://zoom.us/j/123', password: null, zoomMeetingId: '123' });
  mockOnMeetingDeleted.mockReset();
  mockOnMeetingDeleted.mockResolvedValue(undefined);
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
  expect(Alert.alert).toHaveBeenCalledWith('Delete "Budget review"?', expect.stringContaining('Google Calendar'), expect.any(Array));
  await act(async () => {
    pressDestructive();
  });
  expect(mockRemove).toHaveBeenCalledWith('m1', { origin: 'user' });
  // §24: a deleted meeting also deletes its server-created Zoom meeting (no-op without a ref).
  expect(mockOnMeetingDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
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
  expect(screen.getByTestId('meeting-when').props.children).toMatch(/^mar, 6 oct( 2026)? · 15:00 - 16:00$/);
});

it('promises a Meet link only when Google Calendar is connected, else offers to connect it', async () => {
  mockMeeting = meeting({ conference: { provider: 'google_meet', url: null, password: null }, source: 'manual', external: {} });
  await renderDetails();
  expect(screen.getByTestId('meeting-conference-meetPending')).toBeTruthy();
  expect(screen.queryByTestId('meeting-connect-calendar')).toBeNull();
});

it('asks to connect Google Calendar for a Meet meeting without sync', async () => {
  mockGoogleConnected = false;
  mockMeeting = meeting({ conference: { provider: 'google_meet', url: null, password: null }, source: 'manual', external: {} });
  await renderDetails();
  expect(screen.queryByTestId('meeting-conference-meetPending')).toBeNull();
  expect(screen.getByTestId('meeting-conference-meetNeedsCalendar')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-connect-calendar'));
  });
  expect(await screen.findByTestId('calendar-sync-screen')).toBeTruthy();
});

describe('Teams conference card (§22)', () => {
  const teamsMeeting = (external: Record<string, string> = {}) =>
    meeting({ conference: { provider: 'teams', url: null, password: null }, source: 'manual', external });

  it('falls back to the paste hint while Outlook is hidden or unconfigured', async () => {
    mockMeeting = teamsMeeting();
    await renderDetails();
    expect(screen.getByTestId('meeting-conference-noLink')).toBeTruthy();
    expect(screen.queryByTestId('meeting-connect-outlook')).toBeNull();

    mockOutlook = { configured: false, connected: false };
    await renderDetails();
    expect(screen.getByTestId('meeting-conference-noLink')).toBeTruthy();
  });

  it('promises a Teams link when Outlook is connected ("waiting for sync")', async () => {
    mockOutlook = { configured: true, connected: true };
    mockMeeting = teamsMeeting();
    await renderDetails();
    expect(screen.getByTestId('meeting-conference-teamsPending')).toBeTruthy();
    expect(screen.queryByTestId('meeting-connect-outlook')).toBeNull();
  });

  it('asks to connect Outlook when configured but not connected, and opens calendar sync', async () => {
    mockOutlook = { configured: true, connected: false };
    mockMeeting = teamsMeeting();
    await renderDetails();
    expect(screen.getByTestId('meeting-conference-teamsNeedsOutlook')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-connect-outlook'));
    });
    expect(await screen.findByTestId('calendar-sync-screen')).toBeTruthy();
  });

  it('says it is too late for an auto link once the meeting is already in Outlook (create-only)', async () => {
    mockOutlook = { configured: true, connected: true };
    mockMeeting = teamsMeeting({ outlookEventId: 'AAMk1', outlookCalendarId: 'cal1' });
    await renderDetails();
    expect(screen.getByTestId('meeting-conference-teamsLinkTooLate')).toBeTruthy();
    expect(screen.queryByTestId('meeting-conference-teamsPending')).toBeNull();
    expect(screen.queryByTestId('meeting-connect-outlook')).toBeNull();
  });

  it('joins through the written-back Teams link like any other meeting', async () => {
    mockOutlook = { configured: true, connected: true };
    mockMeeting = meeting({
      conference: { provider: 'teams', url: 'https://teams.microsoft.com/l/m/1', password: null },
      source: 'manual',
      external: { outlookEventId: 'AAMk1' },
    });
    await renderDetails();
    expect(screen.getByTestId('meeting-join')).toBeTruthy();
    expect(screen.queryByTestId('meeting-conference-teamsPending')).toBeNull();
  });
});

describe('Zoom conference card (§24)', () => {
  const zoomMeeting = () => meeting({ conference: { provider: 'zoom', url: null, password: null }, source: 'manual', external: {} });

  it('shows the plain no-link copy while the server status is unknown (no server call)', async () => {
    mockMeeting = zoomMeeting();
    await renderDetails();
    expect(screen.getByTestId('meeting-conference-noLink')).toBeTruthy();
    expect(mockEnsureLink).not.toHaveBeenCalled();
  });

  it('shows "being created" and asks the server for the link when configured (idempotent join)', async () => {
    mockZoomConfigured = true;
    mockMeeting = zoomMeeting();
    await renderDetails();
    expect(screen.getByTestId('meeting-conference-zoomPending')).toBeTruthy();
    expect(screen.queryByTestId('meeting-zoom-retry')).toBeNull();
    expect(mockEnsureLink).toHaveBeenCalledWith('m1');
  });

  it('swaps to "could not be created" + Retry after a failure, and retries on tap', async () => {
    mockZoomConfigured = true;
    mockMeeting = zoomMeeting();
    mockEnsureLink.mockImplementation(async (id: string) => {
      mockZoomFailures.set(id, 'upstream_error');
      throw new Error('simulated zoom failure');
    });
    await renderDetails();
    expect(await screen.findByTestId('meeting-conference-zoomCreateFailed')).toBeTruthy();
    const retry = screen.getByTestId('meeting-zoom-retry');

    // The retry succeeds: the failure record clears and the card goes back to the pending copy
    // (the real link then arrives through the meeting listener and turns the card into Join).
    mockEnsureLink.mockImplementation(async (id: string) => {
      mockZoomFailures.delete(id);
      return { url: 'https://zoom.us/j/123', password: null, zoomMeetingId: '123' };
    });
    await act(async () => {
      fireEvent.press(retry);
    });
    expect(screen.getByTestId('meeting-conference-zoomPending')).toBeTruthy();
    expect(screen.queryByTestId('meeting-zoom-retry')).toBeNull();
  });

  it('a pasted or server-written url always wins over the pending state', async () => {
    mockZoomConfigured = true;
    mockMeeting = meeting({ conference: { provider: 'zoom', url: 'https://zoom.us/j/42', password: null }, source: 'manual', external: {} });
    await renderDetails();
    expect(screen.getByTestId('meeting-join')).toBeTruthy();
    expect(mockEnsureLink).not.toHaveBeenCalled();
  });

  it('never promises or requests a link for an UNVERIFIED email user (the server would refuse, §25)', async () => {
    mockZoomConfigured = true;
    mockAuthUser = { uid: 'u1', email: 'a@b.c', displayName: null, photoURL: null, emailVerified: false, providerIds: ['password'] };
    mockMeeting = zoomMeeting();
    await renderDetails();
    // Plain no-link copy instead of "being created", and no doomed ensureLink/retry loop.
    expect(screen.getByTestId('meeting-conference-noLink')).toBeTruthy();
    expect(screen.queryByTestId('meeting-conference-zoomPending')).toBeNull();
    expect(screen.queryByTestId('meeting-zoom-retry')).toBeNull();
    expect(mockEnsureLink).not.toHaveBeenCalled();
  });
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

describe('running late and end now (M9)', () => {
  // A fixed clock: "End now" shortens the meeting to the elapsed whole minutes.
  const NOW_MS = Date.parse('2026-10-06T15:00:00.000Z');
  const minutesFromNow = (minutes: number) => new Date(NOW_MS + minutes * 60_000).toISOString();
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW_MS,
      doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('hides both on a meeting that is over', async () => {
    mockMeeting = meeting({ startAt: minutesFromNow(-120), durationMinutes: 60 });
    await renderDetails();
    expect(screen.queryByTestId('meeting-running-late')).toBeNull();
    expect(screen.queryByTestId('meeting-end-now')).toBeNull();
  });

  it('opens the running-late sheet for an upcoming meeting; End now appears only while it runs', async () => {
    mockOpenRunningLate.mockReset();
    mockMeeting = meeting({ startAt: minutesFromNow(30), durationMinutes: 60 });
    await renderDetails();
    expect(screen.queryByTestId('meeting-end-now')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-running-late'));
    });
    expect(mockOpenRunningLate).toHaveBeenCalledWith({ meetingId: 'm1', startAt: null });
  });

  it('ends a running meeting now after a confirmation (origin user)', async () => {
    mockUpdate.mockReset().mockResolvedValue(undefined);
    mockMeeting = meeting({ startAt: minutesFromNow(-25), durationMinutes: 60 });
    await renderDetails();
    await act(async () => {
      fireEvent.press(screen.getByTestId('meeting-end-now'));
    });
    expect(Alert.alert).toHaveBeenCalledWith('End "Budget review" now?', expect.stringContaining('ends now'), expect.any(Array), expect.anything());
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((button) => button.text === 'End now')?.onPress?.();
    });
    expect(mockUpdate).toHaveBeenCalledWith('m1', { durationMinutes: 25 }, { origin: 'user' });
  });
});

describe('debrief (M8)', () => {
  it('offers a debrief for a meeting that has ended and opens the assistant in debrief mode', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T17:00:00.000Z'));
    try {
      await renderDetails();
      await act(async () => {
        fireEvent.press(screen.getByTestId('meeting-debrief'));
      });
      expect(screen.getByTestId('chat-screen').props.children).toBe(JSON.stringify({ debrief: 'm1' }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('hides the debrief button while the meeting is still ahead', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
    try {
      await renderDetails();
      expect(screen.queryByTestId('meeting-debrief')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
