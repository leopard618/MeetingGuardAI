/**
 * authService Sign in with Microsoft suite (docs/v1/ARCHITECTURE.md section 31): the Microsoft
 * id_token flow (src/services/microsoft/signIn.ts, mocked), the microsoftSignIn callable (mocked
 * httpsCallable) and signInWithCustomToken, plus the custom-token branch of reauthenticate().
 * Modules are re-required per test so the in-flight guard starts fresh.
 */
import type { AuthServiceImpl } from '../authService';

jest.mock('expo-crypto', () => ({
  // 32 deterministic bytes 0..31 -> raw nonce 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef' (base64url alphabet).
  getRandomBytes: jest.fn((count: number) => Uint8Array.from({ length: count }, (_, index) => index)),
  digestStringAsync: jest.fn(async () => 'hashed-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

/** What the deterministic getRandomBytes mock encodes to (the nonce sent to Microsoft and the server). */
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
    credential(params: Record<string, string>): Record<string, string> {
      return { providerId: this.providerId, ...params };
    }
  },
  reauthenticateWithCredential: jest.fn(),
  signInWithCredential: jest.fn(),
  signInWithCustomToken: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendEmailVerification: jest.fn(async () => undefined),
  signOut: jest.fn(async () => undefined),
  onAuthStateChanged: jest.fn(),
}));

const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));

jest.mock('../../../config/firebase', () => ({
  auth: { currentUser: null, authStateReady: jest.fn(async () => undefined) },
  functions: {},
  isFirebaseReady: true,
}));

const mockEnv = {
  google: { webClientId: 'web-client.apps.googleusercontent.com', iosClientId: null, androidClientId: null },
  firebase: { apiKey: 'test-api-key' },
  msal: { clientId: 'ms-client-id' as string | null, tenant: 'common' },
};
jest.mock('../../../config/env', () => ({ env: mockEnv }));

const mockRequestMicrosoftIdToken = jest.fn();
jest.mock('../../microsoft/signIn', () => ({ requestMicrosoftIdToken: mockRequestMicrosoftIdToken }));

type MockFn = jest.Mock;
interface FirebaseAuthMock {
  signInWithCustomToken: MockFn;
}
interface FunctionsMock {
  httpsCallable: MockFn;
}

function firebaseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    uid: 'ms_oid-1',
    email: 'ana@outlook.com',
    displayName: 'Ana Garcia',
    photoURL: null,
    emailVerified: true,
    providerData: [] as { providerId: string }[],
    getIdToken: jest.fn(async () => 'firebase-id-token'),
    ...overrides,
  };
}

function callableError(code: string, reason: string) {
  return Object.assign(new Error(code), { code: `functions/${code}`, details: { reason } });
}

function load(): { authService: AuthServiceImpl; fb: FirebaseAuthMock; fns: FunctionsMock; firebaseConfig: { auth: { currentUser: unknown } } } {
  const fb = jest.requireMock('firebase/auth') as FirebaseAuthMock;
  const fns = jest.requireMock('firebase/functions') as FunctionsMock;
  const firebaseConfig = jest.requireMock('../../../config/firebase') as { auth: { currentUser: unknown } };
  const { authService } = jest.requireActual<typeof import('../authService')>('../authService');
  return { authService, fb, fns, firebaseConfig };
}

beforeEach(() => {
  jest.resetModules();
  mockCallable.mockReset();
  mockRequestMicrosoftIdToken.mockReset();
  mockEnv.msal.clientId = 'ms-client-id';
  (jest.requireMock('firebase/auth') as FirebaseAuthMock).signInWithCustomToken.mockReset();
  (jest.requireMock('../../../config/firebase') as { auth: { currentUser: unknown } }).auth.currentUser = null;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function failure(promise: Promise<unknown>): Promise<{ code: string; details?: Record<string, unknown>; retryable?: boolean }> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error as { code: string; details?: Record<string, unknown>; retryable?: boolean },
  );
}

