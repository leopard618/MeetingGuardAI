import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { I18nProvider, i18n } from '../../../i18n';
import { AlertSettingsScreen } from '../AlertSettingsScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const mockUpdate = jest.fn();
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null, update: mockUpdate }),
  };
});

const mockOpenAlarmChannelSettings = jest.fn(async () => undefined);
let mockExactAlarms: 'not_required' | 'unknown' = 'not_required';
let mockFsiAvailable = false;
let mockFsiStatus = { exactAllowed: true, fullScreenAllowed: true, notificationsAllowed: true };
const mockOpenFullScreenIntentSettings = jest.fn(async () => undefined);
jest.mock('../../../services/alerts', () => ({
  alertEngine: {
    getPermissionStatus: jest.fn(async () => ({ notifications: 'granted', canAskAgain: true, exactAlarms: mockExactAlarms })),
    requestPermissions: jest.fn(),
    openNotificationSettings: jest.fn(async () => undefined),
    openExactAlarmSettings: jest.fn(async () => undefined),
    openAlarmChannelSettings: () => mockOpenAlarmChannelSettings(),
  },
  alertFeedback: { start: jest.fn(() => ({ stop: jest.fn() })) },
  fullScreenAlarm: {
    isAvailable: () => mockFsiAvailable,
    getStatus: jest.fn(async () => ({ ...mockFsiStatus })),
    openFullScreenIntentSettings: () => mockOpenFullScreenIntentSettings(),
  },
}));

type Routes = { Home: undefined; AlertSettings: undefined };
const Stack = createStackNavigator<Routes>();
const navigationRef = createNavigationContainerRef<Routes>();

function Home() {
  return <Text testID="home">home</Text>;
}

async function renderScreen() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home" component={Home} />
            <Stack.Screen name="AlertSettings" component={AlertSettingsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
  await act(async () => {
    navigationRef.navigate('AlertSettings');
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockUpdate.mockReset();
  mockOpenAlarmChannelSettings.mockClear();
  mockOpenFullScreenIntentSettings.mockClear();
  mockExactAlarms = 'not_required';
  mockFsiAvailable = false;
  mockFsiStatus = { exactAllowed: true, fullScreenAllowed: true, notificationsAllowed: true };
});

it('edits alert preferences after onboarding (vibration, follow-ups, snooze) and saves only the changes', async () => {
  mockUpdate.mockResolvedValue({});
  await renderScreen();
  expect(screen.getByText('Snooze length')).toBeTruthy();
  expect(screen.getByText(/voice readout needs the app open/)).toBeTruthy();

  await act(async () => {
    fireEvent(screen.getByTestId('alerts-vibration'), 'valueChange', false);
    fireEvent(screen.getByTestId('alerts-followup'), 'valueChange', false);
  });
  await act(async () => {
    fireEvent.press(screen.getByText('15 min'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('alert-settings-save'));
  });

  expect(mockUpdate).toHaveBeenCalledWith({ vibrationEnabled: false, followUpEnabled: false, snoozeMinutes: 15 });
  // The time format lives in Settings now.
  expect(screen.queryByText('24-hour')).toBeNull();
  expect(await screen.findByTestId('home')).toBeTruthy();
});

it('explains Focus / Do Not Disturb and opens the system settings', async () => {
  await renderScreen();
  expect(screen.getByText(/Settings > Focus/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getAllByText('Open settings').at(-1)!);
  });
  expect(mockOpenAlarmChannelSettings).toHaveBeenCalled();
});

it('hides the full-screen alarm section without the native module', async () => {
  await renderScreen();
  expect(screen.queryByText('Full-screen alarms')).toBeNull();
});

it('shows the full-screen alarm state and the real exact-alarm read when the module is present', async () => {
  mockFsiAvailable = true;
  mockExactAlarms = 'unknown';
  await renderScreen();
  expect(screen.getByText('Full-screen alarms')).toBeTruthy();
  expect(await screen.findByTestId('alerts-fullscreen-allowed')).toBeTruthy();
  // The module reads canScheduleExactAlarms() for real: granted replaces the settings button.
  expect(await screen.findByTestId('alerts-exact-granted')).toBeTruthy();
  expect(screen.queryByText('Open alarm settings')).toBeNull();
});

it('offers the Android 14+ settings page when full-screen alarms are revoked', async () => {
  mockFsiAvailable = true;
  mockExactAlarms = 'unknown';
  mockFsiStatus = { exactAllowed: false, fullScreenAllowed: false, notificationsAllowed: true };
  await renderScreen();
  expect(await screen.findByText(/Full-screen alarms are turned off/)).toBeTruthy();
  // Exact alarms denied: the explanation and the settings button stay.
  expect(screen.getByText('Open alarm settings')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('alerts-fullscreen-open'));
  });
  expect(mockOpenFullScreenIntentSettings).toHaveBeenCalled();
});

it('asks before dropping unsaved changes on back', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderScreen();
  // Nothing changed: back leaves at once.
  await act(async () => {
    navigationRef.goBack();
  });
  expect(alert).not.toHaveBeenCalled();
  expect(screen.getByTestId('home')).toBeTruthy();

  await act(async () => {
    navigationRef.navigate('AlertSettings');
  });
  await act(async () => {
    fireEvent(screen.getByTestId('alerts-vibration'), 'valueChange', false);
  });
  await act(async () => {
    navigationRef.goBack();
  });
  expect(alert).toHaveBeenCalledWith('Discard changes?', expect.any(String), expect.any(Array));
  expect(mockUpdate).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.style === 'destructive')?.onPress?.();
  });
  expect(await screen.findByTestId('home')).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
  alert.mockRestore();
});
