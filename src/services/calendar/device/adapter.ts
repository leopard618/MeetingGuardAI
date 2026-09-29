/**
 * expo-calendar adapter (SDK 57 object API). The legacy root functions (getCalendarsAsync,
 * createEventAsync, ...) throw at runtime in SDK 57 and are never used here.
 */
import * as Calendar from 'expo-calendar';

import type { PermissionState } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import type { DeviceCalendarLike, DeviceEventDetails, DeviceEventLike } from './mapping';

export interface DevicePermission {
  status: PermissionState;
  canAskAgain: boolean;
}

/** The device calendar operations MeetingGuard needs (faked in tests). */
export interface DeviceCalendarPort {
  getPermission(): Promise<DevicePermission>;
  requestPermission(): Promise<DevicePermission>;
  getCalendars(): Promise<DeviceCalendarLike[]>;
  /** Occurrences in [start, end] of the given calendars (recurring series are expanded). */
  listEvents(calendarIds: readonly string[], start: Date, end: Date): Promise<DeviceEventLike[]>;
  /** null when the event no longer exists. */
  findEvent(eventId: string): Promise<DeviceEventLike | null>;
  /** Returns the new event id. */
  createEvent(calendarId: string, details: DeviceEventDetails): Promise<string>;
  updateEvent(eventId: string, details: DeviceEventDetails): Promise<void>;
  /** Deleting a missing event is not an error. */
  deleteEvent(eventId: string): Promise<void>;
}

function toPermission(response: { status: string; canAskAgain?: boolean }): DevicePermission {
  const status: PermissionState =
    response.status === 'granted' ? 'granted' : response.status === 'denied' ? 'denied' : 'undetermined';
  return { status, canAskAgain: response.canAskAgain !== false };
}

function isNotFoundError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'ERR_EVENT_NOT_FOUND' || code === 'E_EVENT_NOT_FOUND') return true;
  const message = error instanceof Error ? error.message : '';
  // Android resolves a missing event to null and the JS wrapper then fails on setPrototypeOf(null).
  if (error instanceof TypeError && /prototype|null|undefined/i.test(message)) return true;
  return /not.?found|does not exist|no longer exists/i.test(message);
}

function toEventLike(event: Calendar.ExpoCalendarEvent): DeviceEventLike {
  return {
    id: event.id,
    calendarId: event.calendarId ?? null,
    title: event.title ?? null,
    notes: event.notes ?? null,
    location: event.location ?? null,
    startDate: event.startDate,
    endDate: event.endDate,
    allDay: event.allDay === true,
    timeZone: event.timeZone ?? null,
    status: event.status ?? null,
    recurrenceRule: event.recurrenceRule ?? null,
    originalId: event.originalId ?? null,
    isDetached: event.isDetached === true,
    url: event.url ?? null,
  };
}

function toCalendarLike(calendar: Calendar.ExpoCalendar): DeviceCalendarLike {
  return {
    id: calendar.id,
    title: calendar.title,
    color: calendar.color ?? null,
    source: calendar.source
      ? { name: calendar.source.name ?? null, type: calendar.source.type ?? null, isLocalAccount: calendar.source.isLocalAccount }
      : null,
    isPrimary: calendar.isPrimary === true,
    allowsModifications: calendar.allowsModifications === true,
    ownerAccount: calendar.ownerAccount ?? null,
  };
}

async function getEventHandle(eventId: string): Promise<Calendar.ExpoCalendarEvent | null> {
  try {
    const event = await Calendar.ExpoCalendarEvent.get(eventId);
    return event ?? null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function writableDetails(details: DeviceEventDetails): Partial<Calendar.ModifiableEventProperties> {
  const out: Partial<Calendar.ModifiableEventProperties> = {
    title: details.title,
    notes: details.notes,
    location: details.location,
    startDate: details.startDate,
    endDate: details.endDate,
    allDay: details.allDay,
    timeZone: details.timeZone,
    alarms: details.alarms,
  };
  if (details.url !== undefined) out.url = details.url;
  return out;
}

export function createExpoCalendarPort(): DeviceCalendarPort {
  return {
    async getPermission() {
      return toPermission(await Calendar.getCalendarPermissions());
    },
    async requestPermission() {
      return toPermission(await Calendar.requestCalendarPermissions());
    },
    async getCalendars() {
      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      return calendars.map(toCalendarLike);
    },
    async listEvents(calendarIds, start, end) {
      if (calendarIds.length === 0) return [];
      const events = await Calendar.listEvents([...calendarIds], start, end);
      return events.map(toEventLike);
    },
    async findEvent(eventId) {
      const event = await getEventHandle(eventId);
      return event ? toEventLike(event) : null;
    },
    async createEvent(calendarId, details) {
      const calendar = await Calendar.ExpoCalendar.get(calendarId);
      if (!calendar.allowsModifications) {
        throw new AppError('permission_denied', 'This calendar is read-only');
      }
      const event = await calendar.createEvent(writableDetails(details));
      return event.id;
    },
    async updateEvent(eventId, details) {
      const event = await getEventHandle(eventId);
      if (!event) throw new AppError('not_found', 'Device calendar event not found');
      await event.update(writableDetails(details));
    },
    async deleteEvent(eventId) {
      const event = await getEventHandle(eventId);
      if (!event) return;
      await event.delete();
    },
  };
}
