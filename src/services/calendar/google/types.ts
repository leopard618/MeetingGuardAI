/**
 * Subset of the Google Calendar API v3 Event resource used by Meeting Guard.
 * https://developers.google.com/calendar/api/v3/reference/events
 */

export interface GoogleEventDateTime {
  /** All-day events: "YYYY-MM-DD" (end date is exclusive). */
  date?: string;
  /** Timed events: RFC 3339 with offset. */
  dateTime?: string;
  /** IANA zone the event was created in. */
  timeZone?: string;
}

export type GoogleResponseStatus = 'needsAction' | 'declined' | 'tentative' | 'accepted';

export interface GoogleAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: GoogleResponseStatus;
  self?: boolean;
  resource?: boolean;
  organizer?: boolean;
  optional?: boolean;
}

export interface GoogleEntryPoint {
  entryPointType?: 'video' | 'phone' | 'sip' | 'more' | string;
  uri?: string;
  label?: string;
  pin?: string;
  accessCode?: string;
  meetingCode?: string;
  passcode?: string;
  password?: string;
}

export type GoogleCreateRequestStatus = 'pending' | 'success' | 'failure';

export interface GoogleConferenceData {
  conferenceId?: string;
  conferenceSolution?: { key?: { type?: string }; name?: string };
  entryPoints?: GoogleEntryPoint[];
  createRequest?: {
    requestId?: string;
    conferenceSolutionKey?: { type?: string };
    status?: { statusCode?: GoogleCreateRequestStatus };
  };
}

export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  /** RFC 3339 (UTC) last modification. */
  updated?: string;
  created?: string;
  attendees?: GoogleAttendee[];
  conferenceData?: GoogleConferenceData;
  hangoutLink?: string;
  /** RRULE/EXDATE/RDATE lines (only on masters; absent with singleEvents=true listings). */
  recurrence?: string[];
  recurringEventId?: string;
  /** default | outOfOffice | focusTime | workingLocation | birthday | fromGmail */
  eventType?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  organizer?: { email?: string; self?: boolean };
}

export interface GoogleEventList {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  /** The calendar's time zone (used for all-day events). */
  timeZone?: string;
}

/** Body of events.insert / events.patch. */
export interface GoogleEventWrite {
  id?: string;
  status?: 'confirmed';
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  attendees?: { email: string; displayName?: string }[];
  conferenceData?: {
    createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } };
  };
  /** RRULE + EXDATE lines for recurring masters (toGoogleRecurrence, docs/v1/ARCHITECTURE.md §16). */
  recurrence?: string[];
  extendedProperties?: { private: Record<string, string> };
}

export type SendUpdates = 'all' | 'externalOnly' | 'none';
