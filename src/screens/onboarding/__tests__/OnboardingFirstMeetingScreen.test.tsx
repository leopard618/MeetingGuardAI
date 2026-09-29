import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { clearPendingNavigation, getPendingNavigation } from '../../../navigation/navigationService';
import { OnboardingFirstMeetingScreen } from '../OnboardingFirstMeetingScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const mockUpdate = jest.fn();
jest.mock('../../../services/data', () => ({
  usePreferences: () => ({ preferences: {}, isLoaded: true, error: null, update: mockUpdate }),
}));
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({ authUser: { uid: 'u1' } }),
}));

const Stack = createStackNavigator();

async function renderStep() {
  await render(
    <I18nProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="OnboardingFirstMeeting" component={OnboardingFirstMeetingScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await AsyncStorage.clear();
  clearPendingNavigation();
  mockUpdate.mockReset();
  (Toast.show as jest.Mock).mockClear();
});

it('queues the manual form, completes onboarding and clears the resume marker', async () => {
  await AsyncStorage.setItem('mg:u1:onboarding.step', 'OnboardingFirstMeeting');
  mockUpdate.mockResolvedValue({});
  await renderStep();
  expect(await AsyncStorage.getItem('mg:u1:onboarding.step')).toBe('OnboardingFirstMeeting');

  await act(async () => {
    fireEvent.press(screen.getByText('Fill in a form'));
  });

  expect(getPendingNavigation()).toEqual({ name: 'CreateMeeting' });
  expect(mockUpdate).toHaveBeenCalledWith({ onboardingCompleted: true });
  expect(await AsyncStorage.getItem('mg:u1:onboarding.step')).toBeNull();
});

it('opens the assistant with an example prompt in the current language', async () => {
  await act(async () => {
    await i18n.changeLanguage('es');
  });
  mockUpdate.mockResolvedValue({});
  await renderStep();

  await act(async () => {
    fireEvent.press(screen.getByText('Pedírselo al asistente de IA'));
  });

  expect(getPendingNavigation()).toEqual({
    name: 'AIChat',
    params: { prefill: 'Programa una reunión de 30 minutos con mi equipo mañana a las 10' },
  });
});

it('drops the queued intent and shows the error when saving fails', async () => {
  mockUpdate.mockRejectedValue(new AppError('offline'));
  await renderStep();

  await act(async () => {
    fireEvent.press(screen.getByText('Fill in a form'));
  });

  expect(getPendingNavigation()).toBeNull();
  expect(Toast.show).toHaveBeenCalledWith({
    type: 'error',
    text1: "You're offline. Check your connection and try again.",
  });
});
