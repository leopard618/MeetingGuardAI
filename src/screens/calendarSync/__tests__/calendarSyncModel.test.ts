import fs from 'fs';
import path from 'path';

import type { CalendarPullResult, CalendarStatus, DeviceCalendarInfo, TranslateFn } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import en from '../../../i18n/locales/en/calendar.json';
import {
  buildDeviceRows,
  connectOutcome,
  googleStateView,
  loadDeviceCalendars,
  nextImportIds,
  outlookConnectOutcome,
  outlookStateView,
  syncReportSummary,
  todoEnableOutcome,
  todoStateView,
} from '../calendarSyncModel';

/** Echoes the key and its options, so assertions do not depend on the English wording. */
const t: TranslateFn = (key, options) => (options ? `${key} ${JSON.stringify(options)}` : key);

function google(overrides: Partial<CalendarStatus['google']> = {}): CalendarStatus['google'] {
  return { enabled: false, syncing: false, lastSyncAt: null, lastError: null, connected: false, hasScope: false, ...overrides };
}

function outlook(overrides: Partial<NonNullable<CalendarStatus['outlook']>> = {}): NonNullable<CalendarStatus['outlook']> {
  return {
    enabled: false,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    configured: true,
    connected: false,
    accountEmail: null,
    ...overrides,
  };
}

function pull(provider: 'google' | 'device' | 'outlook', counts: Partial<CalendarPullResult['counts']> = {}): CalendarPullResult {
  return {
    provider,
    fullSync: false,
    syncedAt: '2030-01-01T00:00:00.000Z',
    counts: { created: 1, updated: 2, removed: 0, unchanged: 5, pushed: 3, failed: 0, ...counts },
  };
}

function calendar(id: string, overrides: Partial<DeviceCalendarInfo> = {}): DeviceCalendarInfo {
  return {
    id,
    title: `Calendar ${id}`,
    color: '#ff0000',
    sourceName: 'Local',
    isPrimary: false,
    allowsModifications: true,
    isGoogleAccount: false,
    ...overrides,
  };
}

const prefs = { deviceCalendarImportIds: [] as string[], deviceCalendarExportId: null as string | null, googleCalendarSyncEnabled: false };

describe('googleStateView', () => {
  it('distinguishes connected, missing permission and not connected', () => {
    expect(googleStateView(google({ connected: true, enabled: true, hasScope: true }))).toEqual({
      labelKey: 'calendar:google.state.connected',
      tone: 'success',
    });
    expect(googleStateView(google({ enabled: true }))).toEqual({ labelKey: 'calendar:google.state.permissionNeeded', tone: 'warning' });
    expect(googleStateView(google())).toEqual({ labelKey: 'calendar:google.state.notConnected', tone: 'muted' });
  });
});

describe('connectOutcome', () => {
  it('reports the first sync counts', () => {
    const outcome = connectOutcome(t, { status: 'connected', initialSync: pull('google', { created: 4, pushed: 2 }) }, null);
    expect(outcome).toEqual({
      kind: 'connected',
      title: 'calendar:google.connectedTitle',
      message: 'calendar:google.firstSyncSummary {"created":4,"pushed":2}',
    });
  });

  it('says so when the first sync did not finish, with the real error', () => {
    const outcome = connectOutcome(t, { status: 'connected', initialSync: null }, 'offline');
    expect(outcome?.message).toBe('calendar:google.firstSyncFailed {"error":"common:errors.offline"}');
  });

  it('explains a refused permission and stays quiet when the user cancelled', () => {
    expect(connectOutcome(t, { status: 'scope_denied', initialSync: null }, null)).toEqual({
      kind: 'scope_denied',
      title: 'calendar:google.title',
      message: 'calendar:google.scopeDenied',
    });
    expect(connectOutcome(t, { status: 'cancelled', initialSync: null }, null)).toBeNull();
  });
});

describe('outlookStateView', () => {
  it('distinguishes connected and not connected', () => {
    expect(outlookStateView(outlook({ connected: true, enabled: true }))).toEqual({
      labelKey: 'calendar:outlook.state.connected',
      tone: 'success',
    });
    expect(outlookStateView(outlook())).toEqual({ labelKey: 'calendar:outlook.state.notConnected', tone: 'muted' });
  });
});

describe('outlookConnectOutcome', () => {
  it('reports the first sync counts', () => {
    const outcome = outlookConnectOutcome(t, { status: 'connected', initialSync: pull('outlook', { created: 4, pushed: 2 }) }, null);
    expect(outcome).toEqual({
      kind: 'connected',
      title: 'calendar:outlook.connectedTitle',
      message: 'calendar:outlook.firstSyncSummary {"created":4,"pushed":2}',
    });
  });

  it('says so when the first sync did not finish, with the real error', () => {
    const outcome = outlookConnectOutcome(t, { status: 'connected', initialSync: null }, 'offline');
    expect(outcome?.message).toBe('calendar:outlook.firstSyncFailed {"error":"common:errors.offline"}');
  });

  it('explains a failed sign-in and stays quiet when the user cancelled', () => {
    expect(outlookConnectOutcome(t, { status: 'failed', initialSync: null }, null)).toEqual({
      kind: 'failed',
      title: 'calendar:outlook.title',
      message: 'calendar:outlook.connectFailed',
    });
    expect(outlookConnectOutcome(t, { status: 'cancelled', initialSync: null }, null)).toBeNull();
  });
});

