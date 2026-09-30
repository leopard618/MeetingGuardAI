import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import type { CalendarStatus, DeviceCalendarInfo } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { createDefaultPreferences, type Preferences } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { CalendarSyncScreen } from '../CalendarSyncScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

let mockDarkMode = false;
jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: mockDarkMode }),
  // For useAppTheme (src/theme) in any nested MG kit component.
  useOptionalTheme: () => ({ colorScheme: mockDarkMode ? 'dark' : 'light' }),
  resolveColorScheme: (_preference: string, system: 'light' | 'dark' | null | undefined) => system ?? 'light',
}));

const mockStatus: { current: CalendarStatus } = { current: status() };
const mockGoogle = {
  isConnected: jest.fn(async () => false),
  connect: jest.fn(),
  disconnect: jest.fn(async () => undefined),
};
const mockDevice = {
  getPermission: jest.fn(async () => 'granted'),
  requestPermission: jest.fn(async () => 'granted'),
  listCalendars: jest.fn(async (): Promise<DeviceCalendarInfo[]> => []),
};
const mockOutlook = {
  isConfigured: jest.fn(() => false),
  isConnected: jest.fn(async () => false),
  connect: jest.fn(),
  disconnect: jest.fn(async () => undefined),
};
const mockEngine = {
  syncNow: jest.fn(),
  getStatus: jest.fn(() => mockStatus.current),
};
// Getters: the factory runs while the screen is imported, before the mocks above are initialized.
jest.mock('../../../services/calendar', () => ({
  useCalendarStatus: () => mockStatus.current,
  get googleCalendarService() {
    return mockGoogle;
  },
  get deviceCalendarService() {
    return mockDevice;
  },
  get outlookCalendarService() {
    return mockOutlook;
  },
  get calendarSyncEngine() {
    return mockEngine;
  },
}));

const mockUpdate = jest.fn(async () => undefined);
let mockPreferences: Preferences = createDefaultPreferences({ language: 'en', timezone: 'UTC' });
let mockPreferencesLoaded = true;
jest.mock('../../../services/data', () => ({
  usePreferences: () => ({ preferences: mockPreferences, isLoaded: mockPreferencesLoaded, error: null, update: mockUpdate }),
}));

function status(
  overrides: {
    google?: Partial<CalendarStatus['google']>;
    device?: Partial<CalendarStatus['device']>;
    outlook?: Partial<NonNullable<CalendarStatus['outlook']>>;
  } = {},
): CalendarStatus {
  const base: CalendarStatus = {
    google: { enabled: false, syncing: false, lastSyncAt: null, lastError: null, connected: false, hasScope: false, ...overrides.google },
    device: {
      enabled: false,
      syncing: false,
      lastSyncAt: null,
      lastError: null,
      permission: 'granted',
      importCalendarIds: [],
      exportCalendarId: null,
      ...overrides.device,
    },
  };
  if (overrides.outlook) {
    base.outlook = {
      enabled: false,
      syncing: false,
      lastSyncAt: null,
      lastError: null,
      configured: true,
      connected: false,
      accountEmail: null,
      ...overrides.outlook,
    };
  }
  return base;
}

function calendar(id: string, overrides: Partial<DeviceCalendarInfo> = {}): DeviceCalendarInfo {
  return { id, title: `Calendar ${id}`, color: '#2563eb', sourceName: 'Local', isPrimary: false, allowsModifications: true, isGoogleAccount: false, ...overrides };
}

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };
type ScreenProps = Parameters<typeof CalendarSyncScreen>[0];

async function renderScreen() {
  const props = { navigation, route: { key: 'CalendarSync-1', name: 'CalendarSync', params: undefined } } as unknown as ScreenProps;
  const result = await render(
    <I18nProvider>
      <CalendarSyncScreen {...props} />
    </I18nProvider>,
  );
  // Let the device-calendar load settle.
  await act(async () => undefined);
  return result;
}

/** Buttons of the last Alert.alert call. */
function lastAlertButtons(): { text?: string; style?: string; onPress?: () => void }[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[];
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockDarkMode = false;
  mockStatus.current = status();
  mockPreferences = createDefaultPreferences({ language: 'en', timezone: 'UTC' });
  mockPreferencesLoaded = true;
  mockDevice.getPermission.mockResolvedValue('granted');
  mockDevice.listCalendars.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('shows a loading state until the preferences are known', async () => {
  mockPreferencesLoaded = false;
  await renderScreen();
  expect(screen.getByTestId('calendar-loading')).toBeTruthy();
  expect(screen.getByTestId('calendar-intro')).toBeTruthy();
});

it('connects Google Calendar and reports the real first-sync counts', async () => {
  mockGoogle.connect.mockResolvedValue({
    status: 'connected',
    initialSync: { provider: 'google', fullSync: true, syncedAt: '2030-01-01T00:00:00.000Z', counts: { created: 3, updated: 0, removed: 0, unchanged: 0, pushed: 2, failed: 0 } },
  });
  await renderScreen();
  expect(mockGoogle.isConnected).toHaveBeenCalled();
  expect(screen.getByTestId('calendar-google-state').props.children).toBe('Not connected');

  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-google-connect'));
  });
  expect(mockGoogle.connect).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledWith('Google Calendar connected', 'Imported 3 events and sent 2 meetings to Google Calendar.', undefined);
});

