/**
 * AUTH identity + Google tokens (owner: auth) - layer L3.
 *
 * Calendar / ai import THIS file (never the auth barrel, which pulls in the session manager and
 * would create an import cycle). Contract: AuthService in src/core/contracts.ts.
 *
 * - Google sign-in is native (@react-native-google-signin/google-signin v16, "Original" API):
 *   signIn() -> idToken -> GoogleAuthProvider.credential(idToken) -> signInWithCredential(auth).
 *   Only the basic profile/email scopes are requested at sign-in; the Calendar scope is added
 *   incrementally with addScopes (requestCalendarScope).
 * - Google access tokens come from GoogleSignin.getTokens() (the native SDK refreshes them). No
 *   client secret, no refresh token and no token is ever stored by the app.
 * - Every native Google call is serialized: the native module rejects a second concurrent call
 *   of the same kind (ASYNC_OP_IN_PROGRESS), and calendar sync may ask for tokens in parallel.
 * - Sign in with Apple (expo-apple-authentication, iOS only - docs/v1/ARCHITECTURE.md section 26):
 *   nonce-protected signInAsync -> OAuthProvider('apple.com').credential({ idToken, rawNonce })
 *   -> signInWithCredential. The module is require()d lazily like Google's; the Apple
 *   authorizationCode is stashed in-process for revokeAppleTokens() (account deletion) only
 *   AFTER the Firebase exchange validated the credential, so the stash can never hold a
 *   wrong-identity code (e.g. after auth/user-mismatch).
 * - No session orchestration here: sessionManager (./sessionManager.ts) owns start/end.
 * - Never logs tokens or emails.
 */
import type {
  ConfigureParams,
  SignInResponse,
  User as GoogleUser,
} from '@react-native-google-signin/google-signin';
import * as Crypto from 'expo-crypto';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged as onFirebaseAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type Auth,
  type AuthCredential,
  type User as FirebaseUser,
  type UserCredential,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';

import { env } from '../../config/env';
import { auth as firebaseAuth, functions as firebaseFunctions } from '../../config/firebase';
import {
  CALLABLES,
  deleteAccountResponseSchema,
  type DeleteAccountRequest,
  type DeleteAccountResponse,
} from '../../core/aiContract';
import { GOOGLE_CALENDAR_SCOPES, type AuthService, type SignInResult } from '../../core/contracts';
import { AppError, isAppError } from '../../core/errors';
import type { Unsubscribe } from '../../core/events';
import { createLogger } from '../../core/logger';
import type { AuthUser } from '../../core/types';

import { authError, getAuthErrorReason, mapAppleSignInError, mapFirebaseAuthError, mapGoogleSignInError, type GoogleStatusCodes } from './authErrors';
import { createSerialQueue } from './serialQueue';

export { registerSessionCleanup } from './sessionCleanup';
export type { SessionCleanupContext, SessionCleanupHook } from './sessionCleanup';

const log = createLogger('auth');

/** Client timeout of the deleteAccount callable (recursive deletes can take a while). */
export const DELETE_ACCOUNT_TIMEOUT_MS = 70_000;

/**
 * AuthService plus backward-compatible extensions used inside the auth area (AuthProvider) and
 * available to other areas through this module.
 */
export interface AuthServiceImpl extends AuthService {
  /**
   * Called after anything that can change Google access on this device: Google/Firebase sign-in
   * and sign-out, Calendar scope grants and revocation. Listeners re-check hasCalendarScope().
   */
  onGoogleAccessChanged(listener: () => void): Unsubscribe;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export function toAuthUser(user: FirebaseUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    emailVerified: user.emailVerified,
    providerIds: user.providerData.map((profile) => profile.providerId).filter((id) => id.length > 0),
  };
}

/** True when every Calendar scope is in `granted`. */
export function hasCalendarScopes(granted: readonly string[] | null | undefined): boolean {
  if (!granted) return false;
  return GOOGLE_CALENDAR_SCOPES.every((scope) => granted.includes(scope));
}

function requireAuth(): Auth {
  if (!firebaseAuth) {
    throw authError('not_configured', 'firebase_not_configured', 'Firebase is not configured');
  }
  return firebaseAuth;
}

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');
type GoogleSigninApi = GoogleSignInModule['GoogleSignin'];

