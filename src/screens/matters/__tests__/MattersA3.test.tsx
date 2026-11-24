import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { I18nProvider, i18n } from '../../../i18n';
import { MattersScreen } from '../MattersScreen';
import { formatCost, timelineDetail, timelineKey } from '../matterFormat';
import { base64ToBytes, isActionIntent } from '../matterVoice';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Madrid', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

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
};
jest.mock('../../../services/matters', () => ({
  matterService: {
    isEnabled: () => true,
    draft: (...args: unknown[]): unknown => mockService.draft(...args),
    decide: (...args: unknown[]): unknown => mockService.decide(...args),
    listOpen: (...args: unknown[]): unknown => mockService.listOpen(...args),
    getPage: (...args: unknown[]): unknown => mockService.getPage(...args),
    setStatus: (...args: unknown[]): unknown => mockService.setStatus(...args),
    cancel: (...args: unknown[]): unknown => mockService.cancel(...args),
    change: (...args: unknown[]): unknown => mockService.change(...args),
    confirmChange: (...args: unknown[]): unknown => mockService.confirmChange(...args),
    ask: (...args: unknown[]): unknown => mockService.ask(...args),
    speak: (...args: unknown[]): unknown => mockService.speak(...args),
  },
}));

const HASH = 'b'.repeat(64);
const ITEM = { matterId: 'm1', status: 'active', title: 'Proposal from Carlos', updatedAt: '2026-11-12T10:00:00.000Z', pendingApprovals: 1, contacts: ['Carlos Ruiz'], meeting: null };
const PAGE = {
  matter: { ...ITEM, meeting: { start: '2026-11-13T08:00:00.000Z', end: '2026-11-13T08:30:00.000Z' } },
  approvals: [
    {
      id: 't1',
      kind: 'time_proposal',
      status: 'pending',
      reason: 'ask_before_booking',
      quote: 'Tuesday at 10:00 works for me.',
      from: 'Carlos Ruiz <carlos@example.com>',
      draft: null,
      draftHash: null,
      guardFlags: [],
      sendOutcome: null,
      auto: false,
      createdAt: '2026-11-12T10:00:00.000Z',
      slot: { start: '2026-11-17T09:00:00.000Z', end: '2026-11-17T09:30:00.000Z' },
    },
    {
      id: 't2',
      kind: 'time_proposal',
      status: 'pending',
      reason: 'slot_busy',
      quote: null,
      from: null,
      draft: null,
      draftHash: null,
      guardFlags: [],
      sendOutcome: null,
      auto: false,
      createdAt: '2026-11-12T09:00:00.000Z',
      slot: { start: '2026-11-18T09:00:00.000Z', end: '2026-11-18T09:30:00.000Z' },
    },
  ],
  proposals: [],
  events: [
    { type: 'meeting_booked', at: '2026-11-12T11:00:00.000Z', detail: 'Fri, Nov 13, 9:00 AM (Europe/Madrid)' },
    { type: 'reply_read', at: '2026-11-12T10:59:00.000Z', detail: 'picks_time' },
    { type: 'something_new', at: '2026-11-12T10:58:00.000Z', detail: 'x' },
  ],
  usage: { modelCalls: 3, inputTokens: 300, outputTokens: 60, emails: 2, speechChars: 0, costUsd: 0.0032 },
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

async function type(testID: string, text: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), text);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockService.listOpen.mockResolvedValue([ITEM]);
  mockService.getPage.mockResolvedValue(PAGE);
  await i18n.changeLanguage('en');
});

describe('matter page (A3)', () => {
  it('shows the booked meeting, the proposed time, the timeline and the cost', async () => {
    await renderScreen();
    await press('matters-open-m1');
    expect(screen.getByTestId('matters-page-meeting')).toBeTruthy();
    expect(screen.getAllByText(/^Meeting booked: /)).toHaveLength(2); // the banner and the timeline
    expect(screen.getByTestId('matters-card-slot-t1')).toBeTruthy();
    expect(screen.getByText('The time is free. Book it with one tap.')).toBeTruthy();
    expect(screen.getByText('Meeting booked: Fri, Nov 13, 9:00 AM (Europe/Madrid)')).toBeTruthy();
    // internal categories never show; unknown types are a plain update
    expect(screen.getByText('Reply read')).toBeTruthy();
    expect(screen.queryByText(/picks_time/)).toBeNull();
    expect(screen.getByText('Update')).toBeTruthy();
    expect(screen.getByText('Cost so far: about $0.0032 (3 AI calls, 2 emails)')).toBeTruthy();
  });

  it('books a free time with one tap; a busy time is only information', async () => {
    mockService.decide.mockResolvedValue({ matterId: 'm1', id: 't1', status: 'approved', outcome: null, taskId: null, matterStatus: 'active' });
    await renderScreen();
    await press('matters-open-m1');
    expect(screen.getAllByText('Book this time')).toHaveLength(1);
    // information only: one "Mark as read" button, never an "OK" that seems to do something
    expect(screen.getByTestId('matters-card-approve-t2')).toHaveTextContent('Mark as read');
    expect(screen.queryByTestId('matters-card-decline-t2')).toBeNull();
    expect(screen.getByTestId('matters-card-noreply-t2')).toHaveTextContent('Nothing was sent. Reply to them yourself if needed.');
    expect(screen.queryByTestId('matters-card-noreply-t1')).toBeNull();
    expect(screen.queryByText('OK')).toBeNull();
    await press('matters-card-approve-t1');
    expect(mockService.decide).toHaveBeenCalledWith({ matterId: 'm1', target: 'approval', id: 't1', action: 'approve' });
    expect(screen.getByText('That time is not free in your calendar.')).toBeTruthy();
  });

  it('pauses and resumes', async () => {
    mockService.setStatus.mockResolvedValue({ matterId: 'm1', status: 'paused' });
    await renderScreen();
    await press('matters-open-m1');
    expect(screen.getByText('Pause this matter')).toBeTruthy();
    await press('matters-page-status');
    expect(mockService.setStatus).toHaveBeenCalledWith('m1', 'pause');
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Paused. Nothing is sent until you resume it.' });
  });
});

