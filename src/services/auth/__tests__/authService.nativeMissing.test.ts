/**
 * A build without the Google Sign-In native code (Expo Go, a misconfigured prebuild) must still
 * start: the module is loaded lazily and only Google features report a typed error.
 * (jest.mock calls are hoisted above the import.)
 */
import { authService } from '../authService';

jest.mock('@react-native-google-signin/google-signin', () => {
  throw new Error("TurboModuleRegistry.getEnforcing(...): 'RNGoogleSignin' could not be found");
});

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: jest.fn() },
  signInWithCredential: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendEmailVerification: jest.fn(async () => undefined),
  signOut: jest.fn(async () => undefined),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));

jest.mock('../../../config/firebase', () => ({
  auth: { currentUser: null, authStateReady: jest.fn(async () => undefined) },
  functions: {},
  isFirebaseReady: true,
}));

jest.mock('../../../config/env', () => ({
  env: { google: { webClientId: 'web-client.apps.googleusercontent.com', iosClientId: null, androidClientId: null } },
}));


beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('imports fine and reports Google Sign-In as unavailable only when it is used', async () => {
  expect(() => authService.init()).not.toThrow();
  await expect(authService.signInWithGoogle()).rejects.toMatchObject({
    code: 'unsupported',
    details: { reason: 'google_sign_in_unavailable' },
  });
  await expect(authService.getGoogleAccessToken({ requireCalendar: true })).rejects.toMatchObject({
    code: 'unsupported',
  });
});

it('still signs out of Firebase without the Google module', async () => {
  const fb = jest.requireMock('firebase/auth') as { signOut: jest.Mock };
  await expect(authService.signOutProviders()).resolves.toBeUndefined();
  expect(fb.signOut).toHaveBeenCalledTimes(1);
});
