/**
 * DeviceCalendarService (contract in src/core/contracts.ts): Apple / Android calendars through
 * expo-calendar. Import is one-way (device -> MeetingGuard, source 'device'); export copies
 * MeetingGuard's own meetings (never imported ones) to ONE calendar chosen on this device.
 * All stored device ids are device-scoped (see ./mapping.ts).
 */
import type {
  CalendarPullResult,
  DeviceCalendarService,
  ExternalMeetingUpsert,
  MeetingRepository,
  PermissionState,
  PreferencesRepository,
} from '../../../core/contracts';
import { AppError, toAppError } from '../../../core/errors';
import type { AppEventMap, EventBus } from '../../../core/events';
import { createLogger } from '../../../core/logger';
import { addMinutesIso, endIso, toDate } from '../../../core/time';
import type { Meeting, MeetingPatch, Preferences } from '../../../core/types';
import { chunk, createMutex, insideWindow, isOwnMeeting, syncWindow } from '../shared';
import type { DeviceSyncState, StateStore } from '../stateStore';
import type { CalendarStatusStore } from '../status';
import type { DeviceCalendarPort } from './adapter';
import {
  deviceEventToMeetingInput,
  deviceExportHash,
  deviceImportHash,
  deviceOccurrenceKey,
  isCancelledDeviceEvent,
  isGoogleAccountCalendar,
  meetingToDeviceEvent,
  ownRawId,
  parseScopedId,
  scopeId,
  toDeviceCalendarInfo,
  type DevicePlatform,
} from './mapping';

const log = createLogger('calendar');
const UPSERT_CHUNK_SIZE = 100;
/** Deleted meetings older than this are assumed to have had their device copy removed already. */
const TOMBSTONE_CHECK_DAYS = 30;

export interface DeviceServiceDeps {
  port: DeviceCalendarPort;
  meetings: Pick<MeetingRepository, 'list' | 'update' | 'upsertExternal'>;
  preferences: Pick<PreferencesRepository, 'get'>;
  state: StateStore<DeviceSyncState>;
  /** Persistent per-installation key used to scope device ids. */
  deviceKey(): Promise<string>;
  platform: DevicePlatform;
  deviceTimeZone(): string;
  untitledTitle(): string;
  now(): Date;
  status: CalendarStatusStore;
  events: EventBus<AppEventMap>;
  getUid(): string | null;
}

export interface OwnDeviceSelection {
  /** Scoped ids of this device's calendars selected for import. */
  importIds: string[];
  /** Scoped id of this device's export calendar (null = no export from this device). */
  exportId: string | null;
}

export interface ExportSyncResult {
  exported: number;
  removed: number;
  failed: number;
}

export interface DeviceCalendarServiceInternal extends DeviceCalendarService {
  /** Import from this device's selection + export reconcile; null when there is nothing to sync. */
  sync(): Promise<CalendarPullResult | null>;
  /** Export reconcile for this device's export target (all own meetings, or only `meetingIds`). */
  syncExports(options?: { meetingIds?: readonly string[] }): Promise<ExportSyncResult>;
  ownSelection(preferences: Preferences): Promise<OwnDeviceSelection>;
  loadState(): Promise<DeviceSyncState>;
}

interface ImportCounts {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
}

