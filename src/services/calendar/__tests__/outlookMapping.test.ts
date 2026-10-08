import {
  extractOutlookConference,
  graphDateTimeToUtcIso,
  mapGraphAttendees,
  meetingToOutlookEvent,
  outlookEventToMeetingInput,
  wantsTeamsLink,
  type OutlookMappingContext,
} from '../outlook/mapping';
import type { GraphEvent } from '../outlook/types';

const ctx: OutlookMappingContext = {
  defaultTimeZone: 'Europe/Madrid',
  untitledTitle: '(No title)',
  selfEmail: 'me@example.com',
};

function timedEvent(overrides: Partial<GraphEvent> = {}): GraphEvent {
  return {
    id: 'ev1',
    changeKey: 'ck1',
    lastModifiedDateTime: '2026-10-01T10:00:00Z',
    type: 'singleInstance',
    subject: 'Design review',
    body: { contentType: 'text', content: 'Agenda' },
    start: { dateTime: '2026-10-05T09:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-10-05T09:45:00.0000000', timeZone: 'UTC' },
    isAllDay: false,
    ...overrides,
  };
}

describe('graphDateTimeToUtcIso', () => {
  it('parses UTC wall clock with 7-digit fractions', () => {
    expect(graphDateTimeToUtcIso({ dateTime: '2026-10-05T09:00:00.0000000', timeZone: 'UTC' })).toBe('2026-10-05T09:00:00.000Z');
  });

  it('converts IANA-zoned wall clock', () => {
    // 09:00 in Madrid (CEST, UTC+2) = 07:00Z.
    expect(graphDateTimeToUtcIso({ dateTime: '2026-10-05T09:00:00.0000000', timeZone: 'Europe/Madrid' })).toBe(
      '2026-10-05T07:00:00.000Z',
    );
  });

  it('returns null for a missing or malformed value', () => {
    expect(graphDateTimeToUtcIso(undefined)).toBeNull();
    expect(graphDateTimeToUtcIso({ dateTime: 'not-a-date', timeZone: 'UTC' })).toBeNull();
  });
});

describe('outlookEventToMeetingInput', () => {
  it('maps a timed event (UTC payload) with duration and default zone', () => {
    const input = outlookEventToMeetingInput(timedEvent(), ctx);
    expect(input).toMatchObject({
      title: 'Design review',
      description: 'Agenda',
      startAt: '2026-10-05T09:00:00.000Z',
      durationMinutes: 45,
      timezone: 'Europe/Madrid',
      allDay: false,
      status: 'scheduled',
    });
  });

  it('maps an all-day event to local midnight of the default zone (exclusive end)', () => {
    const input = outlookEventToMeetingInput(
      timedEvent({
        isAllDay: true,
        start: { dateTime: '2026-10-05T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-07T00:00:00.0000000', timeZone: 'UTC' },
      }),
      ctx,
    );
    // Local midnight in Madrid (CEST) = 22:00Z the day before.
    expect(input).toMatchObject({ startAt: '2026-10-04T22:00:00.000Z', durationMinutes: 2 * 1440, allDay: true });
  });

  it('falls back to the localized untitled title', () => {
    expect(outlookEventToMeetingInput(timedEvent({ subject: '  ' }), ctx)?.title).toBe('(No title)');
  });

  it('imports a declined invitation as cancelled (visible, never alerting)', () => {
    const input = outlookEventToMeetingInput(timedEvent({ responseStatus: { response: 'declined' } }), ctx);
    expect(input?.status).toBe('cancelled');
  });

  it('returns null without a usable start', () => {
    expect(outlookEventToMeetingInput(timedEvent({ start: undefined }), ctx)).toBeNull();
  });

  it('derives a physical location and finds conference links in the body', () => {
    const input = outlookEventToMeetingInput(
      timedEvent({
        location: { displayName: 'Room 4' },
        body: { contentType: 'text', content: 'Join: https://zoom.us/j/123456' },
      }),
      ctx,
    );
    expect(input?.location).toEqual({ type: 'physical', address: 'Room 4', virtualUrl: null });
    expect(input?.conference).toEqual({ provider: 'zoom', url: 'https://zoom.us/j/123456', password: null });
  });
});