describe('syncReportSummary', () => {
  it('lists the per-provider counts, failed pushes and provider errors', () => {
    const summary = syncReportSummary(t, {
      google: pull('google', { failed: 2 }),
      device: pull('device'),
      errors: [{ provider: 'device', code: 'permission_denied' }],
    });
    expect(summary.title).toBe('calendar:sync.problemsTitle');
    const lines = summary.message.split('\n\n');
    expect(lines[0]).toContain('calendar:sync.googleResult');
    expect(lines[1]).toBe('calendar:sync.failedGoogle {"count":2}');
    expect(lines[2]).toContain('calendar:sync.deviceResult');
    expect(lines[3]).toBe('calendar:sync.providerError {"provider":"calendar:sync.providers.device","error":"common:errors.permission_denied"}');
  });

  it('includes the Outlook line, its failed pushes and its provider errors', () => {
    const summary = syncReportSummary(t, {
      google: null,
      device: null,
      outlook: pull('outlook', { failed: 1 }),
      errors: [{ provider: 'outlook', code: 'upstream_error' }],
    });
    const lines = summary.message.split('\n\n');
    expect(lines[0]).toContain('calendar:sync.outlookResult');
    expect(lines[1]).toBe('calendar:sync.failedOutlook {"count":1}');
    expect(lines[2]).toBe('calendar:sync.providerError {"provider":"calendar:sync.providers.outlook","error":"common:errors.upstream_error"}');
  });

  it('says when there is nothing to sync', () => {
    expect(syncReportSummary(t, { google: null, device: null, errors: [] })).toEqual({
      title: 'calendar:sync.doneTitle',
      message: 'calendar:sync.nothingToSync',
    });
  });
});

