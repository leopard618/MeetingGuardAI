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
      // console.error / console.warn stay in production builds; everything else is stripped by
      // babel (transform-remove-console) and should not be added in new code.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
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
          ],
        },
      ],
    },
  },
  {
    // Node-side config files.
    files: ['*.config.js', 'babel.config.js', 'metro.config.js', 'jest.config.js', 'plugins/**/*.js'],
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
