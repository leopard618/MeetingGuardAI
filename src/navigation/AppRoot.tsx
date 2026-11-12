/**
 * The configured app (rendered by App.js once the public configuration is present).
 *
 * Provider order (core/contracts PROVIDER_ORDER, outermost first):
 *   ErrorBoundary > SafeAreaProvider > I18nProvider > ThemeProvider > PaperProvider (light/dark)
 *   > AuthProvider (sessionManager.init) > DataProvider
 *   > NavigationContainer(ref=navigationRef, linking) { RootNavigator, AlertHost, RunningLateHost } + Toast
 * The session manager (auth area) starts/stops the data session, calendar sync and alerts; this
 * root only initializes the alert engine once and registers the crash reporter for the logger.
 */
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactElement } from 'react';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { AlertHost } from '../components/alerts';
import { RunningLateHost } from '../screens/meetings/RunningLateSheet';
import { toastConfig } from '../components/AppToast';
import { PlanChangeNotice } from '../components/PlanChangeNotice';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ThemeProvider, useAppThemes } from '../contexts/ThemeContext';
import { toAppError } from '../core/errors';
import { createLogger, setErrorReporter } from '../core/logger';
import { I18nProvider } from '../i18n';
import { alertEngine, briefingScheduler, statusNotification, taskReminders } from '../services/alerts';
import { AuthProvider } from '../services/auth';
import { DataProvider } from '../services/data';
import { captureException } from '../services/sentry';
import { reportUpdateLaunch } from '../services/updates';
import { linking } from './linking';
import { navigationRef, onNavigationReady } from './navigationService';
import { RootNavigator } from './RootNavigator';

const log = createLogger('app');

/** The app typeface (tokens.ts fontFamilies). Loaded once; a load failure falls back to the system font. */
const APP_FONTS = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
};

/** Registered when this module loads (before the first render), so ErrorBoundary can report a crash of the very first render. */
function registerCrashReporter(): void {
  setErrorReporter((error, context) => captureException(error, { scope: context.scope, message: context.message }));
}
registerCrashReporter();

function ThemedApp(): ReactElement {
  // Paper, React Navigation and the status bar follow ThemeContext (system / light / dark) together.
  const { paperTheme, navigationTheme, statusBarStyle } = useAppThemes();
  const insets = useSafeAreaInsets();

  return (
    <PaperProvider theme={paperTheme}>
      <AuthProvider>
        <DataProvider>
          <NavigationContainer
            ref={navigationRef}
            linking={linking}
            theme={navigationTheme}
            onReady={onNavigationReady}
          >
            <RootNavigator />
            <AlertHost />
            <RunningLateHost />
            <PlanChangeNotice />
          </NavigationContainer>
          {/* Themed, multi-line layouts (the library default is one white line). */}
          <Toast topOffset={insets.top + 8} config={toastConfig} />
          <StatusBar style={statusBarStyle} />
        </DataProvider>
      </AuthProvider>
    </PaperProvider>
  );
}

export function AppRoot(): ReactElement | null {
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  useEffect(() => {
    if (fontError) log.warn('app fonts failed to load; using the system font', fontError.message);
  }, [fontError]);
  useEffect(() => {
    registerCrashReporter();
    // Logs the running bundle (Sentry's Expo integration reports emergency launches itself).
    reportUpdateLaunch();
    alertEngine.init().catch((error: unknown) => {
      log.error('alert engine initialization failed', toAppError(error));
    });
    taskReminders.start();
    briefingScheduler.start();
    statusNotification.start();
    return () => setErrorReporter(null);
  }, []);

  // The native splash stays up until the first frame; the fonts take a few tens of milliseconds.
  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <I18nProvider>
          <ThemeProvider>
            <ThemedApp />
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

export default AppRoot;
