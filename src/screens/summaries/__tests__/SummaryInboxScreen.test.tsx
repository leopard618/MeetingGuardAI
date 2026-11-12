/**
 * The summary inbox (M10 section 9) over the REAL summaries service and hooks with a fake
 * transport: the pilot gate (nothing is read while the feature is off; a missing summaryRead is
 * "not available"), the waiting cards (one-tap filing except on not_addressed_to_you, Choose a
 * meeting, Keep, Delete after a confirmation), "Filed recently" asked only after the inbox
 * re-match answered, "Refused" collapsed until opened, the empty state and pull to refresh.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, Text, type AlertButton } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { SummaryListItem, SummaryListView, SummaryStatusResponse, SummarySuggestion } from '../../../core/aiContract';
import { I18nProvider, i18n } from '../../../i18n';
import { summariesService } from '../../../services/summaries';
import { SummaryInboxScreen } from '../SummaryInboxScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

// The real service with a fake transport: the screen, the hooks and the cache patches all run.
const mockCall = jest.fn();
jest.mock('../../../services/summaries/summariesService', () => {
  const actual = jest.requireActual('../../../services/summaries/summariesService');
  return {
    ...actual,
    summariesService: actual.createSummariesService({
      getTransport: () => ({ call: (...args: unknown[]) => mockCall(...args) }),
    }),
  };
});

jest.mock('../../../services/data', () => ({
  useMeetings: () => ({ meetings: [], isLoading: false, error: null, refresh: jest.fn() }),
  usePreferences: () => {
    const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
    return { preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null };
  },
}));

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const ID_C = 'c'.repeat(64);

const STATUS: SummaryStatusResponse = {
  enabled: true,
  allowed: true,
  ready: true,
  address: 'abcdefghijklmnopqrstuvwxyz@summaries.example.com',
  mailboxes: ['ana@example.com'],
  gmailRequests: [],
  inboxCount: 2,
  lastReceivedAt: '2026-11-12T21:20:00.000Z',
  lastRefused: null,
  refusedToday: null,
};

function suggestion(meetingId: string, title: string, occurrenceDate: string | null = null): SummarySuggestion {
  return { meetingId, occurrenceDate, title, startAt: '2026-11-12T14:00:00.000Z', score: 0.7 };
}

function item(overrides: Partial<SummaryListItem>): SummaryListItem {
  return {
    summaryId: ID_A,
    status: 'inbox',
    title: 'Urpayroll',
    summaryDate: '2026-11-12',
    receivedAt: '2026-11-12T21:20:00.000Z',
    tier: 'vendor_verified',
    recipientBound: true,
    fresh: true,
    inboxReason: 'ambiguous',
    refusedReason: null,
    senderDomain: 'notetaker.example.com',
    count: null,
    match: null,
    suggestions: [],
    ...overrides,
  };
}

const WAITING_A = item({
  suggestions: [suggestion('series', 'Urpayroll weekly sync', '2026-11-12'), suggestion('m2', 'Marketing review')],
});
const WAITING_B = item({
  summaryId: ID_B,
  title: 'Launch readiness',
  inboxReason: 'not_addressed_to_you',
  receivedAt: '2026-11-12T20:00:00.000Z',
  suggestions: [],
});
const KEPT_C = item({ summaryId: ID_C, status: 'kept', title: 'Hiring sync', inboxReason: null, receivedAt: '2026-11-10T10:00:00.000Z' });
const REFUSED = item({
  summaryId: 'refused-2026-11-12',
  status: 'refused',
  title: null,
  summaryDate: null,
  tier: null,
  recipientBound: false,
  fresh: false,
  inboxReason: null,
  refusedReason: 'changed_after_sending',
  senderDomain: 'notetaker.example.com',
  count: 2,
});

interface Call {
  name: string;
  request: Record<string, unknown>;
}

let calls: Call[] = [];
let status: SummaryStatusResponse = STATUS;
let lists: Record<SummaryListView, SummaryListItem[]> = { inbox: [], recent: [], refused: [], meeting: [] };
/** Holds the inbox list answer until release() (null: answer at once). */
let inboxGate: { promise: Promise<void>; release(): void } | null = null;
let readMissing = false;

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function snapshotFor(meetingId: string, occurrenceDate: string | null, title: string) {
  return {
    meetingId,
    occurrenceDate,
    method: 'user' as const,
    meetingSnapshot: { title, startAt: '2026-11-12T14:00:00.000Z', endAt: '2026-11-12T15:00:00.000Z', timezone: 'UTC' },
  };
}

