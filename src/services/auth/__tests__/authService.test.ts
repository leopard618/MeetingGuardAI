/**
 * authService with mocked native Google Sign-In and Firebase (no network, no EXPO_PUBLIC_* needed).
 * Modules are re-required for every test so the service's module state (configure, in-flight
 * sign-in, scope refresh) starts fresh.
 */
import type { AuthServiceImpl } from '../authService';

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
  isCancelledResponse: (response: { type: string }) => response.type === 'cancelled',
}));

jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: jest.fn((idToken: string) => ({ providerId: 'google.com', idToken })) },
  EmailAuthProvider: { credential: jest.fn((email: string, password: string) => ({ providerId: 'password', email, password })) },
  reauthenticateWithCredential: jest.fn(),
  signInWithCredential: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));

jest.mock('../../../config/firebase', () => ({
  auth: { currentUser: null, authStateReady: jest.fn(async () => undefined) },
  functions: { region: 'us-central1' },
  isFirebaseReady: true,
}));

jest.mock('../../../config/env', () => ({
  env: {
    google: { webClientId: 'web-client.apps.googleusercontent.com', iosClientId: null, androidClientId: null },
  },
}));

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

type MockFn = jest.Mock;
interface GoogleMock {
  GoogleSignin: Record<string, MockFn>;
}
interface FirebaseAuthMock {
  GoogleAuthProvider: { credential: MockFn };
  EmailAuthProvider: { credential: MockFn };
  reauthenticateWithCredential: MockFn;
  signInWithCredential: MockFn;
  signInWithEmailAndPassword: MockFn;
  createUserWithEmailAndPassword: MockFn;
  updateProfile: MockFn;
  signOut: MockFn;
  onAuthStateChanged: MockFn;
}

interface Loaded {
  authService: AuthServiceImpl;
  google: Record<string, MockFn>;
  fb: FirebaseAuthMock;
  httpsCallable: MockFn;
  firebaseConfig: { auth: { currentUser: unknown } };
  env: { google: { webClientId: string | null } };
}

function firebaseUser(uid = 'uid-1', displayName: string | null = 'Ana') {
  return {
    uid,
    email: 'ana@example.com',
    displayName,
    photoURL: null,
    emailVerified: true,
    providerData: [{ providerId: 'google.com' }],
  };
}

function googleUser(scopes: string[] = ['email', 'profile'], idToken: string | null = 'id-token') {
  return {
    user: { id: 'g1', name: 'Ana', email: 'ana@example.com', photo: null, familyName: null, givenName: null },
    scopes,
    idToken,
    serverAuthCode: null,
  };
}

function nativeError(code: string, message = 'native failure') {
  return Object.assign(new Error(message), { code });
}

