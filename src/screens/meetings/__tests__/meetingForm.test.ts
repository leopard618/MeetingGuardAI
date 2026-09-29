import { buildMeeting, type Meeting } from '../../../core/types';
import {
  conferenceOf,
  dateFromPicker,
  draftFromMeeting,
  draftToCreateInput,
  draftToPatch,
  isMeetingDraftDirty,
  newMeetingDraft,
  normalizeTypedUrl,
  pickerDateOf,
  timeFromPicker,
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
