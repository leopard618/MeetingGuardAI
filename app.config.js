// Single source of truth for the Expo app config (app.json was removed).
// Native projects are generated from this file (Continuous Native Generation):
// android/ and ios/ are NOT committed - run `npx expo prebuild` locally if needed.
//
// Versioning: `version` is the user-facing version. Android versionCode / iOS
// buildNumber are managed remotely by EAS (eas.json: cli.appVersionSource = "remote").

const CALENDAR_USAGE =
  'MeetingGuard AI uses your calendar to show, create and update your meetings and to schedule meeting alerts.';

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
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.meetingguard.ai',
      infoPlist: {
        NSCalendarsUsageDescription: CALENDAR_USAGE,
        NSCalendarsFullAccessUsageDescription: CALENDAR_USAGE,
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.meetingguard.ai',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      // Only what the app actually needs. INTERNET / ACCESS_NETWORK_STATE are added
      // by React Native and @react-native-community/netinfo themselves.
      permissions: [
        'android.permission.VIBRATE',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_CALENDAR',
        'android.permission.WRITE_CALENDAR',
        'android.permission.WAKE_LOCK',
      ],
      // Prevent libraries (e.g. expo-av) from merging sensitive permissions back in.
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
    },
    plugins: [
      'expo-notifications',
      [
        'expo-calendar',
        {
          calendarPermission: CALENDAR_USAGE,
        },
      ],
      'expo-dev-client',
      [
        'expo-build-properties',
        {
          // TODO(SDK upgrade step): revisit these pins - Play requires targetSdk 36
          // for updates after 31 Aug 2026; the Expo SDK 57 defaults satisfy that.
          android: {
            targetSdkVersion: 35,
            compileSdkVersion: 35,
            minSdkVersion: 24,
          },
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '139b18d2-655f-458f-854a-27e423530626',
      },
    },
  },
};
