module.exports = {
  expo: {
    name: "meeting-guard-ai",
    slug: "meeting-guard-ai",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/adaptive-icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.meetingguard.ai",
      infoPlist: {
        NSCalendarsUsageDescription: "This app needs access to your calendar to create and manage meetings.",
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      package: "com.meetingguard.ai",
      permissions: [
        "READ_CALENDAR",
        "WRITE_CALENDAR",
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        "android.permission.READ_CALENDAR",
        "android.permission.WRITE_CALENDAR"
      ]
    },
    web: {
      favicon: "./assets/adaptive-icon.png"
    },
    plugins: [
      "expo-router",
      "expo-notifications",
      "expo-calendar"
    ],
    scheme: "meetingguardai",
    extra: {
      eas: {
        projectId: "139b18d2-655f-458f-854a-27e423530626"
      }
    },
    // Add build configuration for better Gradle compatibility
    hooks: {
      postPublish: [
        {
          file: "sentry-expo/upload-sourcemaps",
          config: {
            organization: "your-sentry-org",
            project: "meetingguard-ai"
          }
        }
      ]
    }
  }
};
