import { toLocalDateTime } from '../../../core/time';
import { buildMeeting, type Meeting } from '../../../core/types';
import {
  extractGoogleConference,
  googleEventToMeetingInput,
  googleVisibleHash,
  isImportableEventType,
  mapAttendees,
  meetingToGoogleEvent,
  type GoogleMappingContext,
} from '../google/mapping';
import type { GoogleEvent } from '../google/types';

const ctx: GoogleMappingContext = {
  calendarTimeZone: 'America/Los_Angeles',
  defaultTimeZone: 'Europe/Madrid',
  untitledTitle: '(No title)',
};

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}): Meeting {
  return buildMeeting(
    { title: 'Planning', startAt: '2026-10-05T14:00:00.000Z', source: 'manual', timezone: 'Europe/Madrid', ...overrides },
    { id: 'meeting1', userId: 'u1', now: '2026-09-28T10:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

describe('googleEventToMeetingInput', () => {
  it('maps a timed event with its own zone', () => {
    const input = googleEventToMeetingInput(
      {
        id: 'e1',
        summary: '  Budget review ',
        description: 'Agenda',
        start: { dateTime: '2026-10-05T09:30:00-07:00', timeZone: 'America/Los_Angeles' },
        end: { dateTime: '2026-10-05T10:15:00-07:00', timeZone: 'America/Los_Angeles' },
      },
      ctx,
    );
    expect(input).toMatchObject({
      title: 'Budget review',
      description: 'Agenda',
      startAt: '2026-10-05T16:30:00.000Z',
      durationMinutes: 45,
      timezone: 'America/Los_Angeles',
      allDay: false,
      status: 'scheduled',
    });
  });

  it('keeps all-day events on their calendar date (no UTC shift in negative zones)', () => {
    const input = googleEventToMeetingInput(
      { id: 'e2', summary: 'Offsite', start: { date: '2026-10-05' }, end: { date: '2026-10-08' } },
      ctx,
    );
    expect(input).not.toBeNull();
    expect(input?.allDay).toBe(true);
    expect(input?.timezone).toBe('America/Los_Angeles');
    expect(input?.startAt).toBe('2026-10-05T07:00:00.000Z');
    expect(input?.durationMinutes).toBe(3 * 1440);
    expect(toLocalDateTime(input!.startAt, input!.timezone ?? '')).toEqual({ date: '2026-10-05', time: '00:00' });
  });

  it('falls back to the default zone and a localized title', () => {
    const input = googleEventToMeetingInput(
      { id: 'e3', start: { dateTime: '2026-10-05T10:00:00Z' }, end: { dateTime: '2026-10-05T11:00:00Z' } },
      { ...ctx, calendarTimeZone: null },
    );
    expect(input?.title).toBe('(No title)');
    expect(input?.timezone).toBe('Europe/Madrid');
  });

  it('skips events without a usable start', () => {
    expect(googleEventToMeetingInput({ id: 'e4' }, ctx)).toBeNull();
    expect(googleEventToMeetingInput({ id: 'e5', start: { dateTime: 'not a date' } }, ctx)).toBeNull();
  });

  it('reads a real Google Meet link from conferenceData', () => {
    const event: GoogleEvent = {
      id: 'e6',
      start: { dateTime: '2026-10-05T10:00:00Z' },
      end: { dateTime: '2026-10-05T11:00:00Z' },
      conferenceData: {
        conferenceSolution: { key: { type: 'hangoutsMeet' } },
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1-555' },
          { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
        ],
      },
    };
    expect(googleEventToMeetingInput(event, ctx)?.conference).toEqual({
      provider: 'google_meet',
      url: 'https://meet.google.com/abc-defg-hij',
      password: null,
    });
    expect(extractGoogleConference({ id: 'x', hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc' })?.provider).toBe('google_meet');
  });

  it('marks a pending Meet creation as "link requested"', () => {
    expect(
      extractGoogleConference({
        id: 'x',
        conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' }, status: { statusCode: 'pending' } } },
      }),
    ).toEqual({ provider: 'google_meet', url: null, password: null });
  });

  it('detects Zoom links in the location without treating them as a place', () => {
    const input = googleEventToMeetingInput(
      {
        id: 'e7',
        location: 'https://us02web.zoom.us/j/123456789',
        start: { dateTime: '2026-10-05T10:00:00Z' },
        end: { dateTime: '2026-10-05T11:00:00Z' },
      },
      ctx,
    );
    expect(input?.location).toBeNull();
    expect(input?.conference).toEqual({ provider: 'zoom', url: 'https://us02web.zoom.us/j/123456789', password: null });
  });

  it('maps attendees (no resources, not the user) and declined invitations', () => {
    const attendees = [
      { email: 'Me@Example.com', self: true, responseStatus: 'declined' as const },
      { email: 'Ana@Example.com', displayName: ' Ana ', responseStatus: 'accepted' as const },
      { email: 'room-1@resource.calendar.google.com', resource: true },
      { email: 'not-an-email' },
      { email: 'ana@example.com' },
    ];
    expect(mapAttendees(attendees)).toEqual([{ email: 'ana@example.com', name: 'Ana', status: 'accepted' }]);
    const input = googleEventToMeetingInput(
      { id: 'e8', attendees, start: { dateTime: '2026-10-05T10:00:00Z' }, end: { dateTime: '2026-10-05T11:00:00Z' } },
      ctx,
    );
    expect(input?.status).toBe('cancelled');
  });

  it('only imports real meetings', () => {
    expect(isImportableEventType({})).toBe(true);
    expect(isImportableEventType({ eventType: 'default' })).toBe(true);
    expect(isImportableEventType({ eventType: 'outOfOffice' })).toBe(false);
    expect(isImportableEventType({ eventType: 'workingLocation' })).toBe(false);
  });
});

describe('meetingToGoogleEvent', () => {
  it('writes timed events with the meeting zone, attendees and MeetingGuard properties', () => {
    const body = meetingToGoogleEvent(
      meeting({
        durationMinutes: 30,
        participants: [{ email: 'ana@example.com', name: 'Ana' }, { email: 'bob@example.com' }],
        location: { type: 'physical', address: 'Room 4', virtualUrl: null },
      }),
    );
    expect(body.start).toEqual({ dateTime: '2026-10-05T14:00:00.000Z', timeZone: 'Europe/Madrid' });
    expect(body.end).toEqual({ dateTime: '2026-10-05T14:30:00.000Z', timeZone: 'Europe/Madrid' });
    expect(body.attendees).toEqual([{ email: 'ana@example.com', displayName: 'Ana' }, { email: 'bob@example.com' }]);
    expect(body.location).toBe('Room 4');
    expect(body.extendedProperties?.private.mgV).toBe('1');
    expect(body.conferenceData).toBeUndefined();
  });

  it('writes all-day events as dates with an exclusive end', () => {
    const allDay = meeting({
      startAt: '2026-10-04T22:00:00.000Z', // 2026-10-05 00:00 in Madrid
      allDay: true,
      durationMinutes: 2 * 1440,
    });
    const body = meetingToGoogleEvent(allDay);
    expect(body.start).toEqual({ date: '2026-10-05' });
    expect(body.end).toEqual({ date: '2026-10-07' });
  });

  it('requests a real Meet link only when asked', () => {
    const body = meetingToGoogleEvent(meeting({ conference: { provider: 'google_meet', url: null, password: null } }), {
      requestMeetLink: true,
      requestId: 'req-1',
    });
    expect(body.conferenceData).toEqual({
      createRequest: { requestId: 'req-1', conferenceSolutionKey: { type: 'hangoutsMeet' } },
    });
  });

  it('round-trips rich location and conference details through Google', () => {
    const original = meeting({
      location: { type: 'hybrid', address: 'HQ, floor 3', virtualUrl: null },
      conference: { provider: 'zoom', url: 'https://zoom.us/j/999', password: 's3cret' },
    });
    const body = meetingToGoogleEvent(original);
    const echoed: GoogleEvent = {
      id: 'mgev1',
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
      extendedProperties: { private: body.extendedProperties?.private ?? {} },
    };
    const input = googleEventToMeetingInput(echoed, ctx);
    expect(input?.location).toEqual(original.location);
    expect(input?.conference).toEqual(original.conference);
  });

  it('uses the conference link as the visible location of link-only meetings', () => {
    const original = meeting({ conference: { provider: 'teams', url: 'https://teams.microsoft.com/l/meetup-join/1', password: null } });
    const body = meetingToGoogleEvent(original);
    expect(body.location).toBe('https://teams.microsoft.com/l/meetup-join/1');
    const input = googleEventToMeetingInput(
      { id: 'x', location: body.location, start: body.start, end: body.end, extendedProperties: body.extendedProperties },
      ctx,
    );
    expect(input?.location).toBeNull();
    expect(input?.conference?.provider).toBe('teams');
  });
});

describe('googleVisibleHash', () => {
  it('is identical for an import payload and the meeting built from it', () => {
    const input = googleEventToMeetingInput(
      {
        id: 'e9',
        summary: 'Sync',
        attendees: [{ email: 'Ana@Example.com', displayName: 'Ana' }],
        start: { dateTime: '2026-10-05T10:00:00Z', timeZone: 'Europe/Madrid' },
        end: { dateTime: '2026-10-05T11:00:00Z' },
      },
      ctx,
    );
    expect(input).not.toBeNull();
    const built = buildMeeting(
      { ...input!, source: 'google' },
      { id: 'g1', userId: 'u1', now: '2026-09-28T10:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'es' },
    );
    expect(googleVisibleHash(built, 'UTC')).toBe(googleVisibleHash(input!, 'UTC'));
  });

  it('ignores MeetingGuard-only fields and changes with visible ones', () => {
    const base = meeting();
    const alertsOnly = { ...base, customAlertTimes: [30], alertIntensity: 'light' as const, notes: 'private' };
    expect(googleVisibleHash(alertsOnly, 'UTC')).toBe(googleVisibleHash(base, 'UTC'));
    expect(googleVisibleHash({ ...base, title: 'Other' }, 'UTC')).not.toBe(googleVisibleHash(base, 'UTC'));
  });
});
