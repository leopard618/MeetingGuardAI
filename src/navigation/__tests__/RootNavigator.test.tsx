import { NavigationContainer } from '@react-navigation/native';
import { act, render, screen } from '@testing-library/react-native';

import type { AuthContextValue, UsePreferencesResult } from '../../core/contracts';
import { createDefaultPreferences, type Meeting } from '../../core/types';
import { I18nProvider, i18n } from '../../i18n';
import { clearPendingNavigation, navigate, navigationRef, onNavigationReady } from '../navigationService';
import { RootNavigator } from '../RootNavigator';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

// ---- mocked contexts -----------------------------------------------------------------------------

const mockUseAuth = jest.fn();
const mockUsePreferences = jest.fn();
const mockUseMeeting = jest.fn();
const mockUseOnboardingResume = jest.fn();
const mockMounts: Record<string, number> = {};

jest.mock('../../services/auth', () => ({
  useAuth: () => mockUseAuth(),
}));


// §24: the details screen and the row actions read the zoom service (zoomStatus + hooks).
jest.mock('../../services/zoom', () => ({
  useZoomStatus: () => ({ configured: null, refresh: jest.fn() }),
  zoomService: {
    isAvailable: jest.fn(async () => false),
    getKnownAvailability: () => null,
    ensureLink: jest.fn(async () => ({ url: 'https://zoom.us/j/1', password: null, zoomMeetingId: '1' })),
    syncIfNeeded: jest.fn(async () => undefined),
    onMeetingDeleted: jest.fn(async () => undefined),
    linkFailure: () => null,
  },
}));

// The real MeetingDetails screen reads the Google Calendar connection (Meet link hint).
jest.mock('../../services/calendar', () => ({
  useCalendarStatus: () => ({ google: { enabled: false, hasScope: false }, device: { enabled: false } }),
}));
jest.mock('../../services/data', () => ({
  usePreferences: () => mockUsePreferences(),
  useMeeting: (id: string | null) => mockUseMeeting(id),
  useTasks: () => ({ tasks: [], isLoading: false, error: null, create: jest.fn(), update: jest.fn(), remove: jest.fn() }),
}));

/** A stand-in screen that renders its name + language prop and counts its mounts. */
function mockScreen(name: string) {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  function MockScreen(props: { language?: string; route?: { params?: { meeting?: { title?: string } } } }) {
    React.useEffect(() => {
      mockMounts[name] = (mockMounts[name] ?? 0) + 1;
    }, []);
    const meetingTitle = props.route?.params?.meeting?.title;
    return React.createElement(
      Text,
      { testID: `screen-${name}` },
      `${name}|${props.language ?? '-'}${meetingTitle ? `|${meetingTitle}` : ''}`,
    );
  }
  return { __esModule: true, default: MockScreen };
}