function load(): Loaded {
  const google = (jest.requireMock('@react-native-google-signin/google-signin') as GoogleMock).GoogleSignin;
  const fb = jest.requireMock('firebase/auth') as FirebaseAuthMock;
  const { httpsCallable } = jest.requireMock('firebase/functions') as { httpsCallable: MockFn };
  const firebaseConfig = jest.requireMock('../../../config/firebase') as Loaded['firebaseConfig'];
  const { env } = jest.requireMock('../../../config/env') as { env: Loaded['env'] };

  google.hasPlayServices.mockResolvedValue(true);
  google.hasPreviousSignIn.mockReturnValue(false);
  google.getCurrentUser.mockReturnValue(null);
  google.signOut.mockResolvedValue(null);
  google.revokeAccess.mockResolvedValue(null);
  google.clearCachedAccessToken.mockResolvedValue(null);
  google.signInSilently.mockResolvedValue({ type: 'noSavedCredentialFound', data: null });
  fb.signOut.mockResolvedValue(undefined);

  // requireActual: a fresh copy of the module under test (its dependencies stay mocked).
  const { authService } = jest.requireActual<typeof import('../authService')>('../authService');
  return { authService, google, fb, httpsCallable, firebaseConfig, env };
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

describe('init', () => {
  it('configures GoogleSignin once with basic scopes and no offline access', async () => {
    const { authService, google } = load();
    authService.init();
    authService.init();
    expect(google.configure).toHaveBeenCalledTimes(1);
    expect(google.configure).toHaveBeenCalledWith({
      scopes: [],
      offlineAccess: false,
      webClientId: 'web-client.apps.googleusercontent.com',
    });
  });
});

describe('signInWithGoogle', () => {
  it('exchanges the Google idToken for a Firebase session', async () => {
    const { authService, google, fb, firebaseConfig } = load();
    google.signIn.mockResolvedValue({ type: 'success', data: googleUser() });
    fb.signInWithCredential.mockResolvedValue({ user: firebaseUser() });

    const result = await authService.signInWithGoogle();

    expect(google.hasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
    expect(fb.GoogleAuthProvider.credential).toHaveBeenCalledWith('id-token');
    expect(fb.signInWithCredential).toHaveBeenCalledWith(firebaseConfig.auth, {
      providerId: 'google.com',
      idToken: 'id-token',
    });
    expect(result).toEqual({
      status: 'success',
      user: {
        uid: 'uid-1',
        email: 'ana@example.com',
        displayName: 'Ana',
        photoURL: null,
        emailVerified: true,
        providerIds: ['google.com'],
      },
    });
  });

  it('returns cancelled (not an error) when the user closes the picker', async () => {
    const { authService, google, fb } = load();
    google.signIn.mockResolvedValue({ type: 'cancelled', data: null });
    await expect(authService.signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });

    google.signIn.mockRejectedValue(nativeError('12501'));
    await expect(authService.signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
    expect(fb.signInWithCredential).not.toHaveBeenCalled();
  });

  it('maps in-progress and missing Play Services to typed errors', async () => {
    const { authService, google } = load();
    google.signIn.mockRejectedValue(nativeError('ASYNC_OP_IN_PROGRESS'));
    await expect(authService.signInWithGoogle()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'in_progress' },
    });

    google.hasPlayServices.mockRejectedValue(nativeError('PLAY_SERVICES_NOT_AVAILABLE'));
    await expect(authService.signInWithGoogle()).rejects.toMatchObject({
      code: 'unsupported',
      details: { reason: 'play_services_unavailable' },
    });
  });

  it('signs out of Google again when there is no idToken or Firebase rejects the credential', async () => {
    const { authService, google, fb } = load();
    google.signIn.mockResolvedValue({ type: 'success', data: googleUser(['email'], null) });
    await expect(authService.signInWithGoogle()).rejects.toMatchObject({
      code: 'not_configured',
      details: { reason: 'missing_id_token' },
    });
    expect(google.signOut).toHaveBeenCalledTimes(1);

    google.signIn.mockResolvedValue({ type: 'success', data: googleUser() });
    fb.signInWithCredential.mockRejectedValue(nativeError('auth/user-disabled'));
    await expect(authService.signInWithGoogle()).rejects.toMatchObject({
      code: 'permission_denied',
      details: { reason: 'user_disabled' },
    });
    expect(google.signOut).toHaveBeenCalledTimes(2);
  });

  it('shares one flow between concurrent taps', async () => {
    const { authService, google, fb } = load();
    google.signIn.mockResolvedValue({ type: 'success', data: googleUser() });
    fb.signInWithCredential.mockResolvedValue({ user: firebaseUser() });

    const [first, second] = await Promise.all([authService.signInWithGoogle(), authService.signInWithGoogle()]);
    expect(first).toBe(second);
    expect(google.signIn).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the Google web client id is not configured', async () => {
    const { authService, google, env } = load();
    env.google.webClientId = null;
    await expect(authService.signInWithGoogle()).rejects.toMatchObject({
      code: 'not_configured',
      details: { reason: 'google_not_configured' },
    });
    expect(google.signIn).not.toHaveBeenCalled();
    env.google.webClientId = 'web-client.apps.googleusercontent.com';
  });
});

