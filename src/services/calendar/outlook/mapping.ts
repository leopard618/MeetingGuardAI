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
 *   per instance. MeetingGuard series are pushed the other way as Graph series masters
 *   (toGraphRecurrence); cancelled and modified occurrences become instance deletes / patches
 *   (sync.ts applyOccurrenceOverrides). Instances of our own masters are skipped on import.
 */
import { emailSchema, type ConferenceDetails } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import {
  expandOccurrences,
  weekdayOfLocalDate,
  type RecurrenceOverride,
  type RecurrenceWeekday,
  type RecurringMeetingLike,
} from '../../../core/recurrence';
import { addDaysToLocalDate, isLocalDate, isValidTimeZone, minutesBetween, toLocalDateTime, toUtcIso, zonedDateTimeToUtcIso } from '../../../core/time';
import type { Meeting, ParticipantInput, ParticipantStatus } from '../../../core/types';
import {
  appendJoinBlock,
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
  renderLocationText,
  stableHash,
  stripJoinBlock,
  TITLE_MAX,
  truncate,
  type ExternalMeetingInput,
  type ExternalVisibleFields,
} from '../shared';
import type {
  GraphAttendee,
  GraphDateTimeTimeZone,
  GraphDayOfWeek,
  GraphEvent,
  GraphEventWrite,
  GraphPatternedRecurrence,
  GraphRecurrencePattern,
  GraphRecurrenceRange,
  GraphResponse,
} from './types';

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

/**
 * The calendar date of an all-day boundary. Graph converts all-day midnights into the zone the
 * request asked for (UTC, api.ts Prefer header), so an all-day event created in Madrid arrives as
 * 22:00 of the PREVIOUS day. The instant shifted by 12 hours lands on the right date for every
 * zone offset in (-12, +12); taking the date part verbatim was one day early east of UTC.
 */
function allDayLocalDate(value: GraphDateTimeTimeZone | undefined): string | null {
  const instant = graphDateTimeToUtcIso(value);
  if (instant === null) return null;
  const date = new Date(Date.parse(instant) + 12 * 60 * 60_000).toISOString().slice(0, 10);
  return isLocalDate(date) ? date : null;
}