async function fakeServer(name: string, raw: unknown): Promise<unknown> {
  const request = raw as Record<string, unknown>;
  calls.push({ name, request });
  if (name === 'summaryStatus') return status;
  if (name === 'summaryRead') {
    if (readMissing) throw Object.assign(new Error('NOT_FOUND'), { code: 'functions/not-found' });
    const view = request.view as SummaryListView;
    if (view === 'inbox' && inboxGate) await inboxGate.promise;
    return { op: 'list', view, items: lists[view], hasMore: false };
  }
  const summaryId = request.summaryId as string;
  switch (request.op) {
    case 'attach':
      return {
        changed: true,
        status: { ...status, inboxCount: status.inboxCount - 1 },
        summary: {
          summaryId,
          status: 'matched',
          inboxReason: null,
          match: snapshotFor(request.meetingId as string, request.occurrenceDate as string | null, 'Urpayroll weekly sync'),
        },
      };
    case 'keep':
      return { changed: true, status: { ...status, inboxCount: status.inboxCount - 1 }, summary: { summaryId, status: 'kept', inboxReason: null, match: null } };
    case 'delete':
      return { changed: true, status: { ...status, inboxCount: status.inboxCount - 1 }, summary: null };
    default:
      throw new Error(`unexpected op ${String(request.op)}`);
  }
}

function listCalls(): string[] {
  return calls.filter((call) => call.name === 'summaryRead').map((call) => call.request.view as string);
}

const Stack = createStackNavigator();

function MockView({ route }: { route: { params: { summaryId: string } } }): ReactElement {
  return <Text>{`view ${route.params.summaryId}`}</Text>;
}

function MockConnect(): ReactElement {
  return <Text>connect screen</Text>;
}

