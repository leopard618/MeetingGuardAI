import type { RecurrenceRule } from '../../../core/aiContract';
import type { ConferenceCalendarState } from '../../../core/conference';
import { zonedDateTimeToUtcIso } from '../../../core/time';
import { buildMeeting, type Meeting } from '../../../core/types';
import {
  conferenceCardState,
  conferenceConnectTarget,
  conferenceFormHint,
  conferenceFormNote,
  conferenceLinkLabel,
  conferenceOf,
  dateFromPicker,
  defaultRepeatWeekdays,
  draftFromMeeting,
  draftToCreateInput,
  draftToPatch,
  invitesHintKey,
  isMeetingDraftDirty,
  monthlyRepeatDay,
  newMeetingDraft,
  normalizeTypedUrl,
  pickerDateOf,
  recurrenceRuleOf,
  showConferencePassword,
  timeFromPicker,
  toggleRepeatWeekday,
  validateMeetingDraft,
  type MeetingFormDraft,
} from '../meetingForm';

const NOW = new Date('2026-10-05T10:20:00.000Z');

function meeting(overrides: Partial<Parameters<typeof buildMeeting>[0]> = {}): Meeting {
  return buildMeeting(
    {
      title: 'Budget review',
      startAt: '2026-10-06T14:00:00.000Z',
      source: 'google',
      timezone: 'Europe/Madrid',
      participants: [{ email: 'ana@example.com', name: 'Ana', status: 'accepted' }],
      preparationTips: ['Bring numbers'],
      conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: '123' },
      ...overrides,
    },
    { id: 'm1', userId: 'u1', now: NOW, defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
}

function draft(overrides: Partial<MeetingFormDraft> = {}): MeetingFormDraft {
  return { ...newMeetingDraft({ now: NOW, timeZone: 'Europe/Madrid', defaultAlertTimes: [15, 5, 0] }), title: 'Sync', ...overrides };
}

describe('meeting form model', () => {
  it('starts a new meeting at the next full hour in the device zone with the default reminders', () => {
    const fresh = newMeetingDraft({ now: NOW, timeZone: 'Europe/Madrid', defaultAlertTimes: [15, 5, 0] });
    // 10:20Z = 12:20 Madrid -> 13:00 Madrid.
    expect(fresh).toMatchObject({ date: '2026-10-05', time: '13:00', durationMinutes: 60, timezone: 'Europe/Madrid', customAlerts: false });
    expect(fresh.alertTimes).toEqual([15, 5, 0]);
  });

  it('never generates a meeting link: Google Meet without a link asks Google Calendar for a real one', () => {
    expect(conferenceOf(draft({ conferenceProvider: 'google_meet' }))).toEqual({ provider: 'google_meet', url: null, password: null });
    expect(conferenceOf(draft({ conferenceProvider: 'zoom', conferenceUrl: ' zoom.us/j/999 ', conferencePassword: ' abc ' }))).toEqual({
      provider: 'zoom',
      url: 'https://zoom.us/j/999',
      password: 'abc',
    });
    expect(conferenceOf(draft({ conferenceProvider: 'teams' }))).toEqual({ provider: 'teams', url: null, password: null });
    expect(conferenceOf(draft({ conferenceProvider: 'none', conferenceUrl: 'https://x.example' }))).toBeNull();
    expect(normalizeTypedUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeTypedUrl('ftp://files.example')).toBeNull();
  });

  it('builds a manual create input with custom reminders and an intensity override', () => {
    const input = draftToCreateInput(
      draft({
        title: '  Sync  ',
        date: '2026-10-07',
        time: '09:30',
        durationMinutes: 45,
        locationType: 'physical',
        address: ' Room 4 ',
        participants: [
          { email: ' Bob@Example.com ', name: ' Bob ' },
          { email: '', name: '' },
        ],
        tipsText: 'Agenda\n\n  Numbers  \n',
        customAlerts: true,
        alertTimes: [5, 30, 5],
        alertIntensity: 'medium',
        notes: '  ',
      }),
    );
    expect(input).toMatchObject({
      title: 'Sync',
      source: 'manual',
      startAt: '2026-10-07T07:30:00.000Z',
      durationMinutes: 45,
      timezone: 'Europe/Madrid',
      location: { type: 'physical', address: 'Room 4', virtualUrl: null },
      conference: null,
      participants: [{ email: 'bob@example.com', name: 'Bob', status: null }],
      preparationTips: ['Agenda', 'Numbers'],
      customAlertTimes: [30, 5],
      alertIntensity: 'medium',
      notes: null,
    });
  });

  it('validates the fields the user can get wrong', () => {
    expect(validateMeetingDraft(draft())).toEqual({});
    expect(
      validateMeetingDraft(
        draft({
          title: ' ',
          conferenceProvider: 'zoom',
          conferenceUrl: 'not a url',
          participants: [{ email: 'nope', name: 'X' }],
          customAlerts: true,
          alertTimes: [],
          tipsText: 'x'.repeat(301),
        }),
      ),
    ).toEqual({
      title: 'titleRequired',
      conferenceUrl: 'invalidUrl',
      participants: 'invalidEmail',
      alertTimes: 'alertTimesRequired',
      tips: 'tooManyTips',
    });
    expect(validateMeetingDraft(draft({ date: '2026-02-30' }))).toMatchObject({ date: 'invalidDate' });
  });

  it('edits a meeting in its own zone and patches only what changed (keeping participant statuses)', () => {
    const original = meeting();
    const form = draftFromMeeting(original, { fallbackTimeZone: 'UTC', defaultAlertTimes: [15, 5, 0] });
    expect(form).toMatchObject({ date: '2026-10-06', time: '16:00', timezone: 'Europe/Madrid', conferenceUrl: 'https://zoom.us/j/1' });
    expect(draftToPatch(original, form)).toEqual({});

    const patch = draftToPatch(original, {
      ...form,
      time: '17:00',
      participants: [...form.participants, { email: 'new@example.com', name: '' }],
      customAlerts: true,
      alertTimes: [60],
    });
    expect(patch).toEqual({
      startAt: '2026-10-06T15:00:00.000Z',
      participants: [
        { email: 'ana@example.com', name: 'Ana', status: 'accepted' },
        { email: 'new@example.com', name: null, status: null },
      ],
      customAlertTimes: [60],
    });
  });

  it('converts between the wall-clock draft and the pickers', () => {
    const value = pickerDateOf({ date: '2026-03-29', time: '02:30' });
    expect(dateFromPicker(value)).toBe('2026-03-29');
    expect(timeFromPicker(new Date(2026, 0, 5, 7, 5))).toBe('07:05');
  });
});

describe('new meeting on a picked day (Calendar screen)', () => {
  // NOW is 12:20 on Oct 5 in Madrid.
  it('starts a future or past day at 09:00 and keeps the next full hour for today', () => {
    const future = newMeetingDraft({ now: NOW, timeZone: 'Europe/Madrid', date: '2026-10-09' });
    expect([future.date, future.time]).toEqual(['2026-10-09', '09:00']);
    const past = newMeetingDraft({ now: NOW, timeZone: 'Europe/Madrid', date: '2026-10-01' });
    expect([past.date, past.time]).toEqual(['2026-10-01', '09:00']);
    const today = newMeetingDraft({ now: NOW, timeZone: 'Europe/Madrid', date: '2026-10-05' });
    expect([today.date, today.time]).toEqual(['2026-10-05', '13:00']);
  });

  it('ignores an invalid day', () => {
    const fresh = newMeetingDraft({ now: NOW, timeZone: 'Europe/Madrid', date: '2026-02-30' });
    expect([fresh.date, fresh.time]).toEqual(['2026-10-05', '13:00']);
  });
});

describe('isMeetingDraftDirty', () => {
  it('is false for the starting draft and true after any field changes', () => {
    const original = draftFromMeeting(meeting(), { fallbackTimeZone: 'UTC' });
    expect(isMeetingDraftDirty({ ...original }, original)).toBe(false);
    expect(isMeetingDraftDirty({ ...original, title: 'Budget review v2' }, original)).toBe(true);
    expect(isMeetingDraftDirty({ ...original, participants: [...original.participants, { email: '', name: '' }] }, original)).toBe(true);
    expect(isMeetingDraftDirty({ ...original, alertTimes: [...original.alertTimes, 1] }, original)).toBe(true);
  });
});

describe('recurrence in the form (§16)', () => {
  const weekly: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: ['MO'], byMonthDay: null, until: null, count: null };

  it('a new draft does not repeat and creates recurrence null', () => {
    const fresh = draft();
    expect(fresh.repeat).toBe('none');
    expect(recurrenceRuleOf(fresh)).toBeNull();
    expect(draftToCreateInput(fresh).recurrence).toBeNull();
  });

  it('builds the rule from the repeat fields (weekly days, interval, ends)', () => {
    const weeklyDraft = draft({ repeat: 'weekly', repeatWeekdays: ['MO', 'WE'], repeatInterval: '2' });
    expect(recurrenceRuleOf(weeklyDraft)).toEqual({
      freq: 'weekly',
      interval: 2,
      byWeekday: ['MO', 'WE'],
      byMonthDay: null,
      until: null,
      count: null,
    });

    const counted = draft({ repeat: 'daily', repeatEnd: 'afterCount', repeatCount: '10' });
    expect(recurrenceRuleOf(counted)).toMatchObject({ freq: 'daily', count: 10, until: null });

    // Until = the picked day's end in the MEETING zone (inclusive), DST-independent.
    const until = draft({ repeat: 'monthly', repeatEnd: 'onDate', repeatUntilDate: '2026-12-31' });
    expect(recurrenceRuleOf(until)).toMatchObject({ freq: 'monthly', until: '2026-12-31T22:59:00.000Z', count: null });
  });

  it('weekly without selected days means "the meeting weekday" (byWeekday null)', () => {
    expect(recurrenceRuleOf(draft({ repeat: 'weekly' }))).toMatchObject({ byWeekday: null });
    // 2026-10-05 is a Monday; switching to weekly preselects it.
    expect(defaultRepeatWeekdays(draft())).toEqual(['MO']);
  });

  it('validates interval, until day and count', () => {
    expect(validateMeetingDraft(draft({ repeat: 'daily', repeatInterval: '0' }))).toMatchObject({ repeatInterval: 'invalidRepeatInterval' });
    expect(validateMeetingDraft(draft({ repeat: 'daily', repeatInterval: '100' }))).toMatchObject({ repeatInterval: 'invalidRepeatInterval' });
    expect(validateMeetingDraft(draft({ repeat: 'daily', repeatEnd: 'onDate', repeatUntilDate: '' }))).toMatchObject({
      repeatUntil: 'invalidRepeatUntil',
    });
    // The last day cannot be before the first occurrence.
    expect(validateMeetingDraft(draft({ repeat: 'daily', repeatEnd: 'onDate', repeatUntilDate: '2026-10-01' }))).toMatchObject({
      repeatUntil: 'invalidRepeatUntil',
    });
    expect(validateMeetingDraft(draft({ repeat: 'daily', repeatEnd: 'afterCount', repeatCount: '0' }))).toMatchObject({
      repeatCount: 'invalidRepeatCount',
    });
    expect(validateMeetingDraft(draft({ repeat: 'weekly', repeatInterval: '4', repeatEnd: 'afterCount', repeatCount: '12' }))).toEqual({});
    // One-off drafts ignore the repeat inputs entirely.
    expect(validateMeetingDraft(draft({ repeat: 'none', repeatInterval: 'x' }))).toEqual({});
  });

  it('round-trips a stored rule through the form without producing a patch', () => {
    const untilInstant = zonedDateTimeToUtcIso('2026-12-31', '23:59', 'Europe/Madrid');
    const stored = meeting({ recurrence: { ...weekly, until: untilInstant, count: null } });
    const form = draftFromMeeting(stored, { fallbackTimeZone: 'UTC', defaultAlertTimes: [15, 5, 0] });
    expect(form).toMatchObject({
      repeat: 'weekly',
      repeatInterval: '1',
      repeatWeekdays: ['MO'],
      repeatEnd: 'onDate',
      repeatUntilDate: '2026-12-31',
    });
    expect(draftToPatch(stored, form)).toEqual({});
  });

  it('preserves an imported byMonthDay and the exact until instant while their day is unchanged', () => {
    const stored = meeting({
      recurrence: { freq: 'monthly', interval: 1, byWeekday: null, byMonthDay: 20, until: '2026-12-31T10:00:00.000Z', count: null },
    });
    const form = draftFromMeeting(stored, { fallbackTimeZone: 'UTC' });
    const rule = recurrenceRuleOf(form, stored.recurrence);
    // Same local day => the stored instant is kept verbatim; byMonthDay survives the round trip.
    expect(rule).toEqual(stored.recurrence);
    expect(monthlyRepeatDay(form, stored.recurrence)).toBe(20);

    const moved = recurrenceRuleOf({ ...form, repeatUntilDate: '2027-01-15' }, stored.recurrence);
    expect(moved?.until).toBe(zonedDateTimeToUtcIso('2027-01-15', '23:59', stored.timezone));
  });

  it('adds, changes and removes the rule through draftToPatch', () => {
    const oneOff = meeting();
    const withRule = draftFromMeeting(oneOff, { fallbackTimeZone: 'UTC' });
    expect(draftToPatch(oneOff, { ...withRule, repeat: 'daily' }).recurrence).toEqual({
      freq: 'daily',
      interval: 1,
      byWeekday: null,
      byMonthDay: null,
      until: null,
      count: null,
    });

    const recurring = meeting({ recurrence: weekly });
    const form = draftFromMeeting(recurring, { fallbackTimeZone: 'UTC' });
    expect(draftToPatch(recurring, { ...form, repeatInterval: '3' }).recurrence).toMatchObject({ interval: 3 });
    expect(draftToPatch(recurring, { ...form, repeat: 'none' })).toMatchObject({ recurrence: null });
  });

  it('an untouched link field never clobbers a provider-created url that arrived mid-edit', () => {
    // Saved as google_meet without a link; the Google push wrote the Meet link back while the
    // form was open (the form's draft was seeded BEFORE that write-back).
    const seeded = meeting({ source: 'manual', conference: { provider: 'google_meet', url: null, password: null } });
    const original = draftFromMeeting(seeded, { fallbackTimeZone: 'UTC', defaultAlertTimes: [15, 5, 0] });
    const live = meeting({ source: 'manual', conference: { provider: 'google_meet', url: 'https://meet.google.com/abc', password: null } });

    // Unrelated edit (a passcode): the live link is kept, not wiped and re-requested.
    const patch = draftToPatch(live, { ...original, conferencePassword: 'pw' }, original);
    expect(patch.conference).toEqual({ provider: 'google_meet', url: 'https://meet.google.com/abc', password: 'pw' });

    // Nothing touched at all: no conference patch (the live url alone is not a form change).
    expect(draftToPatch(live, original, original).conference).toBeUndefined();

    // The user REALLY cleared a link they could see (it was in the seeded draft): wipe intended.
    const linked = meeting({ source: 'manual', conference: { provider: 'google_meet', url: 'https://meet.google.com/abc', password: null } });
    const linkedDraft = draftFromMeeting(linked, { fallbackTimeZone: 'UTC', defaultAlertTimes: [] });
    expect(draftToPatch(linked, { ...linkedDraft, conferenceUrl: '' }, linkedDraft).conference).toEqual({
      provider: 'google_meet',
      url: null,
      password: null,
    });

    // Provider changed: the old provider's link is not carried over.
    expect(draftToPatch(live, { ...original, conferenceProvider: 'zoom' }, original).conference).toEqual({
      provider: 'zoom',
      url: null,
      password: null,
    });

    // Without the original snapshot (legacy callers) the old diff-against-live behavior stands.
    expect(draftToPatch(live, original).conference).toEqual({ provider: 'google_meet', url: null, password: null });
  });

  it('an untouched passcode field never clobbers a server-written Zoom passcode (§24)', () => {
    // Saved as zoom without a link; zoomCreateMeeting wrote url AND password back while the
    // form was open (the draft was seeded with password '').
    const seeded = meeting({ source: 'manual', conference: { provider: 'zoom', url: null, password: null } });
    const original = draftFromMeeting(seeded, { fallbackTimeZone: 'UTC', defaultAlertTimes: [15, 5, 0] });
    const live = meeting({
      source: 'manual',
      conference: { provider: 'zoom', url: 'https://zoom.us/j/987654321?pwd=abc', password: 'abc123' },
    });

    // Unrelated edit (the title): link AND passcode are kept, not diffed away.
    const patch = draftToPatch(live, { ...original, title: 'Renamed' }, original);
    expect(patch.title).toBe('Renamed');
    expect(patch.conference).toBeUndefined();

    // The user REALLY typed a passcode they could see was empty: their value wins.
    expect(draftToPatch(live, { ...original, conferencePassword: 'mine' }, original).conference).toEqual({
      provider: 'zoom',
      url: 'https://zoom.us/j/987654321?pwd=abc',
      password: 'mine',
    });

    // The user cleared a passcode that WAS in the seeded draft: wipe intended.
    const withPass = meeting({
      source: 'manual',
      conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: 'old' },
    });
    const passDraft = draftFromMeeting(withPass, { fallbackTimeZone: 'UTC', defaultAlertTimes: [] });
    expect(draftToPatch(withPass, { ...passDraft, conferencePassword: '' }, passDraft).conference).toEqual({
      provider: 'zoom',
      url: 'https://zoom.us/j/1',
      password: null,
    });
  });

  it('toggleRepeatWeekday keeps MO..SU order', () => {
    expect(toggleRepeatWeekday(['MO'], 'FR')).toEqual(['MO', 'FR']);
    expect(toggleRepeatWeekday(['FR', 'MO'], 'WE')).toEqual(['MO', 'WE', 'FR']);
    expect(toggleRepeatWeekday(['MO', 'FR'], 'MO')).toEqual(['FR']);
  });
});

