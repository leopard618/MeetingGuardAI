/**
 * The commitments review screen (M11, docs/v2/M11-DESIGN.md sections 3, 8 and 11) over mocked
 * summary hooks: the gate, the as-written list prepared first (free), the origin block first, a
 * quote under every card as plain text, the banner per reason, payment-like and owner guesses
 * never ticked, the AI notice before the first AI preparation (the only AsyncStorage key), quota,
 * preparing, stale, empty, Accept disabled offline, "Added" only after the decide answer, the
 * default reminder and its group notice, the Edit sheet re-prefixing the title, Drop, Undo with
 * "changed", the read-only stale list, leaving with edits, and "Delete the summary, keep my tasks".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import type {
  CommitmentDecision,
  CommitmentItem,
  SummaryCommitments,
  SummaryCommitmentsResponse,
  SummaryDetail,
  SummaryStatusResponse,
} from '../../../core/aiContract';
import type { RootStackParamList } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { addDaysToLocalDate, todayInZone } from '../../../core/time';
import { I18nProvider, i18n } from '../../../i18n';
import { commitmentAppError } from '../../../services/summaries/commitmentsCore';
import { commitmentsAiNoticeKey, resetCommitmentsAiNoticeForTests } from '../../../services/summaries/commitmentsNotice';
import { SUMMARIES_DISABLED_STATUS } from '../../../services/summaries/summaryCore';
import type { DecideCommitmentsResult, SummaryCommitmentsHookState } from '../../../services/summaries/useSummaryCommitments';
import { SummaryCommitmentsScreen } from '../SummaryCommitmentsScreen';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

// The signed-in account: the AI notice flag is per account (decision 17).
let mockUid = 'uid-screen-a';
const NOTICE_KEY = (): string => commitmentsAiNoticeKey(mockUid);
jest.mock('../../../services/auth', () => ({
  useAuth: () => ({ authUser: { uid: mockUid } }),
  authService: { currentUser: null },
}));

let mockOnline = true;
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
    useSyncState: () => ({ online: mockOnline, pendingWrites: 0, lastSyncedAt: null }),
  };
});

const mockPickerProps: Record<string, unknown>[] = [];
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPickerProps.push(props);
    return null;
  },
}));

// The hook's answer lives in a tiny store, so a change re-renders the screen like the real cache.
interface MockHookState {
  state: SummaryCommitmentsHookState;
  data: SummaryCommitments | null;
  error: AppError | null;
  busy: 'prepare' | 'decide' | null;
}
let mockHook: MockHookState = { state: 'loading', data: null, error: null, busy: null };
const mockListeners = new Set<() => void>();
function setHook(patch: Partial<MockHookState>): void {
  mockHook = { ...mockHook, ...patch };
  mockListeners.forEach((listener) => listener());
}
let mockStatus: SummaryStatusResponse | null = null;
let mockSummary: SummaryDetail | null = null;
let mockSummaryLoading = false;
/** useSummary().refresh (summaryRead get again); a test can make it change mockSummary. */
const mockSummaryRefresh = jest.fn(async () => undefined);
const mockUseCommitments = jest.fn();
const mockPrepare = jest.fn<Promise<SummaryCommitmentsResponse | null>, [string]>();
const mockDecide = jest.fn<Promise<DecideCommitmentsResult>, [readonly CommitmentDecision[], unknown]>();
const mockRefresh = jest.fn(async () => undefined);
const mockDelete = jest.fn();

jest.mock('../../../services/summaries', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const notice = jest.requireActual('../../../services/summaries/commitmentsNotice');
  const subscribe = (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  };
  return {
    useSummaryStatus: () => ({
      status: mockStatus,
      available: mockStatus !== null && mockStatus.enabled && mockStatus.allowed,
      error: null,
      refresh: jest.fn(),
    }),
    useSummary: (_id: string, options?: { enabled?: boolean }) => {
      React.useSyncExternalStore(subscribe, () => mockSummary);
      return {
        summary: options?.enabled === false ? null : mockSummary,
        error: null,
        loading: options?.enabled === false ? false : mockSummaryLoading,
        refresh: mockSummaryRefresh,
      };
    },
    useSummaryCommitments: (summaryId: string, options?: { enabled?: boolean }) => {
      mockUseCommitments(summaryId, options);
      const hook = React.useSyncExternalStore(subscribe, () => mockHook);
      const idle = options?.enabled === false;
      return {
        state: idle ? 'idle' : hook.state,
        data: idle ? null : hook.data,
        error: idle ? null : hook.error,
        busy: hook.busy,
        usage: null,
        prepare: (mode: string) => mockPrepare(mode),
        decide: (decisions: readonly CommitmentDecision[], decideOptions: unknown) => mockDecide(decisions, decideOptions),
        refresh: mockRefresh,
      };
    },
    useCommitmentsAiNotice: notice.useCommitmentsAiNotice,
    summariesService: { deleteSummary: (...args: unknown[]) => mockDelete(...args) as Promise<unknown> },
  };
});

const ID = 'a'.repeat(64);
const KEY = 'x_0123456789abcdef';
const TASK_ID = 'sm_0123456789abcdef0123456789abcdef';
const QUOTE_A = 'Provide APK access/files to Urpayroll at https://pay.example.com/x (owner: Bish)';

