import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { setErrorReporter } from '../../core/logger';
import { i18n } from '../../i18n';
import { ErrorBoundary } from '../ErrorBoundary';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

let shouldThrow = true;

function Fragile() {
  if (shouldThrow) throw new Error('render exploded');
  return <Text>Recovered content</Text>;
}

const reporter = jest.fn();

beforeEach(async () => {
  await i18n.changeLanguage('en');
  shouldThrow = true;
  reporter.mockReset();
  setErrorReporter(reporter);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  setErrorReporter(null);
  jest.restoreAllMocks();
});

it('shows a localized fallback and reports the error through the logger (Sentry)', async () => {
  await render(
    <ErrorBoundary>
      <Fragile />
    </ErrorBoundary>,
  );
  expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(reporter).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'render exploded' }),
    expect.objectContaining({ scope: 'ui', message: 'unhandled render error' }),
  );
});

it('remounts the children on "Try again" and calls onReset', async () => {
  const onReset = jest.fn();
  await render(
    <ErrorBoundary onReset={onReset}>
      <Fragile />
    </ErrorBoundary>,
  );
  shouldThrow = false;
  await act(async () => {
    fireEvent.press(screen.getByTestId('error-boundary-retry'));
  });
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Recovered content')).toBeTruthy();
});

it('follows the UI language', async () => {
  await i18n.changeLanguage('es');
  await render(
    <ErrorBoundary>
      <Fragile />
    </ErrorBoundary>,
  );
  expect(screen.getByText('Algo salió mal')).toBeTruthy();
  expect(screen.getByText('Reintentar')).toBeTruthy();
});
