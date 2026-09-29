import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { RootStackParamList } from '../../../core/contracts';
import { I18nProvider, i18n } from '../../../i18n';
import { ChooseCreationMethodScreen, isMethodAvailable } from '../ChooseCreationMethodScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

const Stack = createStackNavigator<RootStackParamList>();

function Stub({ route }: { route: { name: string } }) {
  return <Text testID={`stub-${route.name}`}>{route.name}</Text>;
}

async function renderChooser() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ChooseCreationMethod" component={ChooseCreationMethodScreen} />
            <Stack.Screen name="CreateMeeting" component={Stub} />
            <Stack.Screen name="AIChat" component={Stub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

it('opens the manual form', async () => {
  await renderChooser();
  await act(async () => {
    fireEvent.press(screen.getByTestId('create-method-manual'));
  });
  expect(await screen.findByTestId('stub-CreateMeeting')).toBeTruthy();
});

it('opens the AI assistant', async () => {
  await renderChooser();
  await act(async () => {
    fireEvent.press(screen.getByTestId('create-method-ai'));
  });
  expect(await screen.findByTestId('stub-AIChat')).toBeTruthy();
});

it('shows WhatsApp as a disabled "Coming soon" option that goes nowhere', async () => {
  expect(isMethodAvailable('whatsapp')).toBe(false);
  await renderChooser();
  const whatsapp = screen.getByTestId('create-method-whatsapp');
  expect(whatsapp.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  expect(whatsapp.props.accessibilityLabel).toMatch(/^WhatsApp, Coming soon\./);
  expect(screen.getByTestId('create-method-whatsapp-soon').props.children).toBe('Coming soon');
  await act(async () => {
    fireEvent.press(whatsapp);
  });
  expect(screen.queryByTestId('stub-CreateMeeting')).toBeNull();
  expect(screen.queryByTestId('stub-AIChat')).toBeNull();
  // No phone number or bot link anywhere.
  expect(screen.queryByText(/\+\d{6,}/)).toBeNull();
});

it('is translated to Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderChooser();
  expect(screen.getByText('Rellenar un formulario')).toBeTruthy();
  expect(screen.getByTestId('create-method-whatsapp-soon').props.children).toBe('Próximamente');
});