describe('asking the assistant (A3)', () => {
  it('answers a status question, with no action to confirm', async () => {
    mockService.ask.mockResolvedValue({ intent: 'status', matterId: 'm1', title: 'Proposal from Carlos', answer: 'Carlos has not replied yet.' });
    await renderScreen();
    await type('matters-ask-input', 'What is happening with Carlos?');
    await press('matters-ask-send');
    expect(mockService.ask).toHaveBeenCalledWith({ text: 'What is happening with Carlos?', language: 'en' });
    expect(screen.getByText('Carlos has not replied yet.')).toBeTruthy();
    expect(screen.queryByTestId('matters-ask-yes')).toBeNull();
  });

  it('does an action only after the owner says yes', async () => {
    mockService.ask.mockResolvedValue({ intent: 'pause', matterId: 'm1', title: 'Proposal from Carlos', answer: 'Pause "Proposal from Carlos"? Nothing is sent while it is paused.' });
    mockService.setStatus.mockResolvedValue({ matterId: 'm1', status: 'paused' });
    await renderScreen();
    await type('matters-ask-input', 'Pause Carlos');
    await press('matters-ask-send');
    expect(mockService.setStatus).not.toHaveBeenCalled();
    await press('matters-ask-yes');
    expect(mockService.setStatus).toHaveBeenCalledWith('m1', 'pause');
    expect(mockService.listOpen).toHaveBeenCalledTimes(2); // the list reloads
  });

  it('drafts a change, shows the new plan, and applies it only with its hash', async () => {
    mockService.ask.mockResolvedValue({ intent: 'change', matterId: 'm1', title: 'Proposal from Carlos', answer: 'I will draft the change.' });
    mockService.change.mockResolvedValue({ matterId: 'm1', status: 'active', title: 'Proposal from Carlos', readBack: 'Until: Mon, Nov 16.', questions: [], firstEmail: null, draftHash: HASH });
    mockService.confirmChange.mockResolvedValue({ matterId: 'm1', status: 'active', title: 'Proposal from Carlos', readBack: 'Until: Mon, Nov 16.', questions: [], firstEmail: null, draftHash: null });
    await renderScreen();
    await type('matters-ask-input', 'Move the deadline to Monday');
    await press('matters-ask-send');
    await press('matters-ask-yes');
    expect(mockService.change).toHaveBeenCalledWith('m1', 'Move the deadline to Monday');
    expect(screen.getByText('Until: Mon, Nov 16.')).toBeTruthy();
    await press('matters-ask-change-confirm');
    expect(mockService.confirmChange).toHaveBeenCalledWith('m1', HASH);
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Change applied.' });
  });

  it('turns a new delegation into a matter draft', async () => {
    mockService.ask.mockResolvedValue({ intent: 'new_matter', matterId: null, title: null, answer: 'I will set this up as a new matter.' });
    mockService.draft.mockResolvedValue({ matterId: 'm2', status: 'draft', title: 'Invoice', readBack: '', questions: ['What is the email address of Lucia?'], firstEmail: null, draftHash: null });
    await renderScreen();
    await type('matters-ask-input', 'Ask Lucia for the invoice');
    await press('matters-ask-send');
    await press('matters-ask-yes');
    expect(mockService.draft).toHaveBeenCalledWith({ text: 'Ask Lucia for the invoice', source: 'text', language: 'en', timeZone: expect.any(String) });
    expect(screen.getByText('What is the email address of Lucia?')).toBeTruthy();
  });
});

describe('matter voice and format helpers', () => {
  it('decodes base64 and names the action intents', () => {
    expect(Array.from(base64ToBytes('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
    expect(isActionIntent('pause')).toBe(true);
    expect(isActionIntent('move_meeting')).toBe(true);
    expect(isActionIntent('message')).toBe(true);
    expect(isActionIntent('status')).toBe(false);
  });

  it('names timeline events and formats the cost', () => {
    expect(timelineKey({ type: 'paused', at: '', detail: '' })).toBe('matters:timeline.type.paused');
    expect(timelineKey({ type: 'later_type', at: '', detail: '' })).toBe('matters:timeline.type.other');
    expect(timelineDetail({ type: 'reply_read', at: '', detail: 'answer_within_mandate' })).toBeNull();
    expect(timelineDetail({ type: 'email_sent', at: '', detail: 'Carlos Ruiz' })).toBe('Carlos Ruiz');
    expect(formatCost(0.0032)).toBe('$0.0032');
    expect(formatCost(1.5)).toBe('$1.50');
  });
});