describe('email auth', () => {
  it('validates input and maps Firebase errors', async () => {
    const { authService, fb } = load();
    await expect(authService.signInWithEmail('  ', 'secret')).rejects.toMatchObject({
      code: 'invalid_input',
      details: { reason: 'invalid_email' },
    });
    fb.signInWithEmailAndPassword.mockRejectedValue(nativeError('auth/invalid-credential'));
    await expect(authService.signInWithEmail('ana@example.com', 'wrong')).rejects.toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'invalid_credentials' },
    });
  });

  it('sets the display name after sign-up and tells auth listeners', async () => {
    const { authService, fb, firebaseConfig } = load();
    const created = firebaseUser('uid-2', null);
    fb.createUserWithEmailAndPassword.mockResolvedValue({ user: created });
    fb.updateProfile.mockImplementation(async (user: { displayName: string | null }, profile: { displayName: string }) => {
      user.displayName = profile.displayName;
    });
    fb.onAuthStateChanged.mockReturnValue(() => undefined);
    const listener = jest.fn();
    authService.onAuthStateChanged(listener);
    firebaseConfig.auth.currentUser = created;

    const user = await authService.signUpWithEmail(' ana@example.com ', 'secret1', ' Ana ');

    expect(fb.createUserWithEmailAndPassword).toHaveBeenCalledWith(firebaseConfig.auth, 'ana@example.com', 'secret1');
    expect(user.displayName).toBe('Ana');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ uid: 'uid-2', displayName: 'Ana' }));
    firebaseConfig.auth.currentUser = null;
  });
});

describe('getGoogleAccessToken', () => {
  it('throws google_not_signed_in when no Google account is on the device', async () => {
    const { authService, google } = load();
    await expect(authService.getGoogleAccessToken({ requireCalendar: false })).rejects.toMatchObject({
      code: 'google_not_signed_in',
    });
    expect(google.getTokens).not.toHaveBeenCalled();
  });

  it('restores the Google session silently before asking for tokens', async () => {
    const { authService, google } = load();
    google.hasPreviousSignIn.mockReturnValue(true);
    google.signInSilently.mockResolvedValue({ type: 'success', data: googleUser(['email', CALENDAR_SCOPE]) });
    google.getTokens.mockResolvedValue({ idToken: 'id', accessToken: 'access-1' });

    await expect(authService.getGoogleAccessToken({ requireCalendar: true })).resolves.toBe('access-1');
    expect(google.signInSilently.mock.invocationCallOrder[0]).toBeLessThan(
      google.getTokens.mock.invocationCallOrder[0],
    );
  });

  it('checks the Calendar scope (after one silent refresh) before returning a calendar token', async () => {
    const { authService, google } = load();
    google.getCurrentUser.mockReturnValue(googleUser(['email']));
    google.signInSilently.mockResolvedValue({ type: 'success', data: googleUser(['email']) });
    google.getTokens.mockResolvedValue({ idToken: 'id', accessToken: 'access-1' });

    await expect(authService.getGoogleAccessToken({ requireCalendar: true })).rejects.toMatchObject({
      code: 'calendar_scope_missing',
    });
    expect(google.signInSilently).toHaveBeenCalledTimes(1);
    expect(google.getTokens).not.toHaveBeenCalled();

    // Sign-in scopes are enough when the caller does not need Calendar.
    await expect(authService.getGoogleAccessToken({ requireCalendar: false })).resolves.toBe('access-1');
  });

  it('serializes native token requests', async () => {
    const { authService, google } = load();
    google.getCurrentUser.mockReturnValue(googleUser(['email', CALENDAR_SCOPE]));
    let inFlight = 0;
    let maxInFlight = 0;
    google.getTokens.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { idToken: 'id', accessToken: 'access' };
    });

    await Promise.all([
      authService.getGoogleAccessToken({ requireCalendar: true }),
      authService.getGoogleAccessToken({ requireCalendar: true }),
      authService.getGoogleAccessToken({ requireCalendar: false }),
    ]);
    expect(google.getTokens).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
  });

  it('maps native token failures and clears a rejected token', async () => {
    const { authService, google } = load();
    google.getCurrentUser.mockReturnValue(googleUser(['email', CALENDAR_SCOPE]));
    google.getTokens.mockRejectedValue(nativeError('7'));
    await expect(authService.getGoogleAccessToken({ requireCalendar: true })).rejects.toMatchObject({
      code: 'offline',
    });

    await authService.invalidateGoogleAccessToken('stale-token');
    expect(google.clearCachedAccessToken).toHaveBeenCalledWith('stale-token');
  });
});

