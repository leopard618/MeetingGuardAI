import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { buildMeeting, type Meeting } from '../../../core/types';
import { I18nProvider } from '../../../i18n';
import type { GuestAnswer } from '../../../services/guests/guestService';
import { MeetingGuestReplies } from '../MeetingGuestReplies';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: true }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

let mockAnswers: GuestAnswer[] = [];
const mockDecide = jest.fn(async (_uid: string, _id: string, _state: string) => undefined);
const mockCreateLink = jest.fn(async (_id: string) => 'T'.repeat(43));
const mockRevoke = jest.fn(async (_id: string) => undefined);
jest.mock('../../../services/guests', () => {
  const links = jest.requireActual('../../../services/guests/guestLinks');
  return {
    ...links,
    useGuestAnswers: () => mockAnswers,
    guestService: {
      decide: (uid: string, id: string, state: string) => mockDecide(uid, id, state),
      createLink: (id: string) => mockCreateLink(id),
      revokeLink: (id: string) => mockRevoke(id),
    },
  };
});
const mockUpdate = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../../../services/data', () => ({
  dataService: { getActiveUid: () => 'u1' },
  meetingRepository: { update: (...args: unknown[]) => mockUpdate(...args) },
  usePreferences: () => ({ preferences: { use24HourClock: true, timezone: 'UTC' } }),
}));

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}): Meeting {
  return buildMeeting(
    { title: 'Kickoff', startAt: '2026-11-25T15:00:00.000Z', durationMinutes: 45, timezone: 'UTC', source: 'manual', participants: [{ email: 'ana@example.com', name: 'Ana' }], ...overrides },
    { id: 'm1', userId: 'u1', now: '2026-11-20T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

function answer(overrides: Partial<GuestAnswer> = {}): GuestAnswer {
  return {
    id: 'r1',
    v: 1,
    meetingId: 'm1',
    kind: 'proposed',
    guestName: 'Ana',
    guestEmail: null,
    proposedStartAt: '2026-11-26T16:00:00.000Z',
    message: 'Thursday works better',
    meetingStartAtSeen: '2026-11-25T15:00:00.000Z',
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:00:00.000Z',
    state: 'new',
    decidedAt: null,
    ...overrides,
  };
}

async function renderReplies(value: Meeting) {
  await act(async () => {
    render(
      <I18nProvider>
        <PaperProvider>
          <MeetingGuestReplies meeting={value} />
        </PaperProvider>
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  mockAnswers = [];
  mockDecide.mockClear();
  mockUpdate.mockClear();
  mockCreateLink.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it('approving a proposal moves the meeting as a user edit and closes the other proposals', async () => {
  mockAnswers = [answer(), answer({ id: 'r2', guestName: 'Bob', proposedStartAt: '2026-11-27T10:00:00.000Z' }), answer({ id: 'r3', kind: 'accepted', proposedStartAt: null, message: null })];
  await renderReplies(meeting());
  expect(screen.getAllByText('Note: Thursday works better')).toHaveLength(2);
  await act(async () => {
    fireEvent.press(screen.getByTestId('guest-reply-approve-r1'));
  });
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    buttons.find((button) => button.text === 'Move')!.onPress!();
  });
  expect(mockUpdate).toHaveBeenCalledWith('m1', { startAt: '2026-11-26T16:00:00.000Z' }, { origin: 'user' });
  expect(mockDecide.mock.calls).toEqual([
    ['u1', 'r1', 'approved'],
    ['u1', 'r2', 'superseded'],
  ]);
});

it('keeping the time changes nothing on the meeting', async () => {
  mockAnswers = [answer()];
  await renderReplies(meeting());
  await act(async () => {
    fireEvent.press(screen.getByTestId('guest-reply-keep-r1'));
  });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockDecide).toHaveBeenCalledWith('u1', 'r1', 'declined');
});

it('says when the meeting moved since the proposal', async () => {
  mockAnswers = [answer({ meetingStartAtSeen: '2026-11-24T15:00:00.000Z' })];
  await renderReplies(meeting());
  expect(screen.getByText('The meeting changed since this proposal.')).toBeTruthy();
});

it('adds the reply link to the invitation of an existing meeting', async () => {
  await renderReplies(meeting({ description: 'Agenda' }));
  expect(screen.getByTestId('guest-replies-empty')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('guest-link-add'));
  });
  expect(mockCreateLink).toHaveBeenCalledWith('m1');
  expect(mockUpdate).toHaveBeenCalledWith('m1', { description: `Agenda\n\nReply to this invitation: https://meetingguard-ai-app.web.app/g#t=${'T'.repeat(43)}&l=en` }, { origin: 'user' });
});

it('shows nothing for a meeting without guests and without answers', async () => {
  await renderReplies(meeting({ participants: [] }));
  expect(screen.queryByTestId('guest-replies-empty')).toBeNull();
  expect(screen.queryByTestId('guest-link-share')).toBeNull();
});
