/** Onboarding step 2: the Outlook section (present when registered, first after a Microsoft sign-in). */
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import type { CalendarStatus } from '../../../core/contracts';
import type { AuthUser } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { initialCalendarStatus } from '../../../services/calendar/status';
import { OnboardingCalendarsScreen } from '../OnboardingCalendarsScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

jest.mock('../../../services/data', () => ({
  usePreferences: () => ({ preferences: { deviceCalendarImportIds: [] }, isLoaded: true, error: null, update: jest.fn() }),
}));

let mockAuthUser: AuthUser = { uid: 'u1', email: 'a@b.c', displayName: null, photoURL: null, emailVerified: true, providerIds: ['google.com'] };
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({ authUser: mockAuthUser }),
  signedInWithMicrosoft: (user: AuthUser | null) => user !== null && user.providerIds.length === 0,
}));

let mockStatus: CalendarStatus = initialCalendarStatus();
const mockOutlookConnect = jest.fn();
jest.mock('../../../services/calendar', () => ({
  useCalendarStatus: () => mockStatus,
  calendarSyncEngine: { syncNow: jest.fn(async () => ({})) },
  deviceCalendarService: { getPermission: jest.fn(async () => 'denied'), requestPermission: jest.fn(), listCalendars: jest.fn(async () => []) },
  googleCalendarService: { connect: jest.fn() },
  outlookCalendarService: { connect: (...args: unknown[]) => mockOutlookConnect(...args) },
}));

const Stack = createStackNavigator();

async function renderStep() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="OnboardingCalendars" component={OnboardingCalendarsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

const outlookIdle = { enabled: false, syncing: false, lastSyncAt: null, lastError: null, configured: true, connected: false, accountEmail: null, teamsLinks: null };

function sectionOrder(): string[] {
  return screen.getAllByText(/^(Outlook Calendar|Google Calendar|Calendars on this device)$/).map((node) => String(node.props.children));
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockAuthUser = { uid: 'u1', email: 'a@b.c', displayName: null, photoURL: null, emailVerified: true, providerIds: ['google.com'] };
  mockStatus = initialCalendarStatus();
  mockOutlookConnect.mockReset();
});

it('has no Outlook section when the provider is not registered', async () => {
  await renderStep();
  expect(screen.queryByTestId('onboarding-outlook-section')).toBeNull();
  expect(sectionOrder()).toEqual(['Google Calendar', 'Calendars on this device']);
});

it('lists Outlook after Google for a Google sign-in and connects it inline', async () => {
  mockStatus = { ...initialCalendarStatus(), outlook: outlookIdle };
  mockOutlookConnect.mockResolvedValue({ status: 'connected', initialSync: null });
  await renderStep();
  expect(sectionOrder()).toEqual(['Google Calendar', 'Outlook Calendar', 'Calendars on this device']);
  expect(screen.queryByTestId('onboarding-outlook-hint')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('onboarding-outlook-connect'));
  });
  expect(mockOutlookConnect).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('onboarding-outlook-message').props.children).toBe('Outlook Calendar is connected.');
});

it('leads with Outlook and a hint after a Microsoft sign-in, and reports a cancelled consent', async () => {
  mockAuthUser = { ...mockAuthUser, providerIds: [] };
  mockStatus = { ...initialCalendarStatus(), outlook: outlookIdle };
  mockOutlookConnect.mockResolvedValue({ status: 'cancelled', initialSync: null });
  await renderStep();
  expect(sectionOrder()).toEqual(['Outlook Calendar', 'Google Calendar', 'Calendars on this device']);
  expect(screen.getByTestId('onboarding-outlook-hint').props.children).toBe('You signed in with Microsoft. Connect the same account to see your Outlook meetings here.');

  await act(async () => {
    fireEvent.press(screen.getByTestId('onboarding-outlook-connect'));
  });
  expect(screen.getByTestId('onboarding-outlook-message').props.children).toBe('Outlook was not connected.');
});

it('shows Connected instead of the button once Outlook is connected', async () => {
  mockStatus = { ...initialCalendarStatus(), outlook: { ...outlookIdle, connected: true, enabled: true, accountEmail: 'a@contoso.com' } };
  await renderStep();
  expect(screen.queryByTestId('onboarding-outlook-connect')).toBeNull();
  expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
});
