/**
 * Integration smoke test of the composed app shell: loads the real entry chain (i18n, alert
 * background tasks, AppRoot with every provider, navigation and AlertHost) and checks that a
 * signed-out start renders the Landing screen. Firebase has no configuration here, so the
 * services must degrade to "signed out" instead of crashing while they load and initialize.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

// Firebase ships ESM that Jest does not transform; nothing is configured, so stubs are enough.
jest.mock('firebase/app', () => ({ getApps: () => [], getApp: jest.fn(), initializeApp: jest.fn() }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('firebase/functions', () => ({}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(),
    signInSilently: jest.fn(),
    signOut: jest.fn(async () => null),
    getTokens: jest.fn(),
    getCurrentUser: jest.fn(() => null),
    hasPreviousSignIn: jest.fn(() => false),
    addScopes: jest.fn(),
    revokeAccess: jest.fn(),
    clearCachedAccessToken: jest.fn(),
  },
  statusCodes: { SIGN_IN_CANCELLED: '12501', IN_PROGRESS: 'IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY' },
  isErrorWithCode: () => false,
  isSuccessResponse: () => false,
  isCancelledResponse: () => false,
  isNoSavedCredentialFoundResponse: () => true,
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 0, SECRET: -1 },
  AndroidAudioUsage: { ALARM: 4, NOTIFICATION: 5 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  deleteNotificationChannelAsync: jest.fn(async () => undefined),
  getNotificationChannelsAsync: jest.fn(async () => []),
  setNotificationCategoryAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', granted: false, canAskAgain: true, ios: null })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true, ios: null })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  dismissNotificationAsync: jest.fn(async () => undefined),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponse: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

describe('AppRoot (composed app shell)', () => {
  it('loads the entry chain and shows the Landing screen when nobody is signed in', async () => {
    // index.js order: i18n (sync init) -> alert tasks (module-scope task definitions).
    require('../src/i18n');
    require('../src/services/alerts/tasks');
    const TaskManager = require('expo-task-manager');
    expect(TaskManager.defineTask).toHaveBeenCalledWith('mg-background-refresh', expect.any(Function));
    expect(TaskManager.defineTask).toHaveBeenCalledWith('mg-notification-response', expect.any(Function));

    const { AppRoot } = require('../src/navigation/AppRoot');
    const { unmount } = await render(<AppRoot />);

    // The Landing screen's language switch + consent footer (rendered once the session is known).
    await waitFor(() => expect(screen.getByText('Español')).toBeTruthy(), { timeout: 20_000 });
    await unmount();
  }, 60_000);
});
