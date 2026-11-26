/**
 * A4 part 2: the owner's Microsoft mailbox on the matters screen. "Connect your mailbox" opens the
 * server's sign-in in the browser and asks for the status when it comes back; "Disconnect" asks
 * first; a draft shows "Send from my mailbox" while one is connected. And the service calls.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { CALLABLES, DEFAULT_MATTER_PREFS, MATTER_CONSENT_VERSION } from '../../../core/aiContract';
import { I18nProvider, i18n } from '../../../i18n';
import { createMatterService, type MatterTransport } from '../../../services/matters/matterService';
import { MattersScreen } from '../MattersScreen';
import { timelineKey } from '../matterFormat';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Madrid', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));
jest.mock('../../assistant/useVoice', () => ({ useVoiceInput: () => ({ status: 'idle', toggle: jest.fn() }) }));

const mockService = {
  listOpen: jest.fn(),
  usage: jest.fn(),
  draft: jest.fn(),
  mailboxStatus: jest.fn(),
  mailboxConnectLink: jest.fn(),
  mailboxDisconnect: jest.fn(),
  sendFrom: jest.fn(),
  settings: jest.fn(),
  digest: jest.fn(),
};
const mockOpenSignIn = jest.fn();
jest.mock('../../../services/matters', () => ({
  matterService: new Proxy(
    { isEnabled: () => true },
    { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : (...args: unknown[]): unknown => (mockService as Record<string, jest.Mock>)[key]!(...args)) },
  ),
  openMailboxSignIn: (...args: unknown[]): unknown => mockOpenSignIn(...args),
}));

const ADDRESS = 'ana.lopez@outlook.com';
const OFF = { available: true, connected: false, address: null };
const ON = { available: true, connected: true, address: ADDRESS };
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=x';
/** A5: the mailbox lives on the assistant's settings page. */
const SETTINGS = { prefs: DEFAULT_MATTER_PREFS, consent: { version: MATTER_CONSENT_VERSION, at: '2026-11-25T10:00:00.000Z' }, consentVersion: MATTER_CONSENT_VERSION, address: 'assistant@assistant.meetingguard.ai' };

function draft(sendFrom: 'assistant' | 'mailbox') {
  return {
    matterId: 'm1',
    status: 'draft',
    title: 'Proposal from Carlos',
    readBack: sendFrom === 'mailbox' ? `I will email Carlos Ruiz (carlos@example.com) from your mailbox ${ADDRESS}, as your AI assistant.` : 'I will email Carlos Ruiz (carlos@example.com) from my own address, as your AI assistant.',
    questions: [],
    firstEmail: {
      from: sendFrom === 'mailbox' ? ADDRESS : '"AI assistant for Ana Lopez" <assistant@assistant.meetingguard.ai>',
      to: ['carlos@example.com'],
      cc: [],
      subject: 'Updated proposal',
      text: 'Hello Carlos,\n\nCould you send the updated proposal?\n\nBest,',
    },
    draftHash: (sendFrom === 'mailbox' ? 'a' : 'b').repeat(64),
    sendFrom,
  };
}

async function renderScreen(): Promise<void> {
  await render(
    <I18nProvider>
      <PaperProvider>
        <MattersScreen />
      </PaperProvider>
    </I18nProvider>,
  );
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockService.listOpen.mockResolvedValue([]);
  mockService.usage.mockResolvedValue(null);
  mockService.mailboxStatus.mockResolvedValue(OFF);
  mockService.settings.mockResolvedValue(SETTINGS);
  mockService.digest.mockResolvedValue(null);
  await i18n.changeLanguage('en');
});

/** A5: Settings > the mailbox. */
async function openSettings(): Promise<void> {
  await press('matters-settings-open');
}

