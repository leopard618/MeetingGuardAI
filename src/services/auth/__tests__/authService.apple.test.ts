/**
 * authService Sign in with Apple suite (docs/ARCHITECTURE.md section 26) with mocked
 * expo-apple-authentication ({ virtual: true }: the package only resolves in iOS builds),
 * expo-crypto and firebase/auth. Modules are re-required per test so the module state (cached
 * Apple module, stashed authorizationCode) starts fresh. jest-expo runs as iOS by default, which
 * is exactly the platform the Apple reauthentication branch requires.
 */
import { APPLE_AUTH_CODE_TTL_MS, type AuthServiceImpl } from '../authService';

const mockApple = {
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
};
jest.mock('expo-apple-authentication', () => mockApple, { virtual: true });

jest.mock('expo-crypto', () => ({
  // 32 deterministic bytes 0..31 -> raw nonce 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef' (base64url alphabet).
  getRandomBytes: jest.fn((count: number) => Uint8Array.from({ length: count }, (_, index) => index)),
  digestStringAsync: jest.fn(async () => 'hashed-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

/** What the deterministic getRandomBytes mock encodes to (and Firebase receives as rawNonce). */
const RAW_NONCE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
    addScopes: jest.fn(),
    signInSilently: jest.fn(),
    signOut: jest.fn(),
    revokeAccess: jest.fn(),
    hasPreviousSignIn: jest.fn(),
    getCurrentUser: jest.fn(),
    clearCachedAccessToken: jest.fn(),
    getTokens: jest.fn(),
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
  OAuthProvider: class {
    providerId: string;
    constructor(providerId: string) {
      this.providerId = providerId;
    }
    credential(params: { idToken: string; rawNonce: string }): { providerId: string; idToken: string; rawNonce: string } {
      return { providerId: this.providerId, ...params };
    }
  },
  reauthenticateWithCredential: jest.fn(),
  revokeAccessToken: jest.fn(),
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

type MockFn = jest.Mock;
interface FirebaseAuthMock {
  reauthenticateWithCredential: MockFn;
  revokeAccessToken: MockFn;
  signInWithCredential: MockFn;
  updateProfile: MockFn;
}
interface CryptoMock {
  getRandomBytes: MockFn;
  digestStringAsync: MockFn;
}

interface Loaded {
  authService: AuthServiceImpl;
  fb: FirebaseAuthMock;
  crypto: CryptoMock;
  google: Record<string, MockFn>;
  firebaseConfig: { auth: { currentUser: unknown } };
}

function firebaseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    uid: 'uid-1',
    email: 'relay@privaterelay.appleid.com',
    displayName: null as string | null,
    photoURL: null,
    emailVerified: true,
    providerData: [{ providerId: 'apple.com' }],
    ...overrides,
  };
}

function appleCredential(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    identityToken: 'apple-id-token',
    authorizationCode: 'apple-auth-code',
    email: 'relay@privaterelay.appleid.com',
    fullName: {
      givenName: 'Ana',
      middleName: null,
      familyName: 'Garcia',
      namePrefix: null,
      nameSuffix: null,
      nickname: null,
    },
    ...overrides,
  };
}

function nativeError(code: string, message = 'native failure') {
  return Object.assign(new Error(message), { code });
}

function load(): Loaded {
  const fb = jest.requireMock('firebase/auth') as FirebaseAuthMock;
  const crypto = jest.requireMock('expo-crypto') as CryptoMock;
  const google = (jest.requireMock('@react-native-google-signin/google-signin') as { GoogleSignin: Record<string, MockFn> })
    .GoogleSignin;
  const firebaseConfig = jest.requireMock('../../../config/firebase') as Loaded['firebaseConfig'];
  mockApple.isAvailableAsync.mockReset().mockResolvedValue(true);
  mockApple.signInAsync.mockReset();
  // requireActual: a fresh copy of the module under test (its dependencies stay mocked).
  const { authService } = jest.requireActual<typeof import('../authService')>('../authService');
  return { authService, fb, crypto, google, firebaseConfig };
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('signInWithApple', () => {
  it('signs in with the nonce contract: SHA-256 hash to Apple, raw nonce to Firebase', async () => {
    const { authService, fb, crypto } = load();
    mockApple.signInAsync.mockResolvedValue(appleCredential());
    fb.signInWithCredential.mockResolvedValue({ user: firebaseUser({ displayName: 'Ana Garcia' }) });

    const result = await authService.signInWithApple();

    expect(result).toEqual({
      status: 'success',
      user: expect.objectContaining({ uid: 'uid-1', providerIds: ['apple.com'] }),
    });
    expect(crypto.digestStringAsync).toHaveBeenCalledWith('SHA-256', RAW_NONCE);
    expect(mockApple.signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce: 'hashed-nonce' });
    expect(fb.signInWithCredential).toHaveBeenCalledWith(expect.anything(), {
      providerId: 'apple.com',
      idToken: 'apple-id-token',
      rawNonce: RAW_NONCE,
    });
    // The display name exists already: the first-sign-in capture must not overwrite it.
    expect(fb.updateProfile).not.toHaveBeenCalled();
  });

  it('resolves cancelled (silently) when the user dismisses the Apple sheet', async () => {
    const { authService, fb } = load();
    mockApple.signInAsync.mockRejectedValue(nativeError('ERR_REQUEST_CANCELED'));

    await expect(authService.signInWithApple()).resolves.toEqual({ status: 'cancelled' });
    expect(fb.signInWithCredential).not.toHaveBeenCalled();
  });

  it('reports unavailability as unsupported / apple_sign_in_unavailable', async () => {
    const { authService } = load();
    mockApple.isAvailableAsync.mockResolvedValue(false);

    await expect(authService.signInWithApple()).rejects.toMatchObject({
      code: 'unsupported',
      details: { reason: 'apple_sign_in_unavailable' },
    });
    expect(mockApple.signInAsync).not.toHaveBeenCalled();
  });

  it('treats a failing availability probe as unavailable', async () => {
    const { authService } = load();
    mockApple.isAvailableAsync.mockRejectedValue(nativeError('ERR_REQUEST_UNKNOWN'));

    await expect(authService.signInWithApple()).rejects.toMatchObject({
      code: 'unsupported',
      details: { reason: 'apple_sign_in_unavailable' },
    });
  });

  it('fails typed when Apple returns no identity token', async () => {
    const { authService, fb } = load();
    mockApple.signInAsync.mockResolvedValue(appleCredential({ identityToken: null }));

    await expect(authService.signInWithApple()).rejects.toMatchObject({
      code: 'upstream_error',
      details: { reason: 'apple_sign_in_failed' },
    });
    expect(fb.signInWithCredential).not.toHaveBeenCalled();
  });

  it('saves the one-time Apple name as the display name on the first sign-in', async () => {
    const { authService, fb } = load();
    mockApple.signInAsync.mockResolvedValue(appleCredential());
    const user = firebaseUser({ displayName: null });
    fb.signInWithCredential.mockResolvedValue({ user });

    const result = await authService.signInWithApple();

    expect(fb.updateProfile).toHaveBeenCalledWith(user, { displayName: 'Ana Garcia' });
    expect(result.status).toBe('success');
  });

  it('still succeeds when saving the display name fails (best effort, like signUpWithEmail)', async () => {
    const { authService, fb } = load();
    mockApple.signInAsync.mockResolvedValue(appleCredential());
    fb.signInWithCredential.mockResolvedValue({ user: firebaseUser({ displayName: null }) });
    fb.updateProfile.mockRejectedValue(nativeError('auth/network-request-failed'));

    await expect(authService.signInWithApple()).resolves.toMatchObject({ status: 'success' });
  });
});

describe('revokeAppleTokens', () => {
  async function signIn(loaded: Loaded, authorizationCode: string | null = 'apple-auth-code'): Promise<void> {
    mockApple.signInAsync.mockResolvedValue(appleCredential({ authorizationCode }));
    loaded.fb.signInWithCredential.mockResolvedValue({ user: firebaseUser({ displayName: 'Ana' }) });
    await loaded.authService.signInWithApple();
  }

  it('revokes with the stashed authorizationCode exactly once (single-use)', async () => {
    const loaded = load();
    await signIn(loaded);
    loaded.fb.revokeAccessToken.mockResolvedValue(undefined);

    await expect(loaded.authService.revokeAppleTokens()).resolves.toBeUndefined();
    expect(loaded.fb.revokeAccessToken).toHaveBeenCalledWith(expect.anything(), 'apple-auth-code');

    // The code was consumed: a second attempt needs a fresh Apple interaction.
    await expect(loaded.authService.revokeAppleTokens()).rejects.toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'requires_recent_login' },
    });
    expect(loaded.fb.revokeAccessToken).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh code: none stashed, Apple sent none, or the stash is stale', async () => {
    const loaded = load();
    await expect(loaded.authService.revokeAppleTokens()).rejects.toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'requires_recent_login' },
    });

    await signIn(loaded, null);
    await expect(loaded.authService.revokeAppleTokens()).rejects.toMatchObject({
      details: { reason: 'requires_recent_login' },
    });

    let now = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      await signIn(loaded);
      now += APPLE_AUTH_CODE_TTL_MS + 1;
      await expect(loaded.authService.revokeAppleTokens()).rejects.toMatchObject({
        details: { reason: 'requires_recent_login' },
      });
    } finally {
      nowSpy.mockRestore();
    }
    expect(loaded.fb.revokeAccessToken).not.toHaveBeenCalled();
  });

  it('maps a Firebase revocation failure (callers treat it as best effort)', async () => {
    const loaded = load();
    await signIn(loaded);
    loaded.fb.revokeAccessToken.mockRejectedValue(nativeError('auth/requires-recent-login'));

    await expect(loaded.authService.revokeAppleTokens()).rejects.toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'requires_recent_login' },
    });
  });
});