/** Android values of the library's statusCodes; used only if the native module failed to load. */
const FALLBACK_STATUS_CODES: GoogleStatusCodes = {
  SIGN_IN_CANCELLED: '12501',
  IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: '4',
  NULL_PRESENTER: 'NULL_PRESENTER',
};

let googleModule: GoogleSignInModule | null = null;

/**
 * The Google Sign-In module is loaded on first use, not at import: it resolves its native
 * TurboModule when evaluated, and a build without the native code (Expo Go, unit tests that do
 * not mock it) must still start and show a clear error only when Google is actually used.
 */
function loadGoogleModule(): GoogleSignInModule {
  if (googleModule) return googleModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    googleModule = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  } catch (error) {
    throw authError('unsupported', 'google_sign_in_unavailable', 'The Google Sign-In native module is not available', {
      cause: error,
    });
  }
  return googleModule;
}

function gs(): GoogleSigninApi {
  return loadGoogleModule().GoogleSignin;
}

function mapGoogle(error: unknown): AppError {
  if (isAppError(error)) return error;
  return mapGoogleSignInError(error, googleModule?.statusCodes ?? FALLBACK_STATUS_CODES);
}

const googleQueue = createSerialQueue();
const profileListeners = new Set<(user: AuthUser | null) => void>();
const googleAccessListeners = new Set<() => void>();
let googleConfigured = false;
let googleSignInInFlight: Promise<SignInResult> | null = null;
let appleSignInInFlight: Promise<SignInResult> | null = null;
/** One silent refresh per process when the cached Google user lacks the Calendar scope. */
let scopeRefreshAttempted = false;

function configureGoogle(): void {
  if (googleConfigured) return;
  const params: ConfigureParams = {
    // Basic profile + email only; Calendar is requested incrementally (requestCalendarScope).
    scopes: [],
    offlineAccess: false,
    ...(env.google.webClientId ? { webClientId: env.google.webClientId } : {}),
    ...(env.google.iosClientId ? { iosClientId: env.google.iosClientId } : {}),
  };
  try {
    gs().configure(params);
  } catch (error) {
    throw mapGoogle(error);
  }
  googleConfigured = true;
}

function notifyGoogleAccessChanged(): void {
  scopeRefreshAttempted = false;
  for (const listener of [...googleAccessListeners]) {
    try {
      listener();
    } catch (error) {
      log.error('Google access listener failed', error);
    }
  }
}

function notifyProfileChanged(): void {
  const user = firebaseAuth?.currentUser ? toAuthUser(firebaseAuth.currentUser) : null;
  for (const listener of [...profileListeners]) {
    try {
      listener(user);
    } catch (error) {
      log.error('Auth state listener failed', error);
    }
  }
}

/** Whether a Google account is (or can silently be) signed in natively. Errors count as "maybe". */
function googleSessionMayExist(): boolean {
  try {
    return gs().getCurrentUser() !== null || gs().hasPreviousSignIn();
  } catch (error) {
    log.warn('Could not read the Google sign-in state', mapGoogle(error).code);
    return true;
  }
}

async function signOutGoogleQuietly(): Promise<void> {
  try {
    await gs().signOut();
  } catch (error) {
    // Cleanup path: the Firebase session is what matters; keep the reason for diagnostics.
    log.warn('Google sign-out failed', mapGoogle(error).code);
  }
}

/** Restores the native Google user without UI (iOS needs this after every app start). */
async function silentGoogleSignIn(): Promise<GoogleUser | null> {
  let response;
  try {
    response = await gs().signInSilently();
  } catch (error) {
    throw mapGoogle(error);
  }
  return response.type === 'success' ? response.data : null;
}

async function restoreGoogleUser(): Promise<GoogleUser | null> {
  let current: GoogleUser | null;
  let hasPrevious: boolean;
  try {
    current = gs().getCurrentUser();
    hasPrevious = current !== null || gs().hasPreviousSignIn();
  } catch (error) {
    throw mapGoogle(error);
  }
  if (current) return current;
  if (!hasPrevious) return null;
  return silentGoogleSignIn();
}

