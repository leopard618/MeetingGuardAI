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
    ]
  }
};
