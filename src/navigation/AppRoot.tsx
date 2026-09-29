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
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactElement } from 'react';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { AlertHost } from '../components/alerts';
import { toastConfig } from '../components/AppToast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ThemeProvider, useAppThemes } from '../contexts/ThemeContext';
import { toAppError } from '../core/errors';
import { createLogger, setErrorReporter } from '../core/logger';
import { I18nProvider } from '../i18n';
import { alertEngine } from '../services/alerts';
import { AuthProvider } from '../services/auth';
import { DataProvider } from '../services/data';
import { captureException } from '../services/sentry';
import { reportUpdateLaunch } from '../services/updates';
import { linking } from './linking';
import { navigationRef, onNavigationReady } from './navigationService';
import { RootNavigator } from './RootNavigator';

const log = createLogger('app');

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
          </NavigationContainer>
          {/* Themed, multi-line layouts (the library default is one white line). */}
          <Toast topOffset={insets.top + 8} config={toastConfig} />
          <StatusBar style={statusBarStyle} />
        </DataProvider>
      </AuthProvider>
    </PaperProvider>
  );
}

export function AppRoot(): ReactElement {
  useEffect(() => {
    registerCrashReporter();
    // Logs the running bundle (Sentry's Expo integration reports emergency launches itself).
    reportUpdateLaunch();
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