describe('Connect your mailbox', () => {
  it('hidden when the server does not offer it, or the status cannot be read', async () => {
    mockService.mailboxStatus.mockResolvedValue({ available: false, connected: false, address: null });
    await renderScreen();
    await openSettings();
    expect(screen.queryByTestId('matters-mailbox-connect')).toBeNull();
    mockService.mailboxStatus.mockRejectedValue(new Error('offline'));
    await renderScreen();
    await openSettings();
    expect(screen.queryByTestId('matters-mailbox-connect')).toBeNull();
  });

  it('opens the sign-in, then shows the connected address from the server', async () => {
    mockService.mailboxConnectLink.mockResolvedValue({ ...OFF, authUrl: AUTH_URL });
    mockOpenSignIn.mockResolvedValue(undefined);
    await renderScreen();
    await openSettings();
    expect(screen.getByText('The assistant can send its emails from your Outlook address. It never reads your mailbox.')).toBeTruthy();
    mockService.mailboxStatus.mockResolvedValue(ON);
    await press('matters-mailbox-connect');
    expect(mockService.mailboxConnectLink).toHaveBeenCalledWith('en');
    expect(mockOpenSignIn).toHaveBeenCalledWith(AUTH_URL);
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Mailbox connected.' });
    expect(screen.getByText(`Connected: ${ADDRESS}`)).toBeTruthy();
  });

  it('a sign-in that did not finish says so and keeps "Connect"', async () => {
    mockService.mailboxConnectLink.mockResolvedValue({ ...OFF, authUrl: AUTH_URL });
    mockOpenSignIn.mockResolvedValue(undefined);
    await renderScreen();
    await openSettings();
    await press('matters-mailbox-connect');
    expect(Toast.show).toHaveBeenCalledWith({ type: 'info', text1: 'The mailbox was not connected.' });
    expect(screen.getByTestId('matters-mailbox-connect')).toBeTruthy();
  });

  it('"Disconnect" asks first, then removes the access', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockService.mailboxStatus.mockResolvedValue(ON);
    mockService.mailboxDisconnect.mockResolvedValue(OFF);
    await renderScreen();
    await openSettings();
    await press('matters-mailbox-disconnect');
    expect(alert).toHaveBeenCalledWith(
      'Disconnect your mailbox?',
      'The assistant stops sending from it at once. Matters that send from it will not send until you connect it again.',
      expect.any(Array),
    );
    const buttons = alert.mock.calls[0]![2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['Keep it', 'cancel'],
      ['Disconnect', 'destructive'],
    ]);
    expect(mockService.mailboxDisconnect).not.toHaveBeenCalled();
    await act(async () => {
      buttons[1]!.onPress!();
    });
    expect(mockService.mailboxDisconnect).toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Mailbox disconnected.' });
    expect(screen.getByTestId('matters-mailbox-connect')).toBeTruthy();
    alert.mockRestore();
  });

  it('in Spanish', async () => {
    await i18n.changeLanguage('es');
    await renderScreen();
    await openSettings();
    expect(screen.getByText('Conectar tu buzón')).toBeTruthy();
  });
});

describe('Send from my mailbox', () => {
  it('a draft shows where it sends from; switching redrafts it', async () => {
    mockService.mailboxStatus.mockResolvedValue(ON);
    mockService.draft.mockResolvedValue(draft('mailbox'));
    mockService.sendFrom.mockResolvedValue({ ...ON, draft: draft('assistant') });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Ask Carlos for the proposal');
    });
    await press('matters-prepare');
    expect(screen.getByText(`From: ${ADDRESS}`)).toBeTruthy();
    expect(screen.getByTestId('matters-send-from').props.value).toBe(true);
    await act(async () => {
      fireEvent(screen.getByTestId('matters-send-from'), 'valueChange', false);
    });
    expect(mockService.sendFrom).toHaveBeenCalledWith('m1', false);
    expect(screen.getByText("Off: it sends from the assistant's own address.")).toBeTruthy();
  });

  it('no switch without a connected mailbox', async () => {
    mockService.draft.mockResolvedValue(draft('assistant'));
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Ask Carlos for the proposal');
    });
    await press('matters-prepare');
    expect(screen.queryByTestId('matters-send-from-row')).toBeNull();
  });
});

describe('the timeline', () => {
  it('a send refused because the mailbox is not connected says so', async () => {
    expect(timelineKey({ type: 'email_failed', at: '2026-11-25T10:00:00.000Z', detail: 'mailbox' })).toBe('matters:timeline.type.email_failed_mailbox');
    expect(timelineKey({ type: 'email_failed', at: '2026-11-25T10:00:00.000Z', detail: 'rejected' })).toBe('matters:timeline.type.email_failed');
    expect(i18n.t('matters:timeline.type.email_failed_mailbox')).toBe('An email could not be sent: your mailbox is not connected. Connect it again on the assistant screen.');
  });
});

describe('matterService (A4 part 2)', () => {
  it('every mailbox action goes to matterMailbox and is validated', async () => {
    const calls: { name: string; request: unknown }[] = [];
    const transport: MatterTransport = {
      async call(name, request) {
        calls.push({ name, request });
        return (request as { action: string }).action === 'connect' ? { ...OFF, authUrl: AUTH_URL } : ON;
      },
    };
    const service = createMatterService({ getTransport: () => transport, enabled: () => true });
    await expect(service.mailboxStatus()).resolves.toEqual(ON);
    await expect(service.mailboxConnectLink('es')).resolves.toMatchObject({ authUrl: AUTH_URL });
    await service.mailboxDisconnect();
    await service.sendFrom('m1', true);
    expect(calls).toEqual([
      { name: CALLABLES.matterMailbox, request: { action: 'status' } },
      { name: CALLABLES.matterMailbox, request: { action: 'connect', language: 'es' } },
      { name: CALLABLES.matterMailbox, request: { action: 'disconnect' } },
      { name: CALLABLES.matterMailbox, request: { action: 'sendFrom', matterId: 'm1', mailbox: true } },
    ]);
    await expect(service.sendFrom('bad id!', true)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
