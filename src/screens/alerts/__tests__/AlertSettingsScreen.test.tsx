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
jest.mock('../../../services/alerts', () => ({
  alertEngine: {
    getPermissionStatus: jest.fn(async () => ({ notifications: 'granted', canAskAgain: true, exactAlarms: 'not_required' })),
    requestPermissions: jest.fn(),
    openNotificationSettings: jest.fn(async () => undefined),
    openExactAlarmSettings: jest.fn(async () => undefined),
    openAlarmChannelSettings: () => mockOpenAlarmChannelSettings(),
  },
  alertFeedback: { start: jest.fn(() => ({ stop: jest.fn() })) },
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
});

it('edits alert preferences after onboarding (vibration, follow-ups, snooze, clock) and saves only the changes', async () => {
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
    fireEvent.press(screen.getByText('24-hour'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('alert-settings-save'));
  });

  expect(mockUpdate).toHaveBeenCalledWith({ vibrationEnabled: false, followUpEnabled: false, snoozeMinutes: 15, use24HourClock: true });
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
