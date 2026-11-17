/**
 * Header and sidebar of the Main group: live language (with the flag), the menu button, the back
 * arrow, navigation to existing routes only, sign-out through the shared flow.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../contexts/ThemeContext';
import { I18nProvider, i18n } from '../../i18n';
import { ROUTES } from '../../navigation/routes';
import { avatarInitial, CustomHeader, LANGUAGE_FLAGS } from '../CustomHeader';
import { MobileSidebar, SIDEBAR_ITEMS } from '../MobileSidebar';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

const mockNavigateToTopLevel = jest.fn();
jest.mock('../../navigation/navigationService', () => ({
  navigateToTopLevel: (name: string) => mockNavigateToTopLevel(name),
}));

const mockStartSignOut = jest.fn();
jest.mock('../../navigation/useSignOut', () => ({
  useSignOutFlow: () => mockStartSignOut,
}));

jest.mock('../../services/auth', () => ({
  useAuth: () => ({
    authUser: { uid: 'u1', email: 'ana@example.com', displayName: 'Ana Pérez', photoURL: null, emailVerified: true, providerIds: ['google.com'] },
  }),
}));

async function renderWithProviders(element: ReactElement) {
  await render(
    <I18nProvider>
      <ThemeProvider initialMode="light">{element}</ThemeProvider>
    </I18nProvider>,
  );
  await act(async () => undefined);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  mockNavigateToTopLevel.mockReset();
  mockStartSignOut.mockReset();
});

describe('CustomHeader', () => {
  it('shows the route title and switches the language live from the dropdown', async () => {
    const onMenuPress = jest.fn();
    await renderWithProviders(<CustomHeader title="Calendar" onMenuPress={onMenuPress} />);
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByLabelText('Language: English')).toBeTruthy();
    // A tap opens the list; it does not switch by itself.
    await act(async () => {
      fireEvent.press(screen.getByTestId('header-language'));
    });
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByTestId('header-language-menu')).toBeTruthy();
    expect(screen.getByTestId('header-language-en').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

    await act(async () => {
      fireEvent.press(screen.getByTestId('header-language-es'));
    });
    expect(screen.queryByTestId('header-language-menu')).toBeNull();
    expect(screen.getByText('Calendario')).toBeTruthy();
    expect(screen.getByText('ES')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('header-menu'));
    });
    expect(onMenuPress).toHaveBeenCalledTimes(1);
  });

  it('opens the menu from the menu button and shows the flag of the current language', async () => {
    const onMenuPress = jest.fn();
    await renderWithProviders(<CustomHeader title="Dashboard" onMenuPress={onMenuPress} />);
    expect(screen.queryByTestId('header-theme')).toBeNull();
    expect(screen.getByTestId('header-language-flag').props.children).toBe(LANGUAGE_FLAGS.en);
    expect(avatarInitial(null, 'zoe@example.com')).toBe('Z');
    expect(avatarInitial('  ', '')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('header-menu'));
    });
    expect(onMenuPress).toHaveBeenCalledTimes(1);
  });

  it('shows a back button instead of the menu button when the stack can go back', async () => {
    const onBackPress = jest.fn();
    await renderWithProviders(<CustomHeader title="MeetingDetails" onBackPress={onBackPress} />);
    expect(screen.queryByTestId('header-menu')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Go back'));
    });
    expect(onBackPress).toHaveBeenCalledTimes(1);
  });

  it('falls back to the app name for an unknown route and shows no menu button without a handler', async () => {
    await renderWithProviders(<CustomHeader title="Nowhere" />);
    expect(screen.getByText('Meeting Guard AI')).toBeTruthy();
    expect(screen.queryByTestId('header-menu')).toBeNull();
    expect(screen.queryByTestId('header-back')).toBeNull();
  });

  it('lists the five languages with their flags, and a tap outside closes the list unchanged', async () => {
    await renderWithProviders(<CustomHeader title="Calendar" />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('header-language'));
    });
    for (const name of ['English', 'Español', 'Português', 'Français', 'Deutsch']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText(LANGUAGE_FLAGS.pt)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('header-language-scrim'));
    });
    expect(screen.queryByTestId('header-language-menu')).toBeNull();
    expect(screen.getByText('Calendar')).toBeTruthy();
  });
});

describe('MobileSidebar', () => {
  it('only lists existing routes', () => {
    const routes = Object.values(ROUTES) as string[];
    for (const item of SIDEBAR_ITEMS) expect(routes).toContain(item.route);
  });

  it('shows the user, marks the current route and navigates', async () => {
    const onClose = jest.fn();
    await renderWithProviders(<MobileSidebar visible onClose={onClose} currentRouteName="Calendar" />);
    expect(screen.getByText('Ana Pérez')).toBeTruthy();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByTestId('sidebar-item-Calendar').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

    await act(async () => {
      fireEvent.press(screen.getByText('All meetings'));
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigateToTopLevel).toHaveBeenCalledWith('TotalMeetings');
  });

  it('switches language and theme live', async () => {
    await renderWithProviders(<MobileSidebar visible onClose={jest.fn()} />);
    expect(screen.getByText('English')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sidebar-language'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('sidebar-language-es'));
    });
    expect(screen.getByText('Todas las reuniones')).toBeTruthy();
    // The field now shows the new language; the list is closed.
    expect(screen.queryByTestId('sidebar-language-menu')).toBeNull();
    expect(screen.getByTestId('sidebar-language-flag').props.children).toBe(LANGUAGE_FLAGS.es);
    expect(screen.getByText('Español')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('sidebar-theme-dark'));
    });
    expect(screen.getByTestId('sidebar-theme-dark').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    await expect(AsyncStorage.getItem('mg:theme')).resolves.toBe('dark');
  });

  it('closes and starts the shared sign-out flow', async () => {
    const onClose = jest.fn();
    await renderWithProviders(<MobileSidebar visible onClose={onClose} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('sidebar-sign-out'));
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockStartSignOut).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', async () => {
    await renderWithProviders(<MobileSidebar visible={false} onClose={jest.fn()} />);
    expect(screen.queryByTestId('sidebar-panel')).toBeNull();
  });
});
