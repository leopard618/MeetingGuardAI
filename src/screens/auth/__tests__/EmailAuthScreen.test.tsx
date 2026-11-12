import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider, i18n } from '../../../i18n';
import { EmailAuthScreen } from '../EmailAuthScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

const mockSignInWithEmail = jest.fn();
const mockSignUpWithEmail = jest.fn();
const mockSendPasswordReset = jest.fn();
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({
    signInWithEmail: mockSignInWithEmail,
    signUpWithEmail: mockSignUpWithEmail,
    sendPasswordReset: mockSendPasswordReset,
  }),
}));

const Stack = createStackNavigator();

async function renderEmailAuth() {
  await render(
    <I18nProvider>
      <ThemeProvider initialMode="light">
        <PaperProvider>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="EmailAuth" component={EmailAuthScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </PaperProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await act(async () => undefined);
}

async function fillCredentials(email: string, password: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('email-auth-email'), email);
    fireEvent.changeText(screen.getByTestId('email-auth-password'), password);
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  mockSignInWithEmail.mockReset();
  mockSignUpWithEmail.mockReset();
  mockSendPasswordReset.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('signs in with the typed email and password', async () => {
  mockSignInWithEmail.mockResolvedValueOnce({ success: true, user: { uid: 'u1' } });
  await renderEmailAuth();
  await fillCredentials('ana@example.com', 'secret1');
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-submit'));
  });
  expect(mockSignInWithEmail).toHaveBeenCalledWith('ana@example.com', 'secret1');
  expect(screen.queryByTestId('email-auth-error')).toBeNull();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('shows the one generic message for bad credentials inline', async () => {
  mockSignInWithEmail.mockResolvedValueOnce({
    success: false,
    error: 'The email or password is incorrect.',
    errorCode: 'unauthenticated',
  });
  await renderEmailAuth();
  await fillCredentials('ana@example.com', 'wrong');
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-submit'));
  });
  expect(screen.getByText('The email or password is incorrect.')).toBeTruthy();
});

it('explains a disabled email provider with the admin-hint message', async () => {
  mockSignInWithEmail.mockResolvedValueOnce({
    success: false,
    error: "This sign-in method isn't enabled. Please contact support.",
    errorCode: 'not_configured',
    errorReason: 'provider_disabled',
  });
  await renderEmailAuth();
  await fillCredentials('ana@example.com', 'secret1');
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-submit'));
  });
  expect(screen.getByText("This sign-in method isn't enabled. Please contact support.")).toBeTruthy();
});

it('creates an account with the optional name and confirms the verification email', async () => {
  mockSignUpWithEmail.mockResolvedValueOnce({ success: true, user: { uid: 'u1' } });
  await renderEmailAuth();
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-tab-create'));
  });
  await fillCredentials('ana@example.com', 'secret1');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('email-auth-name'), 'Ana');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-submit'));
  });
  expect(mockSignUpWithEmail).toHaveBeenCalledWith('ana@example.com', 'secret1', 'Ana');
  expect(Alert.alert).toHaveBeenCalledWith(
    'Verify your email',
    'Account created. We sent a verification email to ana@example.com.',
  );
});

it('switching the mode clears the previous error', async () => {
  mockSignInWithEmail.mockResolvedValueOnce({ success: false, error: 'The email or password is incorrect.' });
  await renderEmailAuth();
  await fillCredentials('ana@example.com', 'wrong');
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-submit'));
  });
  expect(screen.getByText('The email or password is incorrect.')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-tab-create'));
  });
  expect(screen.queryByText('The email or password is incorrect.')).toBeNull();
  expect(screen.getByTestId('email-auth-name')).toBeTruthy();
});

it('sends a password reset and always confirms neutrally, also when no account exists', async () => {
  // The collapsed invalid-credentials family (includes user-not-found): no account enumeration.
  mockSendPasswordReset.mockResolvedValueOnce({
    success: false,
    error: 'The email or password is incorrect.',
    errorCode: 'unauthenticated',
  });
  await renderEmailAuth();
  await fillCredentials('nobody@example.com', '');
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-forgot'));
  });
  expect(screen.getByText('Enter your email and we will send you a link to reset your password.')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-reset-send'));
  });
  expect(mockSendPasswordReset).toHaveBeenCalledWith('nobody@example.com');
  expect(screen.getByTestId('email-auth-reset-sent')).toBeTruthy();
  expect(screen.queryByText('The email or password is incorrect.')).toBeNull();
});

it('still reports real reset failures (offline, bad email) instead of pretending', async () => {
  mockSendPasswordReset.mockResolvedValueOnce({
    success: false,
    error: "You're offline. Check your connection and try again.",
    errorCode: 'offline',
  });
  await renderEmailAuth();
  await fillCredentials('ana@example.com', '');
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-forgot'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('email-auth-reset-send'));
  });
  expect(screen.queryByTestId('email-auth-reset-sent')).toBeNull();
  expect(screen.getByText("You're offline. Check your connection and try again.")).toBeTruthy();
});

it('shows and hides the password', async () => {
  await renderEmailAuth();
  expect(screen.getByTestId('email-auth-password').props.secureTextEntry).toBe(true);
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Show password'));
  });
  expect(screen.getByTestId('email-auth-password').props.secureTextEntry).toBe(false);
  expect(screen.getByLabelText('Hide password')).toBeTruthy();
});
