/**
 * Tasks screen sync triggers for Microsoft To Do and Google Tasks (docs/v1/ARCHITECTURE.md
 * sections 28 and 30). The app's task list is the hub: the engine pushes local edits after its
 * debounce and pulls both providers every minute while the app is active. This hook adds the two
 * moments a user expects an immediate answer:
 * - pull-to-refresh runs calendarSyncEngine.syncTasksNow() (both providers, no calendars) and
 *   shows the first provider failure as a toast;
 * - gaining focus runs the same sync quietly, at most once per FOCUS_SYNC_MIN_GAP_MS across all
 *   mounts, so opening the screen is enough to see what changed in To Do or Google Tasks.
 * Nothing runs when no task sync is on (the status store says so).
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import type { CalendarStatus } from '../../core/contracts';
import { errorMessageKey, toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { calendarSyncEngine } from '../../services/calendar';

const log = createLogger('tasks');

/** A focus sync runs when the last task sync started at least this long ago. */
export const FOCUS_SYNC_MIN_GAP_MS = 15_000;

/** At least one task provider is on for this device. */
export function taskSyncActive(status: Pick<CalendarStatus, 'todo' | 'gtasks'>): boolean {
  return status.todo?.enabled === true || status.gtasks?.enabled === true;
}

/** A focus sync is worth running now (a provider is on and the last one is not too recent). */
export function focusSyncDue(status: Pick<CalendarStatus, 'todo' | 'gtasks'>, nowMs: number, lastSyncStartedMs: number): boolean {
  return taskSyncActive(status) && nowMs - lastSyncStartedMs >= FOCUS_SYNC_MIN_GAP_MS;
}

/** Shared across mounts: switching screens back and forth must not restart the sync each time. */
let lastTaskSyncStartedAt = 0;

/** Test hook: forgets the last sync time. */
export function resetTasksRefreshForTests(): void {
  lastTaskSyncStartedAt = 0;
}

export interface TasksRefresh {
  refreshing: boolean;
  onRefresh(): void;
}

export function useTasksRefresh(): TasksRefresh {
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (!focusSyncDue(calendarSyncEngine.getStatus(), now, lastTaskSyncStartedAt)) return;
      lastTaskSyncStartedAt = now;
      calendarSyncEngine.syncTasksNow().then(
        (report) => {
          if (report.errors.length > 0) log.debug('focus task sync finished with errors', report.errors.map((e) => `${e.provider}:${e.code}`).join(','));
        },
        (error: unknown) => log.debug('focus task sync failed', toAppError(error).code),
      );
    }, []),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    lastTaskSyncStartedAt = Date.now();
    void (async () => {
      try {
        const report = await calendarSyncEngine.syncTasksNow();
        const first = report.errors[0];
        if (first) {
          log.warn('task refresh finished with errors', report.errors.map((e) => `${e.provider}:${e.code}`).join(','));
          Toast.show({ type: 'error', text1: t(`meetings:list.refreshFailed.${first.provider}`), text2: t(errorMessageKey(first.code)) });
        }
      } catch (error) {
        const code = toAppError(error).code;
        // Signed out meanwhile: nothing to report on this screen.
        if (code !== 'unauthenticated') Toast.show({ type: 'error', text1: t('tasks:list.refreshFailed'), text2: t(errorMessageKey(code)) });
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    })();
  }, [t]);

  return { refreshing, onRefresh };
}
