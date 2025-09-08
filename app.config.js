module.exports = {
  expo: {
    name: "meeting-guard-ai",
    slug: "meeting-guard-ai",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.meetingguard.ai",
      buildNumber: "1",
      infoPlist: {
        "NSCalendarsUsageDescription": "This app needs access to your calendar to create and manage meetings.",
        "NSContactsUsageDescription": "This app needs access to your contacts to add meeting participants.",
        "NSMicrophoneUsageDescription": "This app needs access to your microphone for voice notes and meeting recordings.",
        "ITSAppUsesNonExemptEncryption": false
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      package: "com.meetingguard.ai",
      versionCode: 1,
      permissions: [
        "READ_CALENDAR",
        "WRITE_CALENDAR",
        "READ_CONTACTS",
        "RECORD_AUDIO",
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        "VIBRATE",
        "WAKE_LOCK",
        "android.permission.READ_CALENDAR",
        "android.permission.WRITE_CALENDAR",
        "android.permission.READ_CONTACTS",
        "android.permission.RECORD_AUDIO"
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    scheme: "meetingguardai",
    newArchEnabled: false,
    plugins: [
      "expo-router",
      "expo-notifications",
      "expo-calendar"
    ],
    extra: {
      eas: {
        projectId: "139b18d2-655f-458f-854a-27e423530626"
      }
    }
  }
};
