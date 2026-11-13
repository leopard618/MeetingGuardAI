/**
 * The summary view screen (M10 section 9) over mocked summary hooks: the gate, the origin, the
 * fixed "did not attend" line, the match line, the sections as plain text, Not this meeting,
 * Move / Choose (AttachMeetingSheet), Keep, Copy text, and Delete with the in-app confirmation,
 * then back. Links stay plain text (no onPress anywhere on the summary's text).
 * M11: "Review commitments" (filed or kept only, with the row's counts), the truncated hint, and
 * "This summary is kept until" with the "How long we keep summaries" lines.
 */
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type { SummaryDetail, SummaryStatusResponse } from '../../../core/aiContract';
import type { RootStackParamList } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { SUMMARIES_DISABLED_STATUS, summaryAppError } from '../../../services/summaries/summaryCore';
import { SummaryViewScreen } from '../SummaryViewScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
  };
});

let mockStatus: SummaryStatusResponse | null = null;
let mockStatusError: AppError | null = null;
let mockSummary: SummaryDetail | null = null;
let mockError: AppError | null = null;
let mockLoading = false;
const mockUseSummary = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
const mockRefreshStatus = jest.fn(async () => undefined);
const mockDetach = jest.fn();
const mockKeep = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../../services/summaries', () => ({
  useSummaryStatus: () => ({
    status: mockStatus,
    available: mockStatus !== null && mockStatus.enabled && mockStatus.allowed,
    error: mockStatusError,
    refresh: mockRefreshStatus,
  }),
  useSummary: (summaryId: string, options?: { enabled?: boolean }) => {
    mockUseSummary(summaryId, options);
    if (options?.enabled === false) return { summary: null, error: null, loading: false, refresh: mockRefresh };
    return { summary: mockSummary, error: mockError, loading: mockLoading, refresh: mockRefresh };
  },
  summariesService: {
    detach: (...args: unknown[]) => mockDetach(...args) as Promise<unknown>,
    keep: (...args: unknown[]) => mockKeep(...args) as Promise<unknown>,
    deleteSummary: (...args: unknown[]) => mockDelete(...args) as Promise<unknown>,
  },
}));

// The sheet has its own builder and tests; here it only shows what it was opened with.
jest.mock('../AttachMeetingSheet', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    AttachMeetingSheet: ({ target, onAttached }: { target: unknown; onAttached?: (response: unknown) => void }) =>
      target ? (
        <MockText testID="attach-sheet" onPress={() => onAttached?.({})}>
          {JSON.stringify(target)}
        </MockText>
      ) : null,
  };
});

const mockCopyText: jest.Mock<boolean, [string]> = jest.fn((_text: string) => true);
jest.mock('../../settings/whatsappConnectModel', () => ({
  ...jest.requireActual<object>('../../settings/whatsappConnectModel'),
  copyText: (text: string): boolean => mockCopyText(text) as boolean,
}));

const ID = 'a'.repeat(64);

const STATUS: SummaryStatusResponse = {
  ...SUMMARIES_DISABLED_STATUS,
  enabled: true,
  allowed: true,
  ready: true,
  address: 'abcdefghijklmnopqrstuvwxyz@summaries.example.com',
  mailboxes: ['ana@example.com'],
};

const TEXT = [
  'Urpayroll launch sync',
  'TL;DR: Launch is on track. Plan at https://example.com/plan',
  'Action items',
  '- [ ] Provide APK access (owner: Bish)',
].join('\n');

function offset(fragment: string): number {
  return TEXT.indexOf(fragment);
}

const FILED: SummaryDetail = {
  summaryId: ID,
  status: 'matched',
  title: 'Urpayroll launch sync',
  summaryDate: '2026-10-16',
  receivedAt: '2026-10-16T20:20:00.000Z',
  tier: 'vendor_verified',
  recipientBound: true,
  fresh: true,
  inboxReason: null,
  refusedReason: null,
  senderDomain: 'notes.example.com',
  count: null,
  match: {
    meetingId: 'm1',
    occurrenceDate: null,
    method: 'auto',
    meetingSnapshot: { title: 'Urpayroll weekly sync', startAt: '2026-10-16T19:00:00.000Z', endAt: '2026-10-16T20:00:00.000Z', timezone: 'UTC' },
  },
  suggestions: [],
  subject: 'Recap: Urpayroll launch sync',
  titleLine: 'Urpayroll launch sync',
  fromAddress: 'recap@notes.example.com',
  forwardedBy: null,
  text: TEXT,
  sections: [
    { id: 's_p', kind: 'preamble', heading: null, derived: false, start: 0, end: offset('\nTL;DR'), items: [] },
    { id: 's_t', kind: 'tldr', heading: 'TL;DR', derived: true, start: offset('TL;DR'), end: offset('\nAction items'), items: [] },
    {
      id: 's_a',
      kind: 'action_items',
      heading: 'Action items',
      derived: false,
      start: offset('Action items'),
      end: TEXT.length,
      items: [
        {
          id: 'i_000000000001',
          text: 'Provide APK access (owner: Bish)',
          start: offset('Provide'),
          end: TEXT.length,
          checked: false,
          owner: 'Bish',
          dueText: null,
          flags: [],
        },
      ],
    },
  ],
};

