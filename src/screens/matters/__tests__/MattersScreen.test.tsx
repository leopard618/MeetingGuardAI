import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { MattersScreen, matterErrorKey } from '../MattersScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Madrid', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const HASH = 'a'.repeat(64);
const QUESTIONS = {
  matterId: 'm1',
  status: 'draft',
  title: 'Proposal from Carlos',
  readBack: '',
  questions: ['What is the email address of Carlos?'],
  firstEmail: null,
  draftHash: null,
};
const COMPLETE = {
  ...QUESTIONS,
  questions: [],
  readBack: 'I will email Carlos Ruiz (carlos@example.com) from my own address, as your AI assistant.',
  firstEmail: {
    from: '"Ana\'s AI assistant" <assistant@assistant.meetingguard.ai>',
    to: ['carlos@example.com'],
    cc: ['ana@example.com'],
    subject: 'Updated proposal',
    text: 'Hello Carlos, could you send the updated proposal?',
  },
  draftHash: HASH,
};

let mockEnabled = true;
const mockDraft = jest.fn();
const mockRevise = jest.fn();
const mockConfirm = jest.fn();
const mockCancel = jest.fn();
jest.mock('../../../services/matters', () => ({
  matterService: {
    isEnabled: () => mockEnabled,
    draft: (...args: unknown[]): Promise<unknown> => mockDraft(...args) as Promise<unknown>,
    revise: (...args: unknown[]): Promise<unknown> => mockRevise(...args) as Promise<unknown>,
    confirm: (...args: unknown[]): Promise<unknown> => mockConfirm(...args) as Promise<unknown>,
    cancel: (...args: unknown[]): Promise<unknown> => mockCancel(...args) as Promise<unknown>,
  },
}));

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
  mockEnabled = true;
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('MattersScreen', () => {
  it('asks for missing details, then shows the read-back and the exact first email', async () => {
    mockDraft.mockResolvedValueOnce(QUESTIONS);
    mockRevise.mockResolvedValueOnce(COMPLETE);
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Ask Carlos for the proposal by Friday');
    });
    await press('matters-prepare');
    expect(mockDraft).toHaveBeenCalledWith({ text: 'Ask Carlos for the proposal by Friday', source: 'text', language: 'en', timeZone: expect.any(String) });
    expect(screen.getByText('What is the email address of Carlos?')).toBeTruthy();
    expect(screen.queryByTestId('matters-confirm')).toBeNull();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-answer-input'), 'carlos@example.com');

    });
    await press('matters-answer');
    expect(mockRevise).toHaveBeenCalledWith('m1', 'carlos@example.com');
    expect(screen.getByText(COMPLETE.readBack)).toBeTruthy();
    expect(screen.getByText('To: carlos@example.com')).toBeTruthy();
    expect(screen.getByText('Copy: ana@example.com')).toBeTruthy();
    expect(screen.getByText('Subject: Updated proposal')).toBeTruthy();
    expect(screen.getByText(COMPLETE.firstEmail.text)).toBeTruthy();
  });

  it('confirms with the hash it showed and reports the send', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', sent: true });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    expect(mockConfirm).toHaveBeenCalledWith('m1', HASH);
    expect(screen.getByTestId('matters-sent')).toBeTruthy();
  });

  it('offers a retry when the email could not go out yet (the same confirm, never a second email)', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', sent: false }).mockResolvedValueOnce({ matterId: 'm1', status: 'active', sent: true });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    expect(screen.getByTestId('matters-not-sent')).toBeTruthy();
    await press('matters-retry');
    expect(mockConfirm).toHaveBeenNthCalledWith(2, 'm1', HASH);
    expect(screen.getByTestId('matters-sent')).toBeTruthy();
  });

  it('cancels the matter', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockCancel.mockResolvedValueOnce({ matterId: 'm1', status: 'cancelled' });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-cancel');
    expect(mockCancel).toHaveBeenCalledWith('m1');
    expect(screen.getByTestId('matters-cancelled')).toBeTruthy();
  });

  it('shows the server reason as a toast', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockConfirm.mockRejectedValueOnce(new AppError('conflict', 'stale', { details: { reason: 'stale_draft' } }));
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    expect(Toast.show).toHaveBeenCalledWith({ type: 'error', text1: 'The draft changed. Check it again before confirming.' });
  });

  it('says it is unavailable when the build has it off', async () => {
    mockEnabled = false;
    await renderScreen();
    expect(screen.getByTestId('matters-off')).toBeTruthy();
    expect(screen.queryByTestId('matters-request')).toBeNull();
  });

  it('words each server reason', () => {
    expect(matterErrorKey(new AppError('permission_denied', 'x', { details: { reason: 'not_allowed' } }))).toBe('matters:errors.notAllowed');
    expect(matterErrorKey(new AppError('not_configured', 'x'))).toBe('matters:errors.unavailable');
    expect(matterErrorKey(new AppError('offline', 'x'))).toBe('common:errors.offline');
  });
});
