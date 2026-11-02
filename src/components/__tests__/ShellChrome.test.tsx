/**
 * Header, sidebar and bottom bar of the Main group: live language and theme, navigation to existing
 * routes only, sign-out through the shared flow (which handles unsynced changes).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../contexts/ThemeContext';
import { I18nProvider, i18n } from '../../i18n';
import { ROUTES } from '../../navigation/routes';
import { BOTTOM_BAR_ITEMS, BottomNavBar } from '../BottomNavBar';
import { TAB_ROOT_ROUTES } from '../../navigation/routes';
import { avatarInitial, CustomHeader, nextLanguage } from '../CustomHeader';
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
  it('shows the route title and switches the language live', async () => {
    const onMenuPress = jest.fn();
    await renderWithProviders(<CustomHeader title="Calendar" onMenuPress={onMenuPress} />);
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByLabelText('Change language to Español')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('header-language'));
    });
    expect(screen.getByText('Calendario')).toBeTruthy();
    expect(screen.getByText('ES')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('header-menu'));
    });
    expect(onMenuPress).toHaveBeenCalledTimes(1);
  });

  it('shows the account avatar with the user initial as the menu button', async () => {
    const onMenuPress = jest.fn();
    await renderWithProviders(<CustomHeader title="Dashboard" onMenuPress={onMenuPress} />);
    expect(screen.queryByTestId('header-theme')).toBeNull();
    expect(screen.getByText('A')).toBeTruthy();
    expect(avatarInitial(null, 'zoe@example.com')).toBe('Z');
    expect(avatarInitial('  ', '')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('header-menu'));
    });
    expect(onMenuPress).toHaveBeenCalledTimes(1);
  });

  it('shows a back button instead of the logo when the stack can go back', async () => {
    const onBackPress = jest.fn();
    await renderWithProviders(<CustomHeader title="MeetingDetails" onBackPress={onBackPress} />);
    expect(screen.queryByTestId('header-home')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Go back'));
    });
    expect(onBackPress).toHaveBeenCalledTimes(1);
  });

  it('goes to the dashboard from the logo and falls back to the app name', async () => {
    await renderWithProviders(<CustomHeader title="NotARoute" />);
    expect(screen.getByText('MeetingGuard AI')).toBeTruthy();
    expect(screen.queryByTestId('header-menu')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('header-home'));
    });
    expect(mockNavigateToTopLevel).toHaveBeenCalledWith('Dashboard');
  });

  it('cycles through the supported languages', () => {
    expect(nextLanguage('en', ['en', 'es'])).toBe('es');
    expect(nextLanguage('es', ['en', 'es'])).toBe('en');
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
    await act(async () => {
      fireEvent.press(screen.getByTestId('sidebar-language-es'));
    });
    expect(screen.getByText('Todas las reuniones')).toBeTruthy();
    expect(screen.getByTestId('sidebar-language-es').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

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

describe('BottomNavBar', () => {
  it('only lists existing routes, each once, and they are the header tab roots', () => {
    const routes = Object.values(ROUTES) as string[];
    for (const item of BOTTOM_BAR_ITEMS) expect(routes).toContain(item.route);
    expect(new Set(BOTTOM_BAR_ITEMS.map((item) => item.route)).size).toBe(BOTTOM_BAR_ITEMS.length);
    expect(new Set(BOTTOM_BAR_ITEMS.map((item) => item.route))).toEqual(TAB_ROOT_ROUTES);
  });

  it('marks the current route and navigates to a top-level destination', async () => {
    await renderWithProviders(<BottomNavBar currentRouteName="Calendar" />);
    expect(screen.getByTestId('bottom-bar')).toBeTruthy();
    expect(screen.getByTestId('bottom-bar-item-Calendar').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('bottom-bar-item-Dashboard').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    expect(screen.getByLabelText('Meetings')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('bottom-bar-item-Tasks'));
    });
    expect(mockNavigateToTopLevel).toHaveBeenCalledWith('Tasks');
  });

  it('selects nothing on a pushed detail screen and labels in the live language', async () => {
    await renderWithProviders(<BottomNavBar currentRouteName="MeetingDetails" />);
    for (const item of BOTTOM_BAR_ITEMS) {
      expect(screen.getByTestId(`bottom-bar-item-${item.route}`).props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    }
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    expect(screen.getByLabelText('Inicio')).toBeTruthy();
    expect(screen.getByLabelText('Reuniones')).toBeTruthy();
  });

  it('carries the AI assistant as the middle item and stays on the chat screen', async () => {
    expect(BOTTOM_BAR_ITEMS[2]).toEqual(expect.objectContaining({ route: 'AIChat', kind: 'ai' }));
    await renderWithProviders(<BottomNavBar currentRouteName="AIChat" />);
    expect(screen.getByTestId('bottom-bar')).toBeTruthy();
    const orb = screen.getByTestId('bottom-bar-item-AIChat');
    expect(orb.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByLabelText('AI')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('bottom-bar-item-Dashboard'));
    });
    expect(mockNavigateToTopLevel).toHaveBeenCalledWith('Dashboard');
  });

  it('opens the assistant from the orb on any screen (null = navigator not ready yet)', async () => {
    await renderWithProviders(<BottomNavBar currentRouteName={null} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('bottom-bar-item-AIChat'));
    });
    expect(mockNavigateToTopLevel).toHaveBeenCalledWith('AIChat');
  });
});