describe('calendar scope', () => {
  it('reports whether the Calendar scope is granted', async () => {
    const { authService, google } = load();
    await expect(authService.hasCalendarScope()).resolves.toBe(false);

    google.getCurrentUser.mockReturnValue(googleUser(['email', CALENDAR_SCOPE]));
    await expect(authService.hasCalendarScope()).resolves.toBe(true);
  });

  it('requests the scope incrementally and reports declines', async () => {
    const { authService, google } = load();
    const listener = jest.fn();
    authService.onGoogleAccessChanged(listener);
    google.getCurrentUser.mockReturnValue(googleUser(['email']));

    google.addScopes.mockResolvedValueOnce({ type: 'success', data: googleUser(['email', CALENDAR_SCOPE]) });
    await expect(authService.requestCalendarScope()).resolves.toBe(true);
    expect(google.addScopes).toHaveBeenCalledWith({ scopes: [CALENDAR_SCOPE] });
    expect(listener).toHaveBeenCalled();

    google.addScopes.mockResolvedValueOnce({ type: 'cancelled', data: null });
    await expect(authService.requestCalendarScope()).resolves.toBe(false);

    // Consent screen shown but the Calendar box unticked.
    google.addScopes.mockResolvedValueOnce({ type: 'success', data: googleUser(['email']) });
    await expect(authService.requestCalendarScope()).resolves.toBe(false);

    google.addScopes.mockResolvedValueOnce(null);
    await expect(authService.requestCalendarScope()).rejects.toMatchObject({ code: 'google_not_signed_in' });
  });

  it('signs in to Google first when there is no Google session (cancel => false)', async () => {
    const { authService, google } = load();
    google.signIn.mockResolvedValueOnce({ type: 'cancelled', data: null });
    await expect(authService.requestCalendarScope()).resolves.toBe(false);
    expect(google.addScopes).not.toHaveBeenCalled();

    google.signIn.mockResolvedValueOnce({ type: 'success', data: googleUser(['email']) });
    google.addScopes.mockResolvedValueOnce({ type: 'success', data: googleUser(['email', CALENDAR_SCOPE]) });
    await expect(authService.requestCalendarScope()).resolves.toBe(true);
  });
});

