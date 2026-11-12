/**
 * Pure mapping between device calendar events (expo-calendar) and meetings (unit-tested).
 *
 * DEVICE-SCOPED IDS. Device calendar/event ids are only meaningful on the device that produced
 * them (Android ids are small integers that collide across phones), yet meetings and preferences
 * sync across devices. Every id this area stores is therefore scoped: "d{deviceKey}.{rawId}", where
 * deviceKey is a random per-installation key. Other devices ignore ids that are not theirs.
 *
 * All-day events: Android stores them at UTC midnight, iOS at local midnight of the device zone;
 * both map to local midnight of the device zone with the same calendar date (never shifted).
 */
import type { DeviceCalendarInfo } from '../../../core/contracts';
import {
  addDaysToLocalDate,
  endIso,
  isValidTimeZone,
  minutesBetween,
  toDate,
  toLocalDateTime,
  zonedDateTimeToUtcIso,
} from '../../../core/time';
import type { Meeting } from '../../../core/types';
import {
  clampDuration,
  deriveLocationFromText,
  DESCRIPTION_MAX,
  detectConferenceInText,
  DURATION_MAX_MINUTES,
  MINUTES_PER_DAY,
  renderLocationText,
  stableHash,
  TITLE_MAX,
  truncate,
  type ExternalMeetingInput,
} from '../shared';

export type DevicePlatform = 'ios' | 'android';

/** The expo-calendar event fields Meeting Guard reads. */
export interface DeviceEventLike {
  id: string;
  calendarId: string | null;
  title: string | null;
  notes: string | null;
  location: string | null;
  startDate: string | Date;
  endDate: string | Date;
  allDay: boolean;
  /** Android: IANA zone; iOS: a localized abbreviation (not usable as a zone). */
  timeZone: string | null;
  /** 'none' | 'confirmed' | 'tentative' | 'canceled' */
  status: string | null;
  recurrenceRule: unknown;
  /** Android: detached instance of a recurring event. */
  originalId?: string | null;
  /** iOS: detached occurrence. */
  isDetached?: boolean;
  /** iOS only. */
  url?: string | null;
}

/** The expo-calendar calendar fields Meeting Guard reads. */
export interface DeviceCalendarLike {
  id: string;
  title: string;
  color?: string | null;
  source?: { name?: string | null; type?: string | null; isLocalAccount?: boolean } | null;
  isPrimary?: boolean;
  allowsModifications: boolean;
  ownerAccount?: string | null;
}

/** What Meeting Guard writes to an exported device event. */
export interface DeviceEventDetails {
  title: string;
  notes: string;
  location: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  timeZone: string;
  /** iOS only (ignored on Android). */
  url?: string;
  /** Meeting Guard is the alarm: no duplicate OS calendar reminders. */
  alarms: [];
}

export interface DeviceMappingContext {
  platform: DevicePlatform;
  deviceTimeZone: string;
  untitledTitle: string;
}

// ---------------------------------------------------------------------------------------------
// Device-scoped ids
// ---------------------------------------------------------------------------------------------

const DEVICE_KEY_PATTERN = /^[a-z0-9]{12}$/;
const SCOPED_ID_PATTERN = /^d([a-z0-9]{12})\.([\s\S]+)$/;
const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function isValidDeviceKey(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_KEY_PATTERN.test(value);
}

export function generateDeviceKey(random: () => number = Math.random): string {
  let key = '';
  for (let i = 0; i < 12; i += 1) {
    key += KEY_ALPHABET[Math.floor(random() * KEY_ALPHABET.length) % KEY_ALPHABET.length];
  }
  return key;
}

export function scopeId(deviceKey: string, rawId: string): string {
  return `d${deviceKey}.${rawId}`;
}

export function parseScopedId(value: string | null | undefined): { deviceKey: string; rawId: string } | null {
  if (!value) return null;
  const match = SCOPED_ID_PATTERN.exec(value);
  if (!match || !match[1] || !match[2]) return null;
  return { deviceKey: match[1], rawId: match[2] };
}

/** Raw id when `value` was scoped by this device, else null. */
export function ownRawId(value: string | null | undefined, deviceKey: string): string | null {
  const parsed = parseScopedId(value);
  return parsed !== null && parsed.deviceKey === deviceKey ? parsed.rawId : null;
}

// ---------------------------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------------------------

/**
 * A Google account calendar synced to the device (its events also arrive through Google sync).
 * Android: account type "com.google". iOS: CalDAV accounts named Gmail/Google or after a Gmail
 * address (Google Workspace accounts with a custom domain are not detectable on iOS).
 */
export function isGoogleAccountCalendar(calendar: DeviceCalendarLike, platform: DevicePlatform): boolean {
  const type = (calendar.source?.type ?? '').toLowerCase();
  if (platform === 'android') return type === 'com.google';
  const name = (calendar.source?.name ?? '').toLowerCase();
  return type === 'caldav' && (/\b(gmail|google)\b/.test(name) || /@(gmail|googlemail)\.com$/.test(name));
}

export function toDeviceCalendarInfo(calendar: DeviceCalendarLike, deviceKey: string, platform: DevicePlatform): DeviceCalendarInfo {
  return {
    id: scopeId(deviceKey, calendar.id),
    title: calendar.title,
    color: calendar.color ?? null,
    sourceName: calendar.source?.name ?? calendar.ownerAccount ?? null,
    isPrimary: calendar.isPrimary === true,
    allowsModifications: calendar.allowsModifications,
    isGoogleAccount: isGoogleAccountCalendar(calendar, platform),
  };
}

