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
const mockDecide = jest.fn();
const mockListOpen = jest.fn();
const mockGetPage = jest.fn();
jest.mock('../../../services/matters', () => ({
  matterService: {
    isEnabled: () => mockEnabled,
    draft: (...args: unknown[]): Promise<unknown> => mockDraft(...args) as Promise<unknown>,
    revise: (...args: unknown[]): Promise<unknown> => mockRevise(...args) as Promise<unknown>,
    confirm: (...args: unknown[]): Promise<unknown> => mockConfirm(...args) as Promise<unknown>,
    cancel: (...args: unknown[]): Promise<unknown> => mockCancel(...args) as Promise<unknown>,
    decide: (...args: unknown[]): Promise<unknown> => mockDecide(...args) as Promise<unknown>,
    listOpen: (...args: unknown[]): Promise<unknown> => mockListOpen(...args) as Promise<unknown>,
    getPage: (...args: unknown[]): Promise<unknown> => mockGetPage(...args) as Promise<unknown>,
  },
}));

const DRAFT_HASH = 'c'.repeat(64);
const PAGE = {
  matter: { matterId: 'm1', status: 'active', title: 'Proposal from Carlos', updatedAt: '2026-11-12T10:00:00.000Z', pendingApprovals: 2 },
  approvals: [
    {
      id: 'c1',
      kind: 'reply_draft',
      status: 'pending',
      reason: 'auto_reply_off',
      quote: null,
      from: 'Carlos Ruiz <carlos@example.com>',
      draft: { to: ['carlos@example.com'], cc: ['ana@example.com'], subject: 'Re: Updated proposal', text: 'Hello Carlos,\n\nThank you, received.\n\nBest,\nAI assistant for Ana' },
      draftHash: DRAFT_HASH,
      guardFlags: ['money'],
      sendOutcome: null,
      auto: false,
      createdAt: '2026-11-12T10:00:00.000Z',
    },
    {
      id: 'c2',
      kind: 'goal_reached',
      status: 'pending',
      reason: null,
      quote: 'Here is the final version.',
      from: 'Carlos Ruiz <carlos@example.com>',
      draft: null,
      draftHash: null,
      guardFlags: [],
      sendOutcome: null,
      auto: false,
      createdAt: '2026-11-12T09:00:00.000Z',
    },
  ],
  proposals: [
    {
      id: 'mt_' + 'a'.repeat(24),
      quote: 'I will send it tomorrow.',
      title: 'Carlos Ruiz: Send the updated proposal',
      owner: { name: 'Carlos Ruiz', isUser: false, guess: false },
      due: { date: '2026-11-13', time: null, zone: null, quote: 'tomorrow', overdue: false },
      status: 'open',
      taskId: null,
      createdAt: '2026-11-12T10:00:00.000Z',
    },
  ],
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
  mockEnabled = true;
  jest.clearAllMocks();
  mockListOpen.mockResolvedValue([]);
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
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'sent' });
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
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'failed' }).mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'sent' });
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

  it('offers no retry when it is unknown whether the email went out (it may have, so never twice)', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'unknown' });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    expect(screen.getByTestId('matters-unknown')).toBeTruthy();
    expect(screen.getByText(/Your copy shows whether it arrived/)).toBeTruthy();
    expect(screen.queryByTestId('matters-retry')).toBeNull();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not mention a copy in the unknown message when the owner is not in copy', async () => {
    mockDraft.mockResolvedValueOnce({ ...COMPLETE, firstEmail: { ...COMPLETE.firstEmail, cc: [] } });
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'unknown' });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    expect(screen.getByText('We could not confirm that the email went out. It may have been sent, so it will not be sent again.')).toBeTruthy();
    expect(screen.queryByText(/Your copy/)).toBeNull();
  });

  it('leaves out the copy sentence after a 406: the copy arrives, the contact\'s email does not', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'unknown', unknownCause: 'inactive_recipient' });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    expect(screen.getByText('We could not confirm that the email went out. It may have been sent, so it will not be sent again.')).toBeTruthy();
    expect(screen.queryByText(/Your copy/)).toBeNull();
    expect(screen.queryByTestId('matters-retry')).toBeNull();
  });

  it('says another request is sending it, and checks again with the same confirm', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'sending' }).mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'sent' });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    expect(screen.getByTestId('matters-sending')).toBeTruthy();
    await press('matters-check-again');
    expect(mockConfirm).toHaveBeenNthCalledWith(2, 'm1', HASH);
    expect(screen.getByTestId('matters-sent')).toBeTruthy();
  });

  it('can still cancel the matter after the first email went out', async () => {
    mockDraft.mockResolvedValueOnce(COMPLETE);
    mockConfirm.mockResolvedValueOnce({ matterId: 'm1', status: 'active', outcome: 'sent' });
    mockCancel.mockResolvedValueOnce({ matterId: 'm1', status: 'cancelled' });
    await renderScreen();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('matters-request'), 'Contact Carlos');
    });
    await press('matters-prepare');
    await press('matters-confirm');
    await press('matters-cancel');
    expect(mockCancel).toHaveBeenCalledWith('m1');
    expect(screen.getByTestId('matters-cancelled')).toBeTruthy();
    expect(screen.queryByTestId('matters-cancel')).toBeNull();
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

  it('A2: lists the open matters with what waits for the owner, and opens one', async () => {
    mockListOpen.mockResolvedValue([PAGE.matter]);
    mockGetPage.mockResolvedValue(PAGE);
    await renderScreen();
    expect(screen.getByTestId('matters-open-list')).toBeTruthy();
    expect(screen.getByText('2 things waiting for you')).toBeTruthy();
    await press('matters-open-m1');
    expect(mockGetPage).toHaveBeenCalledWith('m1');
    expect(screen.getByText('Reply ready to send')).toBeTruthy();
    expect(screen.getByText('Replies go out only after you approve them.')).toBeTruthy();
    // the whole draft, exactly as it would be sent, and what the guard found in it
    expect(screen.getByText(PAGE.approvals[0]!.draft!.text)).toBeTruthy();
    expect(screen.getByText('To: carlos@example.com')).toBeTruthy();
    expect(screen.getByText('Check before sending, it mentions: money or prices')).toBeTruthy();
    expect(screen.getByText('They wrote: "Here is the final version."')).toBeTruthy();
    expect(screen.getByText('Carlos Ruiz: Send the updated proposal')).toBeTruthy();
    expect(screen.getByText('Due: 2026-11-13')).toBeTruthy();
  });

  it('A2: approves a reply with the hash it showed, and adds a commitment with the device zone', async () => {
    mockListOpen.mockResolvedValue([PAGE.matter]);
    mockGetPage.mockResolvedValue(PAGE);
    mockDecide
      .mockResolvedValueOnce({ matterId: 'm1', id: 'c1', status: 'approved', outcome: 'sent', taskId: null, matterStatus: 'active' })
      .mockResolvedValueOnce({ matterId: 'm1', id: PAGE.proposals[0]!.id, status: 'accepted', outcome: null, taskId: PAGE.proposals[0]!.id, matterStatus: 'active' });
    await renderScreen();
    await press('matters-open-m1');
    await press('matters-card-approve-c1');
    expect(mockDecide).toHaveBeenNthCalledWith(1, { matterId: 'm1', target: 'approval', id: 'c1', action: 'approve', draftHash: DRAFT_HASH });
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Reply sent.' });
    await press(`matters-proposal-accept-${PAGE.proposals[0]!.id}`);
    expect(mockDecide).toHaveBeenNthCalledWith(2, { matterId: 'm1', target: 'proposal', id: PAGE.proposals[0]!.id, action: 'accept', timeZone: expect.any(String) });
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Added to your tasks.' });
    expect(mockGetPage).toHaveBeenCalledTimes(3); // reloaded after each decision
  });

  it('A2: declines a card without a hash, and goes back to the list', async () => {
    mockListOpen.mockResolvedValue([PAGE.matter]);
    mockGetPage.mockResolvedValue(PAGE);
    mockDecide.mockResolvedValueOnce({ matterId: 'm1', id: 'c2', status: 'declined', outcome: null, taskId: null, matterStatus: 'active' });
    await renderScreen();
    await press('matters-open-m1');
    await press('matters-card-decline-c2');
    expect(mockDecide).toHaveBeenCalledWith({ matterId: 'm1', target: 'approval', id: 'c2', action: 'decline' });
    await press('matters-back');
    expect(screen.getByTestId('matters-open-list')).toBeTruthy();
  });

  it('A2: a page that cannot be loaded says so and offers to try again (never "no longer available")', async () => {
    mockListOpen.mockResolvedValue([PAGE.matter]);
    mockGetPage.mockRejectedValueOnce(new AppError('permission_denied', 'denied')).mockResolvedValueOnce(PAGE);
    await renderScreen();
    await press('matters-open-m1');
    expect(screen.getByTestId('matters-page-error')).toBeTruthy();
    expect(screen.queryByTestId('matters-page-missing')).toBeNull();
    await press('matters-page-retry');
    expect(screen.getByText('Reply ready to send')).toBeTruthy();
  });

  it('words each server reason', () => {
    expect(matterErrorKey(new AppError('permission_denied', 'x', { details: { reason: 'not_allowed' } }))).toBe('matters:errors.notAllowed');
    expect(matterErrorKey(new AppError('not_configured', 'x'))).toBe('matters:errors.unavailable');
    expect(matterErrorKey(new AppError('offline', 'x'))).toBe('common:errors.offline');
  });
});