describe('video call (§22)', () => {
  const DISCONNECTED: ConferenceCalendarState = { google: { connected: false } };
  const GOOGLE: ConferenceCalendarState = { google: { connected: true } };
  const OUTLOOK_OFF: ConferenceCalendarState = { google: { connected: false }, outlook: { configured: false, connected: false } };
  const OUTLOOK_CONFIGURED: ConferenceCalendarState = { google: { connected: false }, outlook: { configured: true, connected: false } };
  const OUTLOOK_CONNECTED: ConferenceCalendarState = { google: { connected: true }, outlook: { configured: true, connected: true } };

  it('derives the form hint from the provider chips AND the live calendar status (full matrix)', () => {
    expect(conferenceFormHint(draft(), DISCONNECTED)).toBeNull();
    expect(conferenceFormHint(draft({ conferenceProvider: 'zoom' }), OUTLOOK_CONNECTED)).toBe('pasteLinkHint');
    expect(conferenceFormHint(draft({ conferenceProvider: 'other' }), OUTLOOK_CONNECTED)).toBe('pasteLinkHint');
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet' }), GOOGLE)).toBe('meetWillBeCreated');
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet' }), DISCONNECTED)).toBe('meetNeedsCalendar');
    // Teams never advertises the auto link while Outlook is hidden or unconfigured.
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), DISCONNECTED)).toBe('pasteLinkHint');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_OFF)).toBe('pasteLinkHint');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONFIGURED)).toBe('teamsNeedsOutlook');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONNECTED)).toBe('teamsWillBeCreated');
  });

  it('zoom (§24): paste while the server status is unknown, promise/note once known', () => {
    const ZOOM_READY: ConferenceCalendarState = { google: { connected: false }, zoom: { configured: true } };
    const ZOOM_OFF: ConferenceCalendarState = { google: { connected: false }, zoom: { configured: false } };
    // Status unknown (zoomStatus not answered): exactly today's paste behavior, no note.
    expect(conferenceFormHint(draft({ conferenceProvider: 'zoom' }), DISCONNECTED)).toBe('pasteLinkHint');
    expect(conferenceFormNote(draft({ conferenceProvider: 'zoom' }), DISCONNECTED)).toBeNull();
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'zoom' }), DISCONNECTED)).toBe('link');
    // Server configured: the promise, an optional link input, no note.
    expect(conferenceFormHint(draft({ conferenceProvider: 'zoom' }), ZOOM_READY)).toBe('zoomWillBeCreated');
    expect(conferenceFormNote(draft({ conferenceProvider: 'zoom' }), ZOOM_READY)).toBeNull();
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'zoom' }), ZOOM_READY)).toBe('linkOptional');
    // Server said not configured: paste hint + the muted "why" note; the link is required again.
    expect(conferenceFormHint(draft({ conferenceProvider: 'zoom' }), ZOOM_OFF)).toBe('pasteLinkHint');
    expect(conferenceFormNote(draft({ conferenceProvider: 'zoom' }), ZOOM_OFF)).toBe('zoomNotConfigured');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'zoom' }), ZOOM_OFF)).toBe('link');
    // A pasted link wins everywhere: no hint, no note.
    const pasted = draft({ conferenceProvider: 'zoom', conferenceUrl: 'https://zoom.us/j/9' });
    expect(conferenceFormHint(pasted, ZOOM_OFF)).toBeNull();
    expect(conferenceFormNote(pasted, ZOOM_OFF)).toBeNull();
    // Other providers never show the zoom note.
    expect(conferenceFormNote(draft({ conferenceProvider: 'google_meet' }), ZOOM_OFF)).toBeNull();
    // No connect CTA for either zoom hint (only the owner can configure the server).
    expect(conferenceConnectTarget('zoomWillBeCreated')).toBeNull();
    // Details card: ready -> pending copy; not configured / unknown -> plain noLink.
    const zoomMeeting = meeting({ source: 'manual', conference: { provider: 'zoom', url: null, password: null } });
    expect(conferenceCardState(zoomMeeting, ZOOM_READY)).toEqual({ kind: 'info', key: 'zoomPending', connect: null });
    expect(conferenceCardState(zoomMeeting, ZOOM_OFF)).toEqual({ kind: 'info', key: 'noLink', connect: null });
    expect(conferenceCardState(zoomMeeting, DISCONNECTED)).toEqual({ kind: 'info', key: 'noLink', connect: null });
  });

  it('never promises an auto link the sync cannot create (push-target degrade, §17/§22)', () => {
    // Teams + recurrence: series are pushed to Graph since M6, the link comes with the series.
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams', repeat: 'weekly' }), OUTLOOK_CONNECTED)).toBe('teamsWillBeCreated');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams', repeat: 'daily' }), OUTLOOK_CONFIGURED)).toBe('teamsNeedsOutlook');
    // Meet + recurrence keeps its promise: Google pushes recurring masters (insert AND patch).
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet', repeat: 'weekly' }), GOOGLE)).toBe('meetWillBeCreated');
    // Editing an imported meeting: Outlook never pushes google/device meetings, Google never
    // pushes device/outlook meetings.
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONNECTED, 'google')).toBe('pasteLinkHint');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONNECTED, 'device')).toBe('pasteLinkHint');
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet' }), GOOGLE, 'outlook')).toBe('pasteLinkHint');
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet' }), GOOGLE, 'device')).toBe('pasteLinkHint');
    // A google-source meeting still gets its Meet link (the push patches it).
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet' }), GOOGLE, 'google')).toBe('meetWillBeCreated');
  });

  it('keeps the Teams promise for a meeting already in Outlook (the update asks again, §17) and drops it when the account offers none', () => {
    const pushed = { outlookEventId: 'AAMk1' };
    const fresh = { outlookEventId: null };
    const NOT_OFFERED: ConferenceCalendarState = { google: { connected: false }, outlook: { configured: true, connected: true, teamsLinks: false } };
    // Already pushed: the PATCH carries the online-meeting fields, same promise as a new meeting.
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONNECTED, 'manual', pushed)).toBe('teamsWillBeCreated');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONFIGURED, 'manual', pushed)).toBe('teamsNeedsOutlook');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONNECTED, 'manual', fresh)).toBe('teamsWillBeCreated');
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONNECTED, 'manual', null)).toBe('teamsWillBeCreated');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONNECTED, 'manual', pushed)).toBe('linkOptional');
    // The account's calendar allows no online-meeting provider: no promise, paste is the way.
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams' }), NOT_OFFERED, 'manual', fresh)).toBe('teamsNotOffered');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'teams' }), NOT_OFFERED, 'manual', fresh)).toBe('link');
    // Google Meet ignores the Outlook refs (insert AND patch both create the link).
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet' }), GOOGLE, 'manual', pushed)).toBe('meetWillBeCreated');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'google_meet' }), GOOGLE, 'manual', pushed)).toBe('linkOptional');
  });

  it('a typed link always wins: the hint disappears', () => {
    expect(conferenceFormHint(draft({ conferenceProvider: 'google_meet', conferenceUrl: 'https://meet.example/x' }), GOOGLE)).toBeNull();
    expect(conferenceFormHint(draft({ conferenceProvider: 'teams', conferenceUrl: 'https://teams.example/x' }), OUTLOOK_CONNECTED)).toBeNull();
    expect(conferenceFormHint(draft({ conferenceProvider: 'zoom', conferenceUrl: ' zoom.us/j/1 ' }), DISCONNECTED)).toBeNull();
  });

  it('offers the connect CTA exactly for the needs-connection hints', () => {
    expect(conferenceConnectTarget('meetNeedsCalendar')).toBe('google');
    expect(conferenceConnectTarget('teamsNeedsOutlook')).toBe('outlook');
    expect(conferenceConnectTarget('meetWillBeCreated')).toBeNull();
    expect(conferenceConnectTarget('teamsWillBeCreated')).toBeNull();
    expect(conferenceConnectTarget('pasteLinkHint')).toBeNull();
    expect(conferenceConnectTarget(null)).toBeNull();
  });

  it('marks the link input "optional" exactly for the two auto modes', () => {
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'google_meet' }), DISCONNECTED)).toBe('linkOptional');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'google_meet' }), GOOGLE)).toBe('linkOptional');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'teams' }), OUTLOOK_CONFIGURED)).toBe('linkOptional');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'teams' }), OUTLOOK_OFF)).toBe('link');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'zoom' }), OUTLOOK_CONNECTED)).toBe('link');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'other' }), GOOGLE)).toBe('link');
    // Degraded auto modes are plain paste: the link is the only way to get one.
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'teams', repeat: 'weekly' }), OUTLOOK_CONNECTED)).toBe('linkOptional');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'google_meet', repeat: 'weekly' }), GOOGLE)).toBe('linkOptional');
    expect(conferenceLinkLabel(draft({ conferenceProvider: 'google_meet' }), GOOGLE, 'device')).toBe('link');
  });

  it('shows the passcode input only once a link exists (or a stored passcode must stay editable)', () => {
    expect(showConferencePassword(draft())).toBe(false);
    expect(showConferencePassword(draft({ conferenceProvider: 'zoom' }))).toBe(false);
    expect(showConferencePassword(draft({ conferenceProvider: 'zoom', conferenceUrl: 'https://zoom.us/j/1' }))).toBe(true);
    expect(showConferencePassword(draft({ conferenceProvider: 'google_meet', conferenceUrl: ' x ' }))).toBe(true);
    // A meeting saved with a passcode keeps the field visible so it can be cleared.
    expect(showConferencePassword(draft({ conferenceProvider: 'teams', conferencePassword: 'pw' }))).toBe(true);
    expect(showConferencePassword(draft({ conferenceUrl: 'https://zoom.us/j/1' }))).toBe(false);
  });

  it('details card: a real link (conference url or imported virtualUrl) always shows Join', () => {
    expect(conferenceCardState(meeting(), DISCONNECTED)).toEqual({ kind: 'join', url: 'https://zoom.us/j/1' });
    const imported = meeting({
      conference: null,
      location: { type: 'virtual', address: null, virtualUrl: 'https://webex.example/j/7' },
    });
    expect(conferenceCardState(imported, DISCONNECTED)).toEqual({ kind: 'join', url: 'https://webex.example/j/7' });
    expect(conferenceCardState(meeting({ conference: null }), OUTLOOK_CONNECTED)).toEqual({ kind: 'hidden' });
  });

  it('details card: empty-url states follow the provider and the calendar status (full matrix)', () => {
    // source 'manual': the push engines reach every provider for these meetings (§22).
    const withProvider = (provider: 'google_meet' | 'zoom' | 'teams' | 'other') =>
      meeting({ source: 'manual', conference: { provider, url: null, password: null } });
    expect(conferenceCardState(withProvider('zoom'), OUTLOOK_CONNECTED)).toEqual({ kind: 'info', key: 'noLink', connect: null });
    expect(conferenceCardState(withProvider('other'), GOOGLE)).toEqual({ kind: 'info', key: 'noLink', connect: null });
    expect(conferenceCardState(withProvider('google_meet'), GOOGLE)).toEqual({ kind: 'info', key: 'meetPending', connect: null });
    expect(conferenceCardState(withProvider('google_meet'), DISCONNECTED)).toEqual({ kind: 'info', key: 'meetNeedsCalendar', connect: 'google' });
    expect(conferenceCardState(withProvider('teams'), DISCONNECTED)).toEqual({ kind: 'info', key: 'noLink', connect: null });
    expect(conferenceCardState(withProvider('teams'), OUTLOOK_OFF)).toEqual({ kind: 'info', key: 'noLink', connect: null });
    expect(conferenceCardState(withProvider('teams'), OUTLOOK_CONFIGURED)).toEqual({ kind: 'info', key: 'teamsNeedsOutlook', connect: 'outlook' });
    expect(conferenceCardState(withProvider('teams'), OUTLOOK_CONNECTED)).toEqual({ kind: 'info', key: 'teamsPending', connect: null });
    // Already in Outlook without a link: Graph attached none; the card offers paste, no promise.
    const pushedTeams = { ...withProvider('teams'), external: { ...withProvider('teams').external, outlookEventId: 'AAMk1' } };
    expect(conferenceCardState(pushedTeams, OUTLOOK_CONNECTED)).toEqual({ kind: 'info', key: 'teamsLinkMissing', connect: null });
    // The account cannot get Teams links at all: said plainly, pushed or not, no connect CTA.
    const NOT_OFFERED: ConferenceCalendarState = { google: { connected: false }, outlook: { configured: true, connected: true, teamsLinks: false } };
    expect(conferenceCardState(withProvider('teams'), NOT_OFFERED)).toEqual({ kind: 'info', key: 'teamsNotOffered', connect: null });
    expect(conferenceCardState(pushedTeams, NOT_OFFERED)).toEqual({ kind: 'info', key: 'teamsNotOffered', connect: null });
  });

  it('details card: a meeting already in Outlook without a link says Outlook attached none (the update asks again, §17)', () => {
    const pushed = meeting({
      source: 'manual',
      conference: { provider: 'teams', url: null, password: null },
      external: { outlookEventId: 'AAMk1', outlookCalendarId: 'cal1' },
    });
    expect(conferenceCardState(pushed, OUTLOOK_CONNECTED)).toEqual({ kind: 'info', key: 'teamsLinkMissing', connect: null });
    // Disconnected: connecting again lets the next update ask for the link, so the CTA stays.
    expect(conferenceCardState(pushed, OUTLOOK_CONFIGURED)).toEqual({ kind: 'info', key: 'teamsNeedsOutlook', connect: 'outlook' });
    // Once Outlook writes the Teams link back, the card joins like any other.
    const linked = meeting({
      source: 'manual',
      conference: { provider: 'teams', url: 'https://teams.microsoft.com/l/m/1', password: null },
      external: { outlookEventId: 'AAMk1' },
    });
    expect(conferenceCardState(linked, OUTLOOK_CONNECTED)).toEqual({ kind: 'join', url: 'https://teams.microsoft.com/l/m/1' });
    // A Google meeting that was pushed keeps its "waiting for sync" promise (insert AND patch).
    const googlePushed = meeting({
      conference: { provider: 'google_meet', url: null, password: null },
      external: { googleEventId: 'evt1' },
    });
    expect(conferenceCardState(googlePushed, GOOGLE)).toEqual({ kind: 'info', key: 'meetPending', connect: null });
  });

  it('details card: never promises a link the sync cannot create (push-target degrade, §17/§22)', () => {
    const weekly: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: ['TU'], byMonthDay: null, until: null, count: null };
    // Teams + recurrence: the series is pushed with its link (M6), same promise as a one-off.
    const recurringTeams = meeting({ source: 'manual', recurrence: weekly, conference: { provider: 'teams', url: null, password: null } });
    expect(conferenceCardState(recurringTeams, OUTLOOK_CONNECTED)).toEqual({ kind: 'info', key: 'teamsPending', connect: null });
    expect(conferenceCardState(recurringTeams, OUTLOOK_CONFIGURED)).toEqual({ kind: 'info', key: 'teamsNeedsOutlook', connect: 'outlook' });
    // Meet + recurrence still syncs (Google pushes recurring masters).
    const recurringMeet = meeting({ source: 'manual', recurrence: weekly, conference: { provider: 'google_meet', url: null, password: null } });
    expect(conferenceCardState(recurringMeet, GOOGLE)).toEqual({ kind: 'info', key: 'meetPending', connect: null });
    // Imported meetings: Outlook never pushes google/device ones, Google never pushes device/outlook ones.
    const googleTeams = meeting({ source: 'google', conference: { provider: 'teams', url: null, password: null } });
    expect(conferenceCardState(googleTeams, OUTLOOK_CONNECTED)).toEqual({ kind: 'info', key: 'noLink', connect: null });
    const outlookMeet = meeting({ source: 'outlook', conference: { provider: 'google_meet', url: null, password: null } });
    expect(conferenceCardState(outlookMeet, GOOGLE)).toEqual({ kind: 'info', key: 'noLink', connect: null });
    const deviceMeet = meeting({ source: 'device', conference: { provider: 'google_meet', url: null, password: null } });
    expect(conferenceCardState(deviceMeet, GOOGLE)).toEqual({ kind: 'info', key: 'noLink', connect: null });
  });
});