describe('reauthenticate (apple.com first on iOS)', () => {
  function withAppleUser(loaded: Loaded, providers: string[] = ['apple.com']) {
    const user = firebaseUser({ providerData: providers.map((providerId) => ({ providerId })) });
    loaded.firebaseConfig.auth.currentUser = user;
    return user;
  }

  afterEach(() => {
    (jest.requireMock('../../../config/firebase') as Loaded['firebaseConfig']).auth.currentUser = null;
  });

  it('confirms through the Apple sheet without scopes and re-stashes the authorizationCode', async () => {
    const loaded = load();
    const user = withAppleUser(loaded);
    mockApple.signInAsync.mockResolvedValue(appleCredential({ authorizationCode: 'fresh-code', fullName: null }));
    loaded.fb.reauthenticateWithCredential.mockResolvedValue(undefined);
    loaded.fb.revokeAccessToken.mockResolvedValue(undefined);

    await expect(loaded.authService.reauthenticate()).resolves.toBe('done');
    // No requestedScopes: Apple shows a plain confirmation sheet.
    expect(mockApple.signInAsync).toHaveBeenCalledWith({ nonce: 'hashed-nonce' });
    expect(loaded.fb.reauthenticateWithCredential).toHaveBeenCalledWith(user, {
      providerId: 'apple.com',
      idToken: 'apple-id-token',
      rawNonce: RAW_NONCE,
    });

    // The refreshed code is exactly what the delete flow revokes next.
    await loaded.authService.revokeAppleTokens();
    expect(loaded.fb.revokeAccessToken).toHaveBeenCalledWith(expect.anything(), 'fresh-code');
  });

  it('returns cancelled when the Apple sheet is dismissed', async () => {
    const loaded = load();
    withAppleUser(loaded);
    mockApple.signInAsync.mockRejectedValue(nativeError('ERR_REQUEST_CANCELED'));

    await expect(loaded.authService.reauthenticate()).resolves.toBe('cancelled');
    expect(loaded.fb.reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('falls back to Google when Apple is not usable and the account has google.com too', async () => {
    const loaded = load();
    const user = withAppleUser(loaded, ['apple.com', 'google.com']);
    mockApple.isAvailableAsync.mockResolvedValue(false);
    loaded.google.hasPlayServices.mockResolvedValue(true);
    loaded.google.getCurrentUser.mockReturnValue(null);
    loaded.google.hasPreviousSignIn.mockReturnValue(false);
    loaded.google.signIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'google-id-token', scopes: [], user: { id: 'g1' } },
    });
    loaded.fb.reauthenticateWithCredential.mockResolvedValue(undefined);

    await expect(loaded.authService.reauthenticate()).resolves.toBe('done');
    expect(mockApple.signInAsync).not.toHaveBeenCalled();
    expect(loaded.fb.reauthenticateWithCredential).toHaveBeenCalledWith(user, {
      providerId: 'google.com',
      idToken: 'google-id-token',
    });
  });
});
