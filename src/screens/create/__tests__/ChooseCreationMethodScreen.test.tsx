import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { RootStackParamList, WhatsAppLinkStatus } from '../../../core/contracts';
import { I18nProvider, i18n } from '../../../i18n';
import { ChooseCreationMethodScreen, isMethodAvailable } from '../ChooseCreationMethodScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

// §27: the WhatsApp card follows whatsappLinkStatus.enabled (null = unknown = still disabled).
let mockStatus: WhatsAppLinkStatus | null = null;
jest.mock('../../../services/whatsapp', () => ({
  useWhatsAppStatus: () => ({ status: mockStatus, error: null, refresh: jest.fn() }),
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
            <Stack.Screen name="WhatsAppConnect" component={Stub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockStatus = null;
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

it('shows WhatsApp as a disabled "Coming soon" option while the bot is not configured', async () => {
  expect(isMethodAvailable('whatsapp', { whatsappEnabled: false })).toBe(false);
  await renderChooser();
  const whatsapp = screen.getByTestId('create-method-whatsapp');
  expect(whatsapp.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  expect(whatsapp.props.accessibilityLabel).toMatch(/^WhatsApp, Coming soon\./);
  // The "Coming soon" marker is a kit Badge (a View wrapping the label text).
  expect(within(screen.getByTestId('create-method-whatsapp-soon')).getByText('Coming soon')).toBeTruthy();
  await act(async () => {
    fireEvent.press(whatsapp);
  });
  expect(screen.queryByTestId('stub-CreateMeeting')).toBeNull();
  expect(screen.queryByTestId('stub-AIChat')).toBeNull();
  expect(screen.queryByTestId('stub-WhatsAppConnect')).toBeNull();
  // No phone number or bot link anywhere.
  expect(screen.queryByText(/\+\d{6,}/)).toBeNull();
});

it('enables the WhatsApp card once the bot is configured and opens the connect screen', async () => {
  expect(isMethodAvailable('whatsapp', { whatsappEnabled: true })).toBe(true);
  mockStatus = { enabled: true, linked: false, displayNumber: '15550253483', deepLink: 'https://wa.me/15550253483' };
  await renderChooser();
  const whatsapp = screen.getByTestId('create-method-whatsapp');
  expect(whatsapp.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  expect(screen.queryByTestId('create-method-whatsapp-soon')).toBeNull();
  await act(async () => {
    fireEvent.press(whatsapp);
  });
  expect(await screen.findByTestId('stub-WhatsAppConnect')).toBeTruthy();
});

it('is translated to Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderChooser();
  expect(screen.getByText('Rellenar un formulario')).toBeTruthy();
  expect(within(screen.getByTestId('create-method-whatsapp-soon')).getByText('Próximamente')).toBeTruthy();
});
