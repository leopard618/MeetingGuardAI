/**
 * Pure view logic of the calendar sync screen (route "CalendarSync") and the "Connect Google
 * Calendar" prompt: the Google state pill, the messages after connecting and after "Sync now",
 * the device-calendar rows (import switches, export choice) and loading the device calendars.
 * Every message reports the real result; nothing here claims success it did not get.
 */
import type {
  CalendarProvider,
  CalendarStatus,
  CalendarSyncReport,
  DeviceCalendarInfo,
  DeviceCalendarService,
  GoogleConnectResult,
  OutlookConnectResult,
  TranslateFn,
} from '../../core/contracts';
import { errorMessageKey, toAppError, type AppErrorCode } from '../../core/errors';
import type { Preferences } from '../../core/types';

export type Tone = 'success' | 'warning' | 'muted';

export interface GoogleStateView {
  labelKey: 'calendar:google.state.connected' | 'calendar:google.state.permissionNeeded' | 'calendar:google.state.notConnected';
  tone: Tone;
}

/** Connected; turned on but the Calendar permission is missing; or not connected. */
export function googleStateView(google: CalendarStatus['google']): GoogleStateView {
  if (google.connected) return { labelKey: 'calendar:google.state.connected', tone: 'success' };
  if (google.enabled) return { labelKey: 'calendar:google.state.permissionNeeded', tone: 'warning' };
  return { labelKey: 'calendar:google.state.notConnected', tone: 'muted' };
}

export function errorText(t: TranslateFn, code: AppErrorCode): string {
  return t(errorMessageKey(code));
}

export interface OutlookStateView {
  labelKey: 'calendar:outlook.state.connected' | 'calendar:outlook.state.notConnected';
  tone: Tone;
}

/** Connected, or not connected (Outlook has no half-connected "scope missing" state). */
export function outlookStateView(outlook: NonNullable<CalendarStatus['outlook']>): OutlookStateView {
  if (outlook.connected) return { labelKey: 'calendar:outlook.state.connected', tone: 'success' };
  return { labelKey: 'calendar:outlook.state.notConnected', tone: 'muted' };
}

export interface AlertMessage {
  title: string;
  message: string;
}

/**
 * What to tell the user after googleCalendarService.connect(): the first sync's real counts, or
 * that it did not finish (with the engine's last error); a refused permission; nothing when the
 * user cancelled the Google sheet.
 */
export function connectOutcome(
  t: TranslateFn,
  result: GoogleConnectResult,
  lastError: AppErrorCode | null,
): (AlertMessage & { kind: 'connected' | 'scope_denied' }) | null {
  if (result.status === 'connected') {
    const message = result.initialSync
      ? t('calendar:google.firstSyncSummary', {
          created: result.initialSync.counts.created,
          pushed: result.initialSync.counts.pushed,
        })
      : t('calendar:google.firstSyncFailed', { error: lastError ? errorText(t, lastError) : '' });
    return { kind: 'connected', title: t('calendar:google.connectedTitle'), message };
  }
  if (result.status === 'scope_denied') {
    return { kind: 'scope_denied', title: t('calendar:google.title'), message: t('calendar:google.scopeDenied') };
  }
  return null;
}

/**
 * What to tell the user after outlookCalendarService.connect(): the first sync's real counts, or
 * that it did not finish (with the engine's last error); a failed Microsoft sign-in; nothing when
 * the user closed the browser sheet.
 */
export function outlookConnectOutcome(
  t: TranslateFn,
  result: OutlookConnectResult,
  lastError: AppErrorCode | null,
): (AlertMessage & { kind: 'connected' | 'failed' }) | null {
  if (result.status === 'connected') {
    const message = result.initialSync
      ? t('calendar:outlook.firstSyncSummary', {
          created: result.initialSync.counts.created,
          pushed: result.initialSync.counts.pushed,
        })
      : t('calendar:outlook.firstSyncFailed', { error: lastError ? errorText(t, lastError) : '' });
    return { kind: 'connected', title: t('calendar:outlook.connectedTitle'), message };
  }
  if (result.status === 'failed') {
    return { kind: 'failed', title: t('calendar:outlook.title'), message: t('calendar:outlook.connectFailed') };
  }
  return null;
}

function providerLabel(t: TranslateFn, provider: CalendarProvider): string {
  if (provider === 'google') return t('calendar:sync.providers.google');
  if (provider === 'outlook') return t('calendar:sync.providers.outlook');
  return t('calendar:sync.providers.device');
}

/** "Sync now" result: per-provider counts, failed pushes and provider errors. */
export function syncReportSummary(t: TranslateFn, report: CalendarSyncReport): AlertMessage {
  const lines: string[] = [];
  if (report.google) {
    lines.push(t('calendar:sync.googleResult', { ...report.google.counts }));
    if (report.google.counts.failed > 0) lines.push(t('calendar:sync.failedGoogle', { count: report.google.counts.failed }));
  }
  if (report.outlook) {
    lines.push(t('calendar:sync.outlookResult', { ...report.outlook.counts }));
    if (report.outlook.counts.failed > 0) lines.push(t('calendar:sync.failedOutlook', { count: report.outlook.counts.failed }));
  }
  if (report.device) {
    lines.push(t('calendar:sync.deviceResult', { ...report.device.counts }));
    if (report.device.counts.failed > 0) lines.push(t('calendar:sync.failedDevice', { count: report.device.counts.failed }));
  }
  for (const failure of report.errors) {
    lines.push(
      t('calendar:sync.providerError', {
        provider: providerLabel(t, failure.provider),
        error: errorText(t, failure.code),
      }),
    );
  }
  if (lines.length === 0) lines.push(t('calendar:sync.nothingToSync'));
  return {
    title: report.errors.length > 0 ? t('calendar:sync.problemsTitle') : t('calendar:sync.doneTitle'),
    message: lines.join('\n\n'),
  };
}

