// Global Jest mocks for native modules that have no JS implementation under Jest.
// (jest-expo already mocks the Expo SDK modules.)

// react-native-gesture-handler native mocks (React Navigation stack, Paper touchables).
require('react-native-gesture-handler/jestSetup');

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// Sentry's React Native entry pulls in ESM builds of @sentry/core; tests never send events.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: (component) => component,
  captureException: jest.fn(),
}));

// expo-speech-recognition's native module is not available under Jest. Recognition is reported
// available with granted permissions; tests drive results through useSpeechRecognitionEvent mocks.
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    isRecognitionAvailable: jest.fn(() => true),
    getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' })),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' })),
    getSpeechRecognitionServices: jest.fn(() => []),
    supportsOnDeviceRecognition: jest.fn(() => false),
    supportsRecording: jest.fn(() => false),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

// expo-audio's native player class is not available under Jest.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    volume: 1,
    loop: false,
  })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  useAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn() })),
}));

// The app typeface: expo-font's loader is native; tests render with the fonts reported as loaded.
jest.mock('@expo-google-fonts/plus-jakarta-sans', () => ({
  useFonts: () => [true, null],
  PlusJakartaSans_400Regular: 1,
  PlusJakartaSans_500Medium: 2,
  PlusJakartaSans_600SemiBold: 3,
  PlusJakartaSans_700Bold: 4,
  PlusJakartaSans_800ExtraBold: 5,
}));
