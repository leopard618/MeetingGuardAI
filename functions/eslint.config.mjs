// ESLint 9 flat config for Cloud Functions (TypeScript, Node 22).
import js from '@eslint/js';
import globals from 'globals';
import { config as defineTsConfig, configs as tsConfigs } from 'typescript-eslint';

export default defineTsConfig(
  {
    ignores: ['lib/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tsConfigs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Server logs go through firebase-functions/logger (structured, no PII).
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'firebase-functions/v1', message: 'Use Cloud Functions v2 APIs (firebase-functions/https, /params, /logger).' },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
    },
  },
  {
    files: ['jest.config.js', 'jest.rules.config.js', 'test/stubs/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
);
