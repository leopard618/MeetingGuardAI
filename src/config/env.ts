/**
 * Typed, validated app environment.
 *
 * Only PUBLIC values are allowed here: Expo inlines every `process.env.EXPO_PUBLIC_*`
 * reference into the JavaScript bundle at build time, so anyone with the APK/IPA can read them.
 * Secrets (OpenAI key, Google OAuth client secret, service accounts, ...) belong in
 * Firebase Functions secrets and must never be referenced from app code.
 *
 * Rules:
 * - Each variable is read with a static `process.env.EXPO_PUBLIC_X` expression (Expo can only
 *   inline static member accesses - no destructuring, no `process.env[name]`).
 * - Never throws at import time. Missing/invalid values are reported through `isConfigured`,
 *   `missingKeys` and `invalidKeys` so the UI can show a "not configured" screen instead of crashing.
 */
import { Platform } from 'react-native';
import { z } from 'zod';

import { createLogger } from '../core/logger';

const log = createLogger('env');

export type RawEnv = Record<EnvKey, string | undefined>;

export type EnvKey =
  | 'EXPO_PUBLIC_FIREBASE_API_KEY'
  | 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'
  | 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'
  | 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'
  | 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'
  | 'EXPO_PUBLIC_FIREBASE_APP_ID'
  | 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'
  | 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'
  | 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'
  | 'EXPO_PUBLIC_SENTRY_DSN'
  | 'EXPO_PUBLIC_APP_ENV'
  | 'EXPO_PUBLIC_FUNCTIONS_REGION'
  | 'EXPO_PUBLIC_USE_EMULATORS'
  | 'EXPO_PUBLIC_EMULATOR_HOST'
  | 'EXPO_PUBLIC_MSAL_CLIENT_ID'
  | 'EXPO_PUBLIC_MSAL_TENANT'
  | 'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY'
  | 'EXPO_PUBLIC_REVENUECAT_APPLE_KEY';

export type AppPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos' | 'native';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface AppEnv {
  /** True when every key the app needs to run on this platform is present and valid. */
  isConfigured: boolean;
  /** True when the Firebase web config is complete (Auth + Firestore can be initialized). */
  isFirebaseConfigured: boolean;
  /** Required keys that are empty or not set. */
  missingKeys: EnvKey[];
  /** Keys that are set but have an invalid format (optional keys are ignored when invalid). */
  invalidKeys: EnvKey[];
  /** Firebase web config, or null when incomplete. Public by design. */
  firebase: FirebaseWebConfig | null;
  google: {
    /** OAuth "Web" client ID - the audience of the idToken Firebase accepts. */
    webClientId: string | null;
    iosClientId: string | null;
    androidClientId: string | null;
  };
  sentryDsn: string | null;
  /** Microsoft (Outlook) OAuth. `clientId` null hides the whole Outlook feature. */
  msal: {
    /** Azure app registration "Application (client) ID" (a GUID; public, like the Google ids). */
    clientId: string | null;
    /** 'common' | 'organizations' | 'consumers' | a tenant GUID/domain. Default 'common'. */
    tenant: string;
  };
  /**
   * RevenueCat public SDK keys, one per store (Android "goog_...", Apple "appl_..."). The key
   * for the RUNNING platform enables in-app purchases; null (or the other platform's key only)
   * keeps the Pricing screen in its catalog-only "coming soon" behavior (§20).
   */
  revenueCat: {
    androidKey: string | null;
    appleKey: string | null;
  };
  /** development | preview | production (free text, defaults to "development"). */
  appEnv: string;
  /** Region of the Firebase callable functions (must match the deployed functions). */
  functionsRegion: string;
  /** Connect to the local Firebase emulators (development builds only). */
  useEmulators: boolean;
  emulatorHost: string;
}

export const DEFAULT_FUNCTIONS_REGION = 'us-central1';
/** Android emulator alias for the host machine's loopback interface. */
export const DEFAULT_EMULATOR_HOST = '10.0.2.2';
/** Microsoft identity tenant when EXPO_PUBLIC_MSAL_TENANT is not set (any account type). */
export const DEFAULT_MSAL_TENANT = 'common';

const FIREBASE_KEYS = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
] as const satisfies readonly EnvKey[];

const GOOGLE_CLIENT_ID = z.string().regex(/^[\w-]+\.apps\.googleusercontent\.com$/);

const validators: Record<EnvKey, z.ZodType<string>> = {
  EXPO_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: z.string().regex(/^[a-z0-9-]+$/),
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().regex(/^\d+$/),
  EXPO_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: GOOGLE_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: GOOGLE_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: GOOGLE_CLIENT_ID,
  EXPO_PUBLIC_SENTRY_DSN: z.url({ protocol: /^https?$/ }),
  EXPO_PUBLIC_APP_ENV: z.string().min(1),
  EXPO_PUBLIC_FUNCTIONS_REGION: z.string().regex(/^[a-z]+-[a-z]+\d+$/),
  EXPO_PUBLIC_USE_EMULATORS: z.string(),
  EXPO_PUBLIC_EMULATOR_HOST: z.string().regex(/^[\w.-]+$/),
  // Azure "Application (client) ID": always a GUID.
  EXPO_PUBLIC_MSAL_CLIENT_ID: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  // 'common' | 'organizations' | 'consumers' | tenant GUID | verified domain.
  EXPO_PUBLIC_MSAL_TENANT: z.string().regex(/^[\w.-]+$/),
  // RevenueCat public Android SDK key (dashboard -> Project -> API keys). Public by design.
  EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: z.string().regex(/^goog_[A-Za-z0-9]{10,}$/),
  // RevenueCat public Apple SDK key (same dashboard page, the App Store app). Public by design.
  EXPO_PUBLIC_REVENUECAT_APPLE_KEY: z.string().regex(/^appl_[A-Za-z0-9]{10,}$/),
};

