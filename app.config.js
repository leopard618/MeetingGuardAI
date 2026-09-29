// Single source of truth for the Expo app config (app.json was removed).
// Native projects are generated from this file (Continuous Native Generation):
// android/ and ios/ are NOT committed - run `npx expo prebuild` locally if needed.
//
// Versioning: `version` is the user-facing version. Android versionCode / iOS
// buildNumber are managed remotely by EAS (eas.json: cli.appVersionSource = "remote").
//
// Expo SDK 57 platform defaults (no expo-build-properties needed): Android minSdk 24,
// compileSdk/targetSdk 36, New Architecture + Hermes always on, edge-to-edge always on
// (the old `edgeToEdgeEnabled` / `newArchEnabled` switches no longer exist). iOS min 16.4.
//
// This file runs in Node at build/config time. It may read build-time env vars
// (SENTRY_*, EXPO_PUBLIC_GOOGLE_IOS_*); nothing secret is written into the app config.

const CALENDAR_USAGE =
  'MeetingGuard AI uses your calendar to show, create and update your meetings and to schedule meeting alerts.';
const PHOTOS_USAGE = 'MeetingGuard AI lets you attach photos from your library to a meeting.';
const CAMERA_USAGE = 'MeetingGuard AI lets you take a photo and attach it to a meeting.';

const trim = (value) => (typeof value === 'string' ? value.trim() : '');

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
    version: '1.1.0',
    scheme: 'meetingguardai',
    platforms: ['ios', 'android'],
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.meetingguard.ai',
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
          color: '#1E40AF',
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
      sentryPlugin(),
      'expo-dev-client',
    ],
    extra: {
      eas: {
        projectId: '139b18d2-655f-458f-854a-27e423530626',
      },
    },
  },
};
