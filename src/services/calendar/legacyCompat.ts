/**
 * Helpers for the calendar area's legacy compat shims (src/api/googleCalendar.js and
 * src/api/calendarSyncManager.js).
 * Delete together with the shims in stage 3.
 */
import type { CalendarSyncReport } from '../../core/contracts';
import { toAppError, type AppErrorCode } from '../../core/errors';
import { googleCalendarService } from './index';

/** Real Google Calendar connection state; false when no data session is active yet. */
export async function isGoogleCalendarConnectedOrFalse(): Promise<boolean> {
  try {
    return await googleCalendarService.isConnected();
  } catch (error) {
    if (toAppError(error).code === 'unauthenticated') return false;
    throw error;
  }
}

export interface LegacySyncResult {
  created: number;
  updated: number;
  removed: number;
  pushed: number;
  skipped: number;
  errors: { provider: 'google' | 'device'; code: AppErrorCode }[];
}

/** CalendarSyncReport -> the { created, updated, skipped, errors[] } shape old screens read. */
export function toLegacySyncResult(report: CalendarSyncReport): LegacySyncResult {
  const results = [report.google, report.device].filter((item) => item !== null);
  const sum = (key: 'created' | 'updated' | 'removed' | 'pushed' | 'unchanged'): number =>
    results.reduce((total, item) => total + item.counts[key], 0);
  return {
    created: sum('created'),
    updated: sum('updated'),
    removed: sum('removed'),
    pushed: sum('pushed'),
    skipped: sum('unchanged'),
    errors: report.errors,
  };
}