async function renderInbox() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="SummaryInbox" component={SummaryInboxScreen} />
            <Stack.Screen name="SummaryView" component={MockView as never} />
            <Stack.Screen name="SummaryConnect" component={MockConnect} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  summariesService.clearSessionCache();
  calls = [];
  status = STATUS;
  lists = { inbox: [WAITING_A, WAITING_B], recent: [KEPT_C], refused: [REFUSED], meeting: [] };
  inboxGate = null;
  readMissing = false;
  mockCall.mockReset().mockImplementation(fakeServer);
  (Toast.show as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('reads nothing and says so while the feature is off for the caller', async () => {
  status = { ...STATUS, allowed: false, address: null, mailboxes: [], inboxCount: 0 };
  await renderInbox();
  expect(await screen.findByTestId('summary-inbox-unavailable')).toBeTruthy();
  expect(screen.getByText('Meeting summaries are not available for your account yet.')).toBeTruthy();
  expect(listCalls()).toEqual([]);
});

it('treats a missing summaryRead function as not available', async () => {
  readMissing = true;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await renderInbox();
  expect(await screen.findByTestId('summary-inbox-unavailable')).toBeTruthy();
  // Nothing more is asked once the inbox said so.
  expect(listCalls()).toEqual(['inbox']);
});

it('shows the waiting cards, asks "Filed recently" only after the inbox re-match, and keeps Refused closed', async () => {
  inboxGate = gate();
  await renderInbox();
  expect(await screen.findByTestId('summary-inbox-loading')).toBeTruthy();
  expect(listCalls()).toEqual(['inbox']);

  await act(async () => {
    inboxGate?.release();
  });
  expect(await screen.findByText('Urpayroll')).toBeTruthy();
  expect(await screen.findByText('Hiring sync')).toBeTruthy();
  expect(listCalls()).toEqual(['inbox', 'recent']);

  // Card A: chip, date, reason and the one-tap suggestions.
  expect(screen.getAllByText('From your notetaker').length).toBe(2);
  expect(screen.getAllByText('Date in the summary: Nov 12, 2026').length).toBe(2);
  expect(screen.getByText('Two meetings look alike. Choose the right one.')).toBeTruthy();
  expect(screen.getByText('File under Urpayroll weekly sync')).toBeTruthy();
  expect(screen.getByText('File under Marketing review')).toBeTruthy();

  // Card B (not addressed to you): no one-tap filing, and the card says why.
  expect(screen.queryByTestId(`summary-inbox-suggestions-${ID_B}`)).toBeNull();
  expect(screen.getByTestId(`summary-inbox-no-suggestions-${ID_B}`)).toBeTruthy();
  expect(screen.getByTestId(`summary-inbox-choose-${ID_B}`)).toBeTruthy();

  // Filed recently: the kept summary.
  // (The matcher sees the text with its whitespace collapsed: the line break is a space.)
  expect(screen.getByText(/Kept without a meeting\sReceived Nov 10, 2026/)).toBeTruthy();

  // Refused is closed and not read until opened.
  expect(screen.queryByTestId('summary-inbox-refused-list')).toBeNull();
  expect(listCalls()).not.toContain('refused');
});

it('files a summary with one tap under the suggested occurrence and moves it to Filed recently', async () => {
  await renderInbox();
  await screen.findByText('Urpayroll');
  await act(async () => {
    fireEvent.press(screen.getByTestId(`summary-inbox-file-${ID_A}-series|2026-11-12`));
  });
  const attach = calls.find((call) => call.name === 'summaryAction');
  expect(attach?.request).toEqual({ op: 'attach', summaryId: ID_A, meetingId: 'series', occurrenceDate: '2026-11-12' });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Filed under Urpayroll weekly sync' }));
  // The service patched its cache: the card left the inbox and the row joined Filed recently.
  expect(screen.queryByTestId(`summary-inbox-card-${ID_A}`)).toBeNull();
  expect(screen.getByTestId(`summary-inbox-recent-${ID_A}`)).toBeTruthy();
  expect(screen.getByText(/Filed under Urpayroll weekly sync\sReceived/)).toBeTruthy();
});

it('keeps a summary without a meeting', async () => {
  await renderInbox();
  await screen.findByText('Launch readiness');
  await act(async () => {
    fireEvent.press(screen.getByTestId(`summary-inbox-keep-${ID_B}`));
  });
  expect(calls.find((call) => call.name === 'summaryAction')?.request).toEqual({ op: 'keep', summaryId: ID_B });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Kept without a meeting' }));
  expect(screen.queryByTestId(`summary-inbox-card-${ID_B}`)).toBeNull();
  expect(screen.getByTestId(`summary-inbox-recent-${ID_B}`)).toBeTruthy();
});

it('deletes a summary only after the confirmation', async () => {
  let buttons: AlertButton[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, given) => {
    buttons = given ?? [];
  });
  await renderInbox();
  await screen.findByText('Urpayroll');
  await act(async () => {
    fireEvent.press(screen.getByTestId(`summary-inbox-delete-${ID_A}`));
  });
  expect(Alert.alert).toHaveBeenCalledWith('Delete this summary?', expect.stringContaining('The original email stays in your own mailbox.'), expect.any(Array));
  // The section 14 "Deletable" wording, with the provider's own copy (T3).
  expect(Alert.alert).toHaveBeenCalledWith(
    'Delete this summary?',
    expect.stringContaining('It leaves our live database at once and our backups within 21 days. The copy at our email provider expires after 45 days.'),
    expect.any(Array),
  );
  expect(calls.some((call) => call.name === 'summaryAction')).toBe(false);

  await act(async () => {
    buttons.find((button) => button.style === 'destructive')?.onPress?.();
  });
  expect(calls.find((call) => call.name === 'summaryAction')?.request).toEqual({ op: 'delete', summaryId: ID_A });
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Summary deleted' }));
  expect(screen.queryByTestId(`summary-inbox-card-${ID_A}`)).toBeNull();
});

