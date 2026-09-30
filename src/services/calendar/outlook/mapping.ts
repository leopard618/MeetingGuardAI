/**
 * Pure mapping between Microsoft Graph events and MeetingGuard meetings (unit-tested).
 *
 * - Requests use `Prefer: outlook.timezone="UTC"`, so timed events arrive as UTC wall clock; the
 *   meeting keeps the device zone (Graph only exposes the original zone as a Windows name, which
 *   MeetingGuard does not map). All-day events start at local midnight of the device zone and
 *   last 1440 min x days (Graph's all-day end is exclusive, like Google's).
 * - Attendees map to participants (resources and the signed-in account excluded); the user's own
 *   `responseStatus: declined` imports the event as cancelled (visible, never alerting).
 * - Conference: the Teams/online-meeting join URL when present, otherwise the first Zoom / Teams /
 *   Meet link found in the location or body text.
 * - Recurring Graph series arrive as calendarView instances (occurrence/exception), one meeting
 *   per instance - MeetingGuard recurrence rules are NOT pushed to Graph in v1 (§17).
 */
import { emailSchema, type ConferenceDetails } from '../../../core/aiContract';
import { addDaysToLocalDate, isLocalDate, isValidTimeZone, minutesBetween, toLocalDateTime, toUtcIso, zonedDateTimeToUtcIso } from '../../../core/time';
import type { Meeting, ParticipantInput, ParticipantStatus } from '../../../core/types';
import {
  clampDuration,
  conferenceProviderForUrl,
  deriveLocationFromText,
  DESCRIPTION_MAX,
  detectConferenceInText,
  DURATION_MAX_MINUTES,
  externalHash,
  isHttpUrl,
  MINUTES_PER_DAY,
  PARTICIPANT_NAME_MAX,
  PARTICIPANTS_MAX,
  renderLocationText,
  TITLE_MAX,
  truncate,
  type ExternalMeetingInput,
  type ExternalVisibleFields,
} from '../shared';
import type { GraphAttendee, GraphDateTimeTimeZone, GraphEvent, GraphEventWrite, GraphResponse } from './types';

/** MeetingGuard syncs the Microsoft account's default calendar (no calendar id in the routes). */
export const OUTLOOK_DEFAULT_CALENDAR = 'default';

export type OutlookMeetingInput = ExternalMeetingInput;

export interface OutlookMappingContext {
  /** Device / preferences zone (Graph delivers UTC wall clock; see the header). */
  defaultTimeZone: string;
  /** Localized title for events without a subject. */
  untitledTitle: string;
  /** The signed-in Microsoft account (excluded from participants); null when unknown. */
  selfEmail: string | null;
}

/** Series masters never appear in calendarView, but a defensive skip keeps imports instance-only. */
export function isImportableGraphEvent(event: Pick<GraphEvent, 'type'>): boolean {
  return event.type !== 'seriesMaster';
}

const RESPONSE_STATUS: Readonly<Record<GraphResponse, ParticipantStatus | null>> = {
  none: 'needs_action',
  notResponded: 'needs_action',
  organizer: 'accepted',
  accepted: 'accepted',
  declined: 'declined',
  tentativelyAccepted: 'tentative',
};

/** Attendees -> participants (no rooms/resources, not the account itself, valid emails, at most 100). */
export function mapGraphAttendees(attendees: readonly GraphAttendee[] | undefined, selfEmail: string | null): ParticipantInput[] {
  const out: ParticipantInput[] = [];
  const seen = new Set<string>();
  const self = selfEmail?.trim().toLowerCase() ?? null;
  for (const attendee of attendees ?? []) {
    const address = attendee.emailAddress?.address;
    if (!address || attendee.type === 'resource') continue;
    const email = address.trim().toLowerCase();
    if (email === self || seen.has(email) || !emailSchema.safeParse(email).success) continue;
    seen.add(email);
    const name = attendee.emailAddress?.name?.trim();
    const response = attendee.status?.response;
    out.push({
      email,
      name: name ? truncate(name, PARTICIPANT_NAME_MAX) : null,
      status: response ? (RESPONSE_STATUS[response] ?? null) : null,
    });
    if (out.length >= PARTICIPANTS_MAX) break;
  }
  return out;
}

