import { render, screen } from '@testing-library/react-native';

import App from '../App';

// The Firebase JS SDK ships ESM (.mjs) that Jest does not transform; the app never calls it
// when the configuration is missing, so plain stubs are enough here.
jest.mock('firebase/app', () => ({ getApps: () => [], getApp: jest.fn(), initializeApp: jest.fn() }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('firebase/functions', () => ({}));

// No EXPO_PUBLIC_* values are set in this test, so the app must render the
// "not configured" screen instead of crashing while its modules load.
describe('App without configuration', () => {
  it('renders the bilingual "App not configured" screen', async () => {
    await render(<App />);
    expect(screen.getByText('App not configured')).toBeTruthy();
    expect(screen.getByText('Aplicación no configurada')).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_FIREBASE_API_KEY/)).toBeTruthy();
  });
});