describe('mapGraphAttendees', () => {
  it('excludes resources and the signed-in account, dedupes and maps responses', () => {
    const participants = mapGraphAttendees(
      [
        { emailAddress: { address: 'ana@example.com', name: 'Ana' }, type: 'required', status: { response: 'accepted' } },
        { emailAddress: { address: 'ANA@example.com' }, type: 'required' },
        { emailAddress: { address: 'me@example.com' }, type: 'required' },
        { emailAddress: { address: 'room-4@example.com' }, type: 'resource' },
        { emailAddress: { address: 'bo@example.com' }, type: 'optional', status: { response: 'tentativelyAccepted' } },
        { emailAddress: { address: 'not-an-email' }, type: 'required' },
      ],
      'me@example.com',
    );
    expect(participants).toEqual([
      { email: 'ana@example.com', name: 'Ana', status: 'accepted' },
      { email: 'bo@example.com', name: null, status: 'tentative' },
    ]);
  });
});

describe('extractOutlookConference', () => {
  it('prefers the online-meeting join URL and labels Teams', () => {
    const conference = extractOutlookConference(
      timedEvent({
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
        onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/xyz' },
      }),
    );
    expect(conference).toEqual({ provider: 'teams', url: 'https://teams.microsoft.com/l/meetup-join/xyz', password: null });
  });

  it('returns null when there is no link anywhere', () => {
    expect(extractOutlookConference(timedEvent())).toBeNull();
  });
});

describe('meetingToOutlookEvent', () => {
  const meeting = {
    title: 'Weekly sync',
    description: 'Notes',
    startAt: '2026-10-05T07:00:00.000Z', // 09:00 in Madrid (CEST)
    durationMinutes: 60,
    timezone: 'Europe/Madrid',
    allDay: false,
    location: { type: 'physical' as const, address: 'HQ', virtualUrl: null },
    conference: null,
    participants: [{ email: 'ana@example.com', name: 'Ana', status: null }],
  };

  it('writes wall clock in the meeting zone with attendees and location text', () => {
    const body = meetingToOutlookEvent(meeting);
    expect(body.start).toEqual({ dateTime: '2026-10-05T09:00:00', timeZone: 'Europe/Madrid' });
    expect(body.end).toEqual({ dateTime: '2026-10-05T10:00:00', timeZone: 'Europe/Madrid' });
    expect(body.isAllDay).toBe(false);
    expect(body.location).toEqual({ displayName: 'HQ' });
    expect(body.attendees).toEqual([{ emailAddress: { address: 'ana@example.com', name: 'Ana' }, type: 'required' }]);
    expect(body.transactionId).toBeUndefined();
    expect(body.isOnlineMeeting).toBeUndefined();
  });

  it('writes all-day events as midnight-to-midnight (exclusive end)', () => {
    const body = meetingToOutlookEvent({
      ...meeting,
      allDay: true,
      startAt: '2026-10-04T22:00:00.000Z', // local midnight Oct 5 in Madrid
      durationMinutes: 2 * 1440,
    });
    expect(body.start).toEqual({ dateTime: '2026-10-05T00:00:00', timeZone: 'Europe/Madrid' });
    expect(body.end).toEqual({ dateTime: '2026-10-07T00:00:00', timeZone: 'Europe/Madrid' });
    expect(body.isAllDay).toBe(true);
  });

  it('adds the transactionId and Teams fields only when requested (create)', () => {
    const body = meetingToOutlookEvent(meeting, { transactionId: 'mgev-m1', requestTeamsLink: true });
    expect(body.transactionId).toBe('mgev-m1');
    expect(body.isOnlineMeeting).toBe(true);
    expect(body.onlineMeetingProvider).toBe('teamsForBusiness');
  });
});

describe('wantsTeamsLink', () => {
  it('is true only for a teams conference without a URL', () => {
    expect(wantsTeamsLink({ conference: { provider: 'teams', url: null, password: null } })).toBe(true);
    expect(wantsTeamsLink({ conference: { provider: 'teams', url: 'https://teams.microsoft.com/x', password: null } })).toBe(false);
    expect(wantsTeamsLink({ conference: null })).toBe(false);
  });
});