describe('sign-out, revoke and deletion', () => {
  it('signs out of Google before Firebase', async () => {
    const { authService, google, fb } = load();
    google.hasPreviousSignIn.mockReturnValue(true);
    await authService.signOutProviders();
    expect(google.signOut).toHaveBeenCalledTimes(1);
    expect(fb.signOut).toHaveBeenCalledTimes(1);
    expect(google.signOut.mock.invocationCallOrder[0]).toBeLessThan(fb.signOut.mock.invocationCallOrder[0]);
  });

  it('still signs out of Firebase when the Google sign-out fails', async () => {
    const { authService, google, fb } = load();
    google.hasPreviousSignIn.mockReturnValue(true);
    google.signOut.mockRejectedValue(nativeError('12500'));
    await authService.signOutProviders();
    expect(fb.signOut).toHaveBeenCalledTimes(1);
  });

  it('revokes Google access only when a Google session exists', async () => {
    const { authService, google } = load();
    await authService.revokeGoogleAccess();
    expect(google.revokeAccess).not.toHaveBeenCalled();

    google.getCurrentUser.mockReturnValue(googleUser());
    await authService.revokeGoogleAccess();
    expect(google.revokeAccess).toHaveBeenCalledTimes(1);
  });

  it('calls the deleteAccount callable and validates its response', async () => {
    const { authService, httpsCallable, firebaseConfig } = load();
    firebaseConfig.auth.currentUser = firebaseUser();
    const callable = jest.fn().mockResolvedValue({ data: { deleted: true } });
    httpsCallable.mockReturnValue(callable);

    await authService.deleteAccountOnServer();
    expect(httpsCallable).toHaveBeenCalledWith({ region: 'us-central1' }, 'deleteAccount', { timeout: 70_000 });
    expect(callable).toHaveBeenCalledWith({ confirm: true });

    callable.mockResolvedValueOnce({ data: { ok: true } });
    await expect(authService.deleteAccountOnServer()).rejects.toMatchObject({
      code: 'upstream_error',
      details: { reason: 'invalid_server_response' },
    });

    callable.mockRejectedValueOnce(nativeError('functions/unauthenticated'));
    await expect(authService.deleteAccountOnServer()).rejects.toMatchObject({ code: 'unauthenticated' });
    firebaseConfig.auth.currentUser = null;
  });

  it('reports a server-side "sign in again" as requires_recent_login', async () => {
    const { authService, httpsCallable, firebaseConfig } = load();
    firebaseConfig.auth.currentUser = firebaseUser();
    const callable = jest.fn().mockRejectedValue(
      Object.assign(nativeError('functions/failed-precondition'), { details: { reason: 'requires_recent_login' } }),
    );
    httpsCallable.mockReturnValue(callable);
    await expect(authService.deleteAccountOnServer()).rejects.toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'requires_recent_login' },
    });
    firebaseConfig.auth.currentUser = null;
  });

  it('re-authenticates Google users with a fresh ID token and password users with their password', async () => {
    const { authService, google, fb, firebaseConfig } = load();
    const user = firebaseUser();
    firebaseConfig.auth.currentUser = user;
    google.signIn.mockResolvedValueOnce({ type: 'success', data: googleUser(['email'], 'fresh-token') });
    fb.reauthenticateWithCredential.mockResolvedValue({ user });
    await expect(authService.reauthenticate()).resolves.toBe('done');
    expect(fb.reauthenticateWithCredential).toHaveBeenCalledWith(user, { providerId: 'google.com', idToken: 'fresh-token' });

    google.signIn.mockResolvedValueOnce({ type: 'cancelled', data: null });
    await expect(authService.reauthenticate()).resolves.toBe('cancelled');

    google.signIn.mockResolvedValueOnce({ type: 'success', data: googleUser(['email'], 'other-account') });
    fb.reauthenticateWithCredential.mockRejectedValueOnce(nativeError('auth/user-mismatch'));
    await expect(authService.reauthenticate()).rejects.toMatchObject({ details: { reason: 'user_mismatch' } });

    const passwordUser = { ...firebaseUser(), providerData: [{ providerId: 'password' }] };
    firebaseConfig.auth.currentUser = passwordUser;
    await expect(authService.reauthenticate()).rejects.toMatchObject({ details: { reason: 'missing_password' } });
    await expect(authService.reauthenticate({ password: 'secret' })).resolves.toBe('done');
    expect(fb.reauthenticateWithCredential).toHaveBeenLastCalledWith(passwordUser, {
      providerId: 'password',
      email: 'ana@example.com',
      password: 'secret',
    });
    firebaseConfig.auth.currentUser = null;
  });

  it('refuses to delete without a signed-in user', async () => {
    const { authService, httpsCallable } = load();
    await expect(authService.deleteAccountOnServer()).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(httpsCallable).not.toHaveBeenCalled();
  });
});
