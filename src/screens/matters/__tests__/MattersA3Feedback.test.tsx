/**
 * A3 feedback (the client's test of A3): "Move the meeting" and "Write to them" on the matter page, the
 * email cards they make, move and message from "Ask or change something", "Let them know?" after a
 * change, and the microphone staying off while the assistant speaks.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { I18nProvider, i18n } from '../../../i18n';
import { MattersScreen } from '../MattersScreen';
import { useMatterVoice } from '../useMatterVoice';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Madrid', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

const mockVoice = { status: 'idle' as 'idle' | 'listening', toggle: jest.fn() };
jest.mock('../../assistant/useVoice', () => ({
  useVoiceInput: () => ({ status: mockVoice.status, toggle: () => mockVoice.toggle() }),
}));

const mockService = {
  draft: jest.fn(),
  decide: jest.fn(),
  listOpen: jest.fn(),
  getPage: jest.fn(),
  setStatus: jest.fn(),
  cancel: jest.fn(),
  change: jest.fn(),
  confirmChange: jest.fn(),
  ask: jest.fn(),
  speak: jest.fn(),
  message: jest.fn(),
  readNewTime: jest.fn(),
  moveMeeting: jest.fn(),
};
jest.mock('../../../services/matters', () => ({
  matterService: new Proxy(
    { isEnabled: () => true },
    { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : (...args: unknown[]): unknown => (mockService as Record<string, jest.Mock>)[key]!(...args)) },
  ),
}));

const HASH = 'b'.repeat(64);
const MEETING = { start: '2026-11-13T08:00:00.000Z', end: '2026-11-13T08:30:00.000Z' };
const NEW_SLOT = { start: '2026-11-13T15:00:00.000Z', end: '2026-11-13T15:30:00.000Z' };
const ITEM = { matterId: 'm1', status: 'active', title: 'Proposal from Carlos', updatedAt: '2026-11-12T10:00:00.000Z', pendingApprovals: 1, contacts: ['Carlos Ruiz'], meeting: MEETING };
const emailCard = (id: string, reason: string) => ({
  id,
  kind: 'reply_draft',
  status: 'pending',
  reason,
  quote: null,
  from: 'Carlos Ruiz <carlos@example.com>',
  draft: { to: ['carlos@example.com'], cc: [], subject: 'Re: Updated proposal', text: 'Hello Carlos,\n\nA change.\n\nBest,' },
  draftHash: HASH,
  guardFlags: [],
  sendOutcome: null,
  auto: false,
  createdAt: '2026-11-12T10:00:00.000Z',
  slot: reason === 'meeting_moved' ? NEW_SLOT : null,
});
const PAGE = { matter: ITEM, approvals: [emailCard('c1', 'owner_message'), emailCard('c2', 'meeting_moved')], proposals: [], events: [], usage: null };

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

async function type(testID: string, text: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), text);
  });
}

async function openPage(): Promise<void> {
  await renderScreen();
  await press('matters-open-m1');
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockVoice.status = 'idle';
  mockService.listOpen.mockResolvedValue([ITEM]);
  mockService.getPage.mockResolvedValue(PAGE);
  await i18n.changeLanguage('en');
});

describe('the email cards the owner asked for', () => {
  it('are named "Email ready to send" and say why; Send sends exactly the draft shown', async () => {
    mockService.decide.mockResolvedValue({ matterId: 'm1', id: 'c1', status: 'approved', outcome: 'sent', taskId: null, matterStatus: 'active' });
    await openPage();
    expect(screen.getAllByText('Email ready to send')).toHaveLength(2);
    expect(screen.getByText('You asked me to write this. Nothing is sent until you tap Send.')).toBeTruthy();
    expect(screen.getByText('You moved the meeting. Send this so they know the new time.')).toBeTruthy();
    expect(screen.getByTestId('matters-card-approve-c1')).toHaveTextContent('Send this email');
    expect(screen.getByTestId('matters-card-decline-c1')).toHaveTextContent('Do not send');
    expect(screen.getByTestId('matters-card-slot-c2')).toBeTruthy();
    await press('matters-card-approve-c1');
    expect(mockService.decide).toHaveBeenCalledWith({ matterId: 'm1', target: 'approval', id: 'c1', action: 'approve', draftHash: HASH });
  });
});

describe('Move the meeting', () => {
  it('shows the new time first, and moves only on "Move it"', async () => {
    mockService.readNewTime.mockResolvedValue({ matterId: 'm1', slot: NEW_SLOT, free: true, moved: false, id: null, question: null });
    mockService.moveMeeting.mockResolvedValue({ matterId: 'm1', slot: NEW_SLOT, free: true, moved: true, id: 'c3', question: null });
    await openPage();
    await type('matters-move-input', 'Friday at 4 pm');
    await press('matters-move-check');
    expect(mockService.readNewTime).toHaveBeenCalledWith('m1', 'Friday at 4 pm');
    expect(screen.getByText(/^New time: /)).toBeTruthy();
    expect(screen.getByTestId('matters-move-free')).toHaveTextContent('This time is free in your calendar.');
    expect(mockService.moveMeeting).not.toHaveBeenCalled();
    await press('matters-move-apply');
    expect(mockService.moveMeeting).toHaveBeenCalledWith('m1', NEW_SLOT.start);
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Meeting moved. The email that tells them is under "Waiting for you": check it and tap Send.' });
    expect(mockService.getPage).toHaveBeenCalledTimes(2); // the page reloads with the new card
  });

  it('says when the time is taken, and shows the question when no time was read', async () => {
    mockService.readNewTime.mockResolvedValueOnce({ matterId: 'm1', slot: NEW_SLOT, free: false, moved: false, id: null, question: null });
    await openPage();
    await type('matters-move-input', 'at 4 pm');
    await press('matters-move-check');
    expect(screen.getByTestId('matters-move-free')).toHaveTextContent('You already have something else at this time.');
    mockService.readNewTime.mockResolvedValueOnce({ matterId: 'm1', slot: null, free: false, moved: false, id: null, question: 'Which day and time should I move it to? For example: Friday at 4 pm.' });
    await type('matters-move-input', 'later');
    await press('matters-move-check');
    expect(screen.queryByTestId('matters-move-proposed')).toBeNull();
    expect(screen.getByTestId('matters-move-note')).toHaveTextContent(/^Which day and time should I move it to\?/);
  });

  it('is not offered without a booked meeting', async () => {
    mockService.getPage.mockResolvedValue({ ...PAGE, matter: { ...ITEM, meeting: null } });
    await openPage();
    expect(screen.queryByTestId('matters-move')).toBeNull();
    expect(screen.getByTestId('matters-contact')).toBeTruthy();
  });
});

describe('Write to them', () => {
  it('turns the owner\u2019s words into an email card to check and send', async () => {
    mockService.message.mockResolvedValue({ matterId: 'm1', id: 'c4', question: null });
    await openPage();
    expect(screen.getAllByText('What should I tell Carlos Ruiz?').length).toBeGreaterThan(0);
    await type('matters-contact-input', 'I am running 10 minutes late');
    await press('matters-contact-write');
    expect(mockService.message).toHaveBeenCalledWith('m1', 'I am running 10 minutes late');
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'The email is ready under "Waiting for you". Check it and tap Send.' });
    expect(mockService.decide).not.toHaveBeenCalled();
  });

  it('shows the assistant\u2019s question when the words do not say what to tell them', async () => {
    mockService.message.mockResolvedValue({ matterId: 'm1', id: null, question: 'What should I tell Carlos?' });
    await openPage();
    await type('matters-contact-input', 'Carlos');
    await press('matters-contact-write');
    expect(screen.getByTestId('matters-contact-note')).toHaveTextContent('What should I tell Carlos?');
  });
});

describe('Ask or change something (A3 feedback intents)', () => {
  it('"move the meeting" reads the time and moves it only after "Move it"', async () => {
    mockService.ask.mockResolvedValue({ intent: 'move_meeting', matterId: 'm1', title: 'Proposal from Carlos', answer: 'I will read the new time and show it to you before I move the meeting of "Proposal from Carlos".' });
    mockService.readNewTime.mockResolvedValue({ matterId: 'm1', slot: NEW_SLOT, free: true, moved: false, id: null, question: null });
    mockService.moveMeeting.mockResolvedValue({ matterId: 'm1', slot: NEW_SLOT, free: true, moved: true, id: 'c3', question: null });
    await renderScreen();
    await type('matters-ask-input', 'Move the Carlos meeting to Friday at 4 pm');
    await press('matters-ask-send');
    expect(screen.getByTestId('matters-ask-yes')).toHaveTextContent('Show me the new time');
    await press('matters-ask-yes');
    expect(mockService.readNewTime).toHaveBeenCalledWith('m1', 'Move the Carlos meeting to Friday at 4 pm');
    expect(mockService.moveMeeting).not.toHaveBeenCalled();
    await press('matters-ask-move-apply');
    expect(mockService.moveMeeting).toHaveBeenCalledWith('m1', NEW_SLOT.start);
  });

  it('"tell him" writes the email card', async () => {
    mockService.ask.mockResolvedValue({ intent: 'message', matterId: 'm1', title: 'Proposal from Carlos', answer: 'I will write the email.' });
    mockService.message.mockResolvedValue({ matterId: 'm1', id: 'c4', question: null });
    await renderScreen();
    await type('matters-ask-input', 'Tell Carlos I am late');
    await press('matters-ask-send');
    await press('matters-ask-yes');
    expect(mockService.message).toHaveBeenCalledWith('m1', 'Tell Carlos I am late');
  });

  it('after a change that touches what the contact was told, asks "Let them know?"', async () => {
    mockService.ask.mockResolvedValue({ intent: 'change', matterId: 'm1', title: 'Proposal from Carlos', answer: 'I will draft the change.' });
    mockService.change.mockResolvedValue({ matterId: 'm1', status: 'active', title: 'Proposal from Carlos', readBack: 'Until: Wed, Dec 2.', questions: [], firstEmail: null, draftHash: HASH });
    mockService.confirmChange.mockResolvedValue({ matterId: 'm1', status: 'active', title: 'Proposal from Carlos', readBack: 'Until: Wed, Dec 2.', questions: [], firstEmail: null, draftHash: null, letThemKnow: true });
    mockService.message.mockResolvedValue({ matterId: 'm1', id: 'c5', question: null });
    await renderScreen();
    await type('matters-ask-input', 'Move the deadline to Wednesday December 2');
    await press('matters-ask-send');
    await press('matters-ask-yes');
    await press('matters-ask-change-confirm');
    expect(screen.getByTestId('matters-ask-let-them-know')).toBeTruthy();
    expect(mockService.message).not.toHaveBeenCalled();
    await press('matters-ask-let-them-know-yes');
    expect(mockService.message).toHaveBeenCalledWith('m1', 'Tell them about this change: Move the deadline to Wednesday December 2');
  });

  it('a change the contact does not need to know about asks nothing', async () => {
    mockService.ask.mockResolvedValue({ intent: 'change', matterId: 'm1', title: 'Proposal from Carlos', answer: 'I will draft the change.' });
    mockService.change.mockResolvedValue({ matterId: 'm1', status: 'active', title: 'Proposal from Carlos', readBack: 'Follow-up every 3 days.', questions: [], firstEmail: null, draftHash: HASH });
    mockService.confirmChange.mockResolvedValue({ matterId: 'm1', status: 'active', title: 'Proposal from Carlos', readBack: 'Follow-up every 3 days.', questions: [], firstEmail: null, draftHash: null, letThemKnow: false });
    await renderScreen();
    await type('matters-ask-input', 'Follow up every 3 days');
    await press('matters-ask-send');
    await press('matters-ask-yes');
    await press('matters-ask-change-confirm');
    expect(screen.queryByTestId('matters-ask-let-them-know')).toBeNull();
  });
});

describe('the microphone while the assistant speaks', () => {
  const handlers = { language: 'en' as const, onTranscript: jest.fn(), onFinal: jest.fn(), onProblem: jest.fn() };

  it('stays off while speaking; Speak stops the voice and starts listening', async () => {
    const { result } = await renderHook(() => useMatterVoice(handlers));
    await act(async () => {
      result.current.speak('Pause "Proposal from Carlos"? Say yes to confirm, or no.');
    });
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(mockVoice.toggle).not.toHaveBeenCalled();
    expect(result.current.speaking).toBe(true);
    await act(async () => {
      result.current.toggleMic();
    });
    expect(Speech.stop).toHaveBeenCalled();
    expect(mockVoice.toggle).toHaveBeenCalledTimes(1);
    expect(result.current.speaking).toBe(false);
  });

  it('a microphone still listening is turned off before the answer is spoken', async () => {
    mockVoice.status = 'listening';
    const { result } = await renderHook(() => useMatterVoice(handlers));
    await act(async () => {
      result.current.speak('Carlos has not replied yet.');
    });
    expect(mockVoice.toggle).toHaveBeenCalledTimes(1);
  });
});