describe('nextImportIds', () => {
  it('adds once and removes', () => {
    expect(nextImportIds(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(nextImportIds(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(nextImportIds(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});

describe('loadDeviceCalendars', () => {
  it('lists the calendars when permitted', async () => {
    const calendars = [calendar('1')];
    const service = { getPermission: jest.fn(async () => 'granted' as const), listCalendars: jest.fn(async () => calendars) };
    await expect(loadDeviceCalendars(service)).resolves.toEqual({ phase: 'ready', calendars });
  });

  it('asks for permission first', async () => {
    const service = { getPermission: jest.fn(async () => 'undetermined' as const), listCalendars: jest.fn() };
    await expect(loadDeviceCalendars(service)).resolves.toEqual({ phase: 'no_permission' });
    expect(service.listCalendars).not.toHaveBeenCalled();
  });

  it('turns a failure into an error state with its code (never an empty list)', async () => {
    const onError = jest.fn();
    const service = {
      getPermission: jest.fn(async () => 'granted' as const),
      listCalendars: jest.fn(async () => {
        throw new AppError('unknown', 'boom');
      }),
    };
    await expect(loadDeviceCalendars(service, onError)).resolves.toEqual({ phase: 'error', error: 'unknown' });
    expect(onError).toHaveBeenCalledWith('unknown');
  });
});

describe('buildDeviceRows', () => {
  it('lists import switches, then the writable export calendars with "none" first', () => {
    const rows = buildDeviceRows([calendar('1'), calendar('2', { allowsModifications: false })], {
      ...prefs,
      deviceCalendarImportIds: ['2'],
      deviceCalendarExportId: '1',
    }, null);
    expect(rows.map((row) => row.key)).toEqual(['heading:import', 'import:1', 'import:2', 'heading:export', 'export:none', 'export:1', 'hint:export']);
    expect(rows.find((row) => row.key === 'import:2')).toEqual(expect.objectContaining({ selected: true, coveredByGoogle: false }));
    expect(rows.find((row) => row.key === 'export:1')).toEqual(expect.objectContaining({ selected: true }));
    expect(rows.find((row) => row.key === 'export:none')).toEqual(expect.objectContaining({ selected: false }));
  });

  it('never imports a Google account calendar twice while Google sync is on', () => {
    const rows = buildDeviceRows([calendar('g', { isGoogleAccount: true })], {
      ...prefs,
      googleCalendarSyncEnabled: true,
      deviceCalendarImportIds: ['g'],
    }, null);
    expect(rows.find((row) => row.key === 'import:g')).toEqual(expect.objectContaining({ selected: false, coveredByGoogle: true }));
  });

  it('covers only the synced Google account; other Google accounts stay importable', () => {
    const synced = calendar('a', { isGoogleAccount: true, sourceName: 'Ana@Gmail.com' });
    const other = calendar('b', { isGoogleAccount: true, sourceName: 'work@gmail.com' });
    const unnamed = calendar('c', { isGoogleAccount: true, sourceName: 'Gmail' });
    const rows = buildDeviceRows([synced, other, unnamed], {
      ...prefs,
      googleCalendarSyncEnabled: true,
      deviceCalendarImportIds: ['b'],
    }, 'ana@gmail.com');
    expect(rows.find((row) => row.key === 'import:a')).toEqual(expect.objectContaining({ coveredByGoogle: true }));
    expect(rows.find((row) => row.key === 'import:b')).toEqual(expect.objectContaining({ coveredByGoogle: false, selected: true }));
    // iOS sources without an address cannot be matched: blocking stays the safe default.
    expect(rows.find((row) => row.key === 'import:c')).toEqual(expect.objectContaining({ coveredByGoogle: true }));
  });

  it('keeps every Google calendar covered while sync is off or the account is unknown', () => {
    const google = calendar('g', { isGoogleAccount: true, sourceName: 'other@gmail.com' });
    const off = buildDeviceRows([google], { ...prefs, googleCalendarSyncEnabled: false }, 'ana@gmail.com');
    expect(off.find((row) => row.key === 'import:g')).toEqual(expect.objectContaining({ coveredByGoogle: false }));
    const unknown = buildDeviceRows([google], { ...prefs, googleCalendarSyncEnabled: true }, null);
    expect(unknown.find((row) => row.key === 'import:g')).toEqual(expect.objectContaining({ coveredByGoogle: true }));
  });

  it('selects "none" when the export calendar is on another device', () => {
    const rows = buildDeviceRows([calendar('1')], { ...prefs, deviceCalendarExportId: 'dother.9' }, null);
    expect(rows.find((row) => row.key === 'export:none')).toEqual(expect.objectContaining({ selected: true }));
  });

  it('has no export choice without writable calendars and no rows without calendars', () => {
    expect(buildDeviceRows([calendar('1', { allowsModifications: false })], prefs, null).map((row) => row.kind)).toEqual(['heading', 'import']);
    expect(buildDeviceRows([], prefs, null)).toEqual([]);
  });
});

describe('calendar namespace', () => {
  type Json = { [key: string]: Json } | string;
  const has = (key: string): boolean => {
    let node: Json | undefined = en as Json;
    for (const part of key.split('.')) {
      if (node === undefined || typeof node === 'string') return false;
      node = node[part] ?? node[`${part}_one`];
    }
    return node !== undefined;
  };

  it('defines every calendar: key used by the calendar sync screens', () => {
    const dir = path.join(__dirname, '..');
    const files = fs.readdirSync(dir).filter((name) => /\.tsx?$/.test(name));
    const missing: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of source.matchAll(/['"`]calendar:([A-Za-z0-9_.]+)['"`]/g)) {
        const key = match[1] ?? '';
        if (!has(key)) missing.push(`${file}: calendar:${key}`);
      }
      for (const match of source.matchAll(/`calendar:([A-Za-z0-9_.]+)\.\$\{/g)) {
        const prefix = match[1] ?? '';
        if (!has(prefix)) missing.push(`${file}: calendar:${prefix}.*`);
      }
    }
    expect(missing).toEqual([]);
  });
});

function todo(overrides: Partial<NonNullable<CalendarStatus['todo']>> = {}): NonNullable<CalendarStatus['todo']> {
  return { enabled: false, syncing: false, lastSyncAt: null, lastError: null, configured: true, connected: false, listId: null, listName: null, ...overrides };
}

describe('todoStateView', () => {
  it('is on only while enabled on a connected Microsoft account', () => {
    expect(todoStateView(todo({ enabled: true, connected: true }), true)).toEqual({ labelKey: 'calendar:todo.state.on', tone: 'success' });
    expect(todoStateView(todo({ enabled: true }), false)).toEqual({ labelKey: 'calendar:todo.state.off', tone: 'muted' });
    expect(todoStateView(todo(), true)).toEqual({ labelKey: 'calendar:todo.state.off', tone: 'muted' });
  });
});

describe('todoEnableOutcome', () => {
  it('reports the first sync counts, or why it did not finish', () => {
    const result = { fullSync: true, counts: { created: 2, updated: 0, removed: 0, unchanged: 0, pushed: 3, failed: 0 }, syncedAt: '2026-10-01T08:00:00.000Z' };
    expect(todoEnableOutcome(t, result, null)).toEqual({
      title: 'calendar:todo.enabledTitle',
      message: 'calendar:todo.firstSyncSummary {"created":2,"pushed":3}',
    });
    expect(todoEnableOutcome(t, null, 'permission_denied').message).toBe('calendar:todo.firstSyncFailed {"error":"common:errors.permission_denied"}');
  });
});