jest.mock('../../screens/home/DashboardScreen', () => ({ DashboardScreen: mockScreen('Dashboard').default }));
jest.mock('../../screens/create/ChooseCreationMethodScreen', () => ({ ChooseCreationMethodScreen: mockScreen('ChooseCreationMethod').default }));
jest.mock('../../screens/meetings/MeetingFormScreen', () => ({ MeetingFormScreen: mockScreen('MeetingForm').default }));
jest.mock('../../screens/meetings/list/MeetingsListScreen', () => ({ MeetingsListScreen: mockScreen('TotalMeetings').default }));
jest.mock('../../screens/calendar/CalendarScreen', () => ({ CalendarScreen: mockScreen('Calendar').default }));
jest.mock('../../screens/notes/NotesScreen', () => ({ NotesScreen: mockScreen('Notes').default }));
jest.mock('../../screens/attachments/MeetingAttachmentsSection', () => ({ MeetingAttachmentsSection: () => null }));
jest.mock('../../screens/settings/SettingsScreen', () => ({ SettingsScreen: mockScreen('Settings').default }));
jest.mock('../../screens/settings/WhatsAppConnectScreen', () => ({ WhatsAppConnectScreen: mockScreen('WhatsAppConnect').default }));
jest.mock('../../screens/alerts/AlertSettingsScreen', () => ({ AlertSettingsScreen: mockScreen('AlertSettings').default }));
jest.mock('../../screens/assistant/AssistantScreen', () => ({ AssistantScreen: mockScreen('AIChat').default }));
jest.mock('../../screens/insights/AIInsightsScreen', () => ({ AIInsightsScreen: mockScreen('AIInsights').default }));
jest.mock('../../screens/legal', () => ({
  PrivacyScreen: mockScreen('Privacy').default,
  TermsScreen: mockScreen('Terms').default,
  StandalonePrivacyScreen: mockScreen('Privacy').default,
  StandaloneTermsScreen: mockScreen('Terms').default,
}));
jest.mock('../../screens/calendarSync/CalendarSyncScreen', () => ({ CalendarSyncScreen: mockScreen('CalendarSync').default }));
jest.mock('../../screens/pricing/PricingScreen', () => ({ PricingScreen: mockScreen('Pricing').default }));
jest.mock('../../screens/auth/LandingScreen', () => ({ LandingScreen: mockScreen('Landing').default }));
jest.mock('../../components/CustomHeader', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const MockHeader = ({ title }: { title: string }) => React.createElement(Text, { testID: 'header' }, `header:${title}`);
  return { __esModule: true, CustomHeader: MockHeader, default: MockHeader };
});
jest.mock('../../components/MobileSidebar', () => ({ __esModule: true, MobileSidebar: () => null, default: () => null }));
// The real bar needs the ThemeProvider; this stand-in only reports the route it was given.
jest.mock('../../components/BottomNavBar', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const MockBar = ({ currentRouteName }: { currentRouteName: string | null }) =>
    React.createElement(Text, { testID: 'bottom-bar' }, `bar:${currentRouteName ?? 'none'}`);
  return { __esModule: true, BottomNavBar: MockBar, default: MockBar };
});
jest.mock('../../screens/onboarding', () => {
  const stepScreen = (name: string) => () => mockScreen(name).default({});
  return {
    OnboardingLanguageScreen: stepScreen('OnboardingLanguage'),
    OnboardingCalendarsScreen: stepScreen('OnboardingCalendars'),
    OnboardingAlertsScreen: stepScreen('OnboardingAlerts'),
    OnboardingAssistantScreen: stepScreen('OnboardingAssistant'),
    OnboardingFirstMeetingScreen: stepScreen('OnboardingFirstMeeting'),
    useOnboardingResume: (uid: string | null) => mockUseOnboardingResume(uid),
  };
});

// ---- helpers ---------------------------------------------------------------------------------------

const USER = { uid: 'u1', email: 'user@example.com', displayName: 'User', photoURL: null, emailVerified: true, providerIds: ['google.com'] };

function authState(status: AuthContextValue['status']): Partial<AuthContextValue> {
  const signedIn = status === 'active';
  return {
    status,
    isAuthenticated: signedIn,
    isLoading: status !== 'active' && status !== 'signed_out',
    authUser: signedIn ? USER : null,
    signOut: jest.fn(async () => undefined),
  };
}

function preferencesState(overrides: Partial<UsePreferencesResult> & { onboardingCompleted?: boolean } = {}): UsePreferencesResult {
  const preferences = {
    ...createDefaultPreferences({ language: 'en', timezone: 'UTC' }),
    onboardingCompleted: overrides.onboardingCompleted ?? true,
  };
  return {
    preferences,
    isLoaded: overrides.isLoaded ?? true,
    error: overrides.error ?? null,
    update: jest.fn(),
  };
}

function renderNavigator() {
  return render(
    <I18nProvider>
      <NavigationContainer ref={navigationRef} onReady={onNavigationReady}>
        <RootNavigator />
      </NavigationContainer>
    </I18nProvider>,
  );
}

const MEETING: Meeting = {
  id: 'm1',
  userId: 'u1',
  title: 'Budget review',
  description: '',
  startAt: '2026-10-05T13:00:00.000Z',
  durationMinutes: 60,
  timezone: 'UTC',
  allDay: false,
  date: '2026-10-05',
  time: '13:00',
  location: null,
  conference: null,
  participants: [],
  source: 'manual',
  confidence: null,
  language: 'en',
  preparationTips: [],
  customAlertTimes: null,
  alertIntensity: null,
  notes: null,
  status: 'scheduled',
  external: {
    googleEventId: null,
    googleCalendarId: null,
    googleEtag: null,
    googleUpdatedAt: null,
    deviceEventId: null,
    deviceCalendarId: null,
    outlookEventId: null,
    outlookCalendarId: null,
    outlookChangeKey: null,
    outlookUpdatedAt: null,
    zoomMeetingId: null,
  },
  recurrence: null,
  recurrenceOverrides: null,
  seriesId: null,
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
  deletedAt: null,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  clearPendingNavigation();
  Object.keys(mockMounts).forEach((key) => delete mockMounts[key]);
  mockUseAuth.mockReturnValue(authState('active'));
  mockUsePreferences.mockReturnValue(preferencesState());
  mockUseMeeting.mockReturnValue({ meeting: null, isLoading: false, error: null });
  mockUseOnboardingResume.mockReturnValue({ loaded: true, step: null });
});