/** Import selection after toggling one calendar (no duplicates, order kept). */
export function nextImportIds(current: readonly string[], calendarId: string, enabled: boolean): string[] {
  if (enabled) return current.includes(calendarId) ? [...current] : [...current, calendarId];
  return current.filter((id) => id !== calendarId);
}

export type DeviceCalendarsState =
  | { phase: 'loading' }
  | { phase: 'no_permission' }
  | { phase: 'error'; error: AppErrorCode }
  | { phase: 'ready'; calendars: DeviceCalendarInfo[] };

/** Device calendars view state; never throws (a failure becomes phase 'error' with its code). */
export async function loadDeviceCalendars(
  service: Pick<DeviceCalendarService, 'getPermission' | 'listCalendars'>,
  onError?: (code: AppErrorCode) => void,
): Promise<DeviceCalendarsState> {
  try {
    const permission = await service.getPermission();
    if (permission !== 'granted') return { phase: 'no_permission' };
    const calendars = await service.listCalendars();
    return { phase: 'ready', calendars };
  } catch (error) {
    const code = toAppError(error).code;
    onError?.(code);
    return { phase: 'error', error: code };
  }
}

export type DeviceRow =
  | { kind: 'heading'; key: string; labelKey: 'calendar:device.import.title' | 'calendar:device.export.title' }
  | { kind: 'import'; key: string; calendar: DeviceCalendarInfo; selected: boolean; coveredByGoogle: boolean }
  | { kind: 'export'; key: string; calendar: DeviceCalendarInfo | null; selected: boolean }
  | { kind: 'hint'; key: string; labelKey: 'calendar:device.export.hint' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased email, or null when the value is not an email (iOS sources like "Gmail"). */
function asEmail(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase();
  return EMAIL_RE.test(normalized) ? normalized : null;
}

/**
 * Google sync covers ONLY the signed-in Google account's calendars: a phone can hold several
 * Google accounts, and the other accounts' events never arrive through our Google sync, so
 * those calendars must stay importable. When either email is unknown (email/password sign-in,
 * or an iOS source without an address) the calendar counts as covered, like before: blocking
 * an import is safer than importing the synced account twice.
 */
export function isCoveredByGoogle(
  calendar: DeviceCalendarInfo,
  googleSyncEnabled: boolean,
  googleAccountEmail: string | null,
): boolean {
  if (!googleSyncEnabled || !calendar.isGoogleAccount) return false;
  const synced = asEmail(googleAccountEmail);
  const owner = asEmail(calendar.sourceName);
  return synced === null || owner === null || owner === synced;
}

/**
 * Rows of the device-calendar card: every calendar with its import switch (calendars of the
 * synced Google account are covered by Google sync while it is on, so they cannot be imported
 * twice; see isCoveredByGoogle), then the export choice among the writable calendars ("none"
 * is selected when the chosen export calendar is not on this phone).
 */
export function buildDeviceRows(
  calendars: readonly DeviceCalendarInfo[],
  preferences: Pick<Preferences, 'deviceCalendarImportIds' | 'deviceCalendarExportId' | 'googleCalendarSyncEnabled'>,
  googleAccountEmail: string | null,
): DeviceRow[] {
  if (calendars.length === 0) return [];
  const rows: DeviceRow[] = [{ kind: 'heading', key: 'heading:import', labelKey: 'calendar:device.import.title' }];
  for (const calendar of calendars) {
    const coveredByGoogle = isCoveredByGoogle(calendar, preferences.googleCalendarSyncEnabled, googleAccountEmail);
    rows.push({
      kind: 'import',
      key: `import:${calendar.id}`,
      calendar,
      coveredByGoogle,
      selected: !coveredByGoogle && preferences.deviceCalendarImportIds.includes(calendar.id),
    });
  }
  const writable = calendars.filter((calendar) => calendar.allowsModifications);
  if (writable.length > 0) {
    const exportId = preferences.deviceCalendarExportId;
    const exportIsOnThisDevice = exportId !== null && calendars.some((calendar) => calendar.id === exportId);
    rows.push({ kind: 'heading', key: 'heading:export', labelKey: 'calendar:device.export.title' });
    rows.push({ kind: 'export', key: 'export:none', calendar: null, selected: !exportIsOnThisDevice });
    for (const calendar of writable) {
      rows.push({ kind: 'export', key: `export:${calendar.id}`, calendar, selected: exportId === calendar.id });
    }
    rows.push({ kind: 'hint', key: 'hint:export', labelKey: 'calendar:device.export.hint' });
  }
  return rows;
}
