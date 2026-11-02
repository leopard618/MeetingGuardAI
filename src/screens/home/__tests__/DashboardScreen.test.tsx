import { NavigationContainer, type RouteProp } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { RootStackParamList, ScheduledAlertInfo, UseMeetingsResult } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import type { Meeting } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { makeMeeting } from '../../insights/__fixtures__/meetings';
import { DashboardScreen } from '../DashboardScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

jest.mock('../../../services/auth', () => ({
  useAuth: () => ({ authUser: { uid: 'u1', displayName: 'Ana López', email: 'ana@example.com' } }),
}));

let mockMeetings: UseMeetingsResult = { meetings: [], isLoading: false, error: null, refresh: jest.fn() };
let mockOnline = true;
let mockPendingWrites = 0;
let mockAlertEnabled = true;
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    useMeetings: () => mockMeetings,
    usePreferences: () => ({
      preferences: { ...defaults({ language: 'en', timezone: 'UTC' }), alertEnabled: mockAlertEnabled, alertIntensity: 'max' },
      isLoaded: true,
      error: null,
    }),
    useSyncState: () => ({ online: mockOnline, pendingWrites: mockPendingWrites, lastSyncedAt: null }),
    useTasks: () => ({ tasks: [], isLoading: false, error: null, create: jest.fn(), update: jest.fn(), remove: jest.fn() }),
  };
});

const mockSyncNow = jest.fn();
jest.mock('../../../services/calendar', () => ({
  calendarSyncEngine: { syncNow: (...args: unknown[]) => mockSyncNow(...args) },
}));

// §27: the WhatsApp tile follows whatsappLinkStatus.enabled (null = unknown = still disabled).
let mockWhatsAppStatus: { enabled: boolean; linked: boolean; displayNumber: string | null; deepLink: string | null; linkedLast4: string | null } | null = null;
jest.mock('../../../services/whatsapp', () => ({
  useWhatsAppStatus: () => ({ status: mockWhatsAppStatus, error: null, refresh: jest.fn() }),
}));
afterEach(() => {
  mockWhatsAppStatus = null;
});

let mockPending: ScheduledAlertInfo[] = [];
const mockRequestPermissions = jest.fn(async () => ({ notifications: 'granted', canAskAgain: true, exactAlarms: 'not_required' }));
let mockPermission: { notifications: string; canAskAgain: boolean; exactAlarms: string } = {
  notifications: 'granted',
  canAskAgain: true,
  exactAlarms: 'not_required',
};
jest.mock('../../../services/alerts', () => ({
  usePendingAlerts: () => ({
    pending: mockPending,
    next: mockPending[0] ?? null,
    permission: mockPermission,
    isLoading: false,
    refresh: jest.fn(async () => undefined),
  }),
  alertEngine: {
    requestPermissions: () => mockRequestPermissions(),
    openNotificationSettings: jest.fn(async () => undefined),
    openExactAlarmSettings: jest.fn(async () => undefined),
    openAlarmChannelSettings: jest.fn(async () => undefined),
  },
}));

// Wednesday 30 September 2026, 10:00 UTC (only Date is faked; timers stay real).
const NOW = new Date('2026-09-30T10:00:00.000Z');
const minutesFromNow = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const Stack = createStackNavigator<RootStackParamList>();

function TargetStub({ route }: { route: RouteProp<RootStackParamList, keyof RootStackParamList> }) {
  return <Text testID={`target-${route.name}`}>{JSON.stringify(route.params ?? null)}</Text>;
}

