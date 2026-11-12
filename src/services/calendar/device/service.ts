/**
 * DeviceCalendarService (contract in src/core/contracts.ts): Apple / Android calendars through
 * expo-calendar. Import is one-way (device -> Meeting Guard, source 'device'); export copies
 * Meeting Guard's own meetings (never imported ones) to ONE calendar chosen on this device.
 * All stored device ids are device-scoped (see ./mapping.ts).
 *
 * Export links: each device can export the same meeting to its own calendar, so where THIS
 * device's copy lives is kept locally (DeviceSyncState.exportLinks). The synced
 * `external.deviceEventId` / `deviceCalendarId` are only a hint: claimed when free or already this
 * device's, never overwritten with another device's ref and never cleared for another device.
 * A copy without a local link (after a reinstall or a sign-out wipe) is adopted by matching the
 * shared hint or by an exact title + start + end match in the export calendar, never duplicated.
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
  type DeviceEventDetails,
  type DeviceEventLike,
  type DevicePlatform,
} from './mapping';

const log = createLogger('calendar');

/** This device's exported copy of a meeting (raw device ids). */
interface OwnCopy {
  eventId: string;
  /** null when only a legacy shared ref without calendar is known. */
  calendarId: string | null;
}

/** Local link first; else a shared ref scoped to this device (states written before links existed). */
function ownCopy(meeting: Meeting, key: string, state: DeviceSyncState): OwnCopy | null {
  const link = state.exportLinks[meeting.id];
  if (link) return link;
  const raw = ownRawId(meeting.external.deviceEventId, key);
  if (raw === null) return null;
  return { eventId: raw, calendarId: ownRawId(meeting.external.deviceCalendarId, key) };
}

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

function exportSignature(title: string, startIso: string, endIsoValue: string): string {
  return `${title}|${toDate(startIso).getTime()}|${toDate(endIsoValue).getTime()}`;
}

