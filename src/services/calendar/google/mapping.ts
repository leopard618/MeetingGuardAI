/**
 * Pure mapping between Google Calendar events and Meeting Guard meetings (unit-tested).
 *
 * - Timed events keep their instant; the meeting zone is the event's zone (else the calendar's).
 * - All-day events start at local midnight of the event/calendar zone (never shifted through UTC)
 *   and last 1440 min x days (end date is exclusive in Google).
 * - Attendees map to participants (resources and the user themself excluded).
 * - Conference: Google Meet / add-on conferenceData or hangoutLink; otherwise the Zoom/Teams/Meet
 *   link Meeting Guard stored in the event's private extended properties; otherwise a join link
 *   found in the location/description text.
 * - Meeting Guard writes its rich location/conference as private extended properties so a round trip
 *   through Google does not lose passwords, hybrid locations or link-only locations.
 */
import {
  conferenceDetailsSchema,
  emailSchema,
  meetingLocationSchema,
  type ConferenceDetails,
  type MeetingLocation,
} from '../../../core/aiContract';
import {
  addDaysToLocalDate,
  endIso,
  isLocalDate,
  isValidTimeZone,
  minutesBetween,
  toLocalDateTime,
  toUtcIso,
  zonedDateTimeToUtcIso,
} from '../../../core/time';
import { toGoogleRecurrence } from '../../../core/recurrence';
import type { Meeting, ParticipantInput, ParticipantStatus } from '../../../core/types';
import {
  clampDuration,
  conferenceProviderForUrl,
  deriveLocationFromText,
  DESCRIPTION_MAX,
  detectConferenceInText,
  DURATION_MAX_MINUTES,
  externalHash,
  externalProjection,
  isHttpUrl,
  MINUTES_PER_DAY,
  PARTICIPANT_NAME_MAX,
  PARTICIPANTS_MAX,
  PASSWORD_MAX,
  appendJoinBlock,
  renderLocationText,
  stripJoinBlock,
  stableHash,
  TITLE_MAX,
  truncate,
  type ExternalMeetingInput,
  type ExternalVisibleFields,
} from '../shared';
import type {
  GoogleAttendee,
  GoogleCreateRequestStatus,
  GoogleEvent,
  GoogleEventDateTime,
  GoogleEventWrite,
  GoogleResponseStatus,
} from './types';

/** Meeting Guard syncs the user's primary calendar. */
export const GOOGLE_PRIMARY_CALENDAR = 'primary';

/** Private extended properties written on pushed events (visible only to the calendar owner). */
export const MG_EVENT_PROPS = {
  marker: 'mgV',
  location: 'mgLocation',
  conference: 'mgConference',
} as const;
const PROPERTY_VALUE_MAX = 1024;

export type GoogleMeetingInput = ExternalMeetingInput;

export interface GoogleMappingContext {
  /** Calendar zone from events.list (all-day and floating events). */
  calendarTimeZone: string | null;
  /** Device / preferences zone when the event has none. */
  defaultTimeZone: string;
  /** Localized title for events without a summary. */
  untitledTitle: string;
}

const IMPORTABLE_EVENT_TYPES: ReadonlySet<string> = new Set(['default', 'fromGmail']);

/** Out-of-office, focus time, working location and birthdays are not meetings. */
export function isImportableEventType(event: Pick<GoogleEvent, 'eventType'>): boolean {
  return event.eventType === undefined || IMPORTABLE_EVENT_TYPES.has(event.eventType);
}

function firstValidZone(...zones: (string | null | undefined)[]): string {
  for (const zone of zones) {
    if (zone && isValidTimeZone(zone)) return zone;
  }
  return 'UTC';
}

function daysBetweenLocalDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

const RESPONSE_STATUS: Readonly<Record<GoogleResponseStatus, ParticipantStatus>> = {
  needsAction: 'needs_action',
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
};

/** Attendees -> participants (no resources, not the user themself, valid emails, at most 100). */
export function mapAttendees(attendees: readonly GoogleAttendee[] | undefined): ParticipantInput[] {
  const out: ParticipantInput[] = [];
  const seen = new Set<string>();
  for (const attendee of attendees ?? []) {
    if (!attendee.email || attendee.resource || attendee.self) continue;
    const email = attendee.email.trim().toLowerCase();
    if (seen.has(email) || !emailSchema.safeParse(email).success) continue;
    seen.add(email);
    const name = attendee.displayName?.trim();
    out.push({
      email,
      name: name ? truncate(name, PARTICIPANT_NAME_MAX) : null,
      status: attendee.responseStatus ? (RESPONSE_STATUS[attendee.responseStatus] ?? null) : null,
    });
    if (out.length >= PARTICIPANTS_MAX) break;
  }
  return out;
}

export function meetCreateStatus(event: GoogleEvent): GoogleCreateRequestStatus | null {
  return event.conferenceData?.createRequest?.status?.statusCode ?? null;
}

