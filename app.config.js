// Single source of truth for the Expo app config (app.json was removed).
// Native projects are generated from this file (Continuous Native Generation):
// android/ and ios/ are NOT committed - run `npx expo prebuild` locally if needed.
//
// Versioning: `version` is the user-facing version. Android versionCode / iOS
// buildNumber are managed remotely by EAS (eas.json: cli.appVersionSource = "remote").
//
// OTA updates (EAS Update, expo-updates): runtimeVersion follows `version` (policy
// "appVersion"), so an update only reaches binaries with the same version. Bump `version`
// whenever native code or native config changes (new native module, permission, plugin
// option); JS/asset-only fixes ship with `npm run update:<channel>`. Each eas.json build
// profile listens to its own channel. Runbook and rollback: docs/DEPLOYMENT.md.
//
// Expo SDK 57 platform defaults (no expo-build-properties needed): Android minSdk 24,
// compileSdk/targetSdk 36, New Architecture + Hermes always on, edge-to-edge always on
// (the old `edgeToEdgeEnabled` / `newArchEnabled` switches no longer exist). iOS min 16.4.
//
// This file runs in Node at build/config time. It may read build-time env vars
// (SENTRY_*, EXPO_PUBLIC_GOOGLE_IOS_*, MG_LOCAL_TEST_BUILD); nothing secret is written into the app
// config.

const CALENDAR_USAGE =
  'MeetingGuard AI uses your calendar to show, create and update your meetings and to schedule meeting alerts.';
const PHOTOS_USAGE = 'MeetingGuard AI lets you attach photos from your library to a meeting.';
const CAMERA_USAGE = 'MeetingGuard AI lets you take a photo and attach it to a meeting.';

const trim = (value) => (typeof value === 'string' ? value.trim() : '');

const EAS_PROJECT_ID = '139b18d2-655f-458f-854a-27e423530626';

// Local test APKs built on a PC (scripts/build-test-apk.mjs, `npm run apk:test`; docs/TESTING.md B.2)
// set MG_LOCAL_TEST_BUILD=1. They listen to no EAS Update channel, so expo-updates is turned off in
// them: the APK always runs the bundle it was built with and never contacts EAS Update. EAS builds
// never set this variable, so their config is unchanged.
const IS_LOCAL_TEST_BUILD = process.env.MG_LOCAL_TEST_BUILD === '1';

/**
 * iOS URL scheme required by @react-native-google-signin/google-signin: the "reversed" iOS
 * OAuth client ID (com.googleusercontent.apps.<id>). Taken from EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME,
 * or derived from EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (<id>.apps.googleusercontent.com).
 * Returns null when neither is set.
 */
function getGoogleIosUrlScheme() {
  const explicit = trim(process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME);
  if (explicit.startsWith('com.googleusercontent.apps.')) return explicit;

  const iosClientId = trim(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
  const suffix = '.apps.googleusercontent.com';
  if (iosClientId.endsWith(suffix)) {
    return `com.googleusercontent.apps.${iosClientId.slice(0, -suffix.length)}`;
  }
  return null;
}

/**
 * The google-signin plugin only adds the iOS URL scheme. Without options it switches to
 * "Firebase config file" mode and requires google-services.json / GoogleService-Info.plist,
 * which this app does not use - so when no scheme is configured the plugin is left out
 * entirely (Android does not need it; an iOS build then cannot complete Google sign-in).
 */
function googleSignInPlugin() {
  const iosUrlScheme = getGoogleIosUrlScheme();
  return iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }]] : [];
}

/**
 * Sign in with Apple (expo-apple-authentication). The config plugin sets the same
 * com.apple.developer.applesignin entitlement as `ios.usesAppleSignIn: true`, but listing it
 * keeps the native setup explicit and future plugin options available. The entry is conditional
 * because a config plugin whose package is missing makes every `npx expo config` / prebuild
 * fail: on a checkout where `npx expo install expo-apple-authentication` (docs/SETUP.md §8) has
 * not run yet, the plugin is left out and the entitlement still comes from usesAppleSignIn.
 */
function appleAuthPlugin() {
  try {
    require.resolve('expo-apple-authentication/package.json');
    return ['expo-apple-authentication'];
  } catch {
    return [];
  }
}

/**
 * Sentry: organization/project/auth token come from build-time env vars (EAS secrets), never
 * from this file. Source-map upload is only enabled when all three are present, so local
 * prebuilds and builds without Sentry credentials do not fail.
 */
function sentryPlugin() {
  const organization = trim(process.env.SENTRY_ORG);
  const project = trim(process.env.SENTRY_PROJECT);
  const hasAuthToken = trim(process.env.SENTRY_AUTH_TOKEN) !== '';
  const options = {
    url: trim(process.env.SENTRY_URL) || 'https://sentry.io/',
    disableAutoUpload: !(organization && project && hasAuthToken),
  };
  if (organization) options.organization = organization;
  if (project) options.project = project;
  return ['@sentry/react-native/expo', options];
}

