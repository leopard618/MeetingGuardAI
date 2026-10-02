/**
 * A build without the Sign in with Apple native module (Android, Expo Go) must still start: the
 * module is loaded lazily (section 26) and only Apple features report a typed error, while
 * reauthentication falls back to the account's other providers.
 */
import { authService } from '../authService';

jest.mock('expo-apple-authentication', () => {
  throw new Error('expo-apple-authentication only resolves in iOS builds');
}, { virtual: true });

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({
      type: 'success',
      data: { idToken: 'google-id-token', scopes: [], user: { id: 'g1' } },
    })),
    signInSilently: jest.fn(),
    signOut: jest.fn(async () => null),
    hasPreviousSignIn: jest.fn(() => false),
    getCurrentUser: jest.fn(() => null),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: '12501',
    IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: '4',
    NULL_PRESENTER: 'NULL_PRESENTER',
  },
}));

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: jest.fn((idToken: string) => ({ providerId: 'google.com', idToken })) },
  EmailAuthProvider: { credential: jest.fn() },
  OAuthProvider: class {},
  reauthenticateWithCredential: jest.fn(async () => undefined),
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
  (jest.requireMock('../../../config/firebase') as { auth: { currentUser: unknown } }).auth.currentUser = null;
});

it('reports Sign in with Apple as unavailable only when it is used', async () => {
  await expect(authService.signInWithApple()).rejects.toMatchObject({
    code: 'unsupported',
    details: { reason: 'apple_sign_in_unavailable' },
  });
});

it('reauthenticates an apple.com + google.com account through Google when Apple cannot load', async () => {
  const firebaseConfig = jest.requireMock('../../../config/firebase') as { auth: { currentUser: unknown } };
  firebaseConfig.auth.currentUser = {
    uid: 'uid-1',
    email: 'ana@example.com',
    displayName: 'Ana',
    photoURL: null,
    emailVerified: true,
    providerData: [{ providerId: 'apple.com' }, { providerId: 'google.com' }],
  };

  await expect(authService.reauthenticate()).resolves.toBe('done');
  const fb = jest.requireMock('firebase/auth') as { reauthenticateWithCredential: jest.Mock };
  expect(fb.reauthenticateWithCredential).toHaveBeenCalledWith(expect.anything(), {
    providerId: 'google.com',
    idToken: 'google-id-token',
  });
});