const INBOX_FORWARD: SummaryDetail = {
  ...FILED,
  status: 'inbox',
  tier: 'user_forwarded',
  recipientBound: false,
  inboxReason: 'user_forwarded',
  senderDomain: null,
  match: null,
  fromAddress: 'ana@example.com',
  forwardedBy: 'ana@example.com',
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Stack = createStackNavigator<RootStackParamList>();

function PreviousScreen() {
  return <Text testID="previous-screen">meeting</Text>;
}

function CommitmentsStub({ route }: { route: { params?: { summaryId?: string } } }) {
  return <Text testID="commitments-screen">{route.params?.summaryId}</Text>;
}

async function renderScreen() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="MeetingDetails" component={PreviousScreen} initialParams={{ meetingId: 'm1' }} />
            <Stack.Screen name="SummaryView" component={SummaryViewScreen} />
            <Stack.Screen name="SummaryCommitments" component={CommitmentsStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
  await act(async () => {
    navigationRef.navigate('SummaryView', { summaryId: ID });
  });
}

function lastAlertButtons(): { text?: string; style?: string; onPress?: () => void }[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[];
}

function toastTexts(): string[] {
  return (Toast.show as jest.Mock).mock.calls.map((call: [{ text1?: string }]) => call[0].text1 ?? '');
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockStatus = STATUS;
  mockStatusError = null;
  mockSummary = FILED;
  mockError = null;
  mockLoading = false;
  mockUseSummary.mockClear();
  mockRefresh.mockClear();
  mockRefreshStatus.mockClear();
  mockDetach.mockReset();
  mockKeep.mockReset();
  mockDelete.mockReset();
  mockCopyText.mockClear();
  (Toast.show as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('asks nothing and says "not available" unless the feature is on for this account', async () => {
  mockStatus = { ...STATUS, allowed: false };
  await renderScreen();
  expect(screen.getByTestId('summary-view-unavailable')).toBeTruthy();
  expect(mockUseSummary).toHaveBeenCalledWith(ID, { enabled: false });
  expect(screen.queryByTestId('summary-view-title')).toBeNull();

  // summaryRead not deployed: not_enabled from the read.
  mockStatus = STATUS;
  mockSummary = null;
  mockError = summaryAppError('not_enabled');
  await renderScreen();
  expect(screen.getByTestId('summary-view-unavailable')).toBeTruthy();
});

it('shows a loader, then an error with retry when nothing could be read', async () => {
  mockSummary = null;
  mockLoading = true;
  await renderScreen();
  expect(screen.getByTestId('summary-view-loading')).toBeTruthy();

  mockLoading = false;
  mockError = new AppError('offline');
  await renderScreen();
  expect(screen.getByTestId('summary-view-error')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText('Try again'));
  });
  expect(mockRefresh).toHaveBeenCalled();
});

it('shows a filed vendor summary: origin, the fixed line, the match line and the sections as plain text', async () => {
  await renderScreen();
  expect(screen.getByTestId('summary-view-title').props.children).toBe('Urpayroll launch sync');
  expect(screen.getByTestId('summary-view-chip')).toBeTruthy();
  expect(screen.getByText('From your notetaker')).toBeTruthy();
  const origin = screen.getByTestId('summary-view-origin-line').props.children as string;
  expect(origin).toContain('Written by your notetaker (notes.example.com), received Oct 16, 2026');
  expect(origin).toContain('Signature checked.');
  expect(screen.getByTestId('summary-view-not-attended').props.children).toBe(
    'Meeting Guard AI did not attend this meeting. This text comes from your notetaker.',
  );
  expect(screen.getByTestId('summary-view-match-line').props.children).toContain('Filed under Urpayroll weekly sync, Oct 16, 2026');
  expect(screen.getByTestId('summary-view-match-line').props.children).toContain('Matched automatically by title and time.');

  // The TLDR is headed "Your notetaker's own summary"; other headings stay as written.
  expect(screen.getByText("Your notetaker's own summary")).toBeTruthy();
  expect(screen.getByText('Action items')).toBeTruthy();
  const tldr = screen.getByText('Launch is on track. Plan at https://example.com/plan');
  // Links stay plain text: nothing on the summary text can be pressed.
  expect(tldr.props.onPress).toBeUndefined();
  expect(screen.getByText('Provide APK access (owner: Bish)')).toBeTruthy();
  expect(screen.getByText('Owner: Bish')).toBeTruthy();
  expect(screen.getByTestId('summary-item-i_000000000001-open').props.accessibilityLabel).toBe('Open');
  expect(screen.getByTestId('summary-view-links-plain')).toBeTruthy();
  expect(screen.getByText('From: recap@notes.example.com')).toBeTruthy();
  // The title line is not repeated as a preamble block.
  expect(screen.queryByTestId('summary-section-s_p')).toBeNull();
  expect(screen.queryByTestId('summary-view-choose')).toBeNull();
});

it('moves a filed summary back to the inbox after the confirmation', async () => {
  mockDetach.mockResolvedValue({ changed: true });
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-detach'));
  });
  expect(mockDetach).not.toHaveBeenCalled();
  const confirm = lastAlertButtons().find((button) => button.text === 'Back to the inbox');
  await act(async () => {
    confirm?.onPress?.();
  });
  expect(mockDetach).toHaveBeenCalledWith(ID);
  expect(toastTexts()).toContain('Moved back to your summary inbox');
});

