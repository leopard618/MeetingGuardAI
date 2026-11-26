/**
 * A4 part 2, "Watch this thread" on the matters screen: the forwarded emails waiting, how to
 * forward one, a draft from one (their email shown above it), removing one (asks first). And the
 * service calls.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { CALLABLES } from '../../../core/aiContract';
import { I18nProvider, i18n } from '../../../i18n';
import { createMatterService, type MatterTransport } from '../../../services/matters/matterService';
import { MattersScreen } from '../MattersScreen';

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
  mailboxStatus: jest.fn(),
  watchList: jest.fn(),
  watchDraft: jest.fn(),
  watchDismiss: jest.fn(),
};
jest.mock('../../../services/matters', () => ({
  matterService: new Proxy(
    { isEnabled: () => true },
    { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : (...args: unknown[]): unknown => (mockService as Record<string, jest.Mock>)[key]!(...args)) },
  ),
  openMailboxSignIn: jest.fn(),
}));

const ADDRESS = 'ana.lopez@outlook.com';
const ASSISTANT = 'assistant@assistant.meetingguard.ai';
const WATCH_ID = 'a'.repeat(40);
const ITEM = {
  watchId: WATCH_ID,
  fromName: 'Carlos Ruiz',
  fromEmail: 'carlos@example.com',
  subject: 'Proposal for Q1',
  preview: 'Hi Ana, Here is the proposal for Q1.',
  receivedAt: '2026-11-25T10:00:00.000Z',
};
const WAITING = { available: true, address: ASSISTANT, items: [ITEM] };
const DRAFT = {
  matterId: 'm1',
  status: 'draft' as const,
  title: 'Proposal for Q1',
  readBack: `I will email Carlos Ruiz (carlos@example.com) from your mailbox ${ADDRESS}, as your AI assistant.`,
  questions: [],
  firstEmail: { from: ADDRESS, to: ['carlos@example.com'], cc: [], subject: 'Re: Proposal for Q1', text: 'Hello Carlos,\n\nThank you for the proposal.\n\nBest,' },
  draftHash: 'a'.repeat(64),
  sendFrom: 'mailbox' as const,
  forwarded: { fromName: 'Carlos Ruiz', fromEmail: 'carlos@example.com', subject: 'Proposal for Q1', text: 'Hi Ana,\n\nHere is the proposal for Q1.' },
};

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
  mockService.mailboxStatus.mockResolvedValue({ available: true, connected: true, address: ADDRESS });
  mockService.watchList.mockResolvedValue(WAITING);
  await i18n.changeLanguage('en');
});

describe('Watch a thread', () => {
  it('says where to forward and lists the emails waiting', async () => {
    await renderScreen();
    expect(screen.getByText('Watch a thread')).toBeTruthy();
    expect(
      screen.getByText(`Forward an email from your Outlook to ${ASSISTANT} and it shows here. Tap it and the assistant drafts a reply for you to check. Nothing is sent until you confirm.`),
    ).toBeTruthy();
    expect(screen.getByText('Carlos Ruiz: Proposal for Q1')).toBeTruthy();
    expect(screen.getByText(ITEM.preview)).toBeTruthy();
  });

  it('tapping one drafts the reply, with their email above it; nothing is sent yet', async () => {
    mockService.watchDraft.mockResolvedValue({ available: true, address: ASSISTANT, items: [], draft: DRAFT });
    await renderScreen();
    await press(`matters-watch-${WATCH_ID}`);
    expect(mockService.watchDraft).toHaveBeenCalledWith(WATCH_ID, 'en', 'Europe/Madrid');
    expect(screen.getByText('Their email')).toBeTruthy();
    expect(screen.getByText('From: Carlos Ruiz <carlos@example.com>')).toBeTruthy();
    expect(screen.getByText('Hi Ana,\n\nHere is the proposal for Q1.')).toBeTruthy();
    expect(screen.getByText('Subject: Re: Proposal for Q1')).toBeTruthy();
    expect(screen.getByTestId('matters-confirm')).toBeTruthy();
  });

  it('a forward whose draft waits says so and opens that draft again', async () => {
    mockService.watchList.mockResolvedValue({ ...WAITING, items: [{ ...ITEM, drafted: true }] });
    mockService.watchDraft.mockResolvedValue({ ...WAITING, items: [{ ...ITEM, drafted: true }], draft: DRAFT });
    await renderScreen();
    expect(screen.getByText('Draft ready. Tap to review it.')).toBeTruthy();
    await press(`matters-watch-${WATCH_ID}`);
    expect(mockService.watchDraft).toHaveBeenCalledWith(WATCH_ID, 'en', 'Europe/Madrid');
    expect(screen.getByText('Their email')).toBeTruthy();
  });

  it('removing one asks first', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockService.watchDismiss.mockResolvedValue({ available: true, address: ASSISTANT, items: [] });
    await renderScreen();
    await press(`matters-watch-dismiss-${WATCH_ID}`);
    expect(alert).toHaveBeenCalledWith('Remove this email?', 'The assistant will not answer it. Nothing is sent.', expect.any(Array));
    expect(mockService.watchDismiss).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['Keep it', 'cancel'],
      ['Remove', 'destructive'],
    ]);
    await act(async () => {
      buttons[1]!.onPress!();
    });
    expect(mockService.watchDismiss).toHaveBeenCalledWith(WATCH_ID);
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Email removed.' });
    expect(screen.queryByTestId(`matters-watch-${WATCH_ID}`)).toBeNull();
    alert.mockRestore();
  });

  it('hidden when not offered and nothing waits; without a mailbox the waiting ones cannot be opened', async () => {
    mockService.watchList.mockResolvedValue({ available: false, address: null, items: [] });
    await renderScreen();
    expect(screen.queryByTestId('matters-watch')).toBeNull();

    mockService.watchList.mockResolvedValue({ available: false, address: null, items: [ITEM] });
    await renderScreen();
    expect(screen.getByText('Connect your mailbox to answer these emails.')).toBeTruthy();
    await press(`matters-watch-${WATCH_ID}`);
    expect(mockService.watchDraft).not.toHaveBeenCalled();
  });

  it('in Spanish', async () => {
    await i18n.changeLanguage('es');
    await renderScreen();
    expect(screen.getByText('Seguir una conversación')).toBeTruthy();
  });
});

describe('matterService ("Watch this thread")', () => {
  it('every watch action goes to matterWatch and is validated', async () => {
    const calls: { name: string; request: unknown }[] = [];
    const transport: MatterTransport = {
      async call(name, request) {
        calls.push({ name, request });
        return WAITING;
      },
    };
    const service = createMatterService({ getTransport: () => transport, enabled: () => true });
    await expect(service.watchList()).resolves.toEqual(WAITING);
    await service.watchDraft(WATCH_ID, 'es', 'Europe/Madrid');
    await service.watchDismiss(WATCH_ID);
    expect(calls).toEqual([
      { name: CALLABLES.matterWatch, request: { action: 'list' } },
      { name: CALLABLES.matterWatch, request: { action: 'draft', watchId: WATCH_ID, language: 'es', timeZone: 'Europe/Madrid' } },
      { name: CALLABLES.matterWatch, request: { action: 'dismiss', watchId: WATCH_ID } },
    ]);
    await expect(service.watchDismiss('not an id')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
