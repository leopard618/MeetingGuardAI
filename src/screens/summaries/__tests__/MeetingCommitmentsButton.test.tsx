/**
 * "Review commitments" beside Debrief on Meeting details (M11 section 3.1): hidden unless the
 * feature is on for the account and MeetingSummarySection's list holds a filed summary; asks
 * nothing itself (it reads that cached list); targets the newest filed summary with its counts;
 * follows the cache when a decide patches the counts; opens SummaryCommitments.
 */
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { SummaryListItem } from '../../../core/aiContract';
import type { RootStackParamList } from '../../../core/contracts';
import { I18nProvider, i18n } from '../../../i18n';
import { MeetingCommitmentsButton } from '../MeetingCommitmentsButton';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));

let mockAvailable = true;
let mockItems: readonly SummaryListItem[] | null = null;
const mockListeners = new Set<() => void>();
/** Like the service's cache: the same snapshot object until the list changes. */
let mockSnapshot: { view: string; meetingId: string; items: readonly SummaryListItem[]; hasMore: boolean } | null = null;
const mockGetKnownList = jest.fn((view: string, meetingId?: string | null) => {
  if (view !== 'meeting' || meetingId !== 'm1' || mockItems === null) return null;
  if (mockSnapshot?.items !== mockItems) mockSnapshot = { view, meetingId, items: mockItems, hasMore: false };
  return mockSnapshot;
});
const mockListSummaries = jest.fn();
jest.mock('../../../services/summaries', () => ({
  useSummaryStatus: () => ({ status: null, available: mockAvailable, error: null, refresh: jest.fn() }),
  summariesService: {
    getKnownList: (view: string, meetingId?: string | null) => mockGetKnownList(view, meetingId),
    listSummaries: (...args: unknown[]) => mockListSummaries(...args) as unknown,
    subscribe: (listener: () => void) => {
      mockListeners.add(listener);
      return () => {
        mockListeners.delete(listener);
      };
    },
  },
}));

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);

const ROW: SummaryListItem = {
  summaryId: ID_A,
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
    meetingSnapshot: { title: 'Weekly sync', startAt: '2026-10-16T19:00:00.000Z', endAt: '2026-10-16T20:00:00.000Z', timezone: 'UTC' },
  },
  suggestions: [],
};

const OLDER: SummaryListItem = { ...ROW, summaryId: ID_B, receivedAt: '2026-10-09T20:20:00.000Z' };

const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Stack = createStackNavigator<RootStackParamList>();

function DetailsStub() {
  return <MeetingCommitmentsButton meetingId="m1" />;
}

function CommitmentsStub({ route }: { route: { params?: { summaryId?: string } } }) {
  return <Text testID="commitments-screen">{route.params?.summaryId}</Text>;
}

async function renderButton() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="MeetingDetails" component={DetailsStub} initialParams={{ meetingId: 'm1' }} />
            <Stack.Screen name="SummaryCommitments" component={CommitmentsStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockAvailable = true;
  mockItems = [{ ...ROW, commitments: { state: 'ready', open: 5, accepted: 0 } }, OLDER];
  mockListeners.clear();
  mockGetKnownList.mockClear();
  mockListSummaries.mockClear();
});

it('opens the newest filed summary with its open count, and asks nothing itself', async () => {
  await renderButton();
  expect(screen.getByText('Review commitments (5)')).toBeTruthy();
  expect(mockListSummaries).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('meeting-review-commitments-button'));
  });
  expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'SummaryCommitments', params: { summaryId: ID_A } });
});

it('stays hidden while the feature is off for the account, without reading the list', async () => {
  mockAvailable = false;
  await renderButton();
  expect(screen.queryByTestId('meeting-review-commitments')).toBeNull();
  expect(mockGetKnownList).not.toHaveBeenCalled();
});

it('stays hidden until the section listed a filed summary, then follows the cache', async () => {
  mockItems = null;
  await renderButton();
  expect(screen.queryByTestId('meeting-review-commitments')).toBeNull();

  mockItems = [];
  await act(async () => {
    for (const listener of [...mockListeners]) listener();
  });
  expect(screen.queryByTestId('meeting-review-commitments')).toBeNull();

  // MeetingSummarySection's answer arrives, then a decide patches the counts.
  mockItems = [ROW];
  await act(async () => {
    for (const listener of [...mockListeners]) listener();
  });
  expect(screen.getByText('Review commitments')).toBeTruthy();
  mockItems = [{ ...ROW, commitments: { state: 'ready', open: 1, accepted: 4 } }];
  await act(async () => {
    for (const listener of [...mockListeners]) listener();
  });
  expect(screen.getByText('Review commitments (1)')).toBeTruthy();
  expect(screen.getByTestId('meeting-review-commitments-facts').props.children).toBe('4 added to your tasks');
});

it('is translated to Spanish', async () => {
  await i18n.changeLanguage('es');
  await renderButton();
  expect(screen.getByText('Revisar compromisos (5)')).toBeTruthy();
});
