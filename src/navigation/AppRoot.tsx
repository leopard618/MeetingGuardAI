/**
 * The configured app (rendered by App.js once the public configuration is present).
 *
 * Provider order (core/contracts PROVIDER_ORDER, outermost first):
 *   ErrorBoundary > SafeAreaProvider > I18nProvider > ThemeProvider > PaperProvider (light/dark)
 *   > AuthProvider (sessionManager.init) > DataProvider
 *   > NavigationContainer(ref=navigationRef, linking) { RootNavigator, AlertHost } + Toast
 * The session manager (auth area) starts/stops the data session, calendar sync and alerts; this
 * root only initializes the alert engine once and registers the crash reporter for the logger.
 */
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationLightTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactElement } from 'react';
import { MD3DarkTheme, MD3LightTheme, PaperProvider, adaptNavigationTheme } from 'react-native-paper';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { AlertHost } from '../components/alerts';
import ErrorBoundary from '../components/ErrorBoundary';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { toAppError } from '../core/errors';
import { createLogger, setErrorReporter } from '../core/logger';
import { I18nProvider } from '../i18n';
import { alertEngine } from '../services/alerts';
import { AuthProvider } from '../services/auth';
import { DataProvider } from '../services/data';
import { captureException } from '../services/sentry';
import { linking } from './linking';
import { navigationRef, onNavigationReady } from './navigationService';
import { RootNavigator } from './RootNavigator';

const log = createLogger('app');

const { LightTheme: NAVIGATION_LIGHT, DarkTheme: NAVIGATION_DARK } = adaptNavigationTheme({
  reactNavigationLight: NavigationLightTheme,
  reactNavigationDark: NavigationDarkTheme,
  materialLight: MD3LightTheme,
  materialDark: MD3DarkTheme,
});

function ThemedApp(): ReactElement {
  const { isDarkMode } = useTheme() as { isDarkMode: boolean };
  const insets = useSafeAreaInsets();

  return (
    <PaperProvider theme={isDarkMode ? MD3DarkTheme : MD3LightTheme}>
      <AuthProvider>
        <DataProvider>
          <NavigationContainer
            ref={navigationRef}
            linking={linking}
            theme={isDarkMode ? NAVIGATION_DARK : NAVIGATION_LIGHT}
            onReady={onNavigationReady}
          >
            <RootNavigator />
            <AlertHost />
          </NavigationContainer>
          <Toast topOffset={insets.top + 8} />
          <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        </DataProvider>
      </AuthProvider>
    </PaperProvider>
  );
}

export function AppRoot(): ReactElement {
  useEffect(() => {
    setErrorReporter((error, context) => captureException(error, { scope: context.scope, message: context.message }));
    alertEngine.init().catch((error: unknown) => {
      log.error('alert engine initialization failed', toAppError(error));
    });
    return () => setErrorReporter(null);
  }, []);

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