/** Account picker. Resolves null when the user cancels. */
async function interactiveGoogleSignIn(): Promise<GoogleUser | null> {
  let response: SignInResponse;
  try {
    const available = await gs().hasPlayServices({ showPlayServicesUpdateDialog: true });
    if (!available) {
      throw authError('unsupported', 'play_services_unavailable', 'Google Play Services is not available');
    }
    response = await gs().signIn();
  } catch (error) {
    const mapped = mapGoogle(error);
    if (mapped.code === 'cancelled') return null;
    throw mapped;
  }
  if (response.type === 'cancelled') return null;
  if (response.type !== 'success') {
    throw authError('upstream_error', 'google_sign_in_failed', 'Unexpected Google sign-in response');
  }
  return response.data;
}

// ---------------------------------------------------------------------------------------------
// Sign in with Apple (iOS only; docs/v1/ARCHITECTURE.md section 26)
// ---------------------------------------------------------------------------------------------

/**
 * Minimal shape of expo-apple-authentication. Typed locally (not `typeof import(...)`) because
 * the package is resolved lazily at runtime and the code must compile in environments where it
 * is not installed (the module only exists in iOS builds).
 */
interface AppleAuthCredential {
  identityToken: string | null;
  authorizationCode: string | null;
  email: string | null;
  fullName: {
    givenName: string | null;
    middleName: string | null;
    familyName: string | null;
    namePrefix: string | null;
    nameSuffix: string | null;
    nickname: string | null;
  } | null;
}

interface AppleAuthModule {
  isAvailableAsync(): Promise<boolean>;
  signInAsync(options: { requestedScopes?: number[]; nonce?: string }): Promise<AppleAuthCredential>;
  AppleAuthenticationScope: { FULL_NAME: number; EMAIL: number };
}

/** undefined = not tried yet; null = the module cannot be loaded in this build. */
let appleModule: AppleAuthModule | null | undefined;

/**
 * Lazy like loadGoogleModule(): the native module only exists in iOS builds, and Android builds
 * and unit tests must start without resolving it. null when it cannot be loaded.
 */
function tryLoadAppleModule(): AppleAuthModule | null {
  if (appleModule !== undefined) return appleModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    appleModule = require('expo-apple-authentication') as AppleAuthModule;
  } catch {
    appleModule = null;
  }
  return appleModule;
}

function loadAppleModule(): AppleAuthModule {
  const module = tryLoadAppleModule();
  if (!module) {
    throw authError('unsupported', 'apple_sign_in_unavailable', 'The Sign in with Apple native module is not available');
  }
  return module;
}

/** isAvailableAsync() as a boolean; an availability probe that fails counts as unavailable. */
async function appleAvailable(apple: AppleAuthModule): Promise<boolean> {
  try {
    return await apple.isAvailableAsync();
  } catch (error) {
    log.warn('Apple sign-in availability check failed', mapAppleSignInError(error).code);
    return false;
  }
}

/** base64url alphabet: 64 symbols, so `byte & 63` keeps the distribution uniform. */
const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 32 random bytes as 32 base64url characters (192 bits): the Apple replay-protection nonce. */
function createRawNonce(): string {
  const bytes = Crypto.getRandomBytes(32);
  let nonce = '';
  for (const byte of bytes) nonce += NONCE_ALPHABET[byte & 63];
  return nonce;
}

/**
 * Apple authorization codes are single-use and short-lived (about 5 minutes): revokeAppleTokens()
 * treats anything older as stale and asks for a fresh Apple interaction instead.
 */
export const APPLE_AUTH_CODE_TTL_MS = 5 * 60_000;

/**
 * The Firebase Identity Toolkit endpoint behind the native SDKs' revokeToken(withAuthorizationCode:).
 * Takes the same public web API key the rest of the Firebase config uses; no extra secret.
 */
const APPLE_REVOKE_TOKEN_URL = 'https://identitytoolkit.googleapis.com/v2/accounts:revokeToken';

/**
 * Leading error name of an Identity Toolkit error response ("TOKEN_EXPIRED", ...), for
 * diagnostics. Only the first word: the rest can carry upstream details that may not be logged.
 */