it('opens the sheet in move mode on the current meeting', async () => {
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-move'));
  });
  expect(JSON.parse(screen.getByTestId('attach-sheet').props.children as string)).toEqual({
    summaryId: ID,
    summaryDate: '2026-10-16',
    receivedAt: '2026-10-16T20:20:00.000Z',
    mode: 'move',
    currentMeetingId: 'm1',
    currentOccurrenceDate: null,
  });
  // After a successful attach the sheet closes.
  await act(async () => {
    fireEvent.press(screen.getByTestId('attach-sheet'));
  });
  expect(screen.queryByTestId('attach-sheet')).toBeNull();
});

it('opens Move on the occurrence of a series it is filed under (B4)', async () => {
  mockSummary = FILED.match ? { ...FILED, match: { ...FILED.match, occurrenceDate: '2026-10-16' } } : FILED;
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-move'));
  });
  expect(JSON.parse(screen.getByTestId('attach-sheet').props.children as string)).toMatchObject({
    mode: 'move',
    currentMeetingId: 'm1',
    currentOccurrenceDate: '2026-10-16',
  });
});

it('shows a hand forward waiting in the inbox with Choose a meeting and Keep', async () => {
  mockSummary = INBOX_FORWARD;
  mockKeep.mockResolvedValue({ changed: true });
  await renderScreen();
  expect(screen.getByTestId('summary-view-origin-line').props.children).toBe(
    "Forwarded from ana@example.com. The notetaker's own signature could not be checked.",
  );
  expect(screen.getByText('Forwarded')).toBeTruthy();
  expect(screen.getByTestId('summary-view-match-line').props.children).toBe('Not filed yet: waiting for a meeting.');
  expect(screen.getByTestId('summary-view-reason').props.children).toBe('You forwarded it by hand. Choose the meeting it belongs to.');
  expect(screen.queryByTestId('summary-view-detach')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-choose'));
  });
  expect(JSON.parse(screen.getByTestId('attach-sheet').props.children as string)).toMatchObject({ mode: 'file', currentMeetingId: null });

  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-keep'));
  });
  expect(mockKeep).toHaveBeenCalledWith(ID);
  expect(toastTexts()).toContain('Kept without a meeting');
});

it('copies the whole text, and says so when the clipboard fails', async () => {
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-copy'));
  });
  expect(mockCopyText).toHaveBeenCalledWith(TEXT);
  expect(toastTexts()).toContain('Text copied');

  mockCopyText.mockReturnValueOnce(false);
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-copy'));
  });
  expect(toastTexts()).toContain('Could not copy. Press and hold the text to copy it instead.');
});

it('deletes after the in-app confirmation, then goes back', async () => {
  mockDelete.mockImplementation(async () => {
    mockSummary = null;
    return { changed: true };
  });
  await renderScreen();
  expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryView');
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-delete'));
  });
  expect(mockDelete).not.toHaveBeenCalled();
  // The section 14 "Deletable" wording, with the provider's own copy (T3).
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[1]).toContain('The copy at our email provider expires after 45 days.');
  const confirm = lastAlertButtons().find((button) => button.style === 'destructive');
  expect(confirm?.text).toBe('Delete');
  await act(async () => {
    confirm?.onPress?.();
  });
  expect(mockDelete).toHaveBeenCalledWith(ID);
  expect(toastTexts()).toContain('Summary deleted');
  // Its own toast only, not "no longer here".
  expect(toastTexts()).not.toContain('This summary is no longer here.');
  expect(navigationRef.getCurrentRoute()?.name).toBe('MeetingDetails');
});

