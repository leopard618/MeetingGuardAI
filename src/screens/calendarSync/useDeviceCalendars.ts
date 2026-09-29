/**
 * Device calendars of this phone for the calendar sync screen. Reloads when the calendar
 * permission changes, when the app comes back to the foreground (the user may have granted the
 * permission in the system settings) and on retry.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { PermissionState } from '../../core/contracts';
import { createLogger } from '../../core/logger';
import { deviceCalendarService } from '../../services/calendar';
import { loadDeviceCalendars, type DeviceCalendarsState } from './calendarSyncModel';

const log = createLogger('calendar');

export interface DeviceCalendars {
  state: DeviceCalendarsState;
  retry(): void;
}

export function useDeviceCalendars(permission: PermissionState): DeviceCalendars {
  const [state, setState] = useState<DeviceCalendarsState>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    void loadDeviceCalendars(deviceCalendarService, (code) => log.warn('Could not list device calendars', code)).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [permission, reloadToken]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setReloadToken((token) => token + 1);
    });
    return () => subscription.remove();
  }, []);

  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    setReloadToken((token) => token + 1);
  }, []);

  return { state, retry };
}
