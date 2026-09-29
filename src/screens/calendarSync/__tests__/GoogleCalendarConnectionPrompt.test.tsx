import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { CalendarStatus } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { GoogleCalendarConnectionPrompt } from '../GoogleCalendarConnectionPrompt';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

let mockConnected = false;
const mockConnect = jest.fn();
const mockIsConnected = jest.fn(async () => mockConnected);
function mockStatus(): CalendarStatus {
  return {
    google: { enabled: mockConnected, syncing: false, lastSyncAt: null, lastError: null, connected: mockConnected, hasScope: mockConnected },
    device: { enabled: false, syncing: false, lastSyncAt: null, lastError: null, permission: 'granted', importCalendarIds: [], exportCalendarId: null },
  };
}
jest.mock('../../../services/calendar', () => ({
  useCalendarStatus: () => mockStatus(),
  googleCalendarService: {
    connect: (...args: unknown[]) => mockConnect(...args),
    isConnected: () => mockIsConnected(),
  },
  calendarSyncEngine: { getStatus: () => mockStatus() },
}));

async function renderPrompt(props: { onClose?: () => void; onSuccess?: () => void; userEmail?: string | null } = {}) {
  return render(
    <I18nProvider>
      <GoogleCalendarConnectionPrompt visible {...props} />
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  mockConnected = false;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('explains the benefits and connects; onSuccess runs after the user acknowledges the result', async () => {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  const result = { status: 'connected', initialSync: null };
  mockConnect.mockResolvedValue(result);
  await renderPrompt({ onClose, onSuccess, userEmail: 'ana@example.com' });

  expect(mockIsConnected).toHaveBeenCalled();
  expect(screen.getByText('ana@example.com')).toBeTruthy();
  expect(screen.getByText('Get MeetingGuard alerts for your Google Calendar events')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('google-connect-submit'));
  });
  expect(Alert.alert).toHaveBeenCalledWith(
    'Google Calendar connected',
    expect.stringContaining('the first sync did not finish'),
    expect.any(Array),
  );
  const buttons = (Alert.alert as jest.Mock).mock.calls[0]?.[2] as { onPress?: () => void }[];
  buttons[0]?.onPress?.();
  expect(onSuccess).toHaveBeenCalledWith(result);
  expect(onClose).toHaveBeenCalled();
});

it('says when Google Calendar is already connected and only offers Close', async () => {
  mockConnected = true;
  const onClose = jest.fn();
  await renderPrompt({ onClose });
  expect(screen.getByText('Google Calendar is connected.')).toBeTruthy();
  expect(screen.queryByTestId('google-connect-submit')).toBeNull();
  await fireEvent.press(screen.getByText('Close'));
  expect(onClose).toHaveBeenCalled();
});

it('reports a refused permission and real errors, not a cancelled sign-in', async () => {
  const onSuccess = jest.fn();
  mockConnect.mockResolvedValueOnce({ status: 'scope_denied', initialSync: null });
  await renderPrompt({ onSuccess });
  await act(async () => {
    fireEvent.press(screen.getByTestId('google-connect-submit'));
  });
  expect(Alert.alert).toHaveBeenLastCalledWith('Google Calendar', 'Calendar access was not granted. You can connect again at any time.', undefined);

  mockConnect.mockRejectedValueOnce(new AppError('google_not_signed_in'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('google-connect-submit'));
  });
  expect(Alert.alert).toHaveBeenLastCalledWith('Something went wrong', expect.any(String));

  (Alert.alert as jest.Mock).mockClear();
  mockConnect.mockResolvedValueOnce({ status: 'cancelled', initialSync: null });
  await act(async () => {
    fireEvent.press(screen.getByTestId('google-connect-submit'));
  });
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
});

it('can be dismissed with "Not now"', async () => {
  const onClose = jest.fn();
  await renderPrompt({ onClose });
  await fireEvent.press(screen.getByTestId('google-connect-close'));
  expect(onClose).toHaveBeenCalled();
});
