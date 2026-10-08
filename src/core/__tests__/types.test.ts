import { isAppError } from '../errors';
import {
  applyMeetingPatch,
  applyNotePatch,
  applyPreferencesPatch,
  buildMeeting,
  buildNote,
  createDefaultPreferences,
  DEFAULT_ENTITLEMENT,
  effectivePlan,
  mergePreferences,
  parseEntitlementDoc,
  parseMeetingDoc,
  parseNoteDoc,
  meetingSchema,
  toMeetingDoc,
  TOMBSTONE_TITLE,
  tombstoneHasContent,
  tombstoneMeeting,
  type Meeting,
} from '../types';

const NOW = '2026-10-01T10:00:00.000Z';
const ctx = { id: 'm1', userId: 'u1', now: NOW, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'es' as const };

function sampleMeeting(): Meeting {
  return buildMeeting(
    {
      title: '  Weekly sync ',
      startAt: '2026-10-05T16:30:00+02:00',
      source: 'manual',
      participants: [
        { email: 'Ana@Example.com', name: ' Ana ' },
        { email: 'ana@example.com', name: 'Duplicate' },
      ],
      preparationTips: ['  Agenda ', ''],
      customAlertTimes: [5, 15, 5],
    },
    ctx,
  );
}

describe('buildMeeting', () => {
  it('fills defaults, normalizes and derives local date/time', () => {
    const meeting = sampleMeeting();
    expect(meeting).toMatchObject({
      id: 'm1',
      userId: 'u1',
      title: 'Weekly sync',
      description: '',
      startAt: '2026-10-05T14:30:00.000Z',
      durationMinutes: 60,
      timezone: 'Europe/Madrid',
      date: '2026-10-05',
      time: '16:30',
      language: 'es',
      status: 'scheduled',
      confidence: null,
      conference: null,
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(meeting.participants).toEqual([{ email: 'ana@example.com', name: 'Ana', status: null }]);
    expect(meeting.preparationTips).toEqual(['Agenda']);
    expect(meeting.customAlertTimes).toEqual([15, 5]);
    expect(meeting.external.googleEventId).toBeNull();
  });

  it('rejects invalid input with invalid_input', () => {
    expect.assertions(2);
    try {
      buildMeeting({ title: '', startAt: 'tomorrow', source: 'manual' }, ctx);
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      expect(isAppError(error) && error.code).toBe('invalid_input');
    }
  });

  it('rejects javascript: conference URLs', () => {
    expect(() =>
      buildMeeting(
        {
          title: 'x',
          startAt: NOW,
          source: 'manual',
          conference: { provider: 'zoom', url: 'javascript:alert(1)', password: null },
        },
        ctx,
      ),
    ).toThrow();
  });
});

describe('applyMeetingPatch', () => {
  it('recomputes derived fields, clears with null and merges external refs', () => {
    const meeting = { ...sampleMeeting(), notes: 'n' };
    const next = applyMeetingPatch(
      meeting,
      { startAt: '2026-10-06T07:00:00.000Z', notes: null, external: { googleEventId: 'mgabc' } },
      '2026-10-02T00:00:00.000Z',
    );
    expect(next.date).toBe('2026-10-06');
    expect(next.time).toBe('09:00');
    expect(next.notes).toBeNull();
    expect(next.external.googleEventId).toBe('mgabc');
    expect(next.external.deviceEventId).toBeNull();
    expect(next.updatedAt).toBe('2026-10-02T00:00:00.000Z');
    expect(next.createdAt).toBe(meeting.createdAt);
  });

  it('tombstones scrub the content and keep only what sync needs', () => {
    const meeting = applyMeetingPatch(
      sampleMeeting(),
      {
        description: 'Budget, salaries',
        notes: 'Private notes',
        conference: { provider: 'zoom', url: 'https://zoom.us/j/1', password: 'secret' },
        location: { type: 'physical', address: 'Room 4', virtualUrl: null },
        alertIntensity: 'max',
        external: { googleEventId: 'mgabc', googleCalendarId: 'primary' },
      },
      '2026-10-02T00:00:00.000Z',
    );
    const dead = tombstoneMeeting(meeting, '2026-10-03T00:00:00.000Z');
    expect(dead).toMatchObject({
      id: meeting.id,
      userId: meeting.userId,
      source: meeting.source,
      status: meeting.status,
      startAt: meeting.startAt,
      durationMinutes: meeting.durationMinutes,
      timezone: meeting.timezone,
      createdAt: meeting.createdAt,
      external: meeting.external,
      deletedAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
      title: TOMBSTONE_TITLE,
      description: '',
      notes: null,
      conference: null,
      location: null,
      participants: [],
      preparationTips: [],
      customAlertTimes: null,
      alertIntensity: null,
    });
    expect(JSON.stringify(dead)).not.toMatch(/secret|Private|salaries|ana@example\.com|Weekly/);
    // Still a valid document (the rules require a non-empty title).
    expect(meetingSchema.safeParse(dead).success).toBe(true);
    expect(tombstoneHasContent(dead)).toBe(false);
    expect(tombstoneHasContent({ ...meeting, deletedAt: '2026-10-03T00:00:00.000Z' })).toBe(true);
    expect(tombstoneHasContent(meeting)).toBe(false);
  });
});

describe('meeting documents', () => {
  it('round-trips through toMeetingDoc/parseMeetingDoc', () => {
    const meeting = sampleMeeting();
    expect(parseMeetingDoc(meeting.id, JSON.parse(JSON.stringify(toMeetingDoc(meeting))))).toEqual(meeting);
  });

  it('fills defaults for older documents and rejects invalid ones', () => {
    const parsed = parseMeetingDoc('old1', {
      userId: 'u1',
      title: 'Old',
      startAt: '2026-10-05T14:30:00.000Z',
      timezone: 'UTC',
      source: 'ai_chat',
      createdAt: NOW,
      updatedAt: NOW,
      external: { googleEventId: 'x' },
    });
    expect(parsed).toMatchObject({ id: 'old1', durationMinutes: 60, date: '2026-10-05', time: '14:30', participants: [] });
    expect(parsed?.external).toEqual(expect.objectContaining({ googleEventId: 'x', deviceCalendarId: null }));
    expect(parseMeetingDoc('bad', { title: 'no start' })).toBeNull();
    expect(parseMeetingDoc('bad:id', toMeetingDoc(sampleMeeting()))).toBeNull();
  });
});

describe('preferences', () => {
  it('merges field by field without resetting valid values', () => {
    const defaults = createDefaultPreferences({ language: 'es', timezone: 'America/Mexico_City' });
    const merged = mergePreferences(
      { alertIntensity: 'light', alertVolume: 7, defaultAlertTimes: [0, 30, 30], unknownKey: true },
      defaults,
    );
    expect(merged.alertIntensity).toBe('light');
    expect(merged.alertVolume).toBe(defaults.alertVolume);
    expect(merged.defaultAlertTimes).toEqual([30, 0]);
    expect(merged.language).toBe('es');
    expect(mergePreferences(null, defaults)).toEqual(defaults);
  });

  it('applies patches and reports changed keys', () => {
    const prefs = createDefaultPreferences();
    const { preferences, changedKeys } = applyPreferencesPatch(prefs, { alertEnabled: false, language: 'en' }, NOW);
    expect(preferences.alertEnabled).toBe(false);
    expect(preferences.updatedAt).toBe(NOW);
    expect(changedKeys).toEqual(['alertEnabled']);
    expect(() => applyPreferencesPatch(prefs, { alertVolume: 2 }, NOW)).toThrow();
  });
});

describe('entitlements', () => {
  it('defaults to free and downgrades expired plans', () => {
    expect(parseEntitlementDoc(undefined)).toEqual(DEFAULT_ENTITLEMENT);
    expect(parseEntitlementDoc({ plan: 'gold' })).toBeNull();
    const pro = { plan: 'pro' as const, status: 'active' as const, expiresAt: '2026-10-02T00:00:00.000Z', source: 'google_play' as const, updatedAt: null };
    expect(effectivePlan(pro, new Date('2026-10-01T00:00:00Z'))).toBe('pro');
    expect(effectivePlan(pro, new Date('2026-10-03T00:00:00Z'))).toBe('free');
    expect(effectivePlan({ ...pro, expiresAt: null, status: 'revoked' })).toBe('free');
  });
});

describe('notes', () => {
  it('builds, patches and parses notes', () => {
    const note = buildNote({ title: ' Ideas ' }, { id: 'n1', userId: 'u1', now: NOW });
    expect(note).toMatchObject({ title: 'Ideas', content: '', category: 'general', pinned: false, meetingId: null });
    const pinned = applyNotePatch(note, { pinned: true, meetingId: 'm1' }, '2026-10-02T00:00:00.000Z');
    expect(pinned).toMatchObject({ pinned: true, meetingId: 'm1', updatedAt: '2026-10-02T00:00:00.000Z' });
    const { id: _id, ...doc } = pinned;
    expect(parseNoteDoc('n1', doc)).toEqual(pinned);
  });
});