export function createDeviceCalendarService(deps: DeviceServiceDeps): DeviceCalendarServiceInternal {
  const mutex = createMutex();
  /** Deleted meetings whose exported copy was already handled in this app session. */
  const checkedTombstones = new Set<string>();

  async function readPermission(request: boolean): Promise<PermissionState> {
    const result = request ? await deps.port.requestPermission() : await deps.port.getPermission();
    deps.status.patchDevice({ permission: result.status });
    return result.status;
  }

  async function requirePermission(): Promise<void> {
    if ((await readPermission(false)) !== 'granted') {
      throw new AppError('calendar_permission_denied', 'Calendar access is not granted');
    }
  }

  async function ownSelection(preferences: Preferences): Promise<OwnDeviceSelection> {
    const key = await deps.deviceKey();
    return {
      importIds: preferences.deviceCalendarImportIds.filter((id) => ownRawId(id, key) !== null),
      exportId: ownRawId(preferences.deviceCalendarExportId, key) !== null ? preferences.deviceCalendarExportId : null,
    };
  }

  async function writeBack(meeting: Meeting, patch: MeetingPatch): Promise<Meeting> {
    try {
      return await deps.meetings.update(meeting.id, patch, { origin: 'calendar_device' });
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'not_found') return meeting;
      throw appError;
    }
  }

  function emitSynced(result: CalendarPullResult | null, error: AppError | null): void {
    const uid = deps.getUid();
    if (!uid) return;
    deps.events.emit('calendar:synced', {
      uid,
      provider: 'device',
      created: result?.counts.created ?? 0,
      updated: result?.counts.updated ?? 0,
      removed: result?.counts.removed ?? 0,
      pushed: result?.counts.pushed ?? 0,
      error: error?.code ?? null,
    });
  }

  async function tracked<T>(operation: () => Promise<T>): Promise<T> {
    const done = deps.status.beginSync('device');
    try {
      return await operation();
    } catch (error) {
      const appError = toAppError(error);
      deps.status.patchDevice({ lastError: appError.code });
      throw appError;
    } finally {
      done();
    }
  }

  // ---- import --------------------------------------------------------------------------------

  async function importLocked(calendarIds: readonly string[]): Promise<ImportCounts> {
    const key = await deps.deviceKey();
    const now = deps.now();
    const window = syncWindow(now);
    const preferences = await deps.preferences.get();

    const wanted = new Set<string>();
    const ownIds = calendarIds.map((id) => ownRawId(id, key)).filter((raw): raw is string => raw !== null);
    if (ownIds.length > 0) {
      const calendars = await deps.port.getCalendars();
      const byRawId = new Map(calendars.map((calendar) => [calendar.id, calendar]));
      for (const raw of ownIds) {
        const calendar = byRawId.get(raw);
        if (!calendar) continue;
        // Google account calendars arrive through Google sync while it is on (no duplicates).
        if (preferences.googleCalendarSyncEnabled && isGoogleAccountCalendar(calendar, deps.platform)) continue;
        wanted.add(raw);
      }
    }
    const events = wanted.size > 0 ? await deps.port.listEvents([...wanted], toDate(window.timeMin), toDate(window.timeMax)) : [];

    const locals = await deps.meetings.list({ includeDeleted: true, includeCancelled: true });
    const imported = new Map<string, Meeting>();
    const exportedRawIds = new Set<string>();
    const orphans = new Map<string, Meeting>();
    for (const meeting of locals) {
      const parsed = parseScopedId(meeting.external.deviceEventId);
      if (!parsed) continue;
      if (meeting.source !== 'device') {
        if (parsed.deviceKey === key) exportedRawIds.add(parsed.rawId);
        continue;
      }
      if (parsed.deviceKey === key) {
        imported.set(meeting.external.deviceEventId as string, meeting);
      } else if (meeting.deletedAt === null) {
        // Imported by a previous installation on this device (new key after a reinstall):
        // adopted below when the same occurrence shows up again.
        const calendar = parseScopedId(meeting.external.deviceCalendarId);
        if (calendar) orphans.set(`${calendar.rawId}|${parsed.rawId}|${meeting.startAt}`, meeting);
      }
    }

    const state = await deps.state.load();
    const ctx = { platform: deps.platform, deviceTimeZone: deps.deviceTimeZone(), untitledTitle: deps.untitledTitle() };
    const upserts: ExternalMeetingUpsert[] = [];
    const adoptions: { meeting: Meeting; deviceEventId: string; deviceCalendarId: string }[] = [];
    const hashes: Record<string, string> = {};
    const seen = new Set<string>();
    let unchanged = 0;

    for (const event of events) {
      if (!event.calendarId || !wanted.has(event.calendarId)) continue;
      // Our own exported copies are not imported back.
      if (exportedRawIds.has(event.id)) continue;
      let occurrence: string;
      try {
        occurrence = deviceOccurrenceKey(event);
      } catch {
        continue;
      }
      const externalId = scopeId(key, occurrence);
      const calendarId = scopeId(key, event.calendarId);
      seen.add(externalId);
      const local = imported.get(externalId);

      if (isCancelledDeviceEvent(event)) {
        if (local && local.deletedAt === null) {
          upserts.push({ provider: 'device', externalId, calendarId, etag: null, providerUpdatedAt: null, deleted: true, meeting: null });
        }
        continue;
      }
      const input = deviceEventToMeetingInput(event, ctx);
      if (!input) continue;
      const hash = deviceImportHash(input, calendarId);
      hashes[externalId] = hash;
      // Unchanged since the last import (a meeting deleted in MeetingGuard stays deleted until the
      // device event itself changes).
      if (local && state.importHashes[externalId] === hash) {
        unchanged += 1;
        continue;
      }
      if (!local) {
        const orphanKey = `${event.calendarId}|${occurrence}|${input.startAt}`;
        const orphan = orphans.get(orphanKey);
        if (orphan) {
          orphans.delete(orphanKey);
          adoptions.push({ meeting: orphan, deviceEventId: externalId, deviceCalendarId: calendarId });
        }
      }
      upserts.push({ provider: 'device', externalId, calendarId, etag: null, providerUpdatedAt: null, deleted: false, meeting: input });
    }

    // Imported occurrences that disappeared: deselected / removed calendars, or deleted events.
    for (const [externalId, meeting] of imported) {
      if (meeting.deletedAt !== null || seen.has(externalId)) continue;
      const calendarRaw = ownRawId(meeting.external.deviceCalendarId, key);
      const calendarListed = calendarRaw !== null && wanted.has(calendarRaw);
      // Events of a listed calendar are only known inside the window.
      if (calendarListed && !insideWindow(meeting, window)) continue;
      upserts.push({
        provider: 'device',
        externalId,
        calendarId: meeting.external.deviceCalendarId ?? scopeId(key, 'unknown'),
        etag: null,
        providerUpdatedAt: null,
        deleted: true,
        meeting: null,
      });
    }

    for (const adoption of adoptions) {
      await writeBack(adoption.meeting, {
        external: { deviceEventId: adoption.deviceEventId, deviceCalendarId: adoption.deviceCalendarId },
      });
    }
    const counts: ImportCounts = { created: 0, updated: 0, removed: 0, unchanged };
    for (const batch of chunk(upserts, UPSERT_CHUNK_SIZE)) {
      const result = await deps.meetings.upsertExternal(batch);
      counts.created += result.created;
      counts.updated += result.updated;
      counts.removed += result.removed;
      counts.unchanged += result.unchanged;
    }
    await deps.state.update((current) => ({ ...current, importHashes: hashes }));
    return counts;
  }

  // ---- export --------------------------------------------------------------------------------

  async function findAdoptableCopy(meeting: Meeting, rawCalendarId: string, key: string): Promise<string | null> {
    // A copy exported by a previous installation of the app on this device (different key).
    const event = parseScopedId(meeting.external.deviceEventId);
    const calendar = parseScopedId(meeting.external.deviceCalendarId);
    if (!event || !calendar || event.deviceKey === key || calendar.rawId !== rawCalendarId) return null;
    const found = await deps.port.findEvent(event.rawId);
    if (!found || found.calendarId !== rawCalendarId || found.title !== meeting.title) return null;
    return toDate(found.startDate).getTime() === toDate(meeting.startAt).getTime() ? event.rawId : null;
  }

  async function removeCopy(meeting: Meeting, key: string): Promise<boolean> {
    // Only copies of our own meetings: an imported meeting's deviceEventId is the user's original event.
    if (!isOwnMeeting(meeting)) return false;
    const raw = ownRawId(meeting.external.deviceEventId, key);
    if (raw === null) return false;
    await deps.port.deleteEvent(raw);
    if (meeting.deletedAt === null) {
      await writeBack(meeting, { external: { deviceEventId: null, deviceCalendarId: null } });
    }
    await deps.state.update((current) => {
      const exportHashes = { ...current.exportHashes };
      delete exportHashes[meeting.id];
      return { ...current, exportHashes };
    });
    return true;
  }

  async function exportCopy(meeting: Meeting, rawCalendarId: string, key: string): Promise<{ meeting: Meeting; changed: boolean }> {
    if (!isOwnMeeting(meeting)) {
      throw new AppError('unsupported', 'Only MeetingGuard meetings are exported to device calendars');
    }
    if (meeting.deletedAt !== null || meeting.status === 'cancelled') {
      return { meeting, changed: await removeCopy(meeting, key) };
    }
    const details = meetingToDeviceEvent(meeting, { platform: deps.platform, deviceTimeZone: deps.deviceTimeZone() });
    const calendarId = scopeId(key, rawCalendarId);
    const hash = deviceExportHash(details, calendarId);
    const currentRaw = ownRawId(meeting.external.deviceEventId, key);
    const currentCalendarRaw = ownRawId(meeting.external.deviceCalendarId, key);
    const state = await deps.state.load();
    if (currentRaw !== null && currentCalendarRaw === rawCalendarId && state.exportHashes[meeting.id] === hash) {
      return { meeting, changed: false };
    }

    let eventId: string | null = null;
    if (currentRaw !== null) {
      if (currentCalendarRaw === rawCalendarId && (await deps.port.findEvent(currentRaw))) {
        await deps.port.updateEvent(currentRaw, details);
        eventId = currentRaw;
      } else if (currentCalendarRaw !== rawCalendarId) {
        // The export calendar changed: move the copy.
        await deps.port.deleteEvent(currentRaw);
      }
    } else {
      const adoptable = await findAdoptableCopy(meeting, rawCalendarId, key);
      if (adoptable !== null) {
        await deps.port.updateEvent(adoptable, details);
        eventId = adoptable;
      }
    }
    if (eventId === null) eventId = await deps.port.createEvent(rawCalendarId, details);

    const deviceEventId = scopeId(key, eventId);
    let updated = meeting;
    if (meeting.external.deviceEventId !== deviceEventId || meeting.external.deviceCalendarId !== calendarId) {
      updated = await writeBack(meeting, { external: { deviceEventId, deviceCalendarId: calendarId } });
    }
    await deps.state.update((current) => ({ ...current, exportHashes: { ...current.exportHashes, [meeting.id]: hash } }));
    return { meeting: updated, changed: true };
  }

  async function syncExportsLocked(meetingIds?: readonly string[]): Promise<ExportSyncResult> {
    const key = await deps.deviceKey();
    const preferences = await deps.preferences.get();
    const targetRaw = ownRawId(preferences.deviceCalendarExportId, key);
    const now = deps.now();
    const window = syncWindow(now);
    const recentIso = addMinutesIso(now, -24 * 60);
    const tombstoneHorizonIso = addMinutesIso(now, -TOMBSTONE_CHECK_DAYS * 24 * 60);
    const filter = meetingIds ? new Set(meetingIds) : null;
    const result: ExportSyncResult = { exported: 0, removed: 0, failed: 0 };

    const locals = await deps.meetings.list({ includeDeleted: true, includeCancelled: true });
    const { exportHashes } = await deps.state.load();
    let permissionChecked = false;
    for (const meeting of locals) {
      if (!isOwnMeeting(meeting) || (filter && !filter.has(meeting.id))) continue;
      // Tombstones keep their refs forever: check each one at most once per app session, and only
      // while it is recent or its copy is known to exist (export hash still stored).
      const tombstoneDone =
        meeting.deletedAt !== null &&
        (checkedTombstones.has(meeting.id) ||
          (exportHashes[meeting.id] === undefined && meeting.deletedAt < tombstoneHorizonIso));
      const copyRaw = tombstoneDone ? null : ownRawId(meeting.external.deviceEventId, key);
      if (meeting.deletedAt !== null) checkedTombstones.add(meeting.id);
      const shouldExport =
        targetRaw !== null &&
        meeting.deletedAt === null &&
        meeting.status === 'scheduled' &&
        endIso(meeting) >= recentIso &&
        meeting.startAt < window.timeMax;
      const staleCopy =
        copyRaw !== null &&
        (meeting.deletedAt !== null ||
          meeting.status === 'cancelled' ||
          targetRaw === null ||
          ownRawId(meeting.external.deviceCalendarId, key) !== targetRaw);
      if (!shouldExport && !staleCopy) continue;
      if (!permissionChecked) {
        await requirePermission();
        permissionChecked = true;
      }
      try {
        if (shouldExport && targetRaw !== null) {
          if ((await exportCopy(meeting, targetRaw, key)).changed) result.exported += 1;
        } else if (await removeCopy(meeting, key)) {
          result.removed += 1;
        }
      } catch (error) {
        result.failed += 1;
        log.warn('Device calendar export failed', { meetingId: meeting.id, code: toAppError(error).code });
      }
    }
    return result;
  }

  // ---- public --------------------------------------------------------------------------------

  const service: DeviceCalendarServiceInternal = {
    getPermission: () => readPermission(false),
    requestPermission: () => readPermission(true),

    async listCalendars() {
      await requirePermission();
      const key = await deps.deviceKey();
      const calendars = await deps.port.getCalendars();
      return calendars
        .map((calendar) => toDeviceCalendarInfo(calendar, key, deps.platform))
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.title.localeCompare(b.title));
    },

    importFrom(calendarIds) {
      return mutex.run(async () => {
        await requirePermission();
        const counts = await tracked(() => importLocked(calendarIds));
        const syncedAt = deps.now().toISOString();
        deps.status.patchDevice({ lastSyncAt: syncedAt, lastError: null });
        await deps.state.update((current) => ({ ...current, lastSyncAt: syncedAt, lastError: null }));
        return { provider: 'device', fullSync: true, counts: { ...counts, pushed: 0, failed: 0 }, syncedAt };
      });
    },

    exportMeeting(meeting, calendarId) {
      return mutex.run(async () => {
        const key = await deps.deviceKey();
        const rawCalendarId = ownRawId(calendarId, key);
        if (rawCalendarId === null) {
          throw new AppError('invalid_input', 'This calendar is not on this device');
        }
        await requirePermission();
        return (await exportCopy(meeting, rawCalendarId, key)).meeting;
      });
    },

    removeExported(meeting) {
      return mutex.run(async () => {
        const key = await deps.deviceKey();
        if (!isOwnMeeting(meeting) || ownRawId(meeting.external.deviceEventId, key) === null) return;
        await requirePermission();
        await removeCopy(meeting, key);
      });
    },

    sync() {
      return mutex.run(async () => {
        const preferences = await deps.preferences.get();
        const own = await ownSelection(preferences);
        const hasSelection = own.importIds.length > 0 || own.exportId !== null;
        const permission = await readPermission(false);
        if (permission !== 'granted') {
          if (!hasSelection) return null;
          const error = new AppError('calendar_permission_denied', 'Calendar access is not granted');
          deps.status.patchDevice({ lastError: error.code });
          emitSynced(null, error);
          throw error;
        }
        try {
          const result = await tracked(async (): Promise<CalendarPullResult> => {
            const counts = await importLocked(preferences.deviceCalendarImportIds);
            const exports = await syncExportsLocked();
            return {
              provider: 'device',
              fullSync: true,
              counts: { ...counts, pushed: exports.exported, failed: exports.failed },
              syncedAt: deps.now().toISOString(),
            };
          });
          deps.status.patchDevice({ lastSyncAt: result.syncedAt, lastError: null });
          await deps.state.update((current) => ({ ...current, lastSyncAt: result.syncedAt, lastError: null }));
          emitSynced(result, null);
          return result;
        } catch (error) {
          const appError = toAppError(error);
          emitSynced(null, appError);
          throw appError;
        }
      });
    },

    syncExports(options = {}) {
      return mutex.run(() => tracked(() => syncExportsLocked(options.meetingIds)));
    },

    ownSelection,

    loadState() {
      return deps.state.load();
    },
  };
  return service;
}
