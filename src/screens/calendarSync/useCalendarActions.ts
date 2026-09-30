/**
 * Calendar actions of the calendar sync screen (connect, reconnect, disconnect, sync now).
 * Each reports its real result in an alert; a cancelled Google sheet is not an error.
 */
import { useCallback, useState } from 'react';
import { Alert, type AlertButton } from 'react-native';

import type { GoogleConnectResult, OutlookConnectResult, TranslateFn } from '../../core/contracts';
import { toAppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import { useT } from '../../i18n';
import { calendarSyncEngine, googleCalendarService, outlookCalendarService } from '../../services/calendar';
import { connectOutcome, errorText, outlookConnectOutcome } from './calendarSyncModel';

const log = createLogger('calendar');

/** Alert for a failed calendar action (nothing for 'cancelled'). */
export function showCalendarError(t: TranslateFn, error: unknown): void {
  const appError = toAppError(error);
  if (appError.code === 'cancelled') return;
  log.warn('calendar action failed', appError.code);
  Alert.alert(t('calendar:errorTitle'), errorText(t, appError.code));
}

export interface GoogleConnect {
  connect(): Promise<void>;
  connecting: boolean;
}

/**
 * googleCalendarService.connect() (incremental Calendar consent + first two-way sync) and the
 * outcome alert. `onConnected` runs when the user acknowledges the "connected" alert.
 */
export function useGoogleConnect(onConnected?: (result: GoogleConnectResult) => void): GoogleConnect {
  const t = useT();
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const result = await googleCalendarService.connect();
      const outcome = connectOutcome(t, result, calendarSyncEngine.getStatus().google.lastError);
      if (outcome) {
        const buttons: AlertButton[] | undefined =
          outcome.kind === 'connected' && onConnected
            ? [{ text: t('calendar:actions.ok'), onPress: () => onConnected(result) }]
            : undefined;
        Alert.alert(outcome.title, outcome.message, buttons);
      }
    } catch (error) {
      showCalendarError(t, error);
    } finally {
      setConnecting(false);
    }
  }, [onConnected, t]);

  return { connect, connecting };
}

/** Re-reads the Google state (sync switch + Calendar permission) into the shared status. */
export function refreshGoogleState(): void {
  googleCalendarService.isConnected().catch((error: unknown) => {
    log.warn('Could not read the Google Calendar state', toAppError(error).code);
  });
}

export interface OutlookConnect {
  connect(): Promise<void>;
  connecting: boolean;
}

/**
 * outlookCalendarService.connect() (Microsoft PKCE sign-in + first two-way sync) and the outcome
 * alert. A closed browser sheet ("cancelled") shows nothing.
 */
export function useOutlookConnect(onConnected?: (result: OutlookConnectResult) => void): OutlookConnect {
  const t = useT();
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const result = await outlookCalendarService.connect();
      const outcome = outlookConnectOutcome(t, result, calendarSyncEngine.getStatus().outlook?.lastError ?? null);
      if (outcome) {
        const buttons: AlertButton[] | undefined =
          outcome.kind === 'connected' && onConnected
            ? [{ text: t('calendar:actions.ok'), onPress: () => onConnected(result) }]
            : undefined;
        Alert.alert(outcome.title, outcome.message, buttons);
      }
    } catch (error) {
      showCalendarError(t, error);
    } finally {
      setConnecting(false);
    }
  }, [onConnected, t]);

  return { connect, connecting };
}

/** Re-reads the Outlook state (configured + token presence) into the shared status. */
export function refreshOutlookState(): void {
  if (!outlookCalendarService.isConfigured()) return;
  outlookCalendarService.isConnected().catch((error: unknown) => {
    log.warn('Could not read the Outlook state', toAppError(error).code);
  });
}