/** Conference from Google's own conference fields (Meet or conferencing add-ons). */
export function extractGoogleConference(event: GoogleEvent): ConferenceDetails | null {
  const data = event.conferenceData;
  if (data) {
    const solution = data.conferenceSolution?.key?.type ?? data.createRequest?.conferenceSolutionKey?.type;
    const video = data.entryPoints?.find((entry) => entry.entryPointType === 'video' && entry.uri);
    if (video?.uri && isHttpUrl(video.uri)) {
      const provider = solution === 'hangoutsMeet' ? 'google_meet' : (conferenceProviderForUrl(video.uri) ?? 'other');
      const password = video.password ?? video.passcode ?? null;
      return { provider, url: video.uri, password: password ? truncate(password, PASSWORD_MAX) : null };
    }
    if (solution === 'hangoutsMeet' && meetCreateStatus(event) === 'pending') {
      return { provider: 'google_meet', url: null, password: null };
    }
  }
  if (event.hangoutLink && isHttpUrl(event.hangoutLink)) {
    return { provider: 'google_meet', url: event.hangoutLink, password: null };
  }
  return null;
}

interface StoredProps {
  /** The event was last written by Meeting Guard. */
  marker: boolean;
  /** undefined = not stored / unreadable. */
  location: MeetingLocation | null | undefined;
  conference: ConferenceDetails | null | undefined;
}

function readJsonProperty<T>(raw: string | undefined, parse: (value: unknown) => T | undefined): T | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function readStoredProps(event: GoogleEvent): StoredProps {
  const props = event.extendedProperties?.private ?? {};
  return {
    marker: props[MG_EVENT_PROPS.marker] === '1',
    location: readJsonProperty(props[MG_EVENT_PROPS.location], (value) => {
      const parsed = meetingLocationSchema.nullable().safeParse(value);
      return parsed.success ? parsed.data : undefined;
    }),
    conference: readJsonProperty(props[MG_EVENT_PROPS.conference], (value) => {
      const parsed = conferenceDetailsSchema.nullable().safeParse(value);
      return parsed.success ? parsed.data : undefined;
    }),
  };
}

function propertyJson(value: unknown): string {
  const json = JSON.stringify(value);
  return json.length <= PROPERTY_VALUE_MAX ? json : '';
}

interface Timing {
  startAt: string;
  durationMinutes: number;
  timezone: string;
  allDay: boolean;
}

function eventTiming(start: GoogleEventDateTime, end: GoogleEventDateTime | undefined, ctx: GoogleMappingContext): Timing | null {
  if (start.date && isLocalDate(start.date)) {
    const timezone = firstValidZone(start.timeZone, ctx.calendarTimeZone, ctx.defaultTimeZone);
    const endDate = end?.date && isLocalDate(end.date) ? end.date : addDaysToLocalDate(start.date, 1);
    const days = Math.max(1, daysBetweenLocalDates(start.date, endDate));
    return {
      startAt: zonedDateTimeToUtcIso(start.date, '00:00', timezone),
      durationMinutes: Math.min(DURATION_MAX_MINUTES, days * MINUTES_PER_DAY),
      timezone,
      allDay: true,
    };
  }
  if (start.dateTime) {
    const startAt = toUtcIso(start.dateTime);
    const endAt = end?.dateTime ? toUtcIso(end.dateTime) : null;
    return {
      startAt,
      durationMinutes: endAt ? clampDuration(minutesBetween(startAt, endAt)) : 60,
      timezone: firstValidZone(start.timeZone, ctx.calendarTimeZone, ctx.defaultTimeZone),
      allDay: false,
    };
  }
  return null;
}

/**
 * Google event -> import payload. null when the event has no usable start (never throws for
 * malformed dates: those events are skipped).
 */
export function googleEventToMeetingInput(event: GoogleEvent, ctx: GoogleMappingContext): GoogleMeetingInput | null {
  if (!event.start) return null;
  let timing: Timing | null;
  try {
    timing = eventTiming(event.start, event.end, ctx);
  } catch {
    return null;
  }
  if (!timing) return null;

  const stored = readStoredProps(event);
  const locationText = (event.location ?? '').trim();
  const googleConference = extractGoogleConference(event);

  let conference: ConferenceDetails | null;
  if (googleConference) {
    const pushed = stored.conference;
    conference =
      pushed && pushed.provider === googleConference.provider && pushed.url === googleConference.url ? pushed : googleConference;
  } else if (stored.marker && stored.conference !== undefined) {
    conference = stored.conference;
  } else {
    conference = detectConferenceInText(locationText, event.description);
  }

  let location: MeetingLocation | null;
  if (
    stored.marker &&
    stored.location !== undefined &&
    locationText === renderLocationText(stored.location, stored.conference ?? null)
  ) {
    location = stored.location;
  } else {
    location = deriveLocationFromText(locationText);
  }

  const title = truncate((event.summary ?? '').trim(), TITLE_MAX).trim();
  const selfDeclined = (event.attendees ?? []).some((attendee) => attendee.self && attendee.responseStatus === 'declined');

  return {
    title: title.length > 0 ? title : ctx.untitledTitle,
    description: truncate(stripJoinBlock(event.description ?? ''), DESCRIPTION_MAX),
    startAt: timing.startAt,
    durationMinutes: timing.durationMinutes,
    timezone: timing.timezone,
    allDay: timing.allDay,
    location,
    conference,
    participants: mapAttendees(event.attendees),
    // Declined invitations stay visible but never alert.
    status: selfDeclined ? 'cancelled' : 'scheduled',
  };
}