/** Keys the app cannot run without, per platform. */
export function requiredKeysFor(platform: AppPlatform): EnvKey[] {
  const keys: EnvKey[] = [...FIREBASE_KEYS, 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];
  if (platform === 'ios') keys.push('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
  return keys;
}

function clean(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Pure parser (exported for tests). Never throws.
 */
export function parseEnv(raw: Partial<RawEnv>, platform: AppPlatform): AppEnv {
  const required = new Set(requiredKeysFor(platform));
  const values: Partial<Record<EnvKey, string>> = {};
  const missingKeys: EnvKey[] = [];
  const invalidKeys: EnvKey[] = [];

  (Object.keys(validators) as EnvKey[]).forEach((key) => {
    const value = clean(raw[key]);
    if (value === undefined) {
      if (required.has(key)) missingKeys.push(key);
      return;
    }
    if (validators[key].safeParse(value).success) {
      values[key] = value;
    } else {
      invalidKeys.push(key);
    }
  });

  const firebaseComplete = FIREBASE_KEYS.every((key) => values[key] !== undefined);
  const firebase: FirebaseWebConfig | null = firebaseComplete
    ? {
        apiKey: values.EXPO_PUBLIC_FIREBASE_API_KEY!,
        authDomain: values.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: values.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
        storageBucket: values.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
        messagingSenderId: values.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        appId: values.EXPO_PUBLIC_FIREBASE_APP_ID!,
      }
    : null;

  const requiredInvalid = invalidKeys.some((key) => required.has(key));
  const useEmulatorsRaw = (values.EXPO_PUBLIC_USE_EMULATORS ?? '').toLowerCase();

  return {
    isConfigured: missingKeys.length === 0 && !requiredInvalid,
    isFirebaseConfigured: firebase !== null,
    missingKeys,
    invalidKeys,
    firebase,
    google: {
      webClientId: values.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? null,
      iosClientId: values.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? null,
      androidClientId: values.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? null,
    },
    sentryDsn: values.EXPO_PUBLIC_SENTRY_DSN ?? null,
    msal: {
      clientId: values.EXPO_PUBLIC_MSAL_CLIENT_ID ?? null,
      tenant: values.EXPO_PUBLIC_MSAL_TENANT ?? DEFAULT_MSAL_TENANT,
    },
    revenueCat: {
      androidKey: values.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? null,
      appleKey: values.EXPO_PUBLIC_REVENUECAT_APPLE_KEY ?? null,
    },
    appEnv: values.EXPO_PUBLIC_APP_ENV ?? 'development',
    functionsRegion: values.EXPO_PUBLIC_FUNCTIONS_REGION ?? DEFAULT_FUNCTIONS_REGION,
    useEmulators: useEmulatorsRaw === '1' || useEmulatorsRaw === 'true',
    emulatorHost: values.EXPO_PUBLIC_EMULATOR_HOST ?? DEFAULT_EMULATOR_HOST,
  };
}

/**
 * Static references only - see the note at the top of this file.
 */
export function readRawEnv(): RawEnv {
  return {
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_FUNCTIONS_REGION: process.env.EXPO_PUBLIC_FUNCTIONS_REGION,
    EXPO_PUBLIC_USE_EMULATORS: process.env.EXPO_PUBLIC_USE_EMULATORS,
    EXPO_PUBLIC_EMULATOR_HOST: process.env.EXPO_PUBLIC_EMULATOR_HOST,
    EXPO_PUBLIC_MSAL_CLIENT_ID: process.env.EXPO_PUBLIC_MSAL_CLIENT_ID,
    EXPO_PUBLIC_MSAL_TENANT: process.env.EXPO_PUBLIC_MSAL_TENANT,
    EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    EXPO_PUBLIC_REVENUECAT_APPLE_KEY: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY,
  };
}

function computeEnv(): AppEnv {
  try {
    return parseEnv(readRawEnv(), Platform.OS as AppPlatform);
  } catch (error) {
    // parseEnv does not throw; this is a last-resort guard so importing this module never crashes.
    log.error('Failed to read the app environment', error);
    return parseEnv({}, Platform.OS as AppPlatform);
  }
}

export const env: AppEnv = computeEnv();

if (__DEV__ && !env.isConfigured && process.env.NODE_ENV !== 'test') {
  log.warn(
    `App is not fully configured. Missing: ${env.missingKeys.join(', ') || '-'}; ` +
      `invalid: ${env.invalidKeys.join(', ') || '-'}. See env.example.`,
  );
}

export default env;
