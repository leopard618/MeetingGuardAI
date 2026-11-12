import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { RecurrenceRule } from '../../../core/aiContract';
import { buildMeeting, type Meeting } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { RunningLateHost, closeRunningLate, openRunningLate } from '../RunningLateSheet';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const mockShare = jest.fn();
jest.mock('../../../services/ai/shareAdapter', () => ({
  reactNativeShareAdapter: { shareText: (...args: unknown[]) => mockShare(...args) },
}));

const mockUpdate = jest.fn();
const mockUpdateOccurrence = jest.fn();
let mockMeeting: Meeting | null = null;
jest.mock('../../../services/data', () => ({
  useMeeting: () => ({ meeting: mockMeeting, isLoading: false, error: null }),
  usePreferences: () => {
    const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
    return { preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null };
  },
  meetingRepository: {
    update: (...args: unknown[]) => mockUpdate(...args),
    updateOccurrence: (...args: unknown[]) => mockUpdateOccurrence(...args),
  },
}));

const NOW = new Date('2026-10-06T14:50:00.000Z');

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}, id = 'm1'): Meeting {
  return buildMeeting(
    {
      title: 'Budget review',
      startAt: '2026-10-06T15:00:00.000Z',
      durationMinutes: 60,
      timezone: 'UTC',
      source: 'manual',
      participants: [{ email: 'ana@example.com', name: 'Ana' }, { email: 'bob@example.com', name: null }],
      ...overrides,
    },
    { id, userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

function weekly(): RecurrenceRule {
  return { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };
}

async function renderHost() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <RunningLateHost />
      </PaperProvider>
    </I18nProvider>,
  );
}

async function openFor(target: { meetingId: string; startAt: string | null }) {
  await act(async () => {
    openRunningLate(target);
  });
  return screen.findByTestId('running-late-sheet');
}

beforeEach(async () => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  await i18n.changeLanguage('en');
  mockMeeting = meeting();
  mockShare.mockReset();
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockUpdateOccurrence.mockReset().mockResolvedValue(undefined);
  (Toast.show as jest.Mock).mockClear();
  (Platform as { OS: string }).OS = 'ios';
});

afterEach(() => {
  // Plain call: an act() here that is not awaited leaves the next render stuck.
  closeRunningLate();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('prefills the message for the chosen delay, shares it, reports the phone\'s answer and moves the meeting only on confirmation', async () => {
  mockShare.mockResolvedValue('shared');
  await renderHost();
  await openFor({ meetingId: 'm1', startAt: '2026-10-06T15:00:00.000Z' });
  expect(screen.getByTestId('running-late-meeting').props.children).toContain('Budget review · ');
  expect(screen.getByTestId('running-late-meeting').props.children).toContain('3:00 - 4:00 PM');
  // Nothing to share before a delay is picked.
  expect(screen.queryByTestId('running-late-share')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-delay-10'));
  });
  expect(screen.getByTestId('running-late-new-time').props.children).toBe('New time: 3:10 PM');
  expect(screen.getByTestId('running-late-message').props.value).toBe(
    'Hi, I\'m running about 10 minutes late for "Budget review". Let\'s start at 3:10 PM. Sorry for the delay.',
  );
  expect(screen.getByText(/Participants: Ana, bob@example.com\./)).toBeTruthy();

  // The user edits the text; the edited text is what goes out.
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('running-late-message'), 'Running 10 late, start at 3:10 PM please.');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-share'));
  });
  expect(mockShare).toHaveBeenCalledWith({ title: 'Running late: Budget review', message: 'Running 10 late, start at 3:10 PM please.' });
  // iOS reported completion: confirmed, never "delivered".
  expect(screen.getByTestId('running-late-outcome-confirmed').props.children).toBe('Your phone confirms the message was handed to the app you chose.');
  expect(screen.getByTestId('running-late-move-question').props.children).toBe('Move the meeting to 3:10 PM?');
  // Sending moved nothing.
  expect(mockUpdate).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-move'));
  });
  expect(mockUpdate).toHaveBeenCalledWith('m1', { startAt: '2026-10-06T15:10:00.000Z' }, { origin: 'user' });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Meeting moved to 3:10 PM.' }));
  expect(screen.queryByTestId('running-late-sheet')).toBeNull();
});

