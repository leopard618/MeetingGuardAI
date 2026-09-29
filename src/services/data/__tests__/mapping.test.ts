import { toLegacyMeetingView } from '../../../core/legacy';
import { dayRangeUtc, todayInZone } from '../../../core/time';
import { buildMeeting, type Meeting } from '../../../core/types';
import { filterMeetings } from '../engine';
import {
  convertLegacyMeeting,
  legacyPreferencesFromProfile,
  LEGACY_EPOCH,
  meetingToDoc,
  readRemoteMeeting,
  readRemoteProfile,
} from '../mapping';
import { findUndefinedPath } from '../util';


const ctx = { uid: 'u1', timeZone: 'Europe/Madrid', language: 'es' as const };
const now = new Date('2026-10-01T10:00:00.000Z');

function meeting(partial: { id: string; startAt: string; timezone?: string; title?: string }): Meeting {
  return buildMeeting(
    { title: partial.title ?? partial.id, startAt: partial.startAt, source: 'manual', timezone: partial.timezone },
    { id: partial.id, userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
  );
}

describe('write mapping', () => {
  it('produces documents without undefined values and with every optional field as null', () => {
    const m = buildMeeting(
      {
        title: 'Budget review',
        startAt: '2026-10-05T14:30:00+02:00',
        source: 'manual',
        location: { type: 'virtual', address: null, virtualUrl: null },
      },
      { id: 'm1', userId: 'u1', now, defaultTimezone: 'Europe/Madrid', defaultLanguage: 'en' },
    );
    const doc = meetingToDoc(m);
    expect(findUndefinedPath(doc)).toBeNull();
    expect(doc).not.toHaveProperty('id');
    expect(doc).toMatchObject({ startAt: '2026-10-05T12:30:00.000Z', date: '2026-10-05', time: '14:30', conference: null, notes: null, deletedAt: null });
  });

  it('rejects writing an invalid meeting', () => {
    const broken = { ...meeting({ id: 'm2', startAt: '2026-10-05T10:00:00.000Z' }), title: '' };
    expect(() => meetingToDoc(broken)).toThrow(expect.objectContaining({ code: 'invalid_input' }) as Error);
  });

  it('finds undefined anywhere in a nested document', () => {
    expect(findUndefinedPath({ a: { b: [1, { c: undefined }] } })).toBe('a.b[1].c');
  });
});

describe('read mapping', () => {
  it('re-derives date/time from startAt + timezone (stored values are never trusted)', () => {
    const doc = { ...meetingToDoc(meeting({ id: 'm1', startAt: '2026-10-05T12:30:00.000Z' })), date: '1999-01-01', time: '00:00' };
    const read = readRemoteMeeting('m1', doc, ctx);
    expect(read.kind).toBe('current');
    if (read.kind !== 'current') return;
    expect(read.meeting).toMatchObject({ date: '2026-10-05', time: '14:30' });
  });

  it('uses the document path as the owner', () => {
    const doc = { ...meetingToDoc(meeting({ id: 'm1', startAt: '2026-10-05T12:30:00.000Z' })), userId: 'someone-else' };
    const read = readRemoteMeeting('m1', doc, ctx);
    expect(read.kind === 'current' && read.meeting.userId).toBe('u1');
  });

  it('converts pre-rebuild Firestore meetings (date/time strings, legacy labels, undefined-free)', () => {
    const legacy = {
      title: 'Cliente ACME',
      date: '2026-10-05',
      time: '9:00',
      duration: '45',
      source: 'ChatGPT',
      confidence: 87,
      preparation_tips: ['Revisar contrato'],
      location: { type: 'virtual', address: null, virtualPlatform: 'Zoom', virtualLink: 'https://zoom.us/j/123' },
      participants: [{ name: 'Ana', email: 'ana@example.com' }, { name: 'Sin correo' }],
      created_date: '2026-09-01T08:00:00.000Z',
      updated_date: '2026-09-02T08:00:00.000Z',
      user_id: 'u1',
    };
    const read = readRemoteMeeting('abcDEF123', legacy, ctx);
    expect(read.kind).toBe('legacy');
    if (read.kind !== 'legacy') return;
    expect(read.meeting).toMatchObject({
      id: 'abcDEF123',
      startAt: '2026-10-05T07:00:00.000Z',
      date: '2026-10-05',
      time: '09:00',
      durationMinutes: 45,
      source: 'ai_chat',
      confidence: 87,
      preparationTips: ['Revisar contrato'],
      conference: { provider: 'zoom', url: 'https://zoom.us/j/123', password: null },
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-02T08:00:00.000Z',
    });
    expect(read.meeting.participants).toEqual([{ email: 'ana@example.com', name: 'Ana', status: null }]);
    expect(read.meeting.notes).toContain('Sin correo');
    expect(findUndefinedPath(meetingToDoc(read.meeting))).toBeNull();
  });

  it('gives legacy records without timestamps a fixed old updatedAt (stable across reads)', () => {
    const converted = convertLegacyMeeting('x1', { title: 'T', date: '2026-10-05', time: '10:00' }, ctx);
    expect(converted.updatedAt).toBe(LEGACY_EPOCH);
    expect(convertLegacyMeeting('x1', { title: 'T', date: '2026-10-05', time: '10:00' }, ctx)).toEqual(converted);
  });

  it('marks unusable documents invalid', () => {
    expect(readRemoteMeeting('m1', { foo: 1 }, ctx).kind).toBe('invalid');
    expect(readRemoteMeeting('bad:id', meetingToDoc(meeting({ id: 'm1', startAt: '2026-10-05T10:00:00.000Z' })), ctx).kind).toBe('invalid');
  });

  it('reads legacy profiles without plan fields and extracts legacy snake_case preferences', () => {
    const raw = {
      name: 'Ana',
      email: 'ana@example.com',
      picture: 'https://example.com/a.png',
      plan: 'free',
      createdAt: '2025-05-01T10:00:00.000Z',
      preferences: { alert_enabled: false, alert_intensity: 'maximum', language: 'es', theme: 'dark' },
    };
    const profile = readRemoteProfile('u1', raw);
    expect(profile).toEqual({
      uid: 'u1',
      email: 'ana@example.com',
      displayName: 'Ana',
      photoURL: 'https://example.com/a.png',
      createdAt: '2025-05-01T10:00:00.000Z',
      updatedAt: '2025-05-01T10:00:00.000Z',
      lastLoginAt: null,
      legacyMigratedAt: null,
    });
    expect(legacyPreferencesFromProfile(raw)).toEqual({ alertEnabled: false, alertIntensity: 'max', language: 'es' });
    expect(legacyPreferencesFromProfile({ name: 'x' })).toBeNull();
  });
});

describe('time zones: derivation, DST and non-UTC "today"', () => {
  it('handles the spring-forward gap (Europe/Madrid 2026-03-29 02:30 does not exist)', () => {
    const converted = convertLegacyMeeting('dst1', { title: 'Gap', date: '2026-03-29', time: '02:30' }, ctx);
    expect(converted.startAt).toBe('2026-03-29T01:30:00.000Z');
    expect(converted).toMatchObject({ date: '2026-03-29', time: '03:30', timezone: 'Europe/Madrid' });
  });

  it('keeps the wall-clock time across the fall-back change', () => {
    const before = convertLegacyMeeting('dst2', { title: 'Before', date: '2026-10-24', time: '10:00' }, ctx);
    const after = convertLegacyMeeting('dst3', { title: 'After', date: '2026-10-26', time: '10:00' }, ctx);
    expect(before.startAt).toBe('2026-10-24T08:00:00.000Z'); // CEST (+02:00)
    expect(after.startAt).toBe('2026-10-26T09:00:00.000Z'); // CET (+01:00)
    expect([before.time, after.time]).toEqual(['10:00', '10:00']);
  });

  it('selects "today" in the user zone, not in UTC (America/Los_Angeles, 23:30 local)', () => {
    const zone = 'America/Los_Angeles';
    const late = meeting({ id: 'late', startAt: '2026-10-06T06:30:00.000Z', timezone: zone }); // 2026-10-05 23:30 PDT
    const early = meeting({ id: 'early', startAt: '2026-10-05T06:30:00.000Z', timezone: zone }); // 2026-10-04 23:30 PDT
    expect(late).toMatchObject({ date: '2026-10-05', time: '23:30' });

    const today = todayInZone(zone, new Date('2026-10-05T20:00:00.000Z'));
    expect(today).toBe('2026-10-05');
    const range = dayRangeUtc(today, zone);
    expect(filterMeetings([late, early], range).map((m) => m.id)).toEqual(['late']);
    expect(toLegacyMeetingView(late, { timeZone: zone })).toMatchObject({ date: '2026-10-05', time: '23:30' });
  });

  it('shows legacy views in the device zone while storing the meeting zone', () => {
    const m = meeting({ id: 'tz', startAt: '2026-10-05T12:30:00.000Z', timezone: 'Europe/Madrid' });
    expect(toLegacyMeetingView(m, { timeZone: 'America/New_York' })).toMatchObject({ date: '2026-10-05', time: '08:30', timezone: 'Europe/Madrid' });
  });

  it('filters ranges on instants and rejects invalid bounds', () => {
    const a = meeting({ id: 'a', startAt: '2026-10-05T10:00:00.000Z' });
    const b = meeting({ id: 'b', startAt: '2026-10-05T11:00:00.000Z' });
    expect(filterMeetings([b, a], { from: '2026-10-05T12:00:00+02:00', to: '2026-10-05T11:00:00Z' }).map((m) => m.id)).toEqual(['a']);
    expect(() => filterMeetings([a], { from: 'yesterday' })).toThrow(expect.objectContaining({ code: 'invalid_input' }) as Error);
  });
});
