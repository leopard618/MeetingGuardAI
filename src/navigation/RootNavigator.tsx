/**
 * Root stack (single navigator) whose screen group follows the app gate:
 *   splash -> Auth (Landing, Privacy, Terms) -> Onboarding (5 resumable steps) -> Main.
 * Every screen component is module-level (./screens, src/screens/onboarding). The navigator is
 * keyed by the gate so each group starts from a clean stack; queued navigation intents (deep
 * links, notification taps, the onboarding's "first meeting" choice) are flushed once the target
 * group is mounted.
 */
import { createStackNavigator, type StackHeaderProps, type StackNavigationOptions } from '@react-navigation/stack';
import { useEffect, type ReactElement, type ReactNode } from 'react';

import { CustomHeader } from '../components/CustomHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { RootStackParamList, RouteName } from '../core/contracts';
import {
  OnboardingAlertsScreen,
  OnboardingAssistantScreen,
  OnboardingCalendarsScreen,
  OnboardingFirstMeetingScreen,
  OnboardingLanguageScreen,
  useOnboardingResume,
} from '../screens/onboarding';
import { useAuth } from '../services/auth';
import { usePreferences } from '../services/data';
import { computeGate, type AppGate } from './gate';
import { flushPendingNavigation } from './navigationService';
import { MAIN_INITIAL_ROUTE, ONBOARDING_STEPS } from './routes';
import {
  AIChatScreen,
  AIInsightsScreen,
  AlertSettingsScreen,
  CalendarScreen,
  CalendarSyncScreen,
  ChooseCreationMethodScreen,
  CreateMeetingScreen,
  DashboardScreen,
  EditMeetingScreen,
  LandingScreen,
  MeetingDetailsScreen,
  NotesScreen,
  PricingScreen,
  PrivacyScreen,
  ProfileScreen,
  SettingsScreen,
  StandalonePrivacyScreen,
  StandaloneTermsScreen,
  TermsScreen,
  TotalMeetingsScreen,
} from './screens';
import { MainSidebar, SidebarProvider, useSidebar } from './sidebar';
import { PreferencesErrorScreen, SplashScreen } from './StatusScreens';
import { useSignOutFlow } from './useSignOut';

const Stack = createStackNavigator<RootStackParamList>();

function MainHeader({ routeName, onBackPress }: { routeName: RouteName; onBackPress?: () => void }): ReactElement {
  const { open } = useSidebar();
  return <CustomHeader title={routeName} onMenuPress={open} showMenu onBackPress={onBackPress} />;
}

function renderMainHeader({ route, back, navigation }: StackHeaderProps): ReactNode {
  return <MainHeader routeName={route.name as RouteName} onBackPress={back ? navigation.goBack : undefined} />;
}

/** A render error replaces only the failed screen (header and navigation keep working). */
function renderScreenLayout({ children }: { children: ReactElement }): ReactElement {
  return <ErrorBoundary scope="screen">{children}</ErrorBoundary>;
}

const HEADERLESS_OPTIONS: StackNavigationOptions = { headerShown: false };
const MAIN_OPTIONS: StackNavigationOptions = { header: renderMainHeader };

/** Current gate from the session and the user's preferences (exported for tests/diagnostics). */
export function useAppGate(): AppGate {
  const auth = useAuth();
  const { preferences, isLoaded, error } = usePreferences();
  return computeGate({
    sessionStatus: auth.status,
    isAuthenticated: auth.isAuthenticated,
    preferencesLoaded: isLoaded,
    preferencesFailed: error !== null,
    onboardingCompleted: preferences.onboardingCompleted,
  });
}

export function RootNavigator(): ReactElement {
  const auth = useAuth();
  const gate = useAppGate();
  const uid = auth.authUser?.uid ?? null;
  const resume = useOnboardingResume(gate === 'onboarding' ? uid : null);
  const startSignOut = useSignOutFlow();

  useEffect(() => {
    flushPendingNavigation();
  }, [gate, resume.loaded]);

  if (gate === 'splash' || (gate === 'onboarding' && !resume.loaded)) {
    return <SplashScreen onSignOut={auth.isAuthenticated ? startSignOut : undefined} />;
  }
  if (gate === 'preferences_error') {
    return <PreferencesErrorScreen onSignOut={startSignOut} />;
  }

  if (gate === 'auth') {
    return (
      <Stack.Navigator key="auth" initialRouteName="Landing" screenOptions={HEADERLESS_OPTIONS} screenLayout={renderScreenLayout}>
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="Privacy" component={StandalonePrivacyScreen} />
        <Stack.Screen name="Terms" component={StandaloneTermsScreen} />
      </Stack.Navigator>
    );
  }

  if (gate === 'onboarding') {
    return (
      <Stack.Navigator
        key="onboarding"
        initialRouteName={resume.step ?? ONBOARDING_STEPS[0]}
        screenOptions={HEADERLESS_OPTIONS}
        screenLayout={renderScreenLayout}
      >
        <Stack.Screen name="OnboardingLanguage" component={OnboardingLanguageScreen} />
        <Stack.Screen name="OnboardingCalendars" component={OnboardingCalendarsScreen} />
        <Stack.Screen name="OnboardingAlerts" component={OnboardingAlertsScreen} />
        <Stack.Screen name="OnboardingAssistant" component={OnboardingAssistantScreen} />
        <Stack.Screen name="OnboardingFirstMeeting" component={OnboardingFirstMeetingScreen} />
        <Stack.Screen name="Privacy" component={StandalonePrivacyScreen} />
        <Stack.Screen name="Terms" component={StandaloneTermsScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <SidebarProvider>
      <Stack.Navigator key="main" initialRouteName={MAIN_INITIAL_ROUTE} screenOptions={MAIN_OPTIONS} screenLayout={renderScreenLayout}>
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="ChooseCreationMethod" component={ChooseCreationMethodScreen} />
        <Stack.Screen name="CreateMeeting" component={CreateMeetingScreen} />
        <Stack.Screen name="TotalMeetings" component={TotalMeetingsScreen} />
        <Stack.Screen name="MeetingDetails" component={MeetingDetailsScreen} />
        <Stack.Screen name="EditMeeting" component={EditMeetingScreen} />
        <Stack.Screen name="Calendar" component={CalendarScreen} />
        <Stack.Screen name="Notes" component={NotesScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="AlertSettings" component={AlertSettingsScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="AIChat" component={AIChatScreen} />
        <Stack.Screen name="AIInsights" component={AIInsightsScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
        <Stack.Screen name="Terms" component={TermsScreen} />
        <Stack.Screen name="CalendarSync" component={CalendarSyncScreen} />
        <Stack.Screen name="Pricing" component={PricingScreen} />
      </Stack.Navigator>
      <MainSidebar />
    </SidebarProvider>
  );
}