/** Graph fractional seconds have 7 digits; JS date parsing wants at most 3. */
function normalizeGraphDateTime(dateTime: string): string {
  return dateTime.replace(/\.(\d{3})\d+/, '.$1');
}

/** "2026-10-05T09:00:00.0000000" + zone -> UTC ISO; null when unusable. */
export function graphDateTimeToUtcIso(value: GraphDateTimeTimeZone | undefined): string | null {
  const dateTime = value?.dateTime;
  if (!dateTime) return null;
  const zone = value?.timeZone ?? 'UTC';
  try {
    if (zone === 'UTC') return toUtcIso(`${normalizeGraphDateTime(dateTime)}Z`);
    const [date, time] = dateTime.split('T');
    if (isValidTimeZone(zone) && date !== undefined && time !== undefined && isLocalDate(date)) {
      return zonedDateTimeToUtcIso(date, time.slice(0, 5), zone);
    }
    // Windows zone names are not mapped; with the Prefer header this branch is unreachable.
    return toUtcIso(`${normalizeGraphDateTime(dateTime)}Z`);
  } catch {
    return null;
  }
}

function daysBetweenLocalDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** The Teams / online-meeting join link of an event (verified http(s) URL), or null. */
export function extractOnlineMeetingUrl(event: GraphEvent): string | null {
  const url = event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl ?? null;
  return url !== null && isHttpUrl(url) ? url : null;
}

/** Conference from Graph's online-meeting fields, else from links in the location/body text. */
export function extractOutlookConference(event: GraphEvent): ConferenceDetails | null {
  const joinUrl = extractOnlineMeetingUrl(event);
  if (joinUrl !== null) {
    const provider =
      conferenceProviderForUrl(joinUrl) ?? (event.onlineMeetingProvider === 'teamsForBusiness' ? 'teams' : 'other');
    return { provider, url: joinUrl, password: null };
  }
  return detectConferenceInText(event.location?.displayName, bodyText(event));
}

function bodyText(event: GraphEvent): string {
  const body = event.body;
  if (body?.content && body.contentType !== 'html') return body.content;
  // The Prefer header asks for text; if HTML slips through, the short plain preview is safer.
  return event.bodyPreview ?? '';
}

interface Timing {
  startAt: string;
  durationMinutes: number;
  timezone: string;
  allDay: boolean;
}

function eventTiming(event: GraphEvent, ctx: OutlookMappingContext): Timing | null {
  if (event.isAllDay === true) {
    const startDate = event.start?.dateTime?.split('T')[0];
    if (!startDate || !isLocalDate(startDate)) return null;
    const endDate = event.end?.dateTime?.split('T')[0];
    const days = endDate !== undefined && isLocalDate(endDate) ? Math.max(1, daysBetweenLocalDates(startDate, endDate)) : 1;
    return {
      startAt: zonedDateTimeToUtcIso(startDate, '00:00', ctx.defaultTimeZone),
      durationMinutes: Math.min(DURATION_MAX_MINUTES, days * MINUTES_PER_DAY),
      timezone: ctx.defaultTimeZone,
      allDay: true,
    };
  }
  const startAt = graphDateTimeToUtcIso(event.start);
  if (startAt === null) return null;
  const endAt = graphDateTimeToUtcIso(event.end);
  return {
    startAt,
    durationMinutes: endAt !== null ? clampDuration(minutesBetween(startAt, endAt)) : 60,
    timezone: ctx.defaultTimeZone,
    allDay: false,
  };
}

/**
 * Graph event -> import payload. null when the event has no usable start (never throws for
 * malformed dates: those events are skipped).
 */