it('a dismissed share sheet sends nothing and stays on the message; "Keep the time" moves nothing', async () => {
  mockShare.mockResolvedValueOnce('dismissed').mockResolvedValueOnce('shared');
  await renderHost();
  await openFor({ meetingId: 'm1', startAt: null });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-delay-5'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-share'));
  });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text1: 'Nothing was sent.' }));
  expect(screen.getByTestId('running-late-message')).toBeTruthy();
  expect(screen.queryByTestId('running-late-move-question')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-share'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-keep'));
  });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.queryByTestId('running-late-sheet')).toBeNull();
});

it('on Android the message is only known to be handed over', async () => {
  (Platform as { OS: string }).OS = 'android';
  mockShare.mockResolvedValue('shared');
  await renderHost();
  await openFor({ meetingId: 'm1', startAt: null });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-delay-15'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-share'));
  });
  expect(screen.getByTestId('running-late-outcome-handed_over').props.children).toBe(
    'The message went to the app you chose. Meeting Guard cannot see whether it was sent.',
  );
});

it('emails the participants through the mail composer and treats it as handed over', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await renderHost();
  await openFor({ meetingId: 'm1', startAt: null });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-delay-30'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-email'));
  });
  const url = openURL.mock.calls[0]?.[0] as string;
  expect(url.startsWith('mailto:ana@example.com,bob@example.com?subject=Running%20late%3A%20Budget%20review&body=')).toBe(true);
  expect(decodeURIComponent(url.split('&body=')[1] ?? '')).toContain('30 minutes late');
  expect(mockShare).not.toHaveBeenCalled();
  expect(screen.getByTestId('running-late-outcome-handed_over')).toBeTruthy();
  expect(screen.getByTestId('running-late-move-question').props.children).toBe('Move the meeting to 3:30 PM?');
});

it('"Just move the meeting" skips the message; a series moves one occurrence only, through updateOccurrence', async () => {
  mockMeeting = meeting({ recurrence: weekly() }, 'series');
  await renderHost();
  // The alert of the October 13 occurrence.
  await openFor({ meetingId: 'series', startAt: '2026-10-13T15:00:00.000Z' });
  expect(screen.getByTestId('running-late-meeting').props.children).toContain('Oct 13');
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-delay-10'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-just-move'));
  });
  expect(mockShare).not.toHaveBeenCalled();
  expect(screen.queryByTestId(/running-late-outcome-/)).toBeNull();
  expect(screen.getByText('Only this occurrence moves. The rest of the series stays the same.')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-move'));
  });
  expect(mockUpdateOccurrence).toHaveBeenCalledWith('series', '2026-10-13', { startAt: '2026-10-13T15:10:00.000Z' }, { origin: 'user' });
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('closes with a notice when the meeting is no longer live', async () => {
  mockMeeting = meeting({ startAt: '2026-10-06T12:00:00.000Z' });
  await renderHost();
  await act(async () => {
    openRunningLate({ meetingId: 'm1', startAt: null });
  });
  expect(screen.queryByTestId('running-late-sheet')).toBeNull();
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text1: 'This meeting is no longer available.' }));
});

it('renders in Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderHost();
  await openFor({ meetingId: 'm1', startAt: null });
  await act(async () => {
    fireEvent.press(screen.getByTestId('running-late-delay-10'));
  });
  expect(screen.getByTestId('running-late-message').props.value).toBe(
    'Hola, voy unos 10 minutos tarde a "Budget review". Perdón por el retraso. ¿Empezamos a las 3:10 p.m.?',
  );
});
