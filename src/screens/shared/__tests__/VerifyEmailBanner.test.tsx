import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import { AppError } from '../../../core/errors';
import type { AuthUser } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import {
  RESEND_COOLDOWN_MS,
  VerifyEmailBanner,
  isVerificationGateError,
  needsEmailVerification,
} from '../VerifyEmailBanner';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    uid: 'u1',
    email: 'ana@example.com',
    displayName: 'Ana',
    photoURL: null,
    emailVerified: false,
    providerIds: ['password'],
    ...overrides,
  };
}

let mockAuthUser: AuthUser | null = null;
let mockCurrentUser: AuthUser | null = null;
const mockResendVerification = jest.fn();
const mockRefreshUser = jest.fn();
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({
    authUser: mockAuthUser,
    resendVerification: mockResendVerification,
    refreshUser: mockRefreshUser,
  }),
  authService: {
    get currentUser() {
      return mockCurrentUser;
    },
  },
}));

async function renderBanner() {
  await render(
    <I18nProvider>
      <VerifyEmailBanner />
    </I18nProvider>,
  );
  await act(async () => undefined);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  mockAuthUser = user();
  mockCurrentUser = user();
  mockResendVerification.mockReset().mockResolvedValue({ success: true });
  mockRefreshUser.mockReset().mockResolvedValue({ success: true });
});

describe('needsEmailVerification', () => {
  it('mirrors the assistant gate: unverified AND no trusted sign-in provider', () => {
    expect(needsEmailVerification(null)).toBe(false);
    expect(needsEmailVerification(user())).toBe(true);
    expect(needsEmailVerification(user({ emailVerified: true }))).toBe(false);
    expect(needsEmailVerification(user({ providerIds: ['google.com'] }))).toBe(false);
    expect(needsEmailVerification(user({ providerIds: ['password', 'google.com'] }))).toBe(false);
  });

  it('trusts apple.com like google.com (section 26: Apple verified the Apple ID)', () => {
    expect(needsEmailVerification(user({ providerIds: ['apple.com'] }))).toBe(false);
    expect(needsEmailVerification(user({ providerIds: ['password', 'apple.com'] }))).toBe(false);
    // An untrusted provider id alone never opens the gate.
    expect(needsEmailVerification(user({ providerIds: ['microsoft.com'] }))).toBe(true);
  });
});

describe('isVerificationGateError', () => {
  it('matches only unauthenticated errors for a user the gate applies to', () => {
    expect(isVerificationGateError(new AppError('unauthenticated'), user())).toBe(true);
    expect(isVerificationGateError(new AppError('quota_exceeded'), user())).toBe(false);
    expect(isVerificationGateError(new AppError('unauthenticated'), user({ providerIds: ['google.com'] }))).toBe(false);
    expect(isVerificationGateError(null, user())).toBe(false);
    expect(isVerificationGateError(new AppError('unauthenticated'), null)).toBe(false);
  });
});

describe('VerifyEmailBanner', () => {
  it('renders nothing for a verified or Google account', async () => {
    mockAuthUser = user({ providerIds: ['google.com'] });
    await renderBanner();
    expect(screen.queryByTestId('verify-email-banner')).toBeNull();
  });

  it('explains the gate and offers resend and check for an unverified email account', async () => {
    await renderBanner();
    expect(screen.getByTestId('verify-email-banner')).toBeTruthy();
    expect(screen.getByText('Verify your email to use the AI assistant.')).toBeTruthy();
    expect(screen.getByTestId('verify-email-resend')).toBeTruthy();
    expect(screen.getByTestId('verify-email-check')).toBeTruthy();
  });

  it('resends the verification email, confirms with a toast and cools down', async () => {
    jest.useFakeTimers();
    try {
      await renderBanner();
      await act(async () => {
        fireEvent.press(screen.getByTestId('verify-email-resend'));
      });
      expect(mockResendVerification).toHaveBeenCalledTimes(1);
      expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Verification email sent. Check your inbox.' });
      expect(screen.getByTestId('verify-email-resend').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
      // A second press during the cooldown sends nothing.
      await act(async () => {
        fireEvent.press(screen.getByTestId('verify-email-resend'));
      });
      expect(mockResendVerification).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(RESEND_COOLDOWN_MS + 1);
      });
      expect(screen.getByTestId('verify-email-resend').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: false }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the localized failure when the resend did not work', async () => {
    mockResendVerification.mockResolvedValue({ success: false, error: 'Too many attempts. Wait a moment and try again.' });
    await renderBanner();
    await act(async () => {
      fireEvent.press(screen.getByTestId('verify-email-resend'));
    });
    expect(screen.getByTestId('verify-email-note')).toBeTruthy();
    expect(screen.getByText('Too many attempts. Wait a moment and try again.')).toBeTruthy();
  });

  it('says so when "I verified" finds the email still unverified', async () => {
    await renderBanner();
    await act(async () => {
      fireEvent.press(screen.getByTestId('verify-email-check'));
    });
    expect(mockRefreshUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Your email is still not verified. Open the link in the email we sent you.')).toBeTruthy();
  });

  it('stays quiet when the check finds the email verified (the banner disappears via the session)', async () => {
    mockCurrentUser = user({ emailVerified: true });
    await renderBanner();
    await act(async () => {
      fireEvent.press(screen.getByTestId('verify-email-check'));
    });
    expect(screen.queryByTestId('verify-email-note')).toBeNull();
  });
});
