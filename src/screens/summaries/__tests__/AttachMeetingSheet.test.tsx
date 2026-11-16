/**
 * The "Choose a meeting" sheet (M10 section 9): opens on the summary's day, lists that day's
 * meetings from the data layer with a weekly series expanded to that day's occurrence, files the
 * picked row (master id plus the occurrence's ORIGINAL date), offers a cancelled meeting with its
 * badge, steps between days, marks the current meeting (and the current occurrence of a series)
 * in 'move' mode and stays open on a failure.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { RecurrenceRule } from '../../../core/aiContract';
import { buildMeeting, type Meeting } from '../../../core/types';
import { I18nProvider, i18n } from '../../../i18n';
import { summaryAppError } from '../../../services/summaries/summaryCore';
import { AttachMeetingSheet, type AttachMeetingTarget } from '../AttachMeetingSheet';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

let mockMeetings: Meeting[] = [];
let mockMeetingsLoading = false;
jest.mock('../../../services/data', () => ({
  useMeetings: () => ({ meetings: mockMeetings, isLoading: mockMeetingsLoading, error: null, refresh: jest.fn() }),
  usePreferences: () => {
    const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
    return { preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null };
  },
}));

const mockAttach = jest.fn();
jest.mock('../../../services/summaries', () => ({
  summariesService: { attach: (...args: unknown[]) => mockAttach(...args) },
}));

const SUMMARY_ID = 'a'.repeat(64);

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}, id = 'm1'): Meeting {
  return buildMeeting(
    { title: 'Marketing review', startAt: '2026-11-12T10:00:00.000Z', durationMinutes: 30, timezone: 'UTC', source: 'manual', ...overrides },
    { id, userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

function weekly(): RecurrenceRule {
  return { freq: 'weekly', interval: 1, byWeekday: null, byMonthDay: null, until: null, count: null };
}

const TARGET: AttachMeetingTarget = {
  summaryId: SUMMARY_ID,
  summaryDate: '2026-11-12',
  receivedAt: '2026-11-12T16:00:00.000Z',
  mode: 'file',
  currentMeetingId: null,
};

const ANSWER = { changed: true, status: {}, summary: null };

async function renderSheet(target: AttachMeetingTarget | null, handlers: { onDismiss?: jest.Mock; onAttached?: jest.Mock } = {}) {
  const onDismiss = handlers.onDismiss ?? jest.fn();
  const onAttached = handlers.onAttached ?? jest.fn();
  await render(
    <I18nProvider>
      <PaperProvider>
        <AttachMeetingSheet target={target} onDismiss={onDismiss} onAttached={onAttached} />
      </PaperProvider>
    </I18nProvider>,
  );
  return { onDismiss, onAttached };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockMeetings = [
    meeting({}, 'review'),
    // Weekly since Oct 15 (a Thursday) at 14:00: Nov 12 is one of its occurrences.
    meeting({ title: 'Urpayroll weekly sync', startAt: '2026-10-15T14:00:00.000Z', durationMinutes: 60, recurrence: weekly() }, 'series'),
    meeting({ title: 'Cancelled call', status: 'cancelled', startAt: '2026-11-12T12:00:00.000Z' }, 'cancelled'),
  ];
  mockMeetingsLoading = false;
  mockAttach.mockReset();
  (Toast.show as jest.Mock).mockClear();
});

it('renders nothing while closed', async () => {
  await renderSheet(null);
  expect(screen.queryByTestId('attach-meeting-sheet')).toBeNull();
});

it('lists the summary day\'s meetings with the series occurrence and files the picked one', async () => {
  mockAttach.mockResolvedValue(ANSWER);
  const { onDismiss, onAttached } = await renderSheet(TARGET);
  expect(screen.getByText('Choose a meeting')).toBeTruthy();
  expect(screen.getByTestId('attach-day').props.children).toContain('November 12');
  expect(screen.getByText('Marketing review')).toBeTruthy();
  expect(screen.getByText('Urpayroll weekly sync')).toBeTruthy();
  expect(screen.getByText('2:00 PM - 3:00 PM, One meeting of a series')).toBeTruthy();
  // A cancelled meeting is offered with its badge (it may have been held anyway; B6).
  expect(screen.getByText('Cancelled call')).toBeTruthy();
  expect(screen.getByTestId('attach-meeting-cancelled-cancelled')).toBeTruthy();
  expect(screen.queryByTestId('attach-meeting-review-cancelled')).toBeNull();

  // Nothing is filed before a row is picked.
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-file'));
  });
  expect(mockAttach).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-meeting-series:2026-11-12'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-file'));
  });
  expect(mockAttach).toHaveBeenCalledWith({ summaryId: SUMMARY_ID, meetingId: 'series', occurrenceDate: '2026-11-12' });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Filed under Urpayroll weekly sync' }));
  expect(onAttached).toHaveBeenCalledWith(ANSWER);
  expect(onDismiss).toHaveBeenCalled();
});

it('files a one-off meeting with no occurrence date', async () => {
  mockAttach.mockResolvedValue(ANSWER);
  await renderSheet(TARGET);
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-meeting-review'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-file'));
  });
  expect(mockAttach).toHaveBeenCalledWith({ summaryId: SUMMARY_ID, meetingId: 'review', occurrenceDate: null });
});

it('steps to other days and back to the day of the summary', async () => {
  await renderSheet({ ...TARGET, summaryDate: null, receivedAt: '2026-11-12T16:00:00.000Z' });
  expect(screen.getByTestId('attach-day').props.children).toContain('November 12');
  expect(screen.queryByTestId('attach-summary-day')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-next-day'));
  });
  expect(screen.getByTestId('attach-day').props.children).toContain('November 13');
  expect(screen.getByText('No meetings that day. Try another day.')).toBeTruthy();

  // A week later the series is there again.
  for (let step = 0; step < 6; step += 1) {
    await act(async () => {
      fireEvent.press(screen.getByTestId('attach-next-day'));
    });
  }
  expect(screen.getByTestId('attach-day').props.children).toContain('November 19');
  expect(screen.getByTestId('attach-meeting-series:2026-11-19')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-summary-day'));
  });
  expect(screen.getByTestId('attach-day').props.children).toContain('November 12');

  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-previous-day'));
  });
  expect(screen.getByTestId('attach-day').props.children).toContain('November 11');
});

it('says so while the meetings load', async () => {
  mockMeetings = [];
  mockMeetingsLoading = true;
  await renderSheet(TARGET);
  expect(screen.getByTestId('attach-loading')).toBeTruthy();
});

it('stays open with an error toast when the attach fails', async () => {
  mockAttach.mockRejectedValue(summaryAppError('invalid_meeting'));
  const { onDismiss, onAttached } = await renderSheet(TARGET);
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-meeting-review'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-file'));
  });
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', text1: 'That meeting is no longer available. Choose another one.' }),
  );
  expect(onAttached).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
  expect(screen.getByTestId('attach-meeting-sheet')).toBeTruthy();
});

it('marks the current meeting in move mode and says it moved', async () => {
  mockAttach.mockResolvedValue(ANSWER);
  await renderSheet({ ...TARGET, mode: 'move', currentMeetingId: 'review' });
  expect(screen.getByText('Move to another meeting')).toBeTruthy();
  expect(screen.getByText('Filed here now')).toBeTruthy();
  expect(screen.getByTestId('attach-meeting-review').props.accessibilityState).toMatchObject({ disabled: true });

  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-meeting-series:2026-11-12'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-file'));
  });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Moved to Urpayroll weekly sync' }));
});

it('files a cancelled meeting the user picks', async () => {
  mockAttach.mockResolvedValue(ANSWER);
  await renderSheet(TARGET);
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-meeting-cancelled'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-file'));
  });
  expect(mockAttach).toHaveBeenCalledWith({ summaryId: SUMMARY_ID, meetingId: 'cancelled', occurrenceDate: null });
});

it('marks the occurrence of a series it is filed under in move mode (B4)', async () => {
  await renderSheet({ ...TARGET, mode: 'move', currentMeetingId: 'series', currentOccurrenceDate: '2026-11-12' });
  expect(screen.getByTestId('attach-meeting-series:2026-11-12').props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByText('Filed here now')).toBeTruthy();
  // Another occurrence of the same series can be picked.
  for (let step = 0; step < 7; step += 1) {
    await act(async () => {
      fireEvent.press(screen.getByTestId('attach-next-day'));
    });
  }
  expect(screen.getByTestId('attach-meeting-series:2026-11-19').props.accessibilityState).toMatchObject({ disabled: false });
});
