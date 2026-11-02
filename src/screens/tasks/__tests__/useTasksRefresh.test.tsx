/**
 * useTasksRefresh: the focus sync runs only when a task provider is on and not more than once per
 * FOCUS_SYNC_MIN_GAP_MS; pull-to-refresh runs syncTasksNow and reports the first provider error.
 */
import { act, renderHook } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import type { CalendarStatus, TaskSyncReport } from '../../../core/contracts';
import { FOCUS_SYNC_MIN_GAP_MS, focusSyncDue, resetTasksRefreshForTests, taskSyncActive, useTasksRefresh } from '../useTasksRefresh';

// Focus effects run like plain effects here (no navigation container in the test).
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});

const mockSyncTasksNow = jest.fn<Promise<TaskSyncReport>, []>();
let mockStatus: Pick<CalendarStatus, 'todo' | 'gtasks'> = {};
jest.mock('../../../services/calendar', () => ({
  calendarSyncEngine: {
    syncTasksNow: () => mockSyncTasksNow(),
    getStatus: () => mockStatus,
  },
}));

// Keys instead of texts: the real useT suspends while i18n loads, which would leave the hook result empty.
jest.mock('../../../i18n', () => ({ useT: () => (key: string) => key }));

jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

const todoOn = { enabled: true, syncing: false, lastSyncAt: null, lastError: null, configured: true, connected: true, listId: 'l', listName: 'Work' };
const report = (errors: TaskSyncReport['errors'] = []): TaskSyncReport => ({ todo: null, gtasks: null, errors });

beforeEach(() => {
  resetTasksRefreshForTests();
  mockSyncTasksNow.mockReset().mockResolvedValue(report());
  mockStatus = {};
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('helpers', () => {
  it('knows when a task provider is on', () => {
    expect(taskSyncActive({})).toBe(false);
    expect(taskSyncActive({ todo: { ...todoOn, enabled: false } })).toBe(false);
    expect(taskSyncActive({ todo: todoOn })).toBe(true);
    expect(taskSyncActive({ gtasks: { ...todoOn, hasScope: true } })).toBe(true);
  });

  it('spaces focus syncs by the minimum gap', () => {
    expect(focusSyncDue({ todo: todoOn }, 100_000, 0)).toBe(true);
    expect(focusSyncDue({ todo: todoOn }, 100_000, 100_000 - FOCUS_SYNC_MIN_GAP_MS + 1)).toBe(false);
    expect(focusSyncDue({ todo: todoOn }, 100_000, 100_000 - FOCUS_SYNC_MIN_GAP_MS)).toBe(true);
    expect(focusSyncDue({}, 100_000, 0)).toBe(false);
  });
});

describe('useTasksRefresh', () => {
  it('syncs the task providers on focus when one is on, once per gap', async () => {
    mockStatus = { todo: todoOn };
    const { rerender } = await renderHook(() => useTasksRefresh());
    await act(async () => undefined);
    expect(mockSyncTasksNow).toHaveBeenCalledTimes(1);

    // A second focus inside the gap (re-render with a fresh effect) does not start another sync.
    await rerender(undefined);
    await act(async () => undefined);
    expect(mockSyncTasksNow).toHaveBeenCalledTimes(1);
    expect(focusSyncDue({ todo: todoOn }, Date.now(), Date.now() - 1000)).toBe(false);
  });

  it('stays quiet on focus when no task sync is on', async () => {
    const rendered = await renderHook(() => useTasksRefresh());
    await act(async () => undefined);
    expect(mockSyncTasksNow).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('pull-to-refresh runs the sync, shows the first provider error and clears the spinner', async () => {
    mockStatus = { todo: todoOn };
    mockSyncTasksNow.mockResolvedValue(report([{ provider: 'gtasks', code: 'offline' }]));
    const { result } = await renderHook(() => useTasksRefresh());
    await act(async () => undefined);
    mockSyncTasksNow.mockClear();

    await act(async () => {
      result.current.onRefresh();
    });

    expect(mockSyncTasksNow).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(false);
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'meetings:list.refreshFailed.gtasks' }));
  });
});
