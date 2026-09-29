// App entry point (package.json "main"). Import order matters (core/contracts "APP COMPOSITION"):
// 1. react-native-gesture-handler must be imported before anything else (React Navigation stack).
import 'react-native-gesture-handler';
// 2. Intl.PluralRules polyfill (only installed when Hermes' implementation is missing or
//    incomplete) before i18next evaluates plural rules.
import 'intl-pluralrules';
// 3. Sentry, so it can report errors thrown while the other modules load
//    (a no-op when EXPO_PUBLIC_SENTRY_DSN is not set).
import './src/services/sentry';
// 4. i18n initializes synchronously (device language) so headless tasks can translate.
import './src/i18n';
// 5. Background tasks and the notification handler must be defined at module scope, before the
//    root component registers, so headless task runs (app killed) find them.
import './src/services/alerts/tasks';
import { registerRootComponent } from 'expo';

import App from './App';
import { purgeLegacyCredentials } from './src/services/data/legacyPurge';

// 6. Plaintext tokens of the pre-rebuild app are deleted at every start, before any session
//    (upgraded users start signed out; the legacy data blob stays for the migration).
void purgeLegacyCredentials();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App) and sets up
// the environment for both development builds and release builds.
registerRootComponent(App);
