/**
 * Unit tests (no emulators, no network). Firestore rules tests live in test/rules and run through
 * `npm run test:rules` (jest.rules.config.js) inside `firebase emulators:exec`.
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/unit'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // jose 6 is ESM-only and only used for JWT verification (see test/stubs/jose.js).
  moduleNameMapper: { '^jose$': '<rootDir>/test/stubs/jose.js' },
  clearMocks: true,
  restoreMocks: true,
};
