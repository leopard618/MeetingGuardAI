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
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.meetingguard.ai"
    },
    android: {
      package: "com.meetingguard.ai"
    },
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
