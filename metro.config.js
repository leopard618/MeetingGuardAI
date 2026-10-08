// Learn more: https://docs.expo.dev/guides/customizing-metro
// getSentryExpoConfig wraps Expo's default Metro config (package exports, tsconfig "paths",
// EXPO_PUBLIC_* inlining) and adds Sentry debug IDs to bundles and source maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

module.exports = config;