const STATUS: SummaryStatusResponse = { ...SUMMARIES_DISABLED_STATUS, enabled: true, allowed: true, ready: true };

function item(anchorId: string, overrides: Partial<CommitmentItem> = {}): CommitmentItem {
  return {
    anchorId,
    number: 1,
    anchorKind: 'item',
    sectionKind: 'action_items',
    sectionHeading: 'Action items',
    quote: `Quote of ${anchorId}`,
    title: `Title of ${anchorId}`,
    owner: null,
    due: null,
    confidence: null,
    flags: [],
    preselected: true,
    status: 'open',
    taskId: null,
    taskExists: null,
    via: null,
    ...overrides,
  };
}

const A = item('i_00000000000a', {
  quote: QUOTE_A,
  title: 'Bish: Provide APK access/files to Urpayroll',
  owner: { name: 'Bish', isUser: false, guess: false },
  flags: ['has_link'],
  preselected: true,
});
const B = item('i_00000000000b', {
  title: 'Send the signed contract',
  owner: { name: 'Ana Gomez', isUser: true, guess: false },
  due: { date: '2030-01-04', time: null, zone: null, quote: 'by Friday Jan 4', overdue: false },
});
const C = item('i_00000000000c', { title: 'Wire $5,000 to the vendor', flags: ['payment_like'], preselected: true });
const D = item('i_00000000000d', { title: 'Review the deck', owner: { name: 'Ana', isUser: true, guess: true }, flags: ['owner_guess'] });
const E = item('i_00000000000e', { title: 'Book the room' });
const F = item('i_00000000000f', { title: 'Bish: Share the notes', status: 'accepted', taskId: TASK_ID, taskExists: true, via: 'app', preselected: false });

function commitments(overrides: Partial<SummaryCommitments> = {}): SummaryCommitments {
  return {
    key: KEY,
    mode: 'as_written',
    preparedAt: '2026-11-12T10:00:00.000Z',
    preselect: { allowed: true, selectAll: true, reason: null },
    origin: {
      meetingId: 'mtgUrpayroll01',
      meetingTitle: 'Urpayroll weekly sync',
      occurrenceDate: null,
      localDate: '2026-10-16',
      tier: 'vendor_verified',
      senderDomain: 'notetaker.example',
      forwardedBy: null,
    },
    truncated: false,
    meetingChanged: false,
    items: [A, B, C, D, E, F],
    ...overrides,
  };
}

const SUMMARY: SummaryDetail = {
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
  senderDomain: 'notetaker.example',
  count: null,
  match: null,
  suggestions: [],
  subject: null,
  titleLine: null,
  fromAddress: null,
  forwardedBy: null,
  text: 'Action items',
  sections: [],
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Stack = createStackNavigator<RootStackParamList>();

function PreviousScreen() {
  return <Text testID="previous-screen">summary</Text>;
}
function PricingScreen() {
  return <Text testID="pricing-screen">plans</Text>;
}

async function renderScreen() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="SummaryView" component={PreviousScreen} initialParams={{ summaryId: ID }} />
            <Stack.Screen name="SummaryCommitments" component={SummaryCommitmentsScreen} />
            <Stack.Screen name="Pricing" component={PricingScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
  await act(async () => {
    navigationRef.navigate('SummaryCommitments', { summaryId: ID });
  });
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

function toastTexts(): string[] {
  return (Toast.show as jest.Mock).mock.calls.map((call: [{ text1?: string }]) => call[0].text1 ?? '');
}

function lastAlertButtons(): { text?: string; style?: string; onPress?: () => void }[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[];
}

function isChecked(anchorId: string): boolean {
  return screen.getByTestId(`commitment-${anchorId}-select`).props.accessibilityState?.checked === true;
}

function isDisabled(testID: string): boolean {
  return screen.getByTestId(testID).props.accessibilityState?.disabled === true;
}

/** testIDs in render order (host tree, depth first). */
function testIdsInOrder(): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const element = node as { props?: { testID?: unknown }; children?: unknown };
    if (typeof element.props?.testID === 'string') ids.push(element.props.testID);
    walk(element.children ?? null);
  };
  walk(screen.toJSON());
  return ids;
}

function decided(results: { anchorId: string; outcome: string; taskId?: string | null }[], data: SummaryCommitments): DecideCommitmentsResult {
  const response = { op: 'decide', state: 'ready', commitments: data, results: results.map((r) => ({ taskId: null, ...r })) } as SummaryCommitmentsResponse;
  return { status: 'done', results: response.results ?? [], response };
}