/** An event identical (title, start, end) to one of our own meetings. */
function isOwnExportLookalike(event: DeviceEventLike, ownSignatures: ReadonlySet<string>): boolean {
  if (event.allDay || !event.title) return false;
  try {
    return ownSignatures.has(exportSignature(event.title, toDate(event.startDate).toISOString(), toDate(event.endDate).toISOString()));
  } catch {
    return false;
  }
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
    const exportState = await deps.state.load();
    const exportedRawIds = new Set<string>(Object.values(exportState.exportLinks).map((link) => link.eventId));
    const exportTargetRaw = ownRawId(preferences.deviceCalendarExportId, key);
    /** "title|start|end" of our own meetings: an identical event in the export calendar is our copy. */
    const ownSignatures = new Set<string>();
    const orphans = new Map<string, Meeting>();
    for (const meeting of locals) {
      if (isOwnMeeting(meeting) && meeting.deletedAt === null) {
        ownSignatures.add(exportSignature(meeting.title, meeting.startAt, endIso(meeting)));
      }
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
      // Our own exported copies are not imported back (also when the local link was lost).
      if (exportedRawIds.has(event.id)) continue;
      if (event.calendarId === exportTargetRaw && isOwnExportLookalike(event, ownSignatures)) continue;
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
      // Unchanged since the last import (a meeting deleted in Meeting Guard stays deleted until the
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

  /**
   * A copy of `meeting` that this device made earlier but has no local link for (reinstall, or the
   * sign-out wipe of the per-user state): the shared hint of a previous installation, else an event
   * of the export calendar with exactly the same title, start and end that no other meeting owns.
   */
  async function findAdoptableCopy(
    meeting: Meeting,
    details: DeviceEventDetails,
    rawCalendarId: string,
    key: string,
    linkedEventIds: ReadonlySet<string>,
  ): Promise<string | null> {
    const event = parseScopedId(meeting.external.deviceEventId);
    const calendar = parseScopedId(meeting.external.deviceCalendarId);
    if (event && calendar && event.deviceKey !== key && calendar.rawId === rawCalendarId && !linkedEventIds.has(event.rawId)) {
      const found = await deps.port.findEvent(event.rawId);
      if (found && found.calendarId === rawCalendarId && found.title === meeting.title) {
        if (toDate(found.startDate).getTime() === toDate(meeting.startAt).getTime()) return event.rawId;
      }
    }
    const margin = 60_000;
    const candidates = await deps.port.listEvents(
      [rawCalendarId],
      new Date(details.startDate.getTime() - margin),
      new Date(details.endDate.getTime() + margin),
    );
    const match = candidates.find(
      (candidate) =>
        candidate.calendarId === rawCalendarId &&
        !linkedEventIds.has(candidate.id) &&
        candidate.title === details.title &&
        toDate(candidate.startDate).getTime() === details.startDate.getTime() &&
        toDate(candidate.endDate).getTime() === details.endDate.getTime(),
    );
    return match?.id ?? null;
  }

  /** The shared hint may be (re)written only when it is free or already this device's. */
  function mayClaimSharedRef(meeting: Meeting, key: string): boolean {
    const shared = parseScopedId(meeting.external.deviceEventId);
    return shared === null || shared.deviceKey === key;
  }

  async function forgetCopy(meetingId: string): Promise<void> {
    await deps.state.update((current) => {
      const exportHashes = { ...current.exportHashes };
      const exportLinks = { ...current.exportLinks };
      delete exportHashes[meetingId];
      delete exportLinks[meetingId];
      return { ...current, exportHashes, exportLinks };
    });
  }

  async function removeCopy(meeting: Meeting, key: string): Promise<boolean> {
    // Only copies of our own meetings: an imported meeting's deviceEventId is the user's original event.
    if (!isOwnMeeting(meeting)) return false;
    const copy = ownCopy(meeting, key, await deps.state.load());
    if (copy === null) return false;
    await deps.port.deleteEvent(copy.eventId);
    // Clear the shared hint only when it points at THIS device's copy: another device's ref stays.
    if (meeting.deletedAt === null && ownRawId(meeting.external.deviceEventId, key) !== null) {
      await writeBack(meeting, { external: { deviceEventId: null, deviceCalendarId: null } });
    }
    await forgetCopy(meeting.id);
    return true;
  }

  async function exportCopy(meeting: Meeting, rawCalendarId: string, key: string): Promise<{ meeting: Meeting; changed: boolean }> {
    if (!isOwnMeeting(meeting)) {
      throw new AppError('unsupported', 'Only Meeting Guard meetings are exported to device calendars');
    }
    if (meeting.deletedAt !== null || meeting.status === 'cancelled') {
      return { meeting, changed: await removeCopy(meeting, key) };
    }
    const details = meetingToDeviceEvent(meeting, { platform: deps.platform, deviceTimeZone: deps.deviceTimeZone() });
    const calendarId = scopeId(key, rawCalendarId);
    const hash = deviceExportHash(details, calendarId);
    const state = await deps.state.load();
    const copy = ownCopy(meeting, key, state);
    if (copy !== null && copy.calendarId === rawCalendarId && state.exportHashes[meeting.id] === hash) {
      if (!state.exportLinks[meeting.id]) {
        // Known only through the shared hint (older state): keep it locally from now on.
        await deps.state.update((current) => ({
          ...current,
          exportLinks: { ...current.exportLinks, [meeting.id]: { eventId: copy.eventId, calendarId: rawCalendarId } },
        }));
      }
      return { meeting, changed: false };
    }

    let eventId: string | null = null;
    if (copy !== null) {
      if (copy.calendarId === rawCalendarId && (await deps.port.findEvent(copy.eventId))) {
        await deps.port.updateEvent(copy.eventId, details);
        eventId = copy.eventId;
      } else if (copy.calendarId !== rawCalendarId) {
        // The export calendar changed: move the copy.
        await deps.port.deleteEvent(copy.eventId);
      }
      // Else the copy was deleted in the calendar app: a new one is created below.
    } else {
      const linked = new Set(Object.values(state.exportLinks).map((link) => link.eventId));
      const adoptable = await findAdoptableCopy(meeting, details, rawCalendarId, key, linked);
      if (adoptable !== null) {
        await deps.port.updateEvent(adoptable, details);
        eventId = adoptable;
      }
    }
    if (eventId === null) eventId = await deps.port.createEvent(rawCalendarId, details);
    const newEventId = eventId;

    const deviceEventId = scopeId(key, newEventId);
    let updated = meeting;
    const hintChanged = meeting.external.deviceEventId !== deviceEventId || meeting.external.deviceCalendarId !== calendarId;
    if (hintChanged && mayClaimSharedRef(meeting, key)) {
      updated = await writeBack(meeting, { external: { deviceEventId, deviceCalendarId: calendarId } });
    }
    await deps.state.update((current) => ({
      ...current,
      exportHashes: { ...current.exportHashes, [meeting.id]: hash },
      exportLinks: { ...current.exportLinks, [meeting.id]: { eventId: newEventId, calendarId: rawCalendarId } },
    }));
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
    const state = await deps.state.load();
    const { exportHashes } = state;
    let permissionChecked = false;
    for (const meeting of locals) {
      if (!isOwnMeeting(meeting) || (filter && !filter.has(meeting.id))) continue;
      // Tombstones keep their refs forever: check each one at most once per app session, and only
      // while it is recent or its copy is known to exist (export hash still stored).
      const tombstoneDone =
        meeting.deletedAt !== null &&
        (checkedTombstones.has(meeting.id) ||
          (exportHashes[meeting.id] === undefined && meeting.deletedAt < tombstoneHorizonIso));
      // This device's copy comes from its local link (never from another device's shared ref).
      const copy = tombstoneDone ? null : ownCopy(meeting, key, state);
      if (meeting.deletedAt !== null) checkedTombstones.add(meeting.id);
      // Recurring masters are never exported: the mapping writes a single plain event, which
      // would freeze the series' FIRST occurrence in the phone calendar and go stale forever
      // (docs/v1/ARCHITECTURE.md §16). A copy exported before the meeting became recurring is
      // removed below (staleCopy).
      const shouldExport =
        targetRaw !== null &&
        meeting.deletedAt === null &&
        meeting.status === 'scheduled' &&
        meeting.recurrence === null &&
        endIso(meeting) >= recentIso &&
        meeting.startAt < window.timeMax;
      const staleCopy =
        copy !== null &&
        (meeting.deletedAt !== null ||
          meeting.status === 'cancelled' ||
          meeting.recurrence !== null ||
          targetRaw === null ||
          copy.calendarId !== targetRaw);
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
        if (!isOwnMeeting(meeting) || ownCopy(meeting, key, await deps.state.load()) === null) return;
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
            // Exports first: they adopt copies without a local link and record the links the
            // import then uses to skip this device's own copies.
            const exports = await syncExportsLocked();
            const counts = await importLocked(preferences.deviceCalendarImportIds);
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