// ---- tests -------------------------------------------------------------------------------------------

describe('RootNavigator gate', () => {
  it('shows the splash while the session is restoring', async () => {
    mockUseAuth.mockReturnValue(authState('initializing'));
    await renderNavigator();
    expect(screen.getByTestId('app-splash')).toBeTruthy();
  });

  it('shows the Landing screen when signed out', async () => {
    mockUseAuth.mockReturnValue(authState('signed_out'));
    mockUsePreferences.mockReturnValue(preferencesState({ isLoaded: false }));
    await renderNavigator();
    expect(screen.getByTestId('screen-Landing')).toBeTruthy();
  });

  it('waits for the preferences, and reports a preferences failure', async () => {
    mockUsePreferences.mockReturnValue(preferencesState({ isLoaded: false }));
    const view = await renderNavigator();
    expect(screen.getByTestId('app-splash')).toBeTruthy();

    mockUsePreferences.mockReturnValue(
      preferencesState({ isLoaded: false, error: { code: 'offline' } as UsePreferencesResult['error'] }),
    );
    await view.rerender(
      <I18nProvider>
        <NavigationContainer ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      </I18nProvider>,
    );
    expect(screen.getByTestId('preferences-error')).toBeTruthy();
  });

  it('shows onboarding (resuming at the stored step) until it is completed', async () => {
    mockUsePreferences.mockReturnValue(preferencesState({ onboardingCompleted: false }));
    mockUseOnboardingResume.mockReturnValue({ loaded: true, step: 'OnboardingAlerts' });
    await renderNavigator();
    expect(screen.getByTestId('screen-OnboardingAlerts')).toBeTruthy();
    expect(mockUseOnboardingResume).toHaveBeenCalledWith('u1');
  });

  it('shows the splash while the onboarding progress is being read', async () => {
    mockUsePreferences.mockReturnValue(preferencesState({ onboardingCompleted: false }));
    mockUseOnboardingResume.mockReturnValue({ loaded: false, step: null });
    await renderNavigator();
    expect(screen.getByTestId('app-splash')).toBeTruthy();
  });

  it('shows the Main group with the header and the bottom bar when onboarding is completed', async () => {
    await renderNavigator();
    expect(screen.getByTestId('screen-Dashboard').props.children).toBe('Dashboard|-');
    expect(screen.getByTestId('header').props.children).toBe('header:Dashboard');
    expect(screen.getByTestId('bottom-bar').props.children).toBe('bar:Dashboard');

    await act(async () => {
      navigate('Calendar');
    });
    expect(screen.getByTestId('bottom-bar').props.children).toBe('bar:Calendar');
  });

  it('has no bottom bar outside the Main group', async () => {
    mockUseAuth.mockReturnValue(authState('signed_out'));
    await renderNavigator();
    expect(screen.queryByTestId('bottom-bar')).toBeNull();
  });
});

describe('language and navigation behaviour', () => {
  it('keeps the dashboard mounted when the language changes (TypeScript screens read it themselves)', async () => {
    await renderNavigator();
    expect(screen.getByTestId('screen-Dashboard').props.children).toBe('Dashboard|-');
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    expect(screen.getByTestId('screen-Dashboard')).toBeTruthy();
    expect(mockMounts.Dashboard).toBe(1);
  });

  it('opens an intent queued during onboarding once the Main group mounts', async () => {
    mockUsePreferences.mockReturnValue(preferencesState({ onboardingCompleted: false }));
    mockUseMeeting.mockImplementation((id: string | null) => ({
      meeting: id === 'm1' ? MEETING : null,
      isLoading: false,
      error: null,
    }));
    const view = await renderNavigator();
    expect(screen.getByTestId('screen-OnboardingLanguage')).toBeTruthy();

    await act(async () => {
      navigate('MeetingDetails', { meetingId: 'm1' });
    });
    mockUsePreferences.mockReturnValue(preferencesState({ onboardingCompleted: true }));
    await view.rerender(
      <I18nProvider>
        <NavigationContainer ref={navigationRef} onReady={onNavigationReady}>
          <RootNavigator />
        </NavigationContainer>
      </I18nProvider>,
    );
    // The real (TypeScript) details screen reads the live meeting from the deep-link id.
    expect((await screen.findByTestId('meeting-title')).props.children).toBe('Budget review');
    expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(['Dashboard', 'MeetingDetails']);
  });

  it('shows "meeting not found" for an unknown deep-link meeting', async () => {
    await renderNavigator();
    await act(async () => {
      navigate('MeetingDetails', { meetingId: 'missing' });
    });
    expect(await screen.findByText('Meeting not found')).toBeTruthy();
  });
});