it('stays on screen and explains a failed delete', async () => {
  mockDelete.mockRejectedValue(new AppError('offline'));
  await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('summary-view-delete'));
  });
  await act(async () => {
    lastAlertButtons()
      .find((button) => button.style === 'destructive')
      ?.onPress?.();
  });
  expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryView');
  expect((Toast.show as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error' });
});

it('goes back when the summary was deleted on another device', async () => {
  mockSummary = null;
  mockError = summaryAppError('not_found');
  await renderScreen();
  expect(navigationRef.getCurrentRoute()?.name).toBe('MeetingDetails');
  expect(toastTexts()).toContain('This summary is no longer here.');
});

describe('M11', () => {
  it('offers "Review commitments" under the title of a filed summary, with its counts, and opens it', async () => {
    mockSummary = { ...FILED, commitments: { state: 'ready', open: 3, accepted: 2 } };
    await renderScreen();
    expect(screen.getByTestId('summary-view-review-button')).toBeTruthy();
    expect(screen.getByText('Review commitments (3)')).toBeTruthy();
    expect(screen.getByTestId('summary-view-review-facts').props.children).toBe('2 added to your tasks');
    await act(async () => {
      fireEvent.press(screen.getByTestId('summary-view-review-button'));
    });
    expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'SummaryCommitments', params: { summaryId: ID } });
  });

  it('says plainly "Review commitments" before anything was prepared, also for a kept summary', async () => {
    mockSummary = { ...FILED, status: 'kept', match: null };
    await renderScreen();
    expect(screen.getByText('Review commitments')).toBeTruthy();
    expect(screen.queryByTestId('summary-view-review-facts')).toBeNull();
  });

  it('offers nothing for a summary waiting in the inbox', async () => {
    mockSummary = INBOX_FORWARD;
    await renderScreen();
    expect(screen.queryByTestId('summary-view-review')).toBeNull();
  });

  it('says what was kept when summaryRead reports the summary was cut short', async () => {
    mockSummary = { ...FILED, truncated: true };
    await renderScreen();
    expect(screen.getByTestId('summary-view-truncated').props.children).toBe('This summary was cut short because it was very long.');
    expect(screen.getByTestId('summary-view-truncated-hint').props.children).toBe(
      'Only the first part was kept when it arrived. The original email stays in your own mailbox.',
    );

    // The server says it was not cut: no notice, whatever the caps would guess.
    mockSummary = { ...FILED, truncated: false };
    await renderScreen();
    expect(screen.queryByTestId('summary-view-truncated')).toBeNull();
    expect(screen.queryByTestId('summary-view-truncated-hint')).toBeNull();
  });

  it('says until when a filed summary is kept, and shows the rules behind the link', async () => {
    await renderScreen();
    // Received Oct 16, 2026: kept 365 days.
    expect(screen.getByTestId('summary-view-kept-until').props.children).toBe('This summary is kept until October 16th, 2027.');
    expect(screen.queryByTestId('summary-view-retention-list')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('summary-view-retention-link'));
    });
    expect(screen.getByTestId('summary-view-retention-list')).toBeTruthy();
    expect(screen.getByText('Summaries filed under a meeting or kept: 12 months after they arrive, then deleted.')).toBeTruthy();
    expect(screen.getByText(/our email provider's copy after 45 days/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('summary-view-retention-link'));
    });
    expect(screen.queryByTestId('summary-view-retention-list')).toBeNull();
  });

  it('gives no date for an inbox summary, only the rules', async () => {
    mockSummary = INBOX_FORWARD;
    await renderScreen();
    expect(screen.queryByTestId('summary-view-kept-until')).toBeNull();
    expect(screen.getByText('How long we keep summaries')).toBeTruthy();
  });

  it('is translated to Spanish', async () => {
    await i18n.changeLanguage('es');
    mockSummary = { ...FILED, commitments: { state: 'empty', open: 0, accepted: 0 }, truncated: true };
    await renderScreen();
    expect(screen.getByText('Revisar compromisos')).toBeTruthy();
    expect(screen.getByTestId('summary-view-review-facts').props.children).toBe('No se encontraron compromisos');
    expect(screen.getByTestId('summary-view-truncated-hint').props.children).toBe(
      'Al llegar solo se guardó la primera parte. El correo original se queda en tu propio buzón.',
    );
    expect(screen.getByText('Cuánto tiempo guardamos las minutas')).toBeTruthy();
  });
});

it('is translated to Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderScreen();
  expect(screen.getByTestId('summary-view-not-attended').props.children).toBe(
    'Meeting Guard AI no asistió a esta reunión. Este texto viene de tu asistente de notas.',
  );
  expect(screen.getByText('El resumen de tu propio asistente de notas')).toBeTruthy();
  expect(screen.getByText('No es esta reunión')).toBeTruthy();
});
