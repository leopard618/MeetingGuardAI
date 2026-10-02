/**
 * AppleSignInButton render gate (section 26): official native button on iOS when
 * isAvailableAsync() says so, nothing anywhere else, and no presses while disabled.
 * jest-expo runs as iOS by default; the Android case overrides Platform.OS.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { I18nProvider, i18n } from '../../../i18n';
import { AppleSignInButton } from '../AppleSignInButton';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

const mockIsAvailableAsync = jest.fn();
jest.mock(
  'expo-apple-authentication',
  () => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return {
      isAvailableAsync: mockIsAvailableAsync,
      // The official button is native-only; a View with the same props is enough for the gate.
      AppleAuthenticationButton: View,
      AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
      AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    };
  },
  { virtual: true },
);

const onPress = jest.fn();

async function renderButton(props: { disabled?: boolean } = {}) {
  await render(
    <I18nProvider>
      <AppleSignInButton onPress={onPress} {...props} />
    </I18nProvider>,
  );
  // Let isAvailableAsync() resolve before asserting.
  await act(async () => undefined);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  onPress.mockReset();
  mockIsAvailableAsync.mockReset().mockResolvedValue(true);
});

it('renders the official CONTINUE button on iOS and forwards presses', async () => {
  await renderButton();
  const button = screen.getByTestId('landing-apple-sign-in');
  expect(button.props.buttonType).toBe(1); // CONTINUE: matches "Continue with Google" wording
  expect(button.props.accessibilityLabel).toBe('Continue with Apple');
  fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('ignores presses while disabled (Landing is busy)', async () => {
  await renderButton({ disabled: true });
  fireEvent.press(screen.getByTestId('landing-apple-sign-in'));
  expect(onPress).not.toHaveBeenCalled();
});

it('renders nothing when Sign in with Apple is unavailable on the device', async () => {
  mockIsAvailableAsync.mockResolvedValue(false);
  await renderButton();
  expect(screen.queryByTestId('landing-apple-sign-in')).toBeNull();
  // The height reservation collapses too: no dead gap above "Continue with Google".
  expect(screen.queryByTestId('landing-apple-sign-in-placeholder')).toBeNull();
});

it('reserves the button height (invisible placeholder) while the availability check is pending', async () => {
  let resolve: ((value: boolean) => void) | undefined;
  mockIsAvailableAsync.mockReturnValue(
    new Promise<boolean>((promiseResolve) => {
      resolve = promiseResolve;
    }),
  );
  await render(
    <I18nProvider>
      <AppleSignInButton onPress={onPress} />
    </I18nProvider>,
  );
  // No button yet, but its space is held: the Google button below must not shift under a tap
  // in flight when the real button mounts a frame later.
  expect(screen.queryByTestId('landing-apple-sign-in')).toBeNull();
  expect(screen.getByTestId('landing-apple-sign-in-placeholder')).toBeTruthy();
  await act(async () => {
    resolve?.(true);
  });
  expect(screen.getByTestId('landing-apple-sign-in')).toBeTruthy();
  expect(screen.queryByTestId('landing-apple-sign-in-placeholder')).toBeNull();
});

it('renders nothing off iOS (no placeholder either)', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  try {
    await renderButton();
    expect(screen.queryByTestId('landing-apple-sign-in')).toBeNull();
    expect(screen.queryByTestId('landing-apple-sign-in-placeholder')).toBeNull();
  } finally {
    if (descriptor) Object.defineProperty(Platform, 'OS', descriptor);
  }
});