const TOMORROW = () => addDaysToLocalDate(todayInZone('UTC'), 1);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await AsyncStorage.clear();
  resetCommitmentsAiNoticeForTests();
  mockUid = 'uid-screen-a';
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockOnline = true;
  mockStatus = STATUS;
  mockSummary = SUMMARY;
  mockSummaryLoading = false;
  mockSummaryRefresh.mockReset();
  mockSummaryRefresh.mockImplementation(async () => undefined);
  mockHook = { state: 'ready', data: commitments(), error: null, busy: null };
  mockListeners.clear();
  mockUseCommitments.mockClear();
  mockPrepare.mockReset();
  mockDecide.mockReset();
  mockRefresh.mockClear();
  mockDelete.mockReset();
  mockPickerProps.length = 0;
  (Toast.show as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('asks nothing and says "not available" unless the feature is on for this account', async () => {
  mockStatus = { ...STATUS, allowed: false };
  await renderScreen();
  expect(screen.getByTestId('commitments-unavailable')).toBeTruthy();
  expect(mockUseCommitments).toHaveBeenCalledWith(ID, { enabled: false });

  // summaryCommitments not deployed: functions/not-found without details reads as not_enabled.
  mockStatus = STATUS;
  mockHook = { state: 'error', data: null, error: commitmentAppError('not_enabled', 'functions/not-found'), busy: null };
  await renderScreen();
  expect(screen.getByTestId('commitments-unavailable')).toBeTruthy();
  expect(mockPrepare).not.toHaveBeenCalled();
});

it('says a summary in the inbox must be filed first', async () => {
  mockSummary = { ...SUMMARY, status: 'inbox' };
  mockHook = { state: 'error', data: null, error: commitmentAppError('not_found'), busy: null };
  await renderScreen();
  expect(screen.getByTestId('commitments-not-filed')).toBeTruthy();
  expect(screen.getByText('This summary is waiting for a meeting. File it or keep it first, then review its commitments.')).toBeTruthy();
});

it('prepares the action items as written first (free) when nothing is prepared', async () => {
  mockHook = { state: 'none', data: null, error: null, busy: null };
  let finish: (value: SummaryCommitmentsResponse | null) => void = () => undefined;
  mockPrepare.mockImplementation(() => {
    setHook({ busy: 'prepare' });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await renderScreen();
  expect(mockPrepare).toHaveBeenCalledTimes(1);
  expect(mockPrepare).toHaveBeenCalledWith('as_written');
  expect(screen.getByText('Reading the action items...')).toBeTruthy();
  await act(async () => {
    setHook({ state: 'ready', data: commitments(), busy: null });
    finish({ op: 'prepare', state: 'ready', commitments: commitments() });
  });
  expect(screen.getByTestId('commitments-origin')).toBeTruthy();
  expect(mockPrepare).toHaveBeenCalledTimes(1);
});

it('shows the origin first, a plain quote under every card, and never ticks payment-like items or owner guesses', async () => {
  await renderScreen();
  const ids = testIdsInOrder();
  const origin = ids.indexOf('commitments-origin');
  expect(origin).toBeGreaterThanOrEqual(0);
  for (const it of [A, B, C, D, E, F]) expect(ids.indexOf(`commitment-${it.anchorId}`)).toBeGreaterThan(origin);
  expect(origin).toBeLessThan(ids.indexOf('commitments-mode-row'));

  expect(screen.getByTestId('commitments-origin-source').props.children).toBe("From your notetaker's summary of Urpayroll weekly sync, Oct 16, 2026.");
  expect(screen.getByText('Meeting Guard AI did not attend this meeting.')).toBeTruthy();
  expect(screen.getByText('The action items exactly as your notetaker wrote them.')).toBeTruthy();

  for (const it of [A, B, C, D, E, F]) {
    const quote = screen.getByTestId(`commitment-${it.anchorId}-quote`);
    expect(quote.props.children).toBe(it.quote);
    // Links stay plain text: nothing on the quote can be pressed.
    expect(quote.props.onPress).toBeUndefined();
  }
  expect(within(screen.getByTestId(`commitment-${A.anchorId}`)).getByText('From the summary:')).toBeTruthy();

  // Other people's commitments keep the name in the title, as a follow-up.
  expect(screen.getByTestId(`commitment-${A.anchorId}-title`).props.children).toBe('Bish: Provide APK access/files to Urpayroll');
  expect(screen.getByTestId(`commitment-${A.anchorId}-owner`).props.children).toBe('Owner in the summary: Bish');
  expect(screen.getByTestId(`commitment-${A.anchorId}-owner-note`).props.children).toBe('A follow-up for you: the task title starts with Bish.');
  expect(screen.getByTestId(`commitment-${D.anchorId}-owner`).props.children).toBe('You? (the summary says: Ana)');
  expect(screen.getByTestId(`commitment-${B.anchorId}-due-0`).props.children).toBe('Due Jan 4, 2030 (the summary says: by Friday Jan 4)');
  expect(screen.getByTestId(`commitment-${C.anchorId}-reason`).props.children).toBe('Check this one: it mentions a payment or a code.');

  expect(isChecked(A.anchorId)).toBe(true);
  expect(isChecked(B.anchorId)).toBe(true);
  expect(isChecked(E.anchorId)).toBe(true);
  expect(isChecked(C.anchorId)).toBe(false);
  expect(isChecked(D.anchorId)).toBe(false);
  // The accepted one has no checkbox: it is in the tasks already.
  expect(screen.queryByTestId(`commitment-${F.anchorId}-select`)).toBeNull();
  expect(screen.getByTestId(`commitment-${F.anchorId}-status`)).toBeTruthy();
  expect(screen.getByText('In your tasks')).toBeTruthy();
  expect(screen.getByText('Added in the app')).toBeTruthy();

  expect(screen.getByTestId('commitments-accept')).toBeTruthy();
  expect(screen.getByText('Add 3 selected')).toBeTruthy();
  expect(screen.getByTestId('commitments-select-all')).toBeTruthy();
});

it('shows one banner per reason, and no Select all on a summary sent to someone else', async () => {
  mockHook = {
    ...mockHook,
    data: commitments({
      preselect: { allowed: false, selectAll: false, reason: 'not_addressed_to_you' },
      truncated: true,
      items: [{ ...A, preselected: false }, { ...E, preselected: false }],
    }),
  };
  await renderScreen();
  expect(screen.getByTestId('commitments-banner-not_addressed_to_you').props.children).toBe(
    "This summary was not sent to one of your mailboxes. It may be about someone else's meeting, so choose each item yourself.",
  );
  expect(screen.getByTestId('commitments-banner-truncated')).toBeTruthy();
  expect(screen.queryByTestId('commitments-select-all')).toBeNull();
  expect(isChecked(A.anchorId)).toBe(false);
  expect(screen.getByText('Select the tasks you want to add.')).toBeTruthy();
  expect(isDisabled('commitments-accept')).toBe(true);
});

it('says "Added" only after the server answered, with the drafts of the selection', async () => {
  let answer: (value: DecideCommitmentsResult) => void = () => undefined;
  mockDecide.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await renderScreen();
  await press('commitments-accept');

  expect(mockDecide).toHaveBeenCalledTimes(1);
  const [decisions, options] = mockDecide.mock.calls[0] ?? [];
  expect(options).toEqual({ key: KEY, timezone: 'UTC' });
  expect(decisions).toEqual([
    {
      anchorId: A.anchorId,
      decision: 'accept',
      draft: { title: 'Bish: Provide APK access/files to Urpayroll', dueDate: TOMORROW(), dueTime: '09:00', reminderMinutesBefore: 0, owner: { name: 'Bish', isUser: false } },
    },
    {
      anchorId: B.anchorId,
      decision: 'accept',
      draft: { title: 'Send the signed contract', dueDate: '2030-01-04', dueTime: '09:00', reminderMinutesBefore: 0, owner: { name: 'Ana Gomez', isUser: true } },
    },
    {
      anchorId: E.anchorId,
      decision: 'accept',
      draft: { title: 'Book the room', dueDate: TOMORROW(), dueTime: '09:00', reminderMinutesBefore: 0, owner: null },
    },
  ]);
  expect(screen.getByText('Adding tasks...')).toBeTruthy();
  expect(toastTexts()).toEqual([]);

  const after = commitments({
    items: [
      { ...A, status: 'accepted', taskId: TASK_ID, taskExists: true, via: 'app' },
      { ...B, status: 'accepted', taskId: TASK_ID, taskExists: true, via: 'app' },
      C,
      D,
      { ...E, status: 'accepted', taskId: TASK_ID, taskExists: true, via: 'app' },
      F,
    ],
  });
  await act(async () => {
    setHook({ data: after });
    answer(
      decided(
        [
          { anchorId: A.anchorId, outcome: 'added', taskId: TASK_ID },
          { anchorId: B.anchorId, outcome: 'added', taskId: TASK_ID },
          { anchorId: E.anchorId, outcome: 'already_added', taskId: TASK_ID },
        ],
        after,
      ),
    );
  });
  expect(toastTexts()).toEqual(['Added 2 tasks. Their reminders are set on this phone.']);
  expect((Toast.show as jest.Mock).mock.calls[0]?.[0].text2).toBe('1 was already in your tasks.');
  // The list is the decide answer's: the accepted ones left the selection.
  expect(screen.queryByTestId(`commitment-${A.anchorId}-select`)).toBeNull();
  expect(screen.getByText('Add 0 selected')).toBeTruthy();
});

it('keeps Accept disabled offline', async () => {
  mockOnline = false;
  await renderScreen();
  expect(screen.getByTestId('commitments-footer-hint').props.children).toBe('Connect to the internet to add these tasks.');
  expect(isDisabled('commitments-accept')).toBe(true);
  await press('commitments-accept');
  expect(mockDecide).not.toHaveBeenCalled();
});

it('groups the default reminders, and "No reminder" leaves the tasks without one', async () => {
  await renderScreen();
  expect(screen.getByTestId('reminder-default-notice')).toBeTruthy();
  expect(screen.getByText('2 reminders tomorrow at 9:00 AM')).toBeTruthy();
  expect(screen.getByText('Reminders set for the same time arrive together.')).toBeTruthy();
  expect(screen.getByTestId(`commitment-${E.anchorId}-due-0`).props.children).toBe('No date in the summary. Reminder: Tomorrow at 9:00 AM, your choice.');

  await press('reminder-default-none');
  expect(screen.getByText('2 items without a reminder')).toBeTruthy();
  mockDecide.mockResolvedValue({ status: 'stale' });
  await press('commitments-accept');
  const drafts = (mockDecide.mock.calls[0]?.[0] ?? []).map((decision) => (decision.decision === 'accept' ? decision.draft : null));
  expect(drafts[0]).toMatchObject({ dueDate: null, dueTime: null, reminderMinutesBefore: null });
  expect(toastTexts()).toEqual(['These suggestions changed on another device. Check them and try again.']);
});

it('refuses a picked reminder that has passed', async () => {
  await renderScreen();
  await press('reminder-default-picked');
  const datePicker = mockPickerProps[mockPickerProps.length - 1];
  expect(datePicker?.mode).toBe('date');
  // iOS (the jest-expo default): a date spinner, Done, then a time spinner, Done; a time that has passed.
  await act(async () => {
    (datePicker?.onChange as (event: { type: string }, value?: Date) => void)({ type: 'set' }, new Date(2020, 0, 2, 9, 0));
  });
  await press('reminder-default-picker-done');
  const timePicker = mockPickerProps[mockPickerProps.length - 1];
  expect(timePicker?.mode).toBe('time');
  await act(async () => {
    (timePicker?.onChange as (event: { type: string }, value?: Date) => void)({ type: 'set' }, new Date(2020, 0, 2, 10, 30));
  });
  await press('reminder-default-picker-done');
  expect(screen.queryByTestId('reminder-default-picker')).toBeNull();
  expect(screen.getByText('Jan 2, 2020 at 10:30 AM')).toBeTruthy();
  expect(screen.getByTestId('reminder-default-error').props.children).toBe('That time has already passed. Pick a later one.');
  await press('commitments-accept');
  expect(mockDecide).not.toHaveBeenCalled();
});

describe('Suggest with AI', () => {
  it('shows the AI notice once, stores only its boolean flag, then prepares with AI', async () => {
    mockPrepare.mockResolvedValue({ op: 'prepare', state: 'ready', commitments: commitments({ mode: 'ai' }) });
    await renderScreen();
    expect(screen.getByText('Uses 1 AI action, the first time only.')).toBeTruthy();
    await press('commitments-switch-mode');
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(screen.getByTestId('commitments-notice')).toBeTruthy();
    expect(screen.getByText(/sends the text of this summary to OpenAI through our server/)).toBeTruthy();

    await press('commitments-notice-continue');
    expect(mockPrepare).toHaveBeenCalledWith('ai');

    // The only thing on the phone: the boolean notice flag, no content.
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).toEqual([NOTICE_KEY()]);
    expect(await AsyncStorage.getItem(NOTICE_KEY())).toBe('1');
  });

  it('skips the notice once this account saw it', async () => {
    await AsyncStorage.setItem(NOTICE_KEY(), '1');
    mockPrepare.mockResolvedValue({ op: 'prepare', state: 'ready', commitments: commitments({ mode: 'ai' }) });
    await renderScreen();
    await press('commitments-switch-mode');
    expect(screen.queryByTestId('commitments-notice')).toBeNull();
    expect(mockPrepare).toHaveBeenCalledWith('ai');
  });

  it('shows the notice to a second account on the same phone', async () => {
    await AsyncStorage.setItem(NOTICE_KEY(), '1');
    mockUid = 'uid-screen-b';
    await renderScreen();
    await press('commitments-switch-mode');
    expect(screen.getByTestId('commitments-notice')).toBeTruthy();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('offers the as-written list instead of the notice', async () => {
    await renderScreen();
    await press('commitments-switch-mode');
    await press('commitments-notice-as-written');
    // The list shown is already the as-written one: nothing to prepare, nothing stored.
    expect(screen.queryByTestId('commitments-notice')).toBeNull();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('prepares again (free) after the text changed', async () => {
    mockHook = { ...mockHook, state: 'stale', data: null };
    mockPrepare.mockResolvedValue(null);
    await renderScreen();
    // Stale with no list: the text changed; Prepare again (free) with the free list.
    expect(screen.getByTestId('commitments-stale')).toBeTruthy();
    expect(screen.getByText('Preparing them again is free.')).toBeTruthy();
    await press('commitments-stale-prepare');
    expect(mockPrepare).toHaveBeenCalledWith('as_written');
  });

  it('handles a used-up allowance with Plans and the free list', async () => {
    mockHook = {
      ...mockHook,
      data: commitments({ mode: 'ai' }),
      error: commitmentAppError('quota_exceeded', null, { used: 10, limit: 10, plan: 'free', resetsAt: '2026-11-13T00:00:00.000Z' }),
    };
    mockPrepare.mockResolvedValue({ op: 'prepare', state: 'ready', commitments: commitments() });
    await renderScreen();
    expect(screen.getByTestId('commitments-quota')).toBeTruthy();
    expect(screen.getByText('Your AI allowance is used up. The action items as written are still free.')).toBeTruthy();
    expect(screen.getByText(/^Your allowance renews: .+.$/)).toBeTruthy();
    await press('commitments-quota-as-written');
    expect(mockPrepare).toHaveBeenCalledWith('as_written');
    await press('commitments-quota-plans');
    expect(navigationRef.getCurrentRoute()?.name).toBe('Pricing');
  });
});

it('shows "being prepared" while another device prepares, and Try again once the polls gave up', async () => {
  mockHook = { state: 'preparing', data: null, error: null, busy: null };
  await renderScreen();
  expect(screen.getByTestId('commitments-preparing')).toBeTruthy();
  expect(screen.queryByTestId('commitments-preparing-slow')).toBeNull();
  await act(async () => {
    setHook({ error: new AppError('timeout', 'still preparing', { details: { preparing: true } }) });
  });
  expect(screen.getByTestId('commitments-preparing-slow')).toBeTruthy();
  await press('commitments-preparing-retry');
  expect(mockRefresh).toHaveBeenCalled();
});

it('offers Try again on the "being prepared" card after any failed poll (the polls may have stopped)', async () => {
  mockHook = { state: 'preparing', data: null, error: new AppError('offline', 'summary commitments unreachable'), busy: null };
  await renderScreen();
  expect(screen.getByText(/This can take a minute or two; they appear here when they are ready\.$/)).toBeTruthy();
  expect(screen.getByTestId('commitments-preparing-error').props.children).toBe('You are offline. Connect to the internet and try again.');
  expect(screen.queryByTestId('commitments-preparing-slow')).toBeNull();
  await press('commitments-preparing-retry');
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it('shows the start card with both buttons, never an endless spinner, when nothing is prepared after another preparation failed', async () => {
  await AsyncStorage.setItem(NOTICE_KEY(), '1');
  mockHook = { state: 'none', data: null, error: null, busy: null };
  mockPrepare.mockImplementationOnce(async () => {
    setHook({ error: new AppError('offline', 'Device is offline') });
    return null;
  });
  mockPrepare.mockImplementationOnce(async () => {
    setHook({ state: 'preparing', error: null });
    return { op: 'prepare', state: 'preparing', commitments: null };
  });
  await renderScreen();
  // The free list was asked for by itself and failed: the start card.
  expect(mockPrepare).toHaveBeenNthCalledWith(1, 'as_written');
  expect(screen.getByTestId('commitments-start')).toBeTruthy();
  expect(screen.getByTestId('commitments-start-costs').props.children).toBe('As written: free, no AI is used. With AI: 1 AI action, the first time only.');

  await press('commitments-start-ai');
  expect(mockPrepare).toHaveBeenNthCalledWith(2, 'ai');
  expect(screen.getByTestId('commitments-preparing')).toBeTruthy();

  // That preparation failed elsewhere (its lease was released): 'none' again, nothing in flight.
  await act(async () => {
    setHook({ state: 'none', error: null });
  });
  expect(screen.queryByTestId('commitments-preparing-self')).toBeNull();
  expect(screen.getByTestId('commitments-start-as-written')).toBeTruthy();
  expect(screen.getByTestId('commitments-start-ai')).toBeTruthy();
  expect(mockPrepare).toHaveBeenCalledTimes(2);
});

describe('stale with no list after an AI list', () => {
  async function renderStaleAfterAi(): Promise<void> {
    await AsyncStorage.setItem(NOTICE_KEY(), '1');
    mockHook = { state: 'ready', data: commitments({ mode: 'ai' }), error: null, busy: null };
    await renderScreen();
    await act(async () => {
      setHook({ state: 'stale', data: null });
    });
    expect(screen.getByTestId('commitments-stale')).toBeTruthy();
  }

  it('prepares again with AI and always offers the free list beside it', async () => {
    await renderStaleAfterAi();
    mockPrepare.mockImplementation(async (mode) => {
      if (mode === 'ai') setHook({ error: commitmentAppError('upstream_error') });
      return null;
    });
    await press('commitments-stale-prepare');
    expect(mockPrepare).toHaveBeenLastCalledWith('ai');
    expect(screen.getByTestId('commitments-prepare-error').props.children).toBe(
      'Suggested tasks are not available right now. Try again, or show the action items as written.',
    );
    await press('commitments-stale-as-written');
    expect(mockPrepare).toHaveBeenLastCalledWith('as_written');
  });

  it('shows the quota card when the AI allowance is used up', async () => {
    await renderStaleAfterAi();
    mockPrepare.mockImplementation(async (mode) => {
      if (mode === 'ai') setHook({ error: commitmentAppError('quota_exceeded', null, { used: 10, limit: 10, plan: 'free', resetsAt: '2026-11-13T00:00:00.000Z' }) });
      return null;
    });
    await press('commitments-stale-prepare');
    expect(screen.getByTestId('commitments-quota')).toBeTruthy();
    // One free-list button only: the quota card's.
    expect(screen.queryByTestId('commitments-stale-as-written')).toBeNull();
    await press('commitments-quota-as-written');
    expect(mockPrepare).toHaveBeenLastCalledWith('as_written');
  });
});

describe('a summary that is no longer here', () => {
  it('goes back when the summary was deleted on this phone (also by "Disconnect and delete" above it)', async () => {
    await renderScreen();
    expect(screen.getByTestId('commitments-origin')).toBeTruthy();
    // summariesService dropped its copy and commitmentsService its cache: no spinner left behind.
    await act(async () => {
      mockSummary = null;
      setHook({ state: 'loading', data: null });
    });
    expect(toastTexts()).toEqual(['This summary is no longer here.']);
    expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryView');
  });

  it('asks summaryRead again before a commitments not_found reads as deleted: an inbox summary says "file it first"', async () => {
    let answer: () => void = () => undefined;
    mockSummaryRefresh.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          answer = () => resolve(undefined);
        }),
    );
    mockHook = { state: 'error', data: null, error: commitmentAppError('not_found'), busy: null };
    await renderScreen();
    // The cached copy still says filed; summaryRead has not answered yet: wait, never "gone".
    expect(mockSummaryRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('commitments-loading')).toBeTruthy();
    expect(toastTexts()).toEqual([]);

    await act(async () => {
      mockSummary = { ...SUMMARY, status: 'inbox' };
      answer();
    });
    expect(screen.getByTestId('commitments-not-filed')).toBeTruthy();
    expect(toastTexts()).toEqual([]);
    expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryCommitments');
  });

  it('goes back on a commitments not_found once summaryRead answered and the summary is not in the inbox', async () => {
    mockHook = { state: 'error', data: null, error: commitmentAppError('not_found'), busy: null };
    await renderScreen();
    expect(mockSummaryRefresh).toHaveBeenCalledTimes(1);
    expect(toastTexts()).toEqual(['This summary is no longer here.']);
    expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryView');
  });
});

it('says when nothing was found, and offers the other list', async () => {
  mockHook = { ...mockHook, state: 'empty', data: commitments({ mode: 'ai', items: [] }) };
  await renderScreen();
  expect(screen.getByText('No commitments found.')).toBeTruthy();
  expect(screen.getByText('Meeting Guard AI found no commitments in this summary.')).toBeTruthy();
  expect(screen.getByText('Show the action items as written')).toBeTruthy();
  expect(screen.queryByTestId('commitments-footer')).toBeNull();
});

it('shows a stale list read-only with Prepare again', async () => {
  mockHook = { ...mockHook, state: 'stale', data: commitments({ preselect: { allowed: false, selectAll: false, reason: null } }) };
  mockPrepare.mockResolvedValue({ op: 'prepare', state: 'ready', commitments: commitments() });
  await renderScreen();
  expect(screen.getByText('This is the list from before the change. Prepare it again to add or change tasks.')).toBeTruthy();
  expect(screen.queryByTestId(`commitment-${A.anchorId}-select`)).toBeNull();
  expect(screen.queryByTestId(`commitment-${A.anchorId}-drop`)).toBeNull();
  expect(screen.queryByTestId('commitments-footer')).toBeNull();
  await press('commitments-stale-prepare');
  expect(mockPrepare).toHaveBeenCalledWith('as_written');
});

it('edits a suggestion: a new owner moves the name prefix, and the accept carries the edit', async () => {
  await renderScreen();
  await press(`commitment-${A.anchorId}-edit`);
  expect(screen.getByTestId('commitment-edit-sheet')).toBeTruthy();
  expect(screen.getByTestId('commitment-edit-title').props.value).toBe('Bish: Provide APK access/files to Urpayroll');
  await press('commitment-edit-owner-you');
  expect(screen.getByTestId('commitment-edit-title').props.value).toBe('Provide APK access/files to Urpayroll');
  await press('commitment-edit-owner-other');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('commitment-edit-owner-name'), 'Cristina');
  });
  expect(screen.getByTestId('commitment-edit-title').props.value).toBe('Cristina: Provide APK access/files to Urpayroll');
  // No date in the summary: the sheet opens on the default reminder, tomorrow 9:00 at the time.
  expect(screen.getByTestId('commitment-edit-due').props.children).toMatch(/^Due .+ at 9:00 AM$/);
  expect(screen.getByTestId('commitment-edit-reminder-0').props.accessibilityState).toMatchObject({ selected: true });
  await press('commitment-edit-save');
  expect(screen.queryByTestId('commitment-edit-sheet')).toBeNull();

  expect(screen.getByTestId(`commitment-${A.anchorId}-title`).props.children).toBe('Cristina: Provide APK access/files to Urpayroll');
  expect(screen.getByText('Edited by you')).toBeTruthy();

  mockDecide.mockResolvedValue({ status: 'stale' });
  await press('commitments-accept');
  const first = mockDecide.mock.calls[0]?.[0][0];
  expect(first).toEqual({
    anchorId: A.anchorId,
    decision: 'accept',
    draft: {
      title: 'Cristina: Provide APK access/files to Urpayroll',
      dueDate: TOMORROW(),
      dueTime: '09:00',
      reminderMinutesBefore: 0,
      owner: { name: 'Cristina', isUser: false },
    },
  });
});

it('asks before leaving with edits', async () => {
  await renderScreen();
  await press(`commitment-${E.anchorId}-edit`);
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('commitment-edit-title'), 'Book the big room');
  });
  await press('commitment-edit-save');
  await act(async () => {
    navigationRef.goBack();
  });
  expect(Alert.alert).toHaveBeenCalledWith('Leave without adding?', 'Your edits are only on this screen and will be lost.', expect.any(Array));
  expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryCommitments');
  await act(async () => {
    lastAlertButtons().find((button) => button.text === 'Leave')?.onPress?.();
  });
  expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryView');
});

