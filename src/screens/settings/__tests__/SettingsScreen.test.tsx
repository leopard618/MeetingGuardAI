import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
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
  ...jest.requireActual<object>('../../../contexts/ThemeContext'),
  useTheme: () => ({ isDarkMode: false, themeMode: 'system', setThemeMode: jest.fn() }),
}));

const mockReauthenticate = jest.fn();
const mockDeleteAccount = jest.fn();
const mockRevokeAppleTokens = jest.fn();
let mockProviders = ['google.com'];
let mockEmailVerified = true;
jest.mock('../../../services/auth', () => {
  const actual = jest.requireActual('../../../services/auth/authErrors');
  const results = jest.requireActual('../../../services/auth/authResults');
  return {
    authErrorMessageKey: actual.authErrorMessageKey,
    signedInWithMicrosoft: results.signedInWithMicrosoft,
    // Late-bound: the factory runs while the consts above are still initializing.
    authService: {
      revokeAppleTokens: (): Promise<void> => mockRevokeAppleTokens() as Promise<void>,
    },
    useAuth: () => ({
      authUser: { uid: 'u1', email: 'ana@example.com', displayName: 'Ana', emailVerified: mockEmailVerified, providerIds: mockProviders },
      reauthenticate: mockReauthenticate,
      deleteAccount: mockDeleteAccount,
    }),
  };
});
const mockUpdatePreferences = jest.fn(async () => ({}));
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    usePreferences: () => ({
      preferences: defaults({ language: 'en', timezone: 'UTC' }),
      isLoaded: true,
      error: null,
      update: (...args: unknown[]) => mockUpdatePreferences(...(args as [])),
    }),
  };
});

// M10: the "Meeting summaries" row reads summaryStatus (null = unknown).
let mockSummaryStatus: { enabled: boolean; allowed: boolean; address: string | null; inboxCount: number } | null = null;
const mockSummaryStatusOptions: unknown[] = [];
jest.mock('../../../services/summaries', () => ({
  useSummaryStatus: (options?: unknown) => {
    mockSummaryStatusOptions.push(options);
    return {
      status: mockSummaryStatus,
      available: mockSummaryStatus !== null && mockSummaryStatus.enabled && mockSummaryStatus.allowed,
      error: null,
      refresh: jest.fn(),
    };
  },
}));

const Stack = createStackNavigator();
const navigationRef = createNavigationContainerRef<ParamListBase>();

/** Stand-ins for the M10 screens the summaries row opens. */
function SummaryConnectStub() {
  return <Text testID="summary-connect-screen">connect</Text>;
}

function SummaryInboxStub() {
  return <Text testID="summary-inbox-screen">inbox</Text>;
}

async function renderSettings() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="SummaryConnect" component={SummaryConnectStub} />
            <Stack.Screen name="SummaryInbox" component={SummaryInboxStub} />
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
  mockRevokeAppleTokens.mockReset();
  (Toast.show as jest.Mock).mockClear();
  mockProviders = ['google.com'];
  mockEmailVerified = true;
  mockUpdatePreferences.mockClear();
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

it('confirms a Microsoft (custom-token) session through the Microsoft sign-in before deleting (section 31)', async () => {
  mockProviders = [];
  mockReauthenticate.mockResolvedValue('done');
  mockDeleteAccount.mockResolvedValue(undefined);
  await renderSettings();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  expect(mockReauthenticate).toHaveBeenCalledWith();
  expect(mockRevokeAppleTokens).not.toHaveBeenCalled();
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
});

it('deletes an Apple account in order: Apple reauth, token revocation, server delete (5.1.1(v))', async () => {
  mockProviders = ['apple.com'];
  mockReauthenticate.mockResolvedValue('done');
  mockRevokeAppleTokens.mockResolvedValue(undefined);
  mockDeleteAccount.mockResolvedValue(undefined);
  await renderSettings();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  expect(mockReauthenticate).toHaveBeenCalledWith();
  expect(mockRevokeAppleTokens).toHaveBeenCalledTimes(1);
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  // Revocation needs a fresh code and a signed-in user: reauth -> revoke -> delete, exactly.
  expect(mockRevokeAppleTokens.mock.invocationCallOrder[0]).toBeGreaterThan(mockReauthenticate.mock.invocationCallOrder[0]!);
  expect(mockDeleteAccount.mock.invocationCallOrder[0]).toBeGreaterThan(mockRevokeAppleTokens.mock.invocationCallOrder[0]!);
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Your account has been deleted.' }));
});

it('still deletes when the Apple revocation fails, after the best-effort notice', async () => {
  mockProviders = ['apple.com'];
  mockReauthenticate.mockResolvedValue('done');
  mockRevokeAppleTokens.mockRejectedValue(new AppError('upstream_error', 'revocation failed'));
  mockDeleteAccount.mockResolvedValue(undefined);
  await renderSettings();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'info', text1: expect.stringContaining('Sign in with Apple') }),
  );
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
});

