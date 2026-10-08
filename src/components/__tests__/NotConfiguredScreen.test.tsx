import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import NotConfiguredScreen from '../NotConfiguredScreen';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe('NotConfiguredScreen', () => {
  it('renders the bilingual message and the missing keys', async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <NotConfiguredScreen
          missingKeys={['EXPO_PUBLIC_FIREBASE_API_KEY']}
          invalidKeys={['EXPO_PUBLIC_SENTRY_DSN']}
        />
      </SafeAreaProvider>,
    );

    expect(screen.getByText('App not configured')).toBeTruthy();
    expect(screen.getByText('Aplicación no configurada')).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_FIREBASE_API_KEY/)).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_SENTRY_DSN/)).toBeTruthy();
  });
});