it('drops, restores and undoes through decide', async () => {
  const dropped = commitments({ items: [A, B, C, D, { ...E, status: 'dropped' }, F] });
  mockDecide.mockImplementation(async (decisions) => {
    const first = decisions[0];
    if (first?.decision === 'drop') {
      setHook({ data: dropped });
      return decided([{ anchorId: first.anchorId, outcome: 'dropped' }], dropped);
    }
    if (first?.decision === 'restore') return decided([{ anchorId: first.anchorId, outcome: 'restored' }], commitments());
    return decided([{ anchorId: first?.anchorId ?? '', outcome: 'changed', taskId: TASK_ID }], commitments());
  });
  await renderScreen();
  await press(`commitment-${E.anchorId}-drop`);
  expect(mockDecide.mock.calls[0]?.[0]).toEqual([{ anchorId: E.anchorId, decision: 'drop' }]);
  expect(toastTexts()).toContain('Dropped');
  // Dropped ones collapse into a row with Restore.
  expect(screen.getByText('1 dropped')).toBeTruthy();
  expect(screen.queryByTestId(`commitment-${E.anchorId}`)).toBeNull();
  await press('commitments-dropped-toggle');
  await press(`commitment-${E.anchorId}-restore`);
  expect(mockDecide.mock.calls[1]?.[0]).toEqual([{ anchorId: E.anchorId, decision: 'restore' }]);

  // Undo refused because the task changed: offer to open it.
  await press(`commitment-${F.anchorId}-undo`);
  expect(mockDecide.mock.calls[2]?.[0]).toEqual([{ anchorId: F.anchorId, decision: 'remove' }]);
  expect(Alert.alert).toHaveBeenCalledWith(
    'Undo',
    'This task was changed after it was added, so it was not removed. Open it to change or delete it.',
    expect.any(Array),
  );
  expect(lastAlertButtons().map((button) => button.text)).toEqual(['Cancel', 'Open task']);
});

