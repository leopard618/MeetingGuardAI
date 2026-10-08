import { render, screen } from '@testing-library/react-native';

// The Firebase JS SDK ships ESM (.mjs) that Jest does not transform; the app never calls it
// when the configuration is missing, so plain stubs are enough here.
jest.mock('firebase/app', () => ({ getApps: () => [], getApp: jest.fn(), initializeApp: jest.fn() }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('firebase/functions', () => ({}));

// This test needs NO EXPO_PUBLIC_* values. The shell or CI may define some (the CI workflow
// sets dummy values for the bundle step), so remove them for this test and load App afterwards:
// src/config/env.ts reads them once, when the module is first evaluated.
const savedPublicEnv = {};

beforeAll(() => {
  Object.keys(process.env)
    .filter((key) => key.startsWith('EXPO_PUBLIC_'))
    .forEach((key) => {
      savedPublicEnv[key] = process.env[key];
      delete process.env[key];
    });
});

afterAll(() => {
  Object.assign(process.env, savedPublicEnv);
});

// Loaded lazily (not with a top-level import) so env.ts is evaluated after beforeAll ran.
// Plain require keeps the shared module registry, so App and the renderer use the same React.
function loadApp() {
  return require('../App').default;
}

// Without configuration the app must render the "not configured" screen instead of crashing
// while its modules load.
describe('App without configuration', () => {
  it('renders the bilingual "App not configured" screen', async () => {
    const App = loadApp();
    await render(<App />);
    expect(screen.getByText('App not configured')).toBeTruthy();
    expect(screen.getByText('Aplicación no configurada')).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_FIREBASE_API_KEY/)).toBeTruthy();
  });
});