describe('signInWithMicrosoft', () => {
  it('sends the id_token and the nonce to the callable and signs in with the custom token', async () => {
    const { authService, fb, fns } = load();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'success', idToken: 'ms-jwt' });
    mockCallable.mockResolvedValue({ data: { customToken: 'custom-1', uid: 'ms_oid-1', created: true, linked: false } });
    fb.signInWithCustomToken.mockResolvedValue({ user: firebaseUser() });

    const result = await authService.signInWithMicrosoft();

    expect(mockRequestMicrosoftIdToken).toHaveBeenCalledWith({ clientId: 'ms-client-id', tenant: 'common', nonce: RAW_NONCE });
    expect(fns.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'microsoftSignIn', { timeout: 20_000 });
    expect(mockCallable).toHaveBeenCalledWith({ idToken: 'ms-jwt', nonce: RAW_NONCE });
    expect(fb.signInWithCustomToken).toHaveBeenCalledWith(expect.anything(), 'custom-1');
    expect(result).toEqual({
      status: 'success',
      user: { uid: 'ms_oid-1', email: 'ana@outlook.com', displayName: 'Ana Garcia', photoURL: null, emailVerified: true, providerIds: [] },
    });
  });

  it('resolves cancelled when the browser is closed, without calling the server', async () => {
    const { authService, fb } = load();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'cancelled' });
    await expect(authService.signInWithMicrosoft()).resolves.toEqual({ status: 'cancelled' });
    expect(mockCallable).not.toHaveBeenCalled();
    expect(fb.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it('is not configured without a Microsoft client id', async () => {
    mockEnv.msal.clientId = null;
    const { authService } = load();
    const error = await failure(authService.signInWithMicrosoft());
    expect(error.code).toBe('not_configured');
    expect(error.details?.reason).toBe('microsoft_not_configured');
    expect(mockRequestMicrosoftIdToken).not.toHaveBeenCalled();
  });

  it('reports a failed browser flow as a retryable upstream error', async () => {
    const { authService } = load();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'failed', message: 'access_denied' });
    const error = await failure(authService.signInWithMicrosoft());
    expect(error.code).toBe('upstream_error');
    expect(error.details?.reason).toBe('microsoft_sign_in_failed');
    expect(error.retryable).toBe(true);
  });

  it.each([
    ['failed-precondition', 'microsoft_not_configured', 'not_configured', 'microsoft_not_configured'],
    ['already-exists', 'email_in_use', 'conflict', 'email_in_use'],
    ['unauthenticated', 'microsoft_token_invalid', 'upstream_error', 'microsoft_sign_in_rejected'],
  ])('maps the server reason %s/%s to %s (%s)', async (code, serverReason, expectedCode, expectedReason) => {
    const { authService, fb } = load();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'success', idToken: 'ms-jwt' });
    mockCallable.mockRejectedValue(callableError(code, serverReason));
    const error = await failure(authService.signInWithMicrosoft());
    expect(error.code).toBe(expectedCode);
    expect(error.details?.reason).toBe(expectedReason);
    expect(fb.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it('rejects an unexpected server response', async () => {
    const { authService } = load();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'success', idToken: 'ms-jwt' });
    mockCallable.mockResolvedValue({ data: { nope: true } });
    const error = await failure(authService.signInWithMicrosoft());
    expect(error.code).toBe('upstream_error');
    expect(error.details?.reason).toBe('invalid_server_response');
  });

  it('joins the running flow on a second tap while the browser is open', async () => {
    const { authService, fb } = load();
    let finish: (value: { type: 'cancelled' }) => void = () => undefined;
    mockRequestMicrosoftIdToken.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = authService.signInWithMicrosoft();
    const second = authService.signInWithMicrosoft();
    finish({ type: 'cancelled' });
    await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'cancelled' }, { status: 'cancelled' }]);
    expect(mockRequestMicrosoftIdToken).toHaveBeenCalledTimes(1);
    expect(fb.signInWithCustomToken).not.toHaveBeenCalled();
  });
});

describe('reauthenticate for a custom-token (Microsoft) session', () => {
  it('signs in again with a fresh custom token for the same uid', async () => {
    const { authService, fb, firebaseConfig } = load();
    firebaseConfig.auth.currentUser = firebaseUser();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'success', idToken: 'ms-jwt' });
    mockCallable.mockResolvedValue({ data: { customToken: 'custom-2', uid: 'ms_oid-1', created: false, linked: false } });
    fb.signInWithCustomToken.mockResolvedValue({ user: firebaseUser() });

    await expect(authService.reauthenticate()).resolves.toBe('done');
    expect(fb.signInWithCustomToken).toHaveBeenCalledWith(expect.anything(), 'custom-2');
  });

  it('refuses a different Microsoft account (user_mismatch) and never switches the session', async () => {
    const { authService, fb, firebaseConfig } = load();
    firebaseConfig.auth.currentUser = firebaseUser();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'success', idToken: 'ms-jwt' });
    mockCallable.mockResolvedValue({ data: { customToken: 'custom-other', uid: 'ms_oid-2', created: true, linked: false } });

    const error = await failure(authService.reauthenticate());
    expect(error.code).toBe('permission_denied');
    expect(error.details?.reason).toBe('user_mismatch');
    expect(fb.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it('reports a closed browser as cancelled', async () => {
    const { authService, firebaseConfig } = load();
    firebaseConfig.auth.currentUser = firebaseUser();
    mockRequestMicrosoftIdToken.mockResolvedValue({ type: 'cancelled' });
    await expect(authService.reauthenticate()).resolves.toBe('cancelled');
  });
});