function eventTiming(event: GraphEvent, ctx: OutlookMappingContext): Timing | null {
  if (event.isAllDay === true) {
    const startDate = allDayLocalDate(event.start);
    if (startDate === null) return null;
    const endDate = allDayLocalDate(event.end);
    const days = endDate !== null ? Math.max(1, daysBetweenLocalDates(startDate, endDate)) : 1;
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
    // Our own pushed join block comes back out (the conference is stored separately).
    description: truncate(stripJoinBlock(bodyText(event)), DESCRIPTION_MAX),
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
> &
  /** The join block's language (full meetings carry it; defaults to English). */
  Partial<Pick<Meeting, 'language'>> &
  /** Present on full meetings; a recurring master pushes its rule as a Graph series (§17). */
  Partial<Pick<Meeting, 'recurrence' | 'recurrenceOverrides'>>;

function localGraphDateTime(instant: string, timeZone: string): GraphDateTimeTimeZone {
  const local = toLocalDateTime(instant, timeZone);
  return { dateTime: `${local.date}T${local.time}:00`, timeZone };
}

const GRAPH_DAYS: Readonly<Record<RecurrenceWeekday, GraphDayOfWeek>> = {
  MO: 'monday',
  TU: 'tuesday',
  WE: 'wednesday',
  TH: 'thursday',
  FR: 'friday',
  SA: 'saturday',
  SU: 'sunday',
};

/** Expansion horizon when looking for the first / last generated occurrence (3 years). */
const RECURRENCE_HORIZON_MS = 3 * 366 * 86_400_000;

/** RecurringMeetingLike view of a writable meeting (date/time re-derived from startAt + zone). */
function recurringView(meeting: OutlookWritableMeeting): RecurringMeetingLike {
  const local = toLocalDateTime(meeting.startAt, meeting.timezone);
  return {
    id: 'master',
    title: meeting.title,
    date: local.date,
    time: local.time,
    timezone: meeting.timezone,
    durationMinutes: meeting.durationMinutes,
    allDay: meeting.allDay,
    recurrence: meeting.recurrence ?? null,
    // Overrides never move the series anchor or its end: expand the bare rule.
    recurrenceOverrides: null,
  };
}

export interface GraphRecurrenceResult {
  recurrence: GraphPatternedRecurrence;
  /** Local date of the first occurrence the rule generates (the series anchor Graph expects). */
  firstDate: string;
}

/**
 * MeetingGuard rule -> Graph patternedRecurrence. Graph needs the series to start on an
 * occurrence the pattern generates, so an off-pattern anchor (a weekly rule without the anchor's
 * weekday, a monthly rule with a different day) moves the series start to the first generated
 * occurrence, exactly what expandOccurrences renders locally. `until` (an inclusive instant) becomes
 * the local date of the last generated occurrence; `count` maps to a numbered range (cancelled
 * occurrences consume the count on both sides). Cancelled / modified occurrences are not part of
 * the rule: sync.ts applies them to the generated instances.
 */
export function toGraphRecurrence(meeting: OutlookWritableMeeting): GraphRecurrenceResult {
  const rule = meeting.recurrence ?? null;
  if (rule === null) throw new AppError('invalid_input', 'toGraphRecurrence needs a recurring meeting');
  const view = recurringView(meeting);
  const anchorStart = zonedDateTimeToUtcIso(view.date, '00:00', view.timezone);
  const horizonEnd = new Date(Date.parse(anchorStart) + RECURRENCE_HORIZON_MS).toISOString();
  const first = expandOccurrences(view, anchorStart, horizonEnd, { max: 1 })[0];
  const firstDate = first?.localDateKey ?? view.date;

  let pattern: GraphRecurrencePattern;
  if (rule.freq === 'daily') {
    pattern = { type: 'daily', interval: rule.interval };
  } else if (rule.freq === 'weekly') {
    const days = rule.byWeekday !== null && rule.byWeekday.length > 0 ? rule.byWeekday : [weekdayOfLocalDate(firstDate)];
    pattern = { type: 'weekly', interval: rule.interval, daysOfWeek: days.map((day) => GRAPH_DAYS[day]), firstDayOfWeek: 'monday' };
  } else {
    pattern = { type: 'absoluteMonthly', interval: rule.interval, dayOfMonth: rule.byMonthDay ?? Number(firstDate.slice(8, 10)) };
  }

  let range: GraphRecurrenceRange;
  if (rule.until !== null) {
    // The last occurrence the rule generates up to the inclusive instant; a series too long to
    // expand falls back to the instant's local date (differs only when until falls mid-day).
    const generated = expandOccurrences(view, anchorStart, rule.until);
    const last = generated.length > 0 && generated.length < 500 ? generated[generated.length - 1] : undefined;
    const endDate = last?.localDateKey ?? toLocalDateTime(rule.until, view.timezone).date;
    range = { type: 'endDate', startDate: firstDate, endDate: endDate < firstDate ? firstDate : endDate, recurrenceTimeZone: view.timezone };
  } else if (rule.count !== null) {
    range = { type: 'numbered', startDate: firstDate, numberOfOccurrences: rule.count, recurrenceTimeZone: view.timezone };
  } else {
    range = { type: 'noEnd', startDate: firstDate, recurrenceTimeZone: view.timezone };
  }
  return { recurrence: { pattern, range }, firstDate };
}

/** UTC instant of the ORIGINAL (pre-override) occurrence of a series on a local date key. */
export function occurrenceOriginalStart(meeting: Pick<Meeting, 'time' | 'timezone' | 'allDay'>, localDateKey: string): string {
  return zonedDateTimeToUtcIso(localDateKey, meeting.allDay ? '00:00' : meeting.time, meeting.timezone);
}

/** PATCH body of a Graph instance carrying a 'modified' override (null fields keep the master's). */
export function overrideToInstancePatch(
  meeting: Pick<Meeting, 'title' | 'time' | 'timezone' | 'allDay' | 'durationMinutes'>,
  localDateKey: string,
  override: RecurrenceOverride,
): GraphEventWrite {
  const startAt = override.startAt ?? occurrenceOriginalStart(meeting, localDateKey);
  const durationMinutes = override.durationMinutes ?? meeting.durationMinutes;
  const body: GraphEventWrite = { subject: override.title ?? meeting.title };
  if (meeting.allDay) {
    const date = toLocalDateTime(startAt, meeting.timezone).date;
    const days = Math.max(1, Math.round(durationMinutes / MINUTES_PER_DAY));
    body.start = { dateTime: `${date}T00:00:00`, timeZone: meeting.timezone };
    body.end = { dateTime: `${addDaysToLocalDate(date, days)}T00:00:00`, timeZone: meeting.timezone };
  } else {
    body.start = localGraphDateTime(startAt, meeting.timezone);
    body.end = localGraphDateTime(new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString(), meeting.timezone);
  }
  return body;
}

/** Meeting -> POST /me/events / PATCH body (wall clock in the meeting's IANA zone; Graph accepts it). */
export function meetingToOutlookEvent(meeting: OutlookWritableMeeting, options: OutlookWriteOptions = {}): GraphEventWrite {
  let start: GraphDateTimeTimeZone;
  let end: GraphDateTimeTimeZone;
  const rule = meeting.recurrence ?? null;
  const series = rule !== null ? toGraphRecurrence(meeting) : null;
  // A series anchored off its own pattern starts on the first generated occurrence (same local
  // time); Graph rejects a master whose start is not an occurrence of the rule.
  const startAt = series !== null ? zonedDateTimeToUtcIso(series.firstDate, toLocalDateTime(meeting.startAt, meeting.timezone).time, meeting.timezone) : meeting.startAt;
  if (meeting.allDay) {
    const date = toLocalDateTime(startAt, meeting.timezone).date;
    const days = Math.max(1, Math.round(meeting.durationMinutes / MINUTES_PER_DAY));
    start = { dateTime: `${date}T00:00:00`, timeZone: meeting.timezone };
    end = { dateTime: `${addDaysToLocalDate(date, days)}T00:00:00`, timeZone: meeting.timezone };
  } else {
    start = localGraphDateTime(startAt, meeting.timezone);
    const endInstant = new Date(new Date(startAt).getTime() + meeting.durationMinutes * 60_000).toISOString();
    end = localGraphDateTime(endInstant, meeting.timezone);
  }

  const body: GraphEventWrite = {
    subject: meeting.title,
    // The join link travels in the body like the Google writer does: the location field holds
    // the address when there is one, and attendees must still find the link in their invitation.
    body: { contentType: 'text', content: appendJoinBlock(truncate(meeting.description, DESCRIPTION_MAX), meeting.conference, meeting.language ?? 'en') },
    start,
    end,
    isAllDay: meeting.allDay,
    location: { displayName: renderLocationText(meeting.location, meeting.conference) },
    attendees: meeting.participants.map((participant) => ({
      emailAddress: participant.name ? { address: participant.email, name: participant.name } : { address: participant.email },
      type: 'required',
    })),
  };
  if (series !== null) body.recurrence = series.recurrence;
  if (options.transactionId !== undefined) body.transactionId = options.transactionId;
  if (options.requestTeamsLink === true) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = 'teamsForBusiness';
  }
  return body;
}

/**
 * Hash of the Outlook-visible fields (meeting or import payload): unchanged => nothing to push.
 * A recurring master also hashes its rule and EVERY override (cancelled and modified ones are
 * both pushed, as instance deletes / patches). One-off meetings hash exactly as before, so hashes
 * stored by earlier app versions stay valid.
 */
export function outlookVisibleHash(
  fields: ExternalVisibleFields & Partial<Pick<Meeting, 'recurrence' | 'recurrenceOverrides'>>,
  defaultTimeZone: string,
): string {
  const rule = fields.recurrence ?? null;
  if (rule === null) return externalHash(fields, defaultTimeZone);
  const overrides = Object.entries(fields.recurrenceOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return stableHash([externalProjection(fields, defaultTimeZone), rule, overrides]);
}

/** Meeting wants a Teams link that does not exist yet (create-time only in v1; §17). */
export function wantsTeamsLink(meeting: Pick<Meeting, 'conference'>): boolean {
  return meeting.conference?.provider === 'teams' && meeting.conference.url === null;
}
