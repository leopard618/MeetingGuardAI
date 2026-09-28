// App entry point (package.json "main").
// react-native-gesture-handler must be imported before anything else (React Navigation stack).
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App) and sets up
// the environment for both development builds and release builds.
registerRootComponent(App);
