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

const mockSignInWithGoogle = jest.fn();
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({ signInWithGoogle: mockSignInWithGoogle }),
}));

const Stack = createStackNavigator();

function Destination({ route }: { route: { name: string } }) {
  return <Text testID="destination">{route.name}</Text>;
}

async function renderLanding() {
  await render(
    <I18nProvider>
      <ThemeProvider>
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
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('presents honest value props, the free quota and the consent links', async () => {
  await renderLanding();
  expect(screen.getByText('Continue with Google')).toBeTruthy();
  expect(screen.getByText('An AI assistant that asks first')).toBeTruthy();
  expect(screen.getByText('The free plan includes 5 AI assistant requests per day.')).toBeTruthy();
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
