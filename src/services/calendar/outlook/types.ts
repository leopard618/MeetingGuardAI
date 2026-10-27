/**
 * Subset of the Microsoft Graph event resource used by MeetingGuard.
 * https://learn.microsoft.com/graph/api/resources/event
 *
 * Requests are sent with `Prefer: outlook.timezone="UTC"` and
 * `Prefer: outlook.body-content-type="text"`, so start/end come back in UTC and bodies as text.
 */

export interface GraphDateTimeTimeZone {
  /** "2026-10-05T09:00:00.0000000" (no offset; interpret in `timeZone`). */
  dateTime?: string;
  /** "UTC" with our Prefer header; Graph also accepts/returns IANA and Windows names. */
  timeZone?: string;
}

export type GraphResponse = 'none' | 'organizer' | 'tentativelyAccepted' | 'accepted' | 'declined' | 'notResponded';

export interface GraphEmailAddress {
  address?: string;
  name?: string;
}

export interface GraphAttendee {
  emailAddress?: GraphEmailAddress;
  type?: 'required' | 'optional' | 'resource';
  status?: { response?: GraphResponse; time?: string };
}

export interface GraphLocation {
  displayName?: string;
}

export interface GraphItemBody {
  contentType?: 'text' | 'html';
  content?: string;
}

export interface GraphOnlineMeetingInfo {
  joinUrl?: string | null;
}

export type GraphEventType = 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster';

export type GraphDayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

/** https://learn.microsoft.com/graph/api/resources/recurrencepattern (the subset MeetingGuard writes). */
export interface GraphRecurrencePattern {
  type: 'daily' | 'weekly' | 'absoluteMonthly' | 'relativeMonthly' | 'absoluteYearly' | 'relativeYearly';
  interval: number;
  /** weekly */
  daysOfWeek?: GraphDayOfWeek[];
  firstDayOfWeek?: GraphDayOfWeek;
  /** absoluteMonthly / absoluteYearly */
  dayOfMonth?: number;
  month?: number;
  index?: 'first' | 'second' | 'third' | 'fourth' | 'last';
}

/** https://learn.microsoft.com/graph/api/resources/recurrencerange */
export interface GraphRecurrenceRange {
  type: 'endDate' | 'noEnd' | 'numbered';
  /** "YYYY-MM-DD" in recurrenceTimeZone. */
  startDate: string;
  endDate?: string;
  numberOfOccurrences?: number;
  recurrenceTimeZone?: string;
}

export interface GraphPatternedRecurrence {
  pattern: GraphRecurrencePattern;
  range: GraphRecurrenceRange;
}

export interface GraphEvent {
  id: string;
  /** Concurrency/echo token; changes on every modification. */
  changeKey?: string;
  /** UTC ISO ("2026-10-05T09:00:00Z" style). */
  lastModifiedDateTime?: string;
  type?: GraphEventType;
  seriesMasterId?: string | null;
  /** Occurrences / exceptions: the start the series generated for them (UTC ISO), before any edit. */
  originalStart?: string | null;
  recurrence?: GraphPatternedRecurrence | null;
  subject?: string | null;
  body?: GraphItemBody;
  bodyPreview?: string;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: GraphLocation;
  attendees?: GraphAttendee[];
  organizer?: { emailAddress?: GraphEmailAddress };
  /** The signed-in user's own response. */
  responseStatus?: { response?: GraphResponse };
  isOnlineMeeting?: boolean | null;
  onlineMeetingProvider?: 'unknown' | 'teamsForBusiness' | 'skypeForBusiness' | 'skypeForConsumer' | string;
  onlineMeeting?: GraphOnlineMeetingInfo | null;
  /** Legacy field some tenants still fill. */
  onlineMeetingUrl?: string | null;
  /** Delta: present (with a reason) when the event was deleted. */
  '@removed'?: { reason?: string };
}

/** Body of POST /me/events and PATCH /me/events/{id}. */
export interface GraphEventWrite {
  subject?: string;
  body?: GraphItemBody;
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  isAllDay?: boolean;
  location?: GraphLocation;
  attendees?: GraphAttendee[];
  /** Client-generated idempotency key ("mgev-{meetingId}"); create only, immutable. */
  transactionId?: string;
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: 'teamsForBusiness';
  /** Series masters: the rule (toGraphRecurrence). Never sent for one-off events. */
  recurrence?: GraphPatternedRecurrence;
}

/** GET /me/events/{id}/instances page. */
export interface GraphInstancesPage {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
}

export interface GraphDeltaPage {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface GraphUser {
  mail?: string | null;
  userPrincipalName?: string | null;
}
