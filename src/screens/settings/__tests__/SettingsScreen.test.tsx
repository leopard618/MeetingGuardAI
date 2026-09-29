import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { SettingsScreen } from '../SettingsScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, themeMode: 'system', setThemeMode: jest.fn() }),
}));

const mockReauthenticate = jest.fn();
const mockDeleteAccount = jest.fn();
let mockProviders = ['google.com'];
jest.mock('../../../services/auth', () => {
  const actual = jest.requireActual('../../../services/auth/authErrors');
  return {
    authErrorMessageKey: actual.authErrorMessageKey,
    useAuth: () => ({
      authUser: { uid: 'u1', email: 'ana@example.com', displayName: 'Ana', providerIds: mockProviders },
      reauthenticate: mockReauthenticate,
      deleteAccount: mockDeleteAccount,
    }),
  };
});
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
  };
});

const Stack = createStackNavigator();

async function renderSettings() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

/** Presses the destructive button of the last Alert.alert call. */
function confirmLastAlert() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1]?.[2] as { style?: string; onPress?: () => void }[];
  buttons.find((button) => button.style === 'destructive')?.onPress?.();
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockReauthenticate.mockReset();
  mockDeleteAccount.mockReset();
  (Toast.show as jest.Mock).mockClear();
  mockProviders = ['google.com'];
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('offers "Delete account" and deletes after the confirmation and a fresh Google sign-in', async () => {
  mockReauthenticate.mockResolvedValue('done');
  mockDeleteAccount.mockResolvedValue(undefined);
  await renderSettings();

  expect(screen.getByText('Delete account')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Delete account', expect.stringContaining("can't be undone"), expect.any(Array));

  await act(async () => {
    confirmLastAlert();
  });
  expect(mockReauthenticate).toHaveBeenCalledWith();
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Your account has been deleted.' }));
});

it('stops when the Google confirmation is cancelled and explains server failures', async () => {
  mockReauthenticate.mockResolvedValueOnce('cancelled');
  await renderSettings();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  expect(mockDeleteAccount).not.toHaveBeenCalled();

  mockReauthenticate.mockResolvedValueOnce('done');
  mockDeleteAccount.mockRejectedValueOnce(new AppError('offline', 'no network'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  expect(Alert.alert).toHaveBeenLastCalledWith("Couldn't delete your account", "You're offline. Check your connection and try again.");
});

it('asks password accounts for their password', async () => {
  mockProviders = ['password'];
  mockReauthenticate.mockResolvedValue('done');
  mockDeleteAccount.mockResolvedValue(undefined);
  await renderSettings();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('delete-account-password'), 'secret');
  });
  await act(async () => {
    fireEvent.press(screen.getAllByText('Delete my account').at(-1)!);
  });
  expect(mockReauthenticate).toHaveBeenCalledWith({ password: 'secret' });
  expect(mockDeleteAccount).toHaveBeenCalled();
});

it('links to the alert settings', async () => {
  await renderSettings();
  expect(screen.getByText('Alert settings')).toBeTruthy();
  expect(screen.getByText(/Maximum · 15 min before, 5 min before, At start/)).toBeTruthy();
});
