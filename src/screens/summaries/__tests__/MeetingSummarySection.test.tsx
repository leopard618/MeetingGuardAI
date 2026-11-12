/**
 * MeetingSummarySection on Meeting details (M10 section 9): hidden unless summaryStatus says
 * enabled and allowed, while nothing is known, without summaryRead (not_enabled) and when nothing
 * is filed; the list is asked only after the screen settled; rows show the title, the received
 * time, the origin chip and the occurrence date, and open SummaryView.
 */
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import type { SummaryListItem } from '../../../core/aiContract';
import type { RootStackParamList } from '../../../core/contracts';
import type { AppError } from '../../../core/errors';
import { I18nProvider, i18n } from '../../../i18n';
import { summaryAppError } from '../../../services/summaries/summaryCore';
import { MeetingSummarySection } from '../MeetingSummarySection';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: false }]),
}));
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
  };
});

let mockAvailable = true;
let mockItems: readonly SummaryListItem[] | null = null;
let mockError: AppError | null = null;
const mockUseSummaryList = jest.fn();
jest.mock('../../../services/summaries', () => ({
  useSummaryStatus: () => ({ status: null, available: mockAvailable, error: null, refresh: jest.fn() }),
  useSummaryList: (view: string, meetingId: string | null, options?: { enabled?: boolean }) => {
    mockUseSummaryList(view, meetingId, options);
    if (options?.enabled === false) return { items: null, hasMore: false, error: null, loading: false, refreshing: false, refresh: jest.fn() };
    return { items: mockItems, hasMore: false, error: mockError, loading: false, refreshing: false, refresh: jest.fn() };
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

const SERIES_ROW: SummaryListItem = {
  ...ROW,
  summaryId: ID_B,
  title: null,
  tier: 'user_forwarded',
  receivedAt: '2026-10-09T20:20:00.000Z',
  // The Oct 9 occurrence of a weekly series, moved to Oct 11: the row shows the day it took place.
  match: ROW.match
    ? {
        ...ROW.match,
        method: 'user',
        occurrenceDate: '2026-10-09',
        meetingSnapshot: { title: 'Weekly sync', startAt: '2026-10-11T19:00:00.000Z', endAt: '2026-10-11T20:00:00.000Z', timezone: 'UTC' },
      }
    : null,
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Stack = createStackNavigator<RootStackParamList>();

function DetailsStub() {
  return <MeetingSummarySection meetingId="m1" />;
}

function SummaryViewStub({ route }: { route: { params?: { summaryId?: string } } }) {
  return <Text testID="summary-view-screen">{route.params?.summaryId}</Text>;
}

async function renderSection() {
  await render(
    <I18nProvider>
      <PaperProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="MeetingDetails" component={DetailsStub} initialParams={{ meetingId: 'm1' }} />
            <Stack.Screen name="SummaryView" component={SummaryViewStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </I18nProvider>,
  );
}

function lastOptions(): { enabled?: boolean } | undefined {
  const calls = mockUseSummaryList.mock.calls;
  return calls[calls.length - 1]?.[2] as { enabled?: boolean } | undefined;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockAvailable = true;
  mockItems = [ROW, SERIES_ROW];
  mockError = null;
  mockUseSummaryList.mockClear();
});

it('never asks summaryRead while the feature is off for this account, and renders nothing', async () => {
  mockAvailable = false;
  await renderSection();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  expect(mockUseSummaryList).toHaveBeenCalled();
  expect(mockUseSummaryList.mock.calls.every((call) => (call[2] as { enabled?: boolean }).enabled === false)).toBe(true);
  expect(screen.queryByTestId('meeting-summaries-m1')).toBeNull();
});

it('asks for the meeting list only after Meeting details settled', async () => {
  await renderSection();
  expect(mockUseSummaryList.mock.calls[0]).toEqual(['meeting', 'm1', { enabled: false }]);
  expect(screen.queryByTestId('meeting-summaries-m1')).toBeNull();
  await waitFor(() => expect(lastOptions()).toEqual({ enabled: true }));
  expect(screen.getByTestId('meeting-summaries-m1')).toBeTruthy();
});

it('shows each summary with its title, received time, origin chip and occurrence date, and opens it', async () => {
  await renderSection();
  await waitFor(() => expect(screen.getByTestId('meeting-summaries-m1')).toBeTruthy());
  expect(screen.getByText('Notetaker summaries')).toBeTruthy();
  expect(screen.getByText('Urpayroll launch sync')).toBeTruthy();
  expect(screen.getByTestId(`meeting-summary-${ID_A}-received`).props.children).toContain('Received Oct 16, 2026');
  expect(screen.getByText('From your notetaker')).toBeTruthy();
  expect(screen.queryByTestId(`meeting-summary-${ID_A}-occurrence`)).toBeNull();
  // A series occurrence's summary, without a title, forwarded by hand.
  expect(screen.getByText('Summary without a title')).toBeTruthy();
  expect(screen.getByText('Forwarded')).toBeTruthy();
  // The day the (moved) occurrence took place, never its original series date (B5).
  expect(screen.getByTestId(`meeting-summary-${ID_B}-occurrence`).props.children).toBe('For the meeting on Oct 11, 2026');
  expect(screen.getByTestId(`meeting-summary-${ID_A}`).props.accessibilityLabel).toBe('Open the summary Urpayroll launch sync');

  await act(async () => {
    fireEvent.press(screen.getByTestId(`meeting-summary-${ID_A}`));
  });
  expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'SummaryView', params: { summaryId: ID_A } });
});

it('stays hidden when nothing is filed here or summaryRead is not deployed', async () => {
  mockItems = [];
  await renderSection();
  await waitFor(() => expect(lastOptions()).toEqual({ enabled: true }));
  expect(screen.queryByTestId('meeting-summaries-m1')).toBeNull();

  mockItems = [ROW];
  mockError = summaryAppError('not_enabled');
  await renderSection();
  await waitFor(() => expect(lastOptions()).toEqual({ enabled: true }));
  expect(screen.queryByTestId('meeting-summaries-m1')).toBeNull();
});

it('is translated to Spanish', async () => {
  await i18n.changeLanguage('es');
  mockItems = [ROW];
  await renderSection();
  await waitFor(() => expect(screen.getByText('Minuta de tu asistente de notas')).toBeTruthy());
  expect(screen.getByText('De tu asistente de notas')).toBeTruthy();
});
