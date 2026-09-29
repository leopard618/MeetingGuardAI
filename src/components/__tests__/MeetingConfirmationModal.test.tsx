import { fireEvent, render, screen, within } from '@testing-library/react-native';

import type { ProposedActionState } from '../../core/contracts';
import { bulkAction, createAction, deleteAction, makeMeeting, shareAction, updateAction } from '../../services/ai/__fixtures__/aiTestKit';
import type { AiActionPreview } from '../../services/ai/types';
import { MeetingConfirmationModal } from '../MeetingConfirmationModal';

jest.mock('../../i18n', () => {
  const { createTranslator } = jest.requireActual('../../services/ai/__fixtures__/aiTestKit');
  const t = createTranslator('en');
  return {
    t,
    useT: () => t,
    getLanguage: () => 'en',
    useLanguage: () => ({ language: 'en', setLanguage: jest.fn(), supportedLanguages: ['en', 'es'] }),
  };
});

jest.mock('../../utils/format', () => ({
  formatMeetingTimeRange: (m: { startAt: string; durationMinutes: number }) => `${m.startAt.slice(0, 16)}+${m.durationMinutes}m`,
  formatDuration: (minutes: number) => `${minutes} min`,
  formatDateTime: (value: string) => value.slice(0, 16),
  formatTime: (value: string) => value.slice(11, 16),
  formatRelative: (value: string) => `at ${value}`,
  formatDate: (value: string) => value.slice(0, 10),
  uses24HourClock: () => true,
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleTheme: jest.fn() }),
}));

function previewFor(action: ProposedActionState['action'], meetings = [makeMeeting('m1', { title: 'Weekly sync' })]): AiActionPreview {
  return { action, meetings, missingMeetingIds: [], warnings: [], overlapping: [], calendarConnected: null };
}

function proposed(action: ProposedActionState['action'], preview: AiActionPreview | null = previewFor(action)): ProposedActionState {
  return { action, status: 'proposed', preview, result: null };
}

describe('MeetingConfirmationModal', () => {
  it('uses destructive styling and wording for a delete', async () => {
    const action = deleteAction('d1', 'm1');
    const onConfirm = jest.fn();
    await render(<MeetingConfirmationModal visible actions={[proposed(action)]} onConfirm={onConfirm} onCancel={jest.fn()} />);
    expect(screen.getByText('Delete this meeting?')).toBeTruthy();
    expect(screen.getByText('This meeting will be deleted and its alerts cancelled.')).toBeTruthy();
    expect(screen.getByText('Weekly sync')).toBeTruthy();
    expect(within(screen.getByTestId('confirm-submit')).getByText('Delete meeting')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-submit'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('warns that a synced meeting is also removed from the synced calendar', async () => {
    const action = deleteAction('d1', 'm1');
    const synced = makeMeeting('m1', { title: 'Synced' });
    const meeting = { ...synced, external: { ...synced.external, googleEventId: 'g1' } };
    await render(<MeetingConfirmationModal visible actions={[proposed(action, previewFor(action, [meeting]))]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText(/also be removed from your synced calendar/)).toBeTruthy();
  });

  it('lists every email recipient of a share and explains that nothing is sent automatically', async () => {
    const action = shareAction('s1', 'm1', { recipients: ['john@company.com', 'ana@x.io'], message: 'See you there' });
    await render(<MeetingConfirmationModal visible actions={[proposed(action)]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('john@company.com')).toBeTruthy();
    expect(screen.getByText('ana@x.io')).toBeTruthy();
    expect(screen.getByText('Recipients (2)')).toBeTruthy();
    expect(screen.getByText(/Nothing is sent until you send it there/)).toBeTruthy();
    expect(screen.getByText('See you there')).toBeTruthy();
    expect(screen.getByText('Write email')).toBeTruthy();
  });

  it('shows every field of a new meeting and its warnings', async () => {
    const action = createAction('c1', { conference: { provider: 'google_meet', url: null, password: null } });
    const preview: AiActionPreview = { ...previewFor(action, []), warnings: ['google_meet_needs_calendar'] };
    await render(<MeetingConfirmationModal visible actions={[proposed(action, preview)]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Budget review')).toBeTruthy();
    expect(screen.getByText(/Connect Google Calendar to create a real Google Meet link/)).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
  });

  it('shows the new values while the meeting preview is still loading', async () => {
    const action = updateAction('u1', 'm1', { title: 'Renamed' });
    await render(<MeetingConfirmationModal visible actions={[proposed(action, null)]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Renamed')).toBeTruthy();
    expect(screen.getByText('Checking your calendar…')).toBeTruthy();
  });

  it('lists every meeting a bulk change moves, before and after', async () => {
    const action = bulkAction('b1', ['m1', 'm2'], { shiftMinutes: 30 });
    const meetings = [makeMeeting('m1', { title: 'First' }), makeMeeting('m2', { title: 'Second' })];
    await render(<MeetingConfirmationModal visible actions={[proposed(action, previewFor(action, meetings))]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Move 30 min later')).toBeTruthy();
    expect(screen.getByText('2 meetings')).toBeTruthy();
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(within(screen.getByTestId('confirm-submit')).getByText('Change 2 meetings')).toBeTruthy();
  });

  it('confirms several actions at once and lets the user dismiss one of them', async () => {
    const a = createAction('a1');
    const b = deleteAction('b1', 'm1');
    const onReject = jest.fn();
    const onCancel = jest.fn();
    await render(
      <MeetingConfirmationModal visible actions={[proposed(a), proposed(b)]} onConfirm={jest.fn()} onCancel={onCancel} onReject={onReject} isBusy={false} />,
    );
    expect(screen.getByText('Confirm 2 actions')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-dismiss-b1'));
    expect(onReject).toHaveBeenCalledWith('b1');
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables the confirm button while busy', async () => {
    const action = createAction('c1');
    const onConfirm = jest.fn();
    await render(<MeetingConfirmationModal visible actions={[proposed(action)]} onConfirm={onConfirm} onCancel={jest.fn()} isBusy />);
    expect(screen.getByTestId('confirm-submit').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true, busy: true }));
    await fireEvent.press(screen.getByTestId('confirm-submit'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing without actions', async () => {
    await render(<MeetingConfirmationModal visible actions={[]} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByTestId('confirm-submit')).toBeNull();
  });
});