it('adds again a suggestion whose task was deleted', async () => {
  mockHook = { ...mockHook, data: commitments({ items: [{ ...F, taskExists: false }] }) };
  mockDecide.mockResolvedValue(decided([{ anchorId: F.anchorId, outcome: 'added', taskId: TASK_ID }], commitments()));
  await renderScreen();
  expect(screen.getByText('Removed from your tasks')).toBeTruthy();
  await press(`commitment-${F.anchorId}-add-again`);
  expect(mockDecide.mock.calls[0]?.[0]).toEqual([
    {
      anchorId: F.anchorId,
      decision: 'accept',
      draft: { title: 'Bish: Share the notes', dueDate: TOMORROW(), dueTime: '09:00', reminderMinutesBefore: 0, owner: null },
    },
  ]);
  expect(toastTexts()).toEqual(['Added 1 task. Its reminder is set on this phone.']);
});

it('never says a plain "Try again" after a decide that may have been saved, and keeps the other messages', async () => {
  const unconfirmed =
    'Meeting Guard AI could not confirm this change, and it may have been saved. Check the list before you try again; trying again never adds the same task twice.';
  mockDecide.mockResolvedValue({ status: 'failed', error: commitmentAppError('upstream_error') });
  await renderScreen();
  await press('commitments-accept');
  expect(toastTexts()).toEqual([unconfirmed]);

  (Toast.show as jest.Mock).mockClear();
  mockDecide.mockResolvedValue({ status: 'failed', error: new AppError('timeout', 'summary commitments request timed out') });
  await press('commitments-accept');
  expect(toastTexts()).toEqual([unconfirmed]);

  // Offline never left the phone: nothing was saved.
  (Toast.show as jest.Mock).mockClear();
  mockDecide.mockResolvedValue({ status: 'failed', error: new AppError('offline', 'Device is offline') });
  await press('commitments-accept');
  expect(toastTexts()).toEqual(['You are offline. Connect to the internet and try again.']);
});

