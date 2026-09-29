// ESLint 9 flat config. eslint-config-expo/flat already includes eslint-plugin-react,
// eslint-plugin-react-hooks (recommended rules), eslint-plugin-import and typescript-eslint.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'coverage/*',
      'android/*',
      'ios/*',
      '.expo/*',
      'node_modules/*',
      'reference/*',
      'public/*',
      // Cloud Functions have their own ESLint config and CI job (functions/eslint.config.mjs).
      'functions/**',
    ],
  },
  {
    rules: {
      // Log through createLogger (src/core/logger.ts), never console.* directly (docs/ARCHITECTURE.md
      // section 11). The logger is the one allowed caller (override below); babel strips
      // console.log/info/debug from production bundles and keeps console.warn/error.
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@env',
              message: 'Use src/config/env.ts (EXPO_PUBLIC_* only). Secrets never belong in the app.',
            },
            {
              name: '@firebase/auth',
              message:
                "Import from 'firebase/auth'. tsconfig maps '@firebase/auth' to its React Native typings only.",
            },
            {
              name: 'expo-av',
              message: 'expo-av was removed in Expo SDK 55. Use expo-audio.',
            },
            {
              name: 'expo-background-fetch',
              message: 'Deprecated. Use expo-background-task.',
            },
            {
              name: '@expo/vector-icons',
              message:
                "Import one icon family, e.g. `import Ionicons from '@expo/vector-icons/Ionicons'`. The barrel bundles all 19 icon fonts (about 2 MB more).",
            },
          ],
        },
      ],
    },
  },
  {
    // The logger itself, and the Node script that generates the alert sounds.
    files: ['src/core/logger.ts', 'assets/sounds/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Node-side config files, config plugins and build scripts (scripts/ print with
    // process.stdout.write, so no-console stays on).
    files: [
      '*.config.js',
      'babel.config.js',
      'metro.config.js',
      'jest.config.js',
      'plugins/**/*.js',
      'scripts/**/*.{js,mjs}',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Tests run in Node under Jest (fs, path, __dirname are available).
    files: ['**/__tests__/**/*.{js,jsx,ts,tsx}', '**/*.test.{js,jsx,ts,tsx}', 'jest.setup.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
]);