async function identityToolkitErrorName(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return undefined;
    const error = (body as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return undefined;
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message.split(/[\s:]/, 1)[0] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The last VALIDATED Apple authorizationCode of this process, for revocation. Stashed only after
 * signInWithCredential / reauthenticateWithCredential accepted the matching credential: a code
 * from a sheet confirmed with a DIFFERENT Apple ID (auth/user-mismatch) must never end up here,
 * or revokeAppleTokens() would revoke that other Apple ID's tokens for this app.
 */
let appleAuthorizationCode: { code: string; stashedAt: number } | null = null;

function stashAppleAuthorizationCode(code: string | null): void {
  appleAuthorizationCode = code ? { code, stashedAt: Date.now() } : null;
}

/**
 * Shows the Apple sheet and builds the Firebase credential (section 26): raw random nonce ->
 * SHA-256 hash to signInAsync (Apple checks the token's nonce claim equals it) -> OAuth
 * credential with the RAW nonce (Firebase hashes it again to verify; replay protection). Does
 * NOT stash the authorizationCode: callers stash it only after the Firebase exchange succeeds
 * (see appleAuthorizationCode). Resolves null on cancel.
 */
async function requestAppleCredential(
  apple: AppleAuthModule,
  options: { requestScopes: boolean },
): Promise<{ firebaseCredential: AuthCredential; apple: AppleAuthCredential } | null> {
  let rawNonce: string;
  let hashedNonce: string;
  try {
    rawNonce = createRawNonce();
    hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  } catch (error) {
    throw authError('unknown', 'apple_sign_in_failed', 'Could not create the sign-in nonce', { cause: error });
  }

  let credential: AppleAuthCredential;
  try {
    credential = await apple.signInAsync({
      // Reauthentication asks for no scopes: Apple then shows a plain confirm sheet.
      ...(options.requestScopes
        ? { requestedScopes: [apple.AppleAuthenticationScope.FULL_NAME, apple.AppleAuthenticationScope.EMAIL] }
        : {}),
      nonce: hashedNonce,
    });
  } catch (error) {
    const mapped = mapAppleSignInError(error);
    if (mapped.code === 'cancelled') return null;
    throw mapped;
  }
  if (!credential.identityToken) {
    throw authError('upstream_error', 'apple_sign_in_failed', 'Apple returned no identity token', { retryable: true });
  }
  return {
    firebaseCredential: new OAuthProvider('apple.com').credential({
      idToken: credential.identityToken,
      rawNonce,
    }),
    apple: credential,
  };
}

/** "Given Family" from Apple's PersonNameComponents; '' when Apple sent no usable name. */
function formatAppleName(fullName: AppleAuthCredential['fullName']): string {
  if (!fullName) return '';
  return [fullName.givenName, fullName.familyName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' ');
}

// Sign in with Apple, iOS ONLY (contract: src/core/contracts.ts + docs/v1/ARCHITECTURE.md §26).
async function firebaseAppleSignIn(): Promise<SignInResult> {
  const authInstance = requireAuth();
  const apple = loadAppleModule();
  if (!(await appleAvailable(apple))) {
    throw authError('unsupported', 'apple_sign_in_unavailable', 'Sign in with Apple is not available on this device');
  }

  const requested = await requestAppleCredential(apple, { requestScopes: true });
  if (!requested) return { status: 'cancelled' };

  let result: UserCredential;
  try {
    result = await signInWithCredential(authInstance, requested.firebaseCredential);
  } catch (error) {
    const mapped = mapFirebaseAuthError(error);
    // Firebase answers auth/invalid-credential when it refuses the Apple token (the iOS app not
    // registered in the project, a nonce mismatch, an expired token). The generic mapping words
    // that as a wrong email or password, which is what App Review saw on 2026-10-20 and what no
    // Apple user can act on. Name the real situation instead.
    if (getAuthErrorReason(mapped) === 'invalid_credentials') {
      const raw = error as { code?: unknown; message?: unknown; customData?: { _serverResponse?: unknown } } | null;
      const rejected = authError('upstream_error', 'apple_sign_in_rejected', 'Firebase refused the Apple credential', {
        cause: error,
        providerCode: typeof raw?.code === 'string' ? raw.code : undefined,
        retryable: true,
      });
      // Reported, not only shown: the Identity Toolkit detail ("audience mismatch", "nonce
      // mismatch", ...) is the only thing that says WHY, and it is visible nowhere on the device.
      const detail = typeof raw?.customData?._serverResponse === 'string' ? raw.customData._serverResponse : typeof raw?.message === 'string' ? raw.message : 'no detail';
      log.error(`Apple credential refused by Firebase: ${detail}`, rejected);
      throw rejected;
    }
    throw mapped;
  }
  // Only now is the code known to belong to the signed-in user (see appleAuthorizationCode).
  stashAppleAuthorizationCode(requested.apple.authorizationCode);

  // FIRST sign-in only: Apple returns fullName/email once. Keep the name as the display name,
  // best effort (exactly like signUpWithEmail: the session works without it).
  const name = formatAppleName(requested.apple.fullName);
  if (name && !result.user.displayName) {
    try {
      await updateProfile(result.user, { displayName: name });
      // onAuthStateChanged already fired without the name: tell listeners about the update.
      notifyProfileChanged();
    } catch (error) {
      log.error('Signed in but the display name could not be saved', mapFirebaseAuthError(error));
    }
  }
  return { status: 'success', user: toAuthUser(result.user) };
}

async function firebaseGoogleSignIn(): Promise<SignInResult> {
  const authInstance = requireAuth();
  if (!env.google.webClientId) {
    throw authError('not_configured', 'google_not_configured', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set');
  }
  configureGoogle();

  // Signed out of Firebase but still signed in to Google natively (e.g. the Firebase session was
  // lost): sign out of Google first so the account picker is shown and accounts can be switched.
  if (!authInstance.currentUser && googleSessionMayExist()) {
    await signOutGoogleQuietly();
  }

  const account = await interactiveGoogleSignIn();
  if (!account) return { status: 'cancelled' };

  if (!account.idToken) {
    await signOutGoogleQuietly();
    throw authError(
      'not_configured',
      'missing_id_token',
      'Google returned no ID token (check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and the OAuth clients)',
    );
  }

  try {
    const credential = GoogleAuthProvider.credential(account.idToken);
    const result = await signInWithCredential(authInstance, credential);
    return { status: 'success', user: toAuthUser(result.user) };
  } catch (error) {
    // Keep both identities consistent: no native Google session without a Firebase session.
    await signOutGoogleQuietly();
    throw mapFirebaseAuthError(error);
  } finally {
    notifyGoogleAccessChanged();
  }
}

/** `details.reason` of a callable error (HttpsError details), if any. */
function serverReason(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null) return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : null;
}

function requireEmail(email: string): string {
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (!trimmed) throw authError('invalid_input', 'invalid_email', 'Email is required');
  return trimmed;
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export const authService: AuthServiceImpl = {
  init(): void {
    try {
      configureGoogle();
    } catch (error) {
      // Sign-in reports the problem to the user; the app must still start.
      log.error('Google Sign-In could not be configured', error);
    }
  },

  get currentUser(): AuthUser | null {
    const user = firebaseAuth?.currentUser;
    return user ? toAuthUser(user) : null;
  },

  async authReady(): Promise<AuthUser | null> {
    if (!firebaseAuth) return null;
    await firebaseAuth.authStateReady();
    return firebaseAuth.currentUser ? toAuthUser(firebaseAuth.currentUser) : null;
  },

  onAuthStateChanged(listener: (user: AuthUser | null) => void): Unsubscribe {
    if (!firebaseAuth) {
      // Firebase is not configured: nobody can be signed in. Report it asynchronously, like Firebase.
      let active = true;
      void Promise.resolve().then(() => {
        if (active) listener(null);
      });
      return () => {
        active = false;
      };
    }
    profileListeners.add(listener);
    const unsubscribe = onFirebaseAuthStateChanged(
      firebaseAuth,
      (user) => listener(user ? toAuthUser(user) : null),
      (error) => log.error('Firebase auth state listener error', error),
    );
    return () => {
      profileListeners.delete(listener);
      unsubscribe();
    };
  },

  signInWithGoogle(): Promise<SignInResult> {
    // A second tap while the picker is open joins the running flow instead of failing.
    if (googleSignInInFlight) return googleSignInInFlight;
    const flow = googleQueue.run(firebaseGoogleSignIn).finally(() => {
      googleSignInInFlight = null;
    });
    googleSignInInFlight = flow;
    return flow;
  },

  signInWithApple(): Promise<SignInResult> {
    // A second tap while the Apple sheet is presenting joins the running flow instead of
    // presenting a second sheet (same re-entry pattern as signInWithGoogle: the `busy` state a
    // screen renders from is read from a stale closure during same-frame multi-touch).
    if (appleSignInInFlight) return appleSignInInFlight;
    const flow = firebaseAppleSignIn().finally(() => {
      appleSignInInFlight = null;
    });
    appleSignInInFlight = flow;
    return flow;
  },

  async signInWithEmail(email: string, password: string): Promise<AuthUser> {
    const authInstance = requireAuth();
    const trimmed = requireEmail(email);
    if (!password) throw authError('invalid_input', 'missing_password', 'Password is required');
    try {
      const credential = await signInWithEmailAndPassword(authInstance, trimmed, password);
      return toAuthUser(credential.user);
    } catch (error) {
      throw mapFirebaseAuthError(error);
    }
  },

  async signUpWithEmail(email: string, password: string, displayName: string): Promise<AuthUser> {
    const authInstance = requireAuth();
    const trimmed = requireEmail(email);
    if (!password) throw authError('invalid_input', 'missing_password', 'Password is required');
    let user: FirebaseUser;
    try {
      user = (await createUserWithEmailAndPassword(authInstance, trimmed, password)).user;
    } catch (error) {
      throw mapFirebaseAuthError(error);
    }
    // Verification email, NON-BLOCKING (§25): the account exists and is signed in either way;
    // the assistant stays gated until verified and EmailAuthScreen offers a resend.
    try {
      void sendEmailVerification(user).catch((error: unknown) => {
        log.warn('Verification email could not be sent', mapFirebaseAuthError(error).code);
      });
    } catch (error) {
      log.warn('Verification email could not be sent', mapFirebaseAuthError(error).code);
    }
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (name) {
      try {
        await updateProfile(user, { displayName: name });
        // onAuthStateChanged already fired without the name: tell listeners about the update.
        notifyProfileChanged();
      } catch (error) {
        // The account exists and the user is signed in; only the display name is missing (it can
        // be edited later). Reported, not hidden.
        log.error('Account created but the display name could not be saved', mapFirebaseAuthError(error));
      }
    }
    return toAuthUser(user);
  },

  async sendPasswordReset(email: string): Promise<void> {
    const authInstance = requireAuth();
    const trimmed = requireEmail(email);
    try {
      await sendPasswordResetEmail(authInstance, trimmed);
    } catch (error) {
      throw mapFirebaseAuthError(error);
    }
  },

  async resendVerification(): Promise<void> {
    const authInstance = requireAuth();
    const user = authInstance.currentUser;
    if (!user) throw new AppError('unauthenticated', 'Nobody is signed in');
    try {
      await sendEmailVerification(user);
    } catch (error) {
      throw mapFirebaseAuthError(error);
    }
  },

  async reloadUser(): Promise<AuthUser> {
    const authInstance = requireAuth();
    const user = authInstance.currentUser;
    if (!user) throw new AppError('unauthenticated', 'Nobody is signed in');
    try {
      await user.reload();
      // The assistant and zoom callables authorize from the ID TOKEN's email_verified claim,
      // and the cached token lives up to an hour: after "I verified" flipped the profile,
      // force-mint a fresh token so the very next callable carries email_verified=true
      // (otherwise the banner disappears while the server keeps answering unauthenticated).
      await user.getIdToken(true);
    } catch (error) {
      throw mapFirebaseAuthError(error);
    }
    // onAuthStateChanged does not fire for reload(): tell listeners (session state included).
    notifyProfileChanged();
    return toAuthUser(user);
  },

  async signOutProviders(): Promise<void> {
    await googleQueue.run(async () => {
      try {
        configureGoogle();
      } catch (error) {
        log.warn('Google Sign-In not configured during sign-out', mapGoogle(error).code);
        return;
      }
      if (googleSessionMayExist()) await signOutGoogleQuietly();
    });
    notifyGoogleAccessChanged();
    if (!firebaseAuth) return;
    try {
      await firebaseSignOut(firebaseAuth);
    } catch (error) {
      throw mapFirebaseAuthError(error);
    }
  },

  getGoogleAccessToken({ requireCalendar }: { requireCalendar: boolean }): Promise<string> {
    return googleQueue.run(async () => {
      configureGoogle();
      let user = await restoreGoogleUser();
      if (!user) {
        throw new AppError('google_not_signed_in', 'No Google account is signed in on this device');
      }
      if (requireCalendar && !hasCalendarScopes(user.scopes)) {
        // The cached user object can be stale (scopes added on another run): refresh it once.
        const refreshed = await silentGoogleSignIn();
        if (refreshed) user = refreshed;
        if (!hasCalendarScopes(user.scopes)) {
          throw new AppError('calendar_scope_missing', 'The Google Calendar scope has not been granted');
        }
      }
      let accessToken: string;
      try {
        accessToken = (await gs().getTokens()).accessToken;
      } catch (error) {
        throw mapGoogle(error);
      }
      if (!accessToken) {
        throw authError('upstream_error', 'google_sign_in_failed', 'Google returned no access token');
      }
      return accessToken;
    });
  },

  async invalidateGoogleAccessToken(token: string): Promise<void> {
    if (!token) return;
    await googleQueue.run(async () => {
      try {
        await gs().clearCachedAccessToken(token);
      } catch (error) {
        throw mapGoogle(error);
      }
    });
  },

  hasCalendarScope(): Promise<boolean> {
    return googleQueue.run(async () => {
      configureGoogle();
      const user = await restoreGoogleUser();
      if (!user) return false;
      if (hasCalendarScopes(user.scopes)) return true;
      if (scopeRefreshAttempted) return false;
      scopeRefreshAttempted = true;
      try {
        const refreshed = await silentGoogleSignIn();
        return refreshed !== null && hasCalendarScopes(refreshed.scopes);
      } catch (error) {
        // The known scopes say "not granted"; the refresh was only a double check.
        log.warn('Could not refresh the Google scopes', mapGoogle(error).code);
        return false;
      }
    });
  },

  requestCalendarScope(): Promise<boolean> {
    return googleQueue.run(async () => {
      configureGoogle();
      let user = await restoreGoogleUser();
      if (!user) {
        // Email/password users (or a lost native session): sign in to Google for Calendar only.
        user = await interactiveGoogleSignIn();
        if (!user) return false;
        notifyGoogleAccessChanged();
      }
      if (hasCalendarScopes(user.scopes)) return true;

      let response: SignInResponse | null;
      try {
        response = await gs().addScopes({ scopes: [...GOOGLE_CALENDAR_SCOPES] });
      } catch (error) {
        const mapped = mapGoogle(error);
        if (mapped.code === 'cancelled') return false;
        throw mapped;
      }
      if (response === null) {
        throw new AppError('google_not_signed_in', 'No Google account is signed in on this device');
      }
      if (response.type === 'cancelled') return false;
      // With granular consent the user can untick the Calendar box: that is a decline.
      const granted = hasCalendarScopes(response.data.scopes);
      notifyGoogleAccessChanged();
      return granted;
    });
  },

  async revokeGoogleAccess(): Promise<void> {
    await googleQueue.run(async () => {
      configureGoogle();
      const user = await restoreGoogleUser();
      if (!user) {
        log.info('No Google session on this device: nothing to revoke');
        return;
      }
      try {
        // Also signs the account out natively.
        await gs().revokeAccess();
      } catch (error) {
        throw mapGoogle(error);
      }
    });
    notifyGoogleAccessChanged();
  },

  // Revokes the Apple refresh token (App Review 5.1.1(v); §26) with the authorizationCode of the
  // LAST validated Apple interaction in this process. Callers treat any failure as best effort.
  async revokeAppleTokens(): Promise<void> {
    const authInstance = requireAuth();
    const stashed = appleAuthorizationCode;
    // Single-use: never retried with the same code, whatever happens below.
    appleAuthorizationCode = null;
    if (!stashed || Date.now() - stashed.stashedAt > APPLE_AUTH_CODE_TTL_MS) {
      throw authError(
        'unauthenticated',
        'requires_recent_login',
        'No fresh Apple authorization code (run the Apple reauthentication first)',
      );
    }
    const user = authInstance.currentUser;
    if (!user) throw new AppError('unauthenticated', 'Nobody is signed in');
    const apiKey = env.firebase?.apiKey;
    if (!apiKey) {
      throw authError('not_configured', 'firebase_not_configured', 'Firebase is not configured');
    }
    let idToken: string;
    try {
      idToken = await user.getIdToken();
    } catch (error) {
      throw mapFirebaseAuthError(error);
    }
    // The same request the NATIVE iOS SDK's revokeToken(withAuthorizationCode:) sends. The JS
    // SDK's revokeAccessToken() is deliberately NOT used: it labels its argument tokenType
    // ACCESS_TOKEN, and Apple answers 200 to unrecognized token strings (RFC 7009), so passing
    // the authorization code through it "succeeds" while revoking nothing. With
    // AUTHORIZATION_CODE, Firebase exchanges the code using the Sign in with Apple key
    // configured on the Apple provider (docs/v1/SETUP.md section 8.4) and revokes the Apple
    // refresh token server-side.
    let response: Response;
    try {
      response = await fetch(`${APPLE_REVOKE_TOKEN_URL}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: 'apple.com',
          tokenType: 'AUTHORIZATION_CODE',
          token: stashed.code,
          idToken,
        }),
      });
    } catch (error) {
      throw authError('offline', null, 'Could not reach the token revocation endpoint', {
        cause: error,
        retryable: true,
      });
    }
    if (!response.ok) {
      throw authError('upstream_error', null, `Apple token revocation failed (HTTP ${response.status})`, {
        providerCode: await identityToolkitErrorName(response),
      });
    }
  },

  async deleteAccountOnServer(): Promise<void> {
    const authInstance = requireAuth();
    if (!firebaseFunctions) {
      throw authError('not_configured', 'firebase_not_configured', 'Firebase Functions is not configured');
    }
    if (!authInstance.currentUser) {
      throw new AppError('unauthenticated', 'Nobody is signed in');
    }
    const callable = httpsCallable<DeleteAccountRequest, DeleteAccountResponse>(
      firebaseFunctions,
      CALLABLES.deleteAccount,
      { timeout: DELETE_ACCOUNT_TIMEOUT_MS },
    );
    let data: unknown;
    try {
      data = (await callable({ confirm: true })).data;
    } catch (error) {
      if (serverReason(error) === 'requires_recent_login') {
        throw authError('unauthenticated', 'requires_recent_login', 'A recent sign-in is required to delete the account', {
          cause: error,
        });
      }
      throw mapFirebaseAuthError(error);
    }
    if (!deleteAccountResponseSchema.safeParse(data).success) {
      throw authError('upstream_error', 'invalid_server_response', 'Unexpected deleteAccount response');
    }
  },

  async reauthenticate(options: { password?: string } = {}): Promise<'done' | 'cancelled'> {
    const authInstance = requireAuth();
    const user = authInstance.currentUser;
    if (!user) throw new AppError('unauthenticated', 'Nobody is signed in');
    const providers = user.providerData.map((profile) => profile.providerId);
    // Apple FIRST on iOS when the module is usable (§26): the sheet also refreshes the
    // authorizationCode that revokeAppleTokens() needs. Otherwise Google, then password.
    if (providers.includes('apple.com') && Platform.OS === 'ios') {
      const apple = tryLoadAppleModule();
      if (apple && (await appleAvailable(apple))) {
        const requested = await requestAppleCredential(apple, { requestScopes: false });
        if (!requested) return 'cancelled';
        try {
          // Fails with auth/user-mismatch when a different Apple ID confirmed the sheet.
          await reauthenticateWithCredential(user, requested.firebaseCredential);
        } catch (error) {
          throw mapFirebaseAuthError(error);
        }
        // Only now is the code known to belong to the signed-in user (see appleAuthorizationCode).
        stashAppleAuthorizationCode(requested.apple.authorizationCode);
        return 'done';
      }
      // Module unusable in this build: fall through to the account's other providers.
    }
    if (providers.includes('google.com')) {
      if (!env.google.webClientId) {
        throw authError('not_configured', 'google_not_configured', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set');
      }
      return googleQueue.run(async () => {
        configureGoogle();
        const account = await interactiveGoogleSignIn();
        if (!account) return 'cancelled' as const;
        if (!account.idToken) {
          throw authError('not_configured', 'missing_id_token', 'Google returned no ID token');
        }
        try {
          // Fails with auth/user-mismatch when another Google account was picked.
          await reauthenticateWithCredential(user, GoogleAuthProvider.credential(account.idToken));
        } catch (error) {
          throw mapFirebaseAuthError(error);
        } finally {
          notifyGoogleAccessChanged();
        }
        return 'done' as const;
      });
    }
    if (providers.includes('password')) {
      if (!options.password) throw authError('invalid_input', 'missing_password', 'Password is required');
      if (!user.email) throw authError('invalid_input', 'invalid_email', 'The account has no email');
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, options.password));
      } catch (error) {
        throw mapFirebaseAuthError(error);
      }
      return 'done';
    }
    throw new AppError('unsupported', 'This sign-in method cannot be confirmed in the app');
  },

  onGoogleAccessChanged(listener: () => void): Unsubscribe {
    googleAccessListeners.add(listener);
    return () => {
      googleAccessListeners.delete(listener);
    };
  },
};