export interface GoogleWriteOptions {
  /** Adds conferenceData.createRequest (hangoutsMeet); send with conferenceDataVersion=1. */
  requestMeetLink?: boolean;
  /** Unique per creation attempt (Google ignores a repeated requestId). */
  requestId?: string;
}

type GoogleWritableMeeting = Pick<
  Meeting,
  | 'title'
  | 'description'
  | 'startAt'
  | 'durationMinutes'
  | 'timezone'
  | 'allDay'
  | 'location'
  | 'conference'
  | 'participants'
  /** Picks the EN/ES label of the attendee-visible join block (appendJoinBlock). */
  | 'language'
> &
  /** Present on full meetings; a recurring master pushes its rule as RRULE/EXDATE lines (§16). */
  Partial<Pick<Meeting, 'recurrence' | 'recurrenceOverrides'>>;

/** Meeting -> events.insert / events.patch body. */
export function meetingToGoogleEvent(meeting: GoogleWritableMeeting, options: GoogleWriteOptions = {}): GoogleEventWrite {
  let start: GoogleEventDateTime;
  let end: GoogleEventDateTime;
  if (meeting.allDay) {
    const date = toLocalDateTime(meeting.startAt, meeting.timezone).date;
    const days = Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY));
    start = { date };
    end = { date: addDaysToLocalDate(date, days) };
  } else {
    start = { dateTime: meeting.startAt, timeZone: meeting.timezone };
    end = { dateTime: endIso(meeting), timeZone: meeting.timezone };
  }

  const body: GoogleEventWrite = {
    summary: meeting.title,
    description: appendJoinBlock(truncate(meeting.description, DESCRIPTION_MAX), meeting.conference, meeting.language),
    location: renderLocationText(meeting.location, meeting.conference),
    start,
    end,
    attendees: meeting.participants.map((participant) =>
      participant.name ? { email: participant.email, displayName: participant.name } : { email: participant.email },
    ),
    extendedProperties: {
      private: {
        [MG_EVENT_PROPS.marker]: '1',
        [MG_EVENT_PROPS.location]: propertyJson(meeting.location),
        [MG_EVENT_PROPS.conference]: propertyJson(meeting.conference),
      },
    },
  };
  const rule = meeting.recurrence ?? null;
  if (rule !== null) {
    // The master pushes its rule (one RRULE line) plus one EXDATE line per cancelled occurrence;
    // time-modified overrides stay local (docs/v1/ARCHITECTURE.md §16). date/time are re-derived
    // from startAt + timezone, exactly like the stored derived fields.
    const local = toLocalDateTime(meeting.startAt, meeting.timezone);
    body.recurrence = toGoogleRecurrence({
      id: 'master',
      title: meeting.title,
      date: local.date,
      time: local.time,
      timezone: meeting.timezone,
      durationMinutes: meeting.durationMinutes,
      allDay: meeting.allDay,
      recurrence: rule,
      recurrenceOverrides: meeting.recurrenceOverrides ?? null,
    });
  } else {
    // ALWAYS sent: a PATCH keeps fields it does not mention, so removing the repeat from a synced
    // series must clear Google's RRULE explicitly or the phantom series would stay in the user's
    // calendar (and the next full-sync sweep would tombstone the local meeting, since a series
    // master never appears in singleEvents listings). Harmless on insert.
    body.recurrence = [];
  }
  if (options.requestMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: options.requestId ?? `mg-${Date.now().toString(36)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }
  return body;
}

/**
 * Hash of the Google-visible fields (meeting or import payload): unchanged => nothing to push.
 * For a recurring master the rule and the CANCELLED override keys are part of the hash (they are
 * pushed as RRULE/EXDATE); 'modified' overrides are not pushed and therefore not hashed, so a
 * local-only occurrence edit never triggers a Google write. One-off meetings hash exactly as
 * before, so hashes stored by earlier app versions stay valid.
 */
export function googleVisibleHash(
  fields: ExternalVisibleFields & Partial<Pick<Meeting, 'recurrence' | 'recurrenceOverrides'>>,
  defaultTimeZone: string,
): string {
  const rule = fields.recurrence ?? null;
  if (rule === null) return externalHash(fields, defaultTimeZone);
  const cancelled = Object.entries(fields.recurrenceOverrides ?? {})
    .filter(([, override]) => override.status === 'cancelled')
    .map(([key]) => key)
    .sort();
  return stableHash([externalProjection(fields, defaultTimeZone), rule, cancelled]);
}

/** Meeting wants a Meet link that does not exist yet. */
export function wantsMeetLink(meeting: Pick<Meeting, 'conference'>): boolean {
  return meeting.conference?.provider === 'google_meet' && meeting.conference.url === null;
}