async function renderDashboard() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="MeetingDetails" component={TargetStub} />
            <Stack.Screen name="AIChat" component={TargetStub} />
            <Stack.Screen name="AIInsights" component={TargetStub} />
            <Stack.Screen name="AlertSettings" component={TargetStub} />
            <Stack.Screen name="CreateMeeting" component={TargetStub} />
            <Stack.Screen name="WhatsAppConnect" component={TargetStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

function meetingsResult(meetings: Meeting[], overrides: Partial<UseMeetingsResult> = {}): UseMeetingsResult {
  return { meetings, isLoading: false, error: null, refresh: jest.fn(async () => undefined), ...overrides };
}

const CURRENT = makeMeeting({
  id: 'current',
  title: 'Design review',
  startAt: minutesFromNow(-10),
  durationMinutes: 40,
  conference: { provider: 'zoom', url: 'https://zoom.us/j/123', password: null },
});
const OVERLAPPING = makeMeeting({ id: 'overlap', title: 'Vendor call', startAt: minutesFromNow(20), durationMinutes: 30 });
const NO_LINK = makeMeeting({ id: 'later', title: 'Team lunch', startAt: minutesFromNow(240), durationMinutes: 60 });

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
  mockMeetings = meetingsResult([CURRENT, OVERLAPPING, NO_LINK]);
  mockOnline = true;
  mockPendingWrites = 0;
  mockAlertEnabled = true;
  mockPending = [];
  mockPermission = { notifications: 'granted', canAskAgain: true, exactAlarms: 'not_required' };
  mockSyncNow.mockReset().mockResolvedValue({ google: null, device: null, errors: [] });
  (Toast.show as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('shows the greeting, the meeting in progress and the next one with a live countdown', async () => {
  await renderDashboard();
  expect(screen.getByTestId('dashboard-greeting').props.children).toBe('GOOD MORNING');
  expect(screen.getByTestId('dashboard-greeting-name').props.children).toBe('Ana');
  expect(screen.getByTestId('current-meeting-title').props.children).toBe('Design review');
  expect(screen.getByTestId('current-meeting-countdown-label').props.children).toBe('Ends in');
  expect(screen.getByTestId('current-meeting-countdown').props.children).toBe('30:00');
  expect(screen.getByTestId('next-meeting-title').props.children).toBe('Vendor call');
  expect(screen.getByTestId('next-meeting-countdown-label').props.children).toBe('Starts in');
  expect(screen.getByTestId('next-meeting-countdown').props.children).toBe('20:00');
  // Join only for the meeting with a real link.
  expect(screen.getByTestId('current-meeting-join')).toBeTruthy();
  expect(screen.queryByTestId('next-meeting-join')).toBeNull();
});

it('opens the real meeting link and the meeting details', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await renderDashboard();
  await act(async () => {
    fireEvent.press(screen.getByTestId('current-meeting-join'));
  });
  expect(openURL).toHaveBeenCalledWith('https://zoom.us/j/123');

  await act(async () => {
    fireEvent.press(screen.getByTestId('next-meeting-details'));
  });
  expect(JSON.parse(String((await screen.findByTestId('target-MeetingDetails')).props.children))).toEqual({ meetingId: 'overlap' });
});

it("lists today's meetings and highlights overlaps", async () => {
  await renderDashboard();
  expect(screen.getByTestId('today-count').props.children).toBe('3 meetings');
  expect(within(screen.getByTestId('timeline-current-overlap')).getByText('Overlaps with Vendor call')).toBeTruthy();
  expect(within(screen.getByTestId('timeline-overlap-overlap')).getByText('Overlaps with Design review')).toBeTruthy();
  expect(screen.queryByTestId('timeline-later-overlap')).toBeNull();
  expect(screen.getByTestId('insight-overlaps')).toBeTruthy();
  expect(screen.getByText('1 overlap between meetings')).toBeTruthy();
  expect(screen.getByText('2 meetings have no link or place')).toBeTruthy();
});

it('shows an empty day with a create button', async () => {
  mockMeetings = meetingsResult([]);
  await renderDashboard();
  expect(screen.getByTestId('today-empty')).toBeTruthy();
  expect(screen.getByText('No upcoming meetings')).toBeTruthy();
  expect(screen.getByTestId('insight-all-clear')).toBeTruthy();
});

it('shows only the error, with Retry, when no meetings could be read (not "no meetings")', async () => {
  const refresh = jest.fn(async () => undefined);
  mockMeetings = meetingsResult([], { error: new AppError('permission_denied', 'rules'), refresh });
  await renderDashboard();
  expect(screen.getByTestId('dashboard-error')).toBeTruthy();
  expect(screen.queryByTestId('today-empty')).toBeNull();
  expect(screen.queryByText('No upcoming meetings')).toBeNull();
  expect(screen.queryByTestId('insight-all-clear')).toBeNull();
  expect(screen.queryByTestId('today-count')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByText('Try again'));
  });
  expect(refresh).toHaveBeenCalled();
});