it('stops the Apple flow before revocation and deletion when the sheet is dismissed', async () => {
  mockProviders = ['apple.com'];
  mockReauthenticate.mockResolvedValue('cancelled');
  await renderSettings();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account'));
  });
  await act(async () => {
    confirmLastAlert();
  });
  expect(mockRevokeAppleTokens).not.toHaveBeenCalled();
  expect(mockDeleteAccount).not.toHaveBeenCalled();
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

it('shows the email verification state only for password accounts', async () => {
  await renderSettings();
  expect(screen.queryByTestId('settings-email-verified')).toBeNull();

  mockProviders = ['password'];
  mockEmailVerified = false;
  await renderSettings();
  expect(screen.getByText('Email not verified')).toBeTruthy();

  mockEmailVerified = true;
  await renderSettings();
  expect(screen.getByText('Email verified')).toBeTruthy();
});

it('links to the alert settings', async () => {
  await renderSettings();
  expect(screen.getByText('Alert settings')).toBeTruthy();
  expect(screen.getByText(/Maximum · 15 min before, 5 min before, At start/)).toBeTruthy();
});

it('offers the WhatsApp bot link under Integrations (§27)', async () => {
  await renderSettings();
  expect(screen.getByText('Integrations')).toBeTruthy();
  const row = screen.getByTestId('settings-whatsapp');
  expect(row).toBeTruthy();
  expect(screen.getByText('WhatsApp assistant')).toBeTruthy();
  expect(screen.getByText('Link your account to the WhatsApp bot')).toBeTruthy();
});

describe('Meeting summaries row (M10)', () => {
  afterEach(() => {
    mockSummaryStatus = null;
  });

  it('is hidden while the status is unknown, the feature is off or the user is not in the pilot', async () => {
    mockSummaryStatus = null;
    await renderSettings();
    expect(screen.queryByTestId('settings-summaries')).toBeNull();

    mockSummaryStatus = { enabled: false, allowed: false, address: null, inboxCount: 0 };
    await renderSettings();
    expect(screen.queryByTestId('settings-summaries')).toBeNull();

    mockSummaryStatus = { enabled: true, allowed: false, address: null, inboxCount: 0 };
    await renderSettings();
    expect(screen.queryByTestId('settings-summaries')).toBeNull();
  });

  it('shows under Integrations with the inbox count when enabled and allowed', async () => {
    mockSummaryStatus = { enabled: true, allowed: true, address: null, inboxCount: 0 };
    await renderSettings();
    expect(screen.getByTestId('settings-summaries')).toBeTruthy();
    expect(screen.getByText('Meeting summaries')).toBeTruthy();
    expect(screen.getByText("Your notetaker's summaries, filed under your meetings")).toBeTruthy();

    mockSummaryStatus = { enabled: true, allowed: true, address: 'abc@summaries.example.com', inboxCount: 2 };
    await renderSettings();
    expect(screen.getByText('2 waiting for a meeting')).toBeTruthy();

    await i18n.changeLanguage('es');
    await renderSettings();
    expect(screen.getByText('2 minutas esperan una reunión')).toBeTruthy();
  });

  it('asks for a fresh status on focus, so the waiting count follows new mail (B3)', async () => {
    mockSummaryStatusOptions.length = 0;
    mockSummaryStatus = { enabled: true, allowed: true, address: null, inboxCount: 0 };
    await renderSettings();
    expect(mockSummaryStatusOptions.length).toBeGreaterThan(0);
    expect(mockSummaryStatusOptions.every((options) => (options as { refreshOnFocus?: boolean } | undefined)?.refreshOnFocus === true)).toBe(true);
  });

  it('opens the setup screen while there is no address, and the inbox once there is one (T6)', async () => {
    mockSummaryStatus = { enabled: true, allowed: true, address: null, inboxCount: 0 };
    await renderSettings();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-summaries'));
    });
    expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryConnect');
    expect(screen.getByTestId('summary-connect-screen')).toBeTruthy();

    mockSummaryStatus = { enabled: true, allowed: true, address: 'abc@summaries.example.com', inboxCount: 1 };
    await renderSettings();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-summaries'));
    });
    expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryInbox');
    expect(screen.getByTestId('summary-inbox-screen')).toBeTruthy();
  });
});

it('sets the time format for the whole app next to the language', async () => {
  await renderSettings();
  expect(screen.getByText('Time format')).toBeTruthy();
  expect(screen.getByText(/for example 3:30/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-time-format-24'));
  });
  expect(mockUpdatePreferences).toHaveBeenCalledWith({ use24HourClock: true });
  // "Automatic" is the stored value already: nothing to write.
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-time-format-auto'));
  });
  expect(mockUpdatePreferences).toHaveBeenCalledTimes(1);
});
