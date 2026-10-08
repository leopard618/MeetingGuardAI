// Root component (owner: i18n-nav).
//
// Without the public EXPO_PUBLIC_* configuration (e.g. an EAS build missing its environment
// variables) Firebase cannot start: show a clear bilingual screen instead of crashing. Only in
// the configured case is the app shell (providers, navigation, services) loaded - lazily, so the
// "not configured" path never evaluates the service modules. The provider composition lives in
// src/navigation/AppRoot.tsx (core/contracts PROVIDER_ORDER).
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import NotConfiguredScreen from './src/components/NotConfiguredScreen';
import { env } from './src/config/env';
import { isFirebaseReady } from './src/config/firebase';
import { wrapRootComponent } from './src/services/sentry';

function App() {
  if (!env.isConfigured || !isFirebaseReady) {
    return (
      <SafeAreaProvider>
        <NotConfiguredScreen missingKeys={env.missingKeys} invalidKeys={env.invalidKeys} />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  // Metro caches the module after the first render; this is a one-time lazy load.
  const { AppRoot } = require('./src/navigation/AppRoot');
  return <AppRoot />;
}

export default wrapRootComponent(App);
