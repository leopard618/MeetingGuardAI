/**
 * The grid must always show seven columns. The old wrapping row of width/7 cells overflowed by a
 * fraction of a pixel on some phones and pushed the seventh day to the next line (seen on a real
 * device on 2026-10-21); rows of flex cells cannot wrap, and this test pins the row shape.
 */
import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { I18nProvider } from '../../../i18n';
import { buildMonthGrid, weekdayLabels } from '../calendarModel';
import { MonthGrid, weeksOf } from '../MonthGrid';

// The grid colours its dots through the meeting list item, whose module reaches the data and
// zoom services (Firebase ESM); the same stubs CalendarScreen.test uses.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'UTC', uses24hourClock: true }]),
}));
jest.mock('../../../services/data', () => {
  const { createDefaultPreferences: defaults } = jest.requireActual('../../../core/types');
  return {
    useMeetings: () => ({ meetings: [], isLoading: false, error: null, refresh: jest.fn() }),
    usePreferences: () => ({ preferences: defaults({ language: 'en', timezone: 'UTC' }), isLoaded: true, error: null }),
    useTasks: () => ({ tasks: [], isLoading: false, error: null, create: jest.fn(), update: jest.fn(), remove: jest.fn() }),
    meetingRepository: { remove: jest.fn() },
  };
});
jest.mock('../../../services/zoom', () => ({
  useZoomStatus: () => ({ configured: null, refresh: jest.fn() }),
  zoomService: {
    isAvailable: jest.fn(async () => false),
    getKnownAvailability: () => null,
    ensureLink: jest.fn(),
    syncIfNeeded: jest.fn(async () => undefined),
    onMeetingDeleted: jest.fn(async () => undefined),
    linkFailure: () => null,
  },
}));
jest.mock('../../../services/calendar', () => ({ calendarSyncEngine: { syncNow: jest.fn() } }));

describe('weeksOf', () => {
  it('groups a month grid into whole weeks of seven', () => {
    const grid = buildMonthGrid({ year: 2026, month: 10 }, 0);
    const weeks = weeksOf(grid);
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks.flat()).toEqual(grid);
  });

  it('keeps a trailing partial week rather than dropping days', () => {
    expect(weeksOf([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([[1, 2, 3, 4, 5, 6, 7], [8]]);
  });
});

describe('MonthGrid', () => {
  it('renders every week as its own row of seven day buttons, never a wrapping row', async () => {
    const grid = buildMonthGrid({ year: 2026, month: 10 }, 0);
    await render(
      <I18nProvider>
        <PaperProvider>
          <MonthGrid
            grid={grid}
            weekdays={weekdayLabels(0, 'en')}
            index={new Map()}
            selectedKey="2026-10-21"
            todayKey="2026-10-21"
            onSelect={() => undefined}
          />
        </PaperProvider>
      </I18nProvider>,
    );
    expect(screen.getByTestId('calendar-grid')).toBeTruthy();
    expect(screen.getAllByTestId(/^calendar-day-2026-/)).toHaveLength(42);
    for (const key of ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']) {
      expect(screen.getByTestId(`calendar-day-${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId('calendar-day-2026-10-21').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });
});
