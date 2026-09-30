import { DEFAULT_FUNCTIONS_REGION, parseEnv, requiredKeysFor, type RawEnv } from '../env';

const COMPLETE: Partial<RawEnv> = {
  EXPO_PUBLIC_FIREBASE_API_KEY: 'AIzaTestKey123',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-meetingguard.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-meetingguard',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-meetingguard.firebasestorage.app',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:abc123',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '1234567890-web.apps.googleusercontent.com',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '1234567890-ios.apps.googleusercontent.com',
};

describe('parseEnv', () => {
  it('accepts a complete configuration', () => {
    const env = parseEnv(COMPLETE, 'android');
    expect(env.isConfigured).toBe(true);
    expect(env.isFirebaseConfigured).toBe(true);
    expect(env.missingKeys).toEqual([]);
    expect(env.invalidKeys).toEqual([]);
    expect(env.firebase).toEqual({
      apiKey: 'AIzaTestKey123',
      authDomain: 'demo-meetingguard.firebaseapp.com',
      projectId: 'demo-meetingguard',
      storageBucket: 'demo-meetingguard.firebasestorage.app',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abc123',
    });
    expect(env.google.webClientId).toBe('1234567890-web.apps.googleusercontent.com');
  });

  it('applies defaults for optional values', () => {
    const env = parseEnv(COMPLETE, 'android');
    expect(env.functionsRegion).toBe(DEFAULT_FUNCTIONS_REGION);
    expect(env.sentryDsn).toBeNull();
    expect(env.useEmulators).toBe(false);
    expect(env.appEnv).toBe('development');
    expect(env.google.androidClientId).toBeNull();
  });

  it('never throws and reports every missing required key for an empty environment', () => {
    const env = parseEnv({}, 'android');
    expect(env.isConfigured).toBe(false);
    expect(env.isFirebaseConfigured).toBe(false);
    expect(env.firebase).toBeNull();
    expect(env.missingKeys).toEqual(requiredKeysFor('android'));
  });

  it('treats blank strings as missing', () => {
    const env = parseEnv({ ...COMPLETE, EXPO_PUBLIC_FIREBASE_API_KEY: '   ' }, 'android');
    expect(env.isConfigured).toBe(false);
    expect(env.missingKeys).toEqual(['EXPO_PUBLIC_FIREBASE_API_KEY']);
  });

  it('reads the optional Microsoft OAuth values with the "common" tenant default', () => {
    expect(parseEnv(COMPLETE, 'android').msal).toEqual({ clientId: null, tenant: 'common' });
    const env = parseEnv(
      { ...COMPLETE, EXPO_PUBLIC_MSAL_CLIENT_ID: '11111111-2222-3333-4444-555555555555', EXPO_PUBLIC_MSAL_TENANT: 'organizations' },
      'android',
    );
    expect(env.msal).toEqual({ clientId: '11111111-2222-3333-4444-555555555555', tenant: 'organizations' });
    expect(env.isConfigured).toBe(true);
  });

  it('rejects a malformed MSAL client id without breaking the rest (optional key)', () => {
    const env = parseEnv({ ...COMPLETE, EXPO_PUBLIC_MSAL_CLIENT_ID: 'not-a-guid' }, 'android');
    expect(env.msal.clientId).toBeNull();
    expect(env.invalidKeys).toContain('EXPO_PUBLIC_MSAL_CLIENT_ID');
    expect(env.isConfigured).toBe(true);
  });

  it('reads the optional RevenueCat Android key and defaults it to null', () => {
    expect(parseEnv(COMPLETE, 'android').revenueCat).toEqual({ androidKey: null });
    const env = parseEnv({ ...COMPLETE, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_AbCdEfGhIjKlMnOp01' }, 'android');
    expect(env.revenueCat.androidKey).toBe('goog_AbCdEfGhIjKlMnOp01');
    expect(env.isConfigured).toBe(true);
  });

  it('rejects a malformed RevenueCat key without blocking the app (optional key)', () => {
    // A secret API key ("sk_...") or garbage must never be accepted as the public SDK key.
    const env = parseEnv({ ...COMPLETE, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'sk_not_a_public_key' }, 'android');
    expect(env.revenueCat.androidKey).toBeNull();
    expect(env.invalidKeys).toContain('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY');
    expect(env.isConfigured).toBe(true);
  });

  it('requires the iOS client ID only on iOS', () => {
    const withoutIos = { ...COMPLETE, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: undefined };
    expect(parseEnv(withoutIos, 'android').isConfigured).toBe(true);
    const ios = parseEnv(withoutIos, 'ios');
    expect(ios.isConfigured).toBe(false);
    expect(ios.missingKeys).toEqual(['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID']);
  });

  it('flags invalid required values and keeps Firebase unconfigured', () => {
    const env = parseEnv({ ...COMPLETE, EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'abc' }, 'android');
    expect(env.isConfigured).toBe(false);
    expect(env.invalidKeys).toEqual(['EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID']);
    expect(env.firebase).toBeNull();
  });

  it('ignores an invalid optional value without blocking the app', () => {
    const env = parseEnv({ ...COMPLETE, EXPO_PUBLIC_SENTRY_DSN: 'not a url' }, 'android');
    expect(env.isConfigured).toBe(true);
    expect(env.sentryDsn).toBeNull();
    expect(env.invalidKeys).toEqual(['EXPO_PUBLIC_SENTRY_DSN']);
  });

  it('reads optional values', () => {
    const env = parseEnv(
      {
        ...COMPLETE,
        EXPO_PUBLIC_SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/42',
        EXPO_PUBLIC_FUNCTIONS_REGION: 'europe-west1',
        EXPO_PUBLIC_USE_EMULATORS: 'true',
        EXPO_PUBLIC_EMULATOR_HOST: '192.168.1.20',
      },
      'android',
    );
    expect(env.sentryDsn).toBe('https://abc123@o1.ingest.sentry.io/42');
    expect(env.functionsRegion).toBe('europe-west1');
    expect(env.useEmulators).toBe(true);
    expect(env.emulatorHost).toBe('192.168.1.20');
  });
});

describe('env module', () => {
  it('can be imported without any configuration and does not throw', () => {
    jest.isolateModules(() => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../env') as typeof import('../env');
      expect(typeof mod.env.isConfigured).toBe('boolean');
      expect(Array.isArray(mod.env.missingKeys)).toBe(true);
      warn.mockRestore();
    });
  });

  it('contains no secret-like keys', () => {
    const keys = requiredKeysFor('ios').join(' ');
    expect(keys).not.toMatch(/SECRET|OPENAI|PRIVATE|SERVICE_ACCOUNT/);
  });
});