it('says how long the summary is kept, and deletes it while keeping the tasks', async () => {
  mockDelete.mockResolvedValue({ changed: true });
  await renderScreen();
  expect(screen.getByTestId('commitments-kept-until').props.children).toBe(
    'This summary is kept until Oct 16, 2027. Tasks you add stay until you delete them.',
  );
  await press('commitments-delete');
  expect(mockDelete).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'Delete the summary and keep your tasks?',
    expect.stringContaining('expires after 45 days'),
    expect.any(Array),
    expect.anything(),
  );
  await act(async () => {
    lastAlertButtons().find((button) => button.text === 'Delete the summary')?.onPress?.();
  });
  expect(mockDelete).toHaveBeenCalledWith(ID);
  expect(toastTexts()).toContain('Summary deleted. Your tasks are kept.');
  expect(navigationRef.getCurrentRoute()?.name).toBe('SummaryView');
});

it('offers no delete before anything was added', async () => {
  mockHook = { ...mockHook, data: commitments({ items: [A, E] }) };
  await renderScreen();
  expect(screen.queryByTestId('commitments-delete')).toBeNull();
  expect(screen.getByText('Accept all (2)')).toBeTruthy();
  await press(`commitment-${A.anchorId}-select`);
  expect(screen.getByText('Add 1 selected')).toBeTruthy();
  await press('commitments-select-all');
  expect(screen.getByText('Accept all (2)')).toBeTruthy();
  await press('commitments-clear-selection');
  expect(isChecked(A.anchorId)).toBe(false);
  expect(isChecked(E.anchorId)).toBe(false);
});