module.exports = {
  expo: {
    name: 'MeetingGuard AI',
    slug: 'meeting-guard-ai',
    // 1.2.0: the mg-fullscreen-alarm native module changed the native runtime (new module +
    // USE_FULL_SCREEN_INTENT). Builds of 1.1.0 must never receive 1.2.0 JS via OTA.
    // 1.3.0: mg-next-meeting-widget (new native module) + react-native-purchases (native SDK)
    // changed the runtime again: store/APK build only, never an OTA update onto 1.2.0.
    // 1.4.0: expo-apple-authentication (Sign in with Apple, iOS pass) is a new native module +
    // the applesignin entitlement: store/APK build only, never an OTA update onto 1.3.x.
    version: '1.4.0',
    scheme: 'meetingguardai',
    platforms: ['ios', 'android'],
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      enabled: !IS_LOCAL_TEST_BUILD,
      // Look for a newer update at every cold start, in the background.
      checkAutomatically: 'ON_LOAD',
      // Never delay the launch waiting for the network: the cached (or embedded) bundle starts
      // at once and a downloaded update runs from the next cold start. This app is offline-first
      // and its headless background tasks (alert refresh, snooze) start the same JS runtime.
      fallbackToCacheTimeout: 0,
    },
    ios: {
      // iPhone only for the first iOS release: the layouts are portrait-only and untested on iPad
      // (an iPad build must support every orientation and needs iPad screenshots). iPads run the
      // iPhone app in compatibility mode. Turn on after iPad QA (docs/SETUP.md §8).
      supportsTablet: false,
      bundleIdentifier: 'com.meetingguard.ai',
      // Full-bleed square icon: the shared icon.png has a transparent margin and baked rounded
      // corners, which iOS (own superellipse mask) renders as a frame inside the tile.
      icon: './assets/icon-ios.png',
      // Sign in with Apple (App Review 4.8: an app with Google sign-in must offer it). Prebuild
      // adds the com.apple.developer.applesignin entitlement from this flag ONCE
      // expo-apple-authentication is installed (until then `npx expo config --type introspect`
      // prints a warning and emits no entitlement - harmless, nothing can build iOS before the
      // install either). EAS registers the capability on the App ID from the generated
      // entitlements (docs/SETUP.md §8).
      usesAppleSignIn: true,
      // MAX / MEDIUM meeting alerts use interruptionLevel "timeSensitive" (they break through
      // Focus modes). The App ID needs the "Time Sensitive Notifications" capability.
      entitlements: {
        'com.apple.developer.usernotifications.time-sensitive': true,
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.meetingguard.ai',
      // No Auto Backup: AsyncStorage holds the Firebase session (refresh token), the meeting cache
      // (conference passwords, third-party emails), the outbox and the assistant thread. A restore
      // on another device must never recreate a signed-in session without authentication.
      // allowBackup=false alone does not stop device-to-device transfers on some Android 12+
      // phones: plugins/withNoDeviceTransfer.js adds dataExtractionRules that exclude everything.
      allowBackup: false,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      // Only what the app actually needs. INTERNET / ACCESS_NETWORK_STATE are added by
      // React Native and @react-native-community/netinfo; expo-notifications and
      // expo-calendar add their own permissions too (listed here for clarity).
      permissions: [
        'android.permission.VIBRATE',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_CALENDAR',
        'android.permission.WRITE_CALENDAR',
        'android.permission.WAKE_LOCK',
        // User-granted on Android 12+; lets expo-notifications use exact alarms for meeting
        // alerts once the user allows it (otherwise the OS may delay alerts under Doze).
        'android.permission.SCHEDULE_EXACT_ALARM',
        // Full-screen MAX alarms over the lock screen (modules/mg-fullscreen-alarm). Normal
        // permission; on Android 14+ the user can revoke it and the app falls back to ordinary
        // notifications (the module's app.plugin.js declares it too).
        'android.permission.USE_FULL_SCREEN_INTENT',
      ],
      // Prevent libraries from merging sensitive permissions back in.
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
    },
    plugins: [
      [
        'expo-splash-screen',
        {
          image: './assets/splash.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
      ],
      [
        'expo-notifications',
        {
          // 96x96 white-on-transparent glyph (Android status bar icon), derived from icon.png.
          icon: './assets/notification-icon.png',
          // MG Indigo brand primary (src/theme/tokens.ts lightColors.primary).
          color: '#4646D3',
          // Alert sounds (generated by assets/sounds/generate-sounds.js). Copied to Android
          // res/raw and the iOS bundle; referenced by file name from the notification channels
          // (Android 8+) and content.sound (iOS, Android 7). Names must stay [a-z0-9_].
          sounds: ['./assets/sounds/meeting_alarm.wav', './assets/sounds/meeting_chime.wav'],
        },
      ],
      [
        'expo-calendar',
        {
          calendarPermission: CALENDAR_USAGE,
          remindersPermission: false,
        },
      ],
      [
        // Playback only: no microphone, no background playback (avoids RECORD_AUDIO and a
        // mediaPlayback foreground service that would need a Play Console declaration).
        'expo-audio',
        {
          microphonePermission: false,
          recordAudioAndroid: false,
          enableBackgroundPlayback: false,
        },
      ],
      'expo-background-task',
      [
        'expo-localization',
        {
          supportedLocales: {
            ios: ['en', 'es'],
            android: ['en', 'es'],
          },
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: PHOTOS_USAGE,
          cameraPermission: CAMERA_USAGE,
          microphonePermission: false,
        },
      ],
      ...googleSignInPlugin(),
      ...appleAuthPlugin(),
      sentryPlugin(),
      // Local full-screen alarm module (modules/mg-fullscreen-alarm): the plugin only ensures the
      // USE_FULL_SCREEN_INTENT permission; autolinking picks the module itself up from modules/.
      // Native code: shipping it needs a NEW `version` and a store build, never an OTA update.
      './modules/mg-fullscreen-alarm/app.plugin.js',
      'expo-dev-client',
      './plugins/withNoDeviceTransfer',
      // Signs local release builds with the test key outside the repository. Always listed because it
      // does nothing unless MG_LOCAL_SIGNING=1 at prebuild time (and never on an EAS build server), so
      // EAS builds get the same native project as before, and `MG_LOCAL_SIGNING=1 npx expo prebuild`
      // also works without the build script. Details in the plugin file.
      './plugins/withLocalReleaseSigning',
    ],
    extra: {
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
  },
};
