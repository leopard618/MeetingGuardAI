import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { WhatsAppLinkStatus } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { WhatsAppConnectScreen } from '../WhatsAppConnectScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

// A fixed clock: the countdown is pure math over mockNow (model-tested), no ticking here.
let mockNow = new Date('2026-10-02T10:00:00.000Z');
jest.mock('../../shared/useLiveNow', () => ({ useLiveNow: () => mockNow }));

let mockStatus: WhatsAppLinkStatus | null = null;
let mockError: AppError | null = null;
const mockRefresh = jest.fn(async () => undefined);
const mockStartLink = jest.fn();
const mockUnlink = jest.fn();
jest.mock('../../../services/whatsapp', () => ({
  useWhatsAppStatus: () => ({ status: mockStatus, error: mockError, refresh: mockRefresh }),
  whatsappService: {
    startLink: (): Promise<unknown> => mockStartLink() as Promise<unknown>,
    unlink: (): Promise<void> => mockUnlink() as Promise<void>,
  },
}));

const mockCopyText: jest.Mock<boolean, [string]> = jest.fn((_text: string) => true);
jest.mock('../whatsappConnectModel', () => ({
  ...jest.requireActual<object>('../whatsappConnectModel'),
  copyText: (text: string): boolean => mockCopyText(text) as boolean,
}));

const ENABLED: WhatsAppLinkStatus = {
  enabled: true,
  linked: false,
  displayNumber: '15550253483',
  deepLink: 'https://wa.me/15550253483',
  linkedLast4: null,
};

async function renderScreen() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <WhatsAppConnectScreen />
      </PaperProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  mockStatus = ENABLED;
  mockError = null;
  mockNow = new Date('2026-10-02T10:00:00.000Z');
  mockRefresh.mockClear();
  mockStartLink.mockReset();
  mockUnlink.mockReset();
  mockCopyText.mockClear();
  (Toast.show as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('shows a loader while the status is unknown and an error state with retry on failure', async () => {
  mockStatus = null;
  await renderScreen();
  expect(screen.getByTestId('whatsapp-loading')).toBeTruthy();

  mockError = new AppError('offline');
  await renderScreen();
  expect(screen.getByTestId('whatsapp-error')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText('Try again'));
  });
  expect(mockRefresh).toHaveBeenCalled();
});

it('explains that the bot is not available yet while the server integration is off', async () => {
  mockStatus = { enabled: false, linked: false, displayNumber: null, deepLink: null, linkedLast4: null };
  await renderScreen();
  expect(screen.getByTestId('whatsapp-unavailable')).toBeTruthy();
  expect(screen.queryByTestId('whatsapp-generate')).toBeNull();
});

it('generates a code, counts it down, copies it and opens WhatsApp with the code prefilled', async () => {
  mockStartLink.mockResolvedValue({ code: '004217', expiresAtIso: '2026-10-02T10:09:07.000Z' });
  await renderScreen();

  await act(async () => {
    fireEvent.press(screen.getByTestId('whatsapp-generate'));
  });
  expect(screen.getByTestId('whatsapp-code').props.children).toBe('004217');
  expect(screen.getByTestId('whatsapp-countdown').props.children).toContain('9:07');
  // The destination number is shown with the code (WhatsApp may live on another device).
  expect(screen.getByTestId('whatsapp-send-to').props.children).toContain('+15550253483');

  await act(async () => {
    fireEvent.press(screen.getByTestId('whatsapp-copy'));
  });
  expect(mockCopyText).toHaveBeenCalledWith('004217');
  expect(screen.getByText('Code copied')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('whatsapp-open'));
  });
  expect(Linking.openURL).toHaveBeenCalledWith('https://wa.me/15550253483?text=004217');
});

it('marks an expired code and offers to generate a new one', async () => {
  mockStartLink.mockResolvedValue({ code: '004217', expiresAtIso: '2026-10-02T09:59:00.000Z' });
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('whatsapp-generate'));
  });
  expect(screen.getByTestId('whatsapp-code-expired')).toBeTruthy();
  expect(screen.queryByTestId('whatsapp-copy')).toBeNull();
  expect(screen.getByTestId('whatsapp-generate')).toBeTruthy();
});

it('explains a rate-limited code request', async () => {
  mockStartLink.mockRejectedValue(new AppError('quota_exceeded', 'x', { details: { reason: 'rate_limited' } }));
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('whatsapp-generate'));
  });
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', text1: 'You have requested too many codes today. Try again tomorrow.' }),
  );
  expect(screen.queryByTestId('whatsapp-code')).toBeNull();
});

it('shows the linked state and unlinks after the confirmation', async () => {
  mockStatus = { ...ENABLED, linked: true, linkedLast4: '4567' };
  mockUnlink.mockResolvedValue(undefined);
  await renderScreen();

  expect(screen.getByTestId('whatsapp-linked-number').props.children).toContain('+15550253483');
  // Owner visibility of WHICH phone is bound (masked).
  expect(screen.getByTestId('whatsapp-linked-own-number').props.children).toContain('4567');
  await act(async () => {
    fireEvent.press(screen.getByTestId('whatsapp-open'));
  });
  expect(Linking.openURL).toHaveBeenCalledWith('https://wa.me/15550253483');

  await act(async () => {
    fireEvent.press(screen.getByTestId('whatsapp-unlink'));
  });
  expect(mockUnlink).not.toHaveBeenCalled();
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1]?.[2] as { style?: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.style === 'destructive')?.onPress?.();
  });
  expect(mockUnlink).toHaveBeenCalledTimes(1);
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'WhatsApp unlinked.' }));
});

it('is translated to Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderScreen();
  expect(screen.getByText('Generar código')).toBeTruthy();
});