describe('invitation hint under the participants', () => {
  const OUTLOOK_ON = { configured: true, connected: true };
  const OUTLOOK_OFF = { configured: true, connected: false };

  it('names the calendars that email the invitations of a new meeting', () => {
    expect(invitesHintKey(true, undefined)).toBe('invitesByGoogle');
    expect(invitesHintKey(true, OUTLOOK_OFF)).toBe('invitesByGoogle');
    expect(invitesHintKey(false, OUTLOOK_ON)).toBe('invitesByOutlook');
    expect(invitesHintKey(true, OUTLOOK_ON)).toBe('invitesByBoth');
    expect(invitesHintKey(false, OUTLOOK_ON, 'ai_chat')).toBe('invitesByOutlook');
  });

  it('asks to connect a calendar when none sends them', () => {
    expect(invitesHintKey(false, undefined)).toBe('invitesNeedCalendar');
    expect(invitesHintKey(false, { configured: false, connected: false })).toBe('invitesNeedCalendar');
    expect(invitesHintKey(false, OUTLOOK_OFF)).toBe('invitesNeedCalendars');
  });

  it('only promises the calendar an imported meeting is pushed to', () => {
    expect(invitesHintKey(true, OUTLOOK_ON, 'google')).toBe('invitesByGoogle');
    expect(invitesHintKey(true, OUTLOOK_ON, 'outlook')).toBe('invitesByOutlook');
    expect(invitesHintKey(true, OUTLOOK_ON, 'device')).toBe('invitesSavedOnly');
    expect(invitesHintKey(false, OUTLOOK_ON, 'google')).toBe('invitesNeedCalendar');
  });
});