// ---------------------------------------------------------------------------------------------
// Events -> meetings
// ---------------------------------------------------------------------------------------------

/**
 * Stable per-occurrence key: recurring series share one event id (iOS and Android), so their
 * occurrences are keyed by id + start.
 */
export function deviceOccurrenceKey(event: Pick<DeviceEventLike, 'id' | 'startDate' | 'recurrenceRule' | 'originalId' | 'isDetached'>): string {
  const recurring = (event.recurrenceRule !== null && event.recurrenceRule !== undefined) || !!event.originalId || event.isDetached === true;
  return recurring ? `${event.id}@${toDate(event.startDate).toISOString()}` : event.id;
}

export function isCancelledDeviceEvent(event: Pick<DeviceEventLike, 'status'>): boolean {
  return event.status === 'canceled' || event.status === 'cancelled';
}

/** Device event -> import payload; null when its dates are unusable. */
export function deviceEventToMeetingInput(event: DeviceEventLike, ctx: DeviceMappingContext): ExternalMeetingInput | null {
  let start: Date;
  let end: Date;
  try {
    start = toDate(event.startDate);
    end = toDate(event.endDate);
  } catch {
    return null;
  }

  let startAt: string;
  let durationMinutes: number;
  let timezone: string;
  if (event.allDay) {
    const date = toLocalDateTime(start, ctx.platform === 'android' ? 'UTC' : ctx.deviceTimeZone).date;
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    timezone = ctx.deviceTimeZone;
    startAt = zonedDateTimeToUtcIso(date, '00:00', timezone);
    durationMinutes = Math.min(DURATION_MAX_MINUTES, days * MINUTES_PER_DAY);
  } else {
    startAt = start.toISOString();
    durationMinutes = clampDuration(minutesBetween(start, end));
    // iOS reports localized abbreviations ("EST" is even a valid fixed-offset id, losing DST).
    timezone =
      ctx.platform === 'android' && event.timeZone && isValidTimeZone(event.timeZone) ? event.timeZone : ctx.deviceTimeZone;
  }

  const title = truncate((event.title ?? '').trim(), TITLE_MAX).trim();
  return {
    title: title.length > 0 ? title : ctx.untitledTitle,
    description: truncate(event.notes ?? '', DESCRIPTION_MAX),
    startAt,
    durationMinutes,
    timezone,
    allDay: event.allDay,
    location: deriveLocationFromText(event.location),
    conference: detectConferenceInText(event.url, event.location, event.notes),
    participants: [],
    status: 'scheduled',
  };
}

export function deviceImportHash(input: ExternalMeetingInput, scopedCalendarId: string): string {
  return stableHash({ input, calendar: scopedCalendarId });
}

// ---------------------------------------------------------------------------------------------
// Meetings -> exported events
// ---------------------------------------------------------------------------------------------

type ExportableMeeting = Pick<
  Meeting,
  'title' | 'description' | 'startAt' | 'durationMinutes' | 'timezone' | 'allDay' | 'location' | 'conference'
>;

export function meetingToDeviceEvent(meeting: ExportableMeeting, ctx: Pick<DeviceMappingContext, 'platform' | 'deviceTimeZone'>): DeviceEventDetails {
  const joinUrl = meeting.conference?.url ?? meeting.location?.virtualUrl ?? null;
  const notes = joinUrl && !meeting.description.includes(joinUrl)
    ? `${meeting.description}${meeting.description.length > 0 ? '\n\n' : ''}${joinUrl}`
    : meeting.description;

  let startDate: Date;
  let endDate: Date;
  let timeZone: string;
  if (meeting.allDay) {
    const date = toLocalDateTime(meeting.startAt, meeting.timezone).date;
    const days = Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY));
    const endDateLocal = addDaysToLocalDate(date, days);
    if (ctx.platform === 'android') {
      // Android requires all-day events at UTC midnight with the UTC zone.
      startDate = new Date(`${date}T00:00:00.000Z`);
      endDate = new Date(`${endDateLocal}T00:00:00.000Z`);
      timeZone = 'UTC';
    } else {
      // EventKit all-day events are floating days in the device zone; the end is inclusive.
      startDate = new Date(zonedDateTimeToUtcIso(date, '00:00', ctx.deviceTimeZone));
      endDate = new Date(new Date(zonedDateTimeToUtcIso(endDateLocal, '00:00', ctx.deviceTimeZone)).getTime() - 1000);
      timeZone = ctx.deviceTimeZone;
    }
  } else {
    startDate = new Date(meeting.startAt);
    endDate = new Date(endIso(meeting));
    timeZone = meeting.timezone;
  }

  const details: DeviceEventDetails = {
    title: meeting.title,
    notes,
    location: renderLocationText(meeting.location, meeting.conference),
    startDate,
    endDate,
    allDay: meeting.allDay,
    timeZone,
    alarms: [],
  };
  if (ctx.platform === 'ios' && joinUrl) details.url = joinUrl;
  return details;
}

export function deviceExportHash(details: DeviceEventDetails, scopedCalendarId: string): string {
  return stableHash({
    ...details,
    startDate: details.startDate.toISOString(),
    endDate: details.endDate.toISOString(),
    calendar: scopedCalendarId,
  });
}