it('explains connection errors but stays quiet when the user cancels', async () => {
  mockGoogle.connect.mockRejectedValueOnce(new AppError('offline'));
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-google-connect'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Something went wrong', "You're offline. Check your connection and try again.");

  (Alert.alert as jest.Mock).mockClear();
  mockGoogle.connect.mockRejectedValueOnce(new AppError('cancelled'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-google-connect'));
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('asks before stopping Google sync and can revoke access', async () => {
  mockStatus.current = status({ google: { enabled: true, connected: true, hasScope: true, lastSyncAt: new Date().toISOString() } });
  await renderScreen();
  expect(screen.getByTestId('calendar-google-state').props.children).toBe('Connected');
  expect(screen.getByText(/^Last synced/)).toBeTruthy();

  await act(async () => {
    fireEvent(screen.getByTestId('calendar-google-switch'), 'valueChange', false);
  });
  expect(Alert.alert).toHaveBeenCalledWith('Stop Google Calendar sync?', expect.any(String), expect.any(Array));
  const revoke = lastAlertButtons().find((button) => button.style === 'destructive');
  await act(async () => {
    revoke?.onPress?.();
  });
  expect(mockGoogle.disconnect).toHaveBeenCalledWith({ revoke: true });
  expect(Alert.alert).toHaveBeenLastCalledWith('Google Calendar sync is off');
});

it('offers to grant access again when the Calendar permission is missing', async () => {
  mockStatus.current = status({ google: { enabled: true, connected: false, hasScope: false, lastError: 'calendar_scope_missing' } });
  await renderScreen();
  expect(screen.getByTestId('calendar-google-state').props.children).toBe('Calendar access needed');
  expect(screen.getByTestId('calendar-google-grant')).toBeTruthy();
});

it('lists the phone calendars and saves the import and export choices', async () => {
  mockPreferences = { ...mockPreferences, googleCalendarSyncEnabled: true, deviceCalendarImportIds: ['1'] };
  mockDevice.listCalendars.mockResolvedValue([
    calendar('1', { title: 'Work' }),
    calendar('2', { title: 'Personal' }),
    calendar('g', { title: 'Google account', isGoogleAccount: true, allowsModifications: false }),
  ]);
  await renderScreen();

  expect(screen.getAllByText('Work').length).toBe(2);
  expect(screen.getByText('Already synced through Google Calendar')).toBeTruthy();
  expect(screen.getByTestId('device-import-switch-g').props.disabled).toBe(true);

  await act(async () => {
    fireEvent(screen.getByTestId('device-import-switch-2'), 'valueChange', true);
  });
  expect(mockUpdate).toHaveBeenCalledWith({ deviceCalendarImportIds: ['1', '2'] });

  await act(async () => {
    fireEvent.press(screen.getByTestId('device-export-2'));
  });
  expect(mockUpdate).toHaveBeenCalledWith({ deviceCalendarExportId: '2' });
  expect(screen.getByTestId('device-export-none').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  expect(screen.getByLabelText('Import events from Personal')).toBeTruthy();
});

it('shows a failed preference save instead of pretending it worked', async () => {
  mockDevice.listCalendars.mockResolvedValue([calendar('1')]);
  mockUpdate.mockRejectedValueOnce(new AppError('offline'));
  await renderScreen();
  await act(async () => {
    fireEvent(screen.getByTestId('device-import-switch-1'), 'valueChange', true);
  });
  expect(Alert.alert).toHaveBeenCalledWith('Something went wrong', "You're offline. Check your connection and try again.");
});

it('asks for the calendar permission and points to the settings when it is refused', async () => {
  mockDevice.getPermission.mockResolvedValue('undetermined');
  mockDevice.requestPermission.mockResolvedValue('denied');
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await renderScreen();

  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-device-permission'));
  });
  expect(mockDevice.requestPermission).toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Calendars on this phone', 'Calendar access is turned off for MeetingGuard.', expect.any(Array));
  const settings = lastAlertButtons().find((button) => button.text === 'Open settings');
  settings?.onPress?.();
  expect(openSettings).toHaveBeenCalled();
});

it('shows why the phone calendars could not be read and retries', async () => {
  mockDevice.listCalendars.mockRejectedValueOnce(new AppError('unknown', 'boom'));
  await renderScreen();
  expect(screen.getByTestId('calendar-device-retry')).toBeTruthy();

  mockDevice.listCalendars.mockResolvedValueOnce([calendar('1', { title: 'Work' })]);
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-device-retry'));
  });
  expect(screen.getByTestId('device-import-1')).toBeTruthy();
  expect(screen.queryByTestId('calendar-device-retry')).toBeNull();
});