it('shows the loading state until the meetings are known', async () => {
  mockMeetings = meetingsResult([], { isLoading: true });
  await renderDashboard();
  expect(screen.getByTestId('dashboard-loading')).toBeTruthy();
  expect(screen.queryByTestId('next-meeting-card')).toBeNull();
});

it('has no alerts card: alert settings live in the menu and Settings', async () => {
  mockAlertEnabled = false;
  await renderDashboard();
  expect(screen.queryByTestId('alert-status')).toBeNull();
  expect(screen.queryByText('Allow notifications')).toBeNull();
  expect(screen.getByTestId('quick-actions')).toBeTruthy();
  expect(screen.getByTestId('dashboard-tasks')).toBeTruthy();
});

it('shows the week against last week and opens the insights screen from the week card', async () => {
  await renderDashboard();
  expect(screen.getByTestId('week-meetings').props.children).toBe('3 meetings');
  await act(async () => {
    fireEvent.press(screen.getByTestId('insights-see-all'));
  });
  expect(await screen.findByTestId('target-AIInsights')).toBeTruthy();
});

it('offers manual and AI creation; WhatsApp is disabled ("coming soon")', async () => {
  await renderDashboard();
  expect(screen.getByTestId('quick-whatsapp').props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByTestId('quick-whatsapp').props.accessibilityLabel).toBe('WhatsApp: coming soon, not available yet');
  await act(async () => {
    fireEvent.press(screen.getByTestId('quick-new-manual'));
  });
  expect(await screen.findByTestId('target-CreateMeeting')).toBeTruthy();
});

it('the WhatsApp tile opens the WhatsApp setup once the server-side bot is enabled', async () => {
  mockWhatsAppStatus = { enabled: true, linked: false, displayNumber: null, deepLink: null, linkedLast4: null };
  await renderDashboard();
  expect(screen.getByTestId('quick-whatsapp').props.accessibilityLabel).toBe('WhatsApp: create meetings by message. Opens the WhatsApp setup');
  await act(async () => {
    fireEvent.press(screen.getByTestId('quick-whatsapp'));
  });
  expect(await screen.findByTestId('target-WhatsAppConnect')).toBeTruthy();
});

it('pull to refresh flushes and re-reads the meetings and syncs the calendars; failures are reported', async () => {
  const refresh = jest.fn(async () => {
    throw new AppError('offline', 'no network');
  });
  mockMeetings = meetingsResult([CURRENT], { refresh });
  mockSyncNow.mockResolvedValue({ google: null, device: null, errors: [{ provider: 'google', code: 'calendar_scope_missing' }] });
  await renderDashboard();
  await act(async () => {
    await screen.getByTestId('dashboard-list').props.onRefresh();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(mockSyncNow).toHaveBeenCalledWith({ reason: 'manual' });
  const messages = (Toast.show as jest.Mock).mock.calls.map(([options]) => (options as { text1: string }).text1);
  expect(messages).toEqual([
    expect.stringMatching(/^Could not refresh: /),
    expect.stringMatching(/^Calendar sync failed: /),
  ]);
});

it('shows the offline banner with the number of changes waiting to sync', async () => {
  mockOnline = false;
  mockPendingWrites = 2;
  await renderDashboard();
  expect(screen.getByTestId('offline-banner')).toBeTruthy();
  expect(screen.getByText(/2 changes are waiting to sync\./)).toBeTruthy();
});

it('renders in Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderDashboard();
  expect(screen.getByTestId('dashboard-greeting').props.children).toBe('BUENOS DÍAS');
  expect(screen.getByText('Nueva reunión')).toBeTruthy();
  expect(screen.getByTestId('next-meeting-countdown-label').props.children).toBe('Empieza en');
  expect(screen.getByTestId('next-meeting-countdown').props.children).toBe('20:00');
});
