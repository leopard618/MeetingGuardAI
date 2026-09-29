/**
 * Pull-to-refresh for the meeting screens: sends pending local changes and re-reads the meetings
 * (data layer), and pulls the connected calendars (calendar sync engine: Google Calendar and the
 * selected device calendars; never a direct Google API call from the screen). Failures are shown
 * as they are; nothing is reported as synced when it was not.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import { errorMessageKey, toAppError, type AppErrorCode } from '../../../core/errors';
import { createLogger } from '../../../core/logger';
import { useT } from '../../../i18n';
import { calendarSyncEngine } from '../../../services/calendar';

const log = createLogger('meetings');

export interface MeetingsRefresh {
  refreshing: boolean;
  onRefresh(): void;
}

export function useMeetingsRefresh(refreshMeetings: () => Promise<void>): MeetingsRefresh {
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      const [local, calendars] = await Promise.allSettled([refreshMeetings(), calendarSyncEngine.syncNow({ reason: 'manual' })]);
      const problems: { provider: 'meetings' | 'calendars' | 'google' | 'device'; code: AppErrorCode }[] = [];
      if (local.status === 'rejected') problems.push({ provider: 'meetings', code: toAppError(local.reason).code });
      if (calendars.status === 'rejected') {
        const code = toAppError(calendars.reason).code;
        // Signed out between the pull and the sync: nothing to report on this screen.
        if (code !== 'unauthenticated') problems.push({ provider: 'calendars', code });
      } else {
        problems.push(...calendars.value.errors);
      }
      const first = problems[0];
      if (first) {
        log.warn('refresh finished with errors', problems.map((problem) => `${problem.provider}:${problem.code}`).join(','));
        Toast.show({
          type: 'error',
          text1: t(`meetings:list.refreshFailed.${first.provider}`),
          text2: t(errorMessageKey(first.code)),
        });
      }
      if (mounted.current) setRefreshing(false);
    })();
  }, [refreshMeetings, t]);

  return { refreshing, onRefresh };
}
