import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';

import { ThemeProvider } from '../../../contexts/ThemeContext';
import { I18nProvider, i18n } from '../../../i18n';
import { LandingScreen } from '../LandingScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

// jest-expo runs as iOS, so the Apple button renders (virtual: the package is iOS-build only).
jest.mock(
  'expo-apple-authentication',
  () => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return {
      isAvailableAsync: jest.fn(async () => true),
      AppleAuthenticationButton: View,
      AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
      AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    };
  },
  { virtual: true },
);

const mockSignInWithGoogle = jest.fn();
const mockSignInWithApple = jest.fn();
const mockSignInWithMicrosoft = jest.fn();
let mockCanSignInWithMicrosoft = true;
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({
    signInWithGoogle: mockSignInWithGoogle,
    signInWithApple: mockSignInWithApple,
    signInWithMicrosoft: mockSignInWithMicrosoft,
    canSignInWithMicrosoft: mockCanSignInWithMicrosoft,
  }),
}));

const Stack = createStackNavigator();

function Destination({ route }: { route: { name: string } }) {
  return <Text testID="destination">{route.name}</Text>;
}

async function renderLanding() {
  await render(
    <I18nProvider>
      <ThemeProvider initialMode="light">
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Landing" component={LandingScreen} />
            <Stack.Screen name="EmailAuth" component={Destination} />
            <Stack.Screen name="Terms" component={Destination} />
            <Stack.Screen name="Privacy" component={Destination} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </I18nProvider>,
  );
  await act(async () => undefined);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  mockSignInWithGoogle.mockReset();
  mockSignInWithApple.mockReset();
  mockSignInWithMicrosoft.mockReset();
  mockCanSignInWithMicrosoft = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('presents only the sign-in buttons and the legal links (no panel, no copy)', async () => {
  await renderLanding();
  expect(screen.getByText('Continue with Google')).toBeTruthy();
  expect(screen.getByText('Continue with Microsoft')).toBeTruthy();
  expect(screen.getByText('Continue with email')).toBeTruthy();
  expect(screen.queryByText(/assistant that asks first/)).toBeNull();
  expect(screen.queryByText(/free plan/)).toBeNull();
  expect(screen.queryByText(/By continuing/)).toBeNull();
  expect(screen.queryByText(/Outlook/)).toBeNull();
  expect(screen.getByText('Terms of Service')).toBeTruthy();
  expect(screen.getByText('Privacy Policy')).toBeTruthy();
});

it('opens the Terms and the Privacy Policy', async () => {
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-privacy'));
  });
  expect(screen.getByTestId('destination').props.children).toBe('Privacy');
});

it('signs in with Google and ignores a closed account picker', async () => {
  mockSignInWithGoogle.mockResolvedValueOnce({ success: false, cancelled: true });
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-sign-in'));
  });
  expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('explains a failed sign-in with the localized message from the auth service', async () => {
  mockSignInWithGoogle.mockResolvedValueOnce({ success: false, error: 'No internet connection.' });
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-sign-in'));
  });
  expect(Alert.alert).toHaveBeenCalledWith("Couldn't sign in", 'No internet connection.');
});

it('shows the Apple button on iOS and signs in with Apple; a dismissed sheet stays silent', async () => {
  mockSignInWithApple.mockResolvedValueOnce({ success: false, cancelled: true });
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-apple-sign-in'));
  });
  expect(mockSignInWithApple).toHaveBeenCalledTimes(1);
  expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('runs only one sign-in for same-frame presses (multi-touch across the two provider buttons)', async () => {
  mockSignInWithApple.mockResolvedValue({ success: false, cancelled: true });
  await renderLanding();
  const apple = screen.getByTestId('landing-apple-sign-in');
  await act(async () => {
    // Direct prop calls, no re-render in between: both handlers read the stale `busy` closure,
    // exactly like two Pressables pressed in the same frame. Only the synchronous busyRef guard
    // can stop the second flow.
    apple.props.onPress();
    apple.props.onPress();
  });
  expect(mockSignInWithApple).toHaveBeenCalledTimes(1);
});

it('explains a failed Apple sign-in with the localized message from the auth service', async () => {
  mockSignInWithApple.mockResolvedValueOnce({ success: false, error: 'Apple sign-in failed. Please try again.' });
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-apple-sign-in'));
  });
  expect(Alert.alert).toHaveBeenCalledWith("Couldn't sign in", 'Apple sign-in failed. Please try again.');
});

it('signs in with Microsoft and stays silent when the browser is closed (section 31)', async () => {
  mockSignInWithMicrosoft.mockResolvedValueOnce({ success: false, cancelled: true });
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-microsoft'));
  });
  expect(mockSignInWithMicrosoft).toHaveBeenCalledTimes(1);
  expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('explains a failed Microsoft sign-in with the localized message from the auth service', async () => {
  mockSignInWithMicrosoft.mockResolvedValueOnce({ success: false, error: 'Microsoft sign-in was not accepted.' });
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-microsoft'));
  });
  expect(Alert.alert).toHaveBeenCalledWith("Couldn't sign in", 'Microsoft sign-in was not accepted.');
});

it('hides the Microsoft button in a build without a Microsoft client id', async () => {
  mockCanSignInWithMicrosoft = false;
  await renderLanding();
  expect(screen.queryByTestId('landing-microsoft')).toBeNull();
  expect(screen.getByText('Continue with Google')).toBeTruthy();
});

it('offers email sign-in as a secondary path', async () => {
  await renderLanding();
  expect(screen.getByText('Continue with email')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-email'));
  });
  expect(screen.getByTestId('destination').props.children).toBe('EmailAuth');
  expect(mockSignInWithGoogle).not.toHaveBeenCalled();
});

it('switches to Spanish instantly', async () => {
  await renderLanding();
  await act(async () => {
    fireEvent.press(screen.getByTestId('landing-language-es'));
  });
  expect(screen.getByText('Continuar con Google')).toBeTruthy();
  expect(screen.getByTestId('landing-language-es').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
});
