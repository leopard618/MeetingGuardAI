/**
 * usePendingAlerts (owner: alerts): pending MeetingGuard notifications + permission status for the
 * Settings / onboarding UI. Refreshes after every reconcile and permission change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AlertPermissionStatus, ScheduledAlertInfo, UsePendingAlertsResult } from '../../core/contracts';
import { createLogger } from '../../core/logger';
import { alertEngine } from './engine';

const log = createLogger('alerts.usePendingAlerts');

export function usePendingAlerts(): UsePendingAlertsResult {
  const [pending, setPending] = useState<ScheduledAlertInfo[]>([]);
  const [permission, setPermission] = useState<AlertPermissionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  /** Rejects with an AppError when the OS state cannot be read (callers of refresh() see it). */
  const refresh = useCallback(async () => {
    try {
      const [scheduled, status] = await Promise.all([alertEngine.getScheduled(), alertEngine.getPermissionStatus()]);
      if (!mounted.current) return;
      setPending(scheduled);
      setPermission(status);
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const load = () => {
      refresh().catch((error: unknown) => log.warn('could not read pending alerts', error));
    };
    load();
    const unsubscribe = alertEngine.subscribeStatus(load);
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [refresh]);

  return useMemo(
    () => ({ pending, next: pending[0] ?? null, permission, isLoading, refresh }),
    [pending, permission, isLoading, refresh],
  );
}