it('explains a failed action and asks the inbox again when the summary is gone', async () => {
  await renderInbox();
  await screen.findByText('Urpayroll');
  const before = listCalls().filter((view) => view === 'inbox').length;
  mockCall.mockImplementation(async (name: string, raw: unknown) => {
    if (name === 'summaryAction') {
      throw Object.assign(new Error('gone'), { code: 'functions/not-found', details: { reason: 'not_found' } });
    }
    return fakeServer(name, raw);
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId(`summary-inbox-keep-${ID_A}`));
  });
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', text1: 'This summary is no longer here. It may have been deleted.' }),
  );
  expect(listCalls().filter((view) => view === 'inbox').length).toBe(before + 1);
});

it('opens the meeting sheet from Choose a meeting and the summary from its card', async () => {
  await renderInbox();
  await screen.findByText('Urpayroll');
  await act(async () => {
    fireEvent.press(screen.getByTestId(`summary-inbox-choose-${ID_B}`));
  });
  expect(screen.getByTestId('attach-meeting-sheet')).toBeTruthy();
  expect(screen.getByText('No meetings that day. Try another day.')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-cancel'));
  });
  expect(screen.queryByTestId('attach-meeting-sheet')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId(`summary-inbox-open-${ID_A}`));
  });
  expect(await screen.findByText(`view ${ID_A}`)).toBeTruthy();
});

it('shows the refused days once opened', async () => {
  await renderInbox();
  await screen.findByText('Urpayroll');
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-inbox-refused-header-action'));
  });
  expect(await screen.findByTestId('summary-inbox-refused-list')).toBeTruthy();
  expect(listCalls()).toContain('refused');
  expect(screen.getByText('2 refused on Nov 12, 2026')).toBeTruthy();
  expect(screen.getByText('Changed after sending\nFrom notetaker.example.com')).toBeTruthy();
  expect(screen.getByText(/Refused emails are not stored by Meeting Guard AI/)).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-inbox-refused-header-action'));
  });
  expect(screen.queryByTestId('summary-inbox-refused-list')).toBeNull();
});

it('shows the empty state with the way to setup when nothing waits and nothing was filed', async () => {
  lists = { inbox: [], recent: [], refused: [], meeting: [] };
  await renderInbox();
  expect(await screen.findByTestId('summary-inbox-empty')).toBeTruthy();
  expect(screen.getByText('No summaries yet')).toBeTruthy();
  // Refused stays reachable: it is often why nothing arrived.
  expect(screen.getByTestId('summary-inbox-refused')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText('Set up forwarding'));
  });
  expect(await screen.findByText('connect screen')).toBeTruthy();
});

it('pull to refresh asks the inbox (re-match) before the other views', async () => {
  await renderInbox();
  await screen.findByText('Hiring sync');
  calls = [];
  const refreshControl = screen.getByTestId('summary-inbox').props.refreshControl as { props: { onRefresh(): void } };
  await act(async () => {
    refreshControl.props.onRefresh();
  });
  expect(calls.map((call) => (call.name === 'summaryRead' ? `read:${String(call.request.view)}` : call.name))).toEqual([
    'summaryStatus',
    'read:inbox',
    'read:recent',
  ]);
});

it('shows an error with a retry when the inbox cannot be read', async () => {
  mockCall.mockImplementation(async (name: string, raw: unknown) => {
    if (name === 'summaryRead') throw Object.assign(new Error('down'), { code: 'functions/unavailable' });
    return fakeServer(name, raw);
  });
  await renderInbox();
  expect(await screen.findByTestId('summary-inbox-error')).toBeTruthy();
  mockCall.mockImplementation(fakeServer);
  await act(async () => {
    fireEvent.press(screen.getByText('Try again'));
  });
  expect(await screen.findByText('Urpayroll')).toBeTruthy();
});