export function outlookEventToMeetingInput(event: GraphEvent, ctx: OutlookMappingContext): OutlookMeetingInput | null {
  let timing: Timing | null;
  try {
    timing = eventTiming(event, ctx);
  } catch {
    return null;
  }
  if (!timing) return null;

  const title = truncate((event.subject ?? '').trim(), TITLE_MAX).trim();
  const selfDeclined = event.responseStatus?.response === 'declined';

  return {
    title: title.length > 0 ? title : ctx.untitledTitle,
    description: truncate(bodyText(event), DESCRIPTION_MAX),
    startAt: timing.startAt,
    durationMinutes: timing.durationMinutes,
    timezone: timing.timezone,
    allDay: timing.allDay,
    location: deriveLocationFromText(event.location?.displayName),
    conference: extractOutlookConference(event),
    participants: mapGraphAttendees(event.attendees, ctx.selfEmail),
    // Declined invitations stay visible but never alert.
    status: selfDeclined ? 'cancelled' : 'scheduled',
  };
}

export interface OutlookWriteOptions {
  /** Create only ("mgev-" + meeting.id): Graph replays a POST with the same id idempotently. */
  transactionId?: string;
  /** Create only: ask Graph for a Teams meeting (isOnlineMeeting + teamsForBusiness). */
  requestTeamsLink?: boolean;
}

type OutlookWritableMeeting = Pick<
  Meeting,
  'title' | 'description' | 'startAt' | 'durationMinutes' | 'timezone' | 'allDay' | 'location' | 'conference' | 'participants'
>;

function localGraphDateTime(instant: string, timeZone: string): GraphDateTimeTimeZone {
  const local = toLocalDateTime(instant, timeZone);
  return { dateTime: `${local.date}T${local.time}:00`, timeZone };
}

/** Meeting -> POST /me/events / PATCH body (wall clock in the meeting's IANA zone; Graph accepts it). */
export function meetingToOutlookEvent(meeting: OutlookWritableMeeting, options: OutlookWriteOptions = {}): GraphEventWrite {
  let start: GraphDateTimeTimeZone;
  let end: GraphDateTimeTimeZone;
  if (meeting.allDay) {
    const date = toLocalDateTime(meeting.startAt, meeting.timezone).date;
    const days = Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY));
    start = { dateTime: `${date}T00:00:00`, timeZone: meeting.timezone };
    end = { dateTime: `${addDaysToLocalDate(date, days)}T00:00:00`, timeZone: meeting.timezone };
  } else {
    start = localGraphDateTime(meeting.startAt, meeting.timezone);
    const endInstant = new Date(new Date(meeting.startAt).getTime() + meeting.durationMinutes * 60_000).toISOString();
    end = localGraphDateTime(endInstant, meeting.timezone);
  }

  const body: GraphEventWrite = {
    subject: meeting.title,
    body: { contentType: 'text', content: meeting.description },
    start,
    end,
    isAllDay: meeting.allDay,
    location: { displayName: renderLocationText(meeting.location, meeting.conference) },
    attendees: meeting.participants.map((participant) => ({
      emailAddress: participant.name ? { address: participant.email, name: participant.name } : { address: participant.email },
      type: 'required',
    })),
  };
  if (options.transactionId !== undefined) body.transactionId = options.transactionId;
  if (options.requestTeamsLink === true) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = 'teamsForBusiness';
  }
  return body;
}

/** Hash of the Outlook-visible fields (meeting or import payload): unchanged => nothing to push. */
export function outlookVisibleHash(fields: ExternalVisibleFields, defaultTimeZone: string): string {
  return externalHash(fields, defaultTimeZone);
}

/** Meeting wants a Teams link that does not exist yet (create-time only in v1; §17). */
export function wantsTeamsLink(meeting: Pick<Meeting, 'conference'>): boolean {
  return meeting.conference?.provider === 'teams' && meeting.conference.url === null;
}
