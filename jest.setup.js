// Global Jest mocks for native modules that have no JS implementation under Jest.
// (jest-expo already mocks the Expo SDK modules.)

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
