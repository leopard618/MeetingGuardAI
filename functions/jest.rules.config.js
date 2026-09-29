/**
 * Firestore security rules tests. They need the Firestore emulator (Java 21+), so they only run
 * through `npm run test:rules` (firebase emulators:exec sets FIRESTORE_EMULATOR_HOST).
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/rules'],
  testMatch: ['**/*.rules.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 30000,
};