it('syncs now and summarizes the real result', async () => {
  mockEngine.syncNow.mockResolvedValue({ google: null, device: null, errors: [] });
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-sync-now'));
  });
  expect(mockEngine.syncNow).toHaveBeenCalledWith({ reason: 'manual' });
  expect(Alert.alert).toHaveBeenCalledWith(
    'Sync complete',
    'Nothing to sync yet. Connect Google Calendar or choose calendars on this phone first.',
  );
});

it('disables "Sync now" while a sync runs', async () => {
  mockStatus.current = status({ google: { enabled: true, connected: true, hasScope: true, syncing: true } });
  await renderScreen();
  expect(screen.getByTestId('calendar-sync-now').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  expect(screen.getAllByText('Syncing…').length).toBeGreaterThan(0);
});

it('leaves the back arrow and the title to the stack header', async () => {
  await renderScreen();
  expect(screen.queryByTestId('calendar-back')).toBeNull();
  expect(screen.queryByText('Calendar sync')).toBeNull();
  expect(screen.getByText('Keep MeetingGuard in step with your connected calendars and the calendars on this phone.')).toBeTruthy();
});

it('renders in Spanish and in dark mode', async () => {
  mockDarkMode = true;
  await i18n.changeLanguage('es');
  await renderScreen();
  expect(screen.getByText('Mantén MeetingGuard al día con tus calendarios conectados y con los calendarios de este teléfono.')).toBeTruthy();
  expect(screen.getByText('Conectar Google Calendar')).toBeTruthy();
});

it('hides the Outlook card while the provider is not registered', async () => {
  await renderScreen();
  expect(screen.queryByTestId('calendar-outlook-card')).toBeNull();
});

it('connects Outlook and reports the real first-sync counts', async () => {
  mockStatus.current = status({ outlook: { configured: true, connected: false } });
  mockOutlook.connect.mockResolvedValue({
    status: 'connected',
    initialSync: {
      provider: 'outlook',
      fullSync: true,
      syncedAt: '2030-01-01T00:00:00.000Z',
      counts: { created: 4, updated: 0, removed: 0, unchanged: 0, pushed: 1, failed: 0 },
    },
  });
  await renderScreen();
  expect(screen.getByTestId('calendar-outlook-state').props.children).toBe('Not connected');

  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-outlook-connect'));
  });
  expect(mockOutlook.connect).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledWith('Outlook connected', 'Imported 4 events and sent 1 meetings to Outlook.', undefined);
});

it('reports a failed Microsoft sign-in but stays quiet on cancel', async () => {
  mockStatus.current = status({ outlook: { configured: true, connected: false } });
  mockOutlook.connect.mockResolvedValueOnce({ status: 'failed', initialSync: null });
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-outlook-connect'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Outlook Calendar', 'The Microsoft sign-in did not finish. Please try again.', undefined);

  (Alert.alert as jest.Mock).mockClear();
  mockOutlook.connect.mockResolvedValueOnce({ status: 'cancelled', initialSync: null });
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-outlook-connect'));
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('shows the connected Outlook account and asks before stopping the sync', async () => {
  mockStatus.current = status({
    outlook: { configured: true, connected: true, enabled: true, accountEmail: 'me@outlook.com', lastSyncAt: new Date().toISOString() },
  });
  await renderScreen();
  expect(screen.getByTestId('calendar-outlook-state').props.children).toBe('Connected');
  expect(screen.getByTestId('calendar-outlook-account')).toBeTruthy();
  expect(screen.getByText('Microsoft account: me@outlook.com')).toBeTruthy();

  await act(async () => {
    fireEvent(screen.getByTestId('calendar-outlook-switch'), 'valueChange', false);
  });
  expect(Alert.alert).toHaveBeenCalledWith('Stop Outlook sync?', expect.any(String), expect.any(Array));
  const revoke = lastAlertButtons().find((button) => button.style === 'destructive');
  await act(async () => {
    revoke?.onPress?.();
  });
  expect(mockOutlook.disconnect).toHaveBeenCalledWith({ revoke: true });
  expect(Alert.alert).toHaveBeenLastCalledWith('Outlook sync is off');
});

it('includes the Outlook line in the sync summary', async () => {
  mockStatus.current = status({ outlook: { configured: true, connected: true, enabled: true } });
  mockEngine.syncNow.mockResolvedValue({
    google: null,
    device: null,
    outlook: {
      provider: 'outlook',
      fullSync: false,
      syncedAt: '2030-01-01T00:00:00.000Z',
      counts: { created: 2, updated: 1, removed: 0, unchanged: 5, pushed: 3, failed: 0 },
    },
    errors: [],
  });
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('calendar-sync-now'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Sync complete', 'Outlook: 2 new, 1 updated, 0 removed, 3 sent to Outlook.');
});
