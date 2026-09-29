import {
  fromLegacyIntensity,
  fromLegacyMeetingInput,
  fromLegacyMeetingPatch,
  fromLegacyPreferencesPatch,
  normalizeMeetingSource,
  parseLegacyTime,
  toLegacyMeetingView,
  toLegacyPreferencesView,
} from '../legacy';
import { buildMeeting, createDefaultPreferences } from '../types';

const context = { timeZone: 'America/Mexico_City', language: 'es' as const };
const NOW = '2026-10-01T10:00:00.000Z';

describe('legacy sources and intensities', () => {
  it('maps legacy labels', () => {
    expect(normalizeMeetingSource('ChatGPT')).toBe('ai_chat');
    expect(normalizeMeetingSource('WhatsApp')).toBe('whatsapp');
    expect(normalizeMeetingSource('Manual')).toBe('manual');
    expect(normalizeMeetingSource('google')).toBe('google');
    expect(normalizeMeetingSource(undefined)).toBe('manual');
    expect(fromLegacyIntensity('maximum')).toBe('max');
    expect(fromLegacyIntensity('loud')).toBeNull();
  });

  it('parses legacy times', () => {
    expect(parseLegacyTime('9:05')).toBe('09:05');
    expect(parseLegacyTime('14:30:00')).toBe('14:30');
    expect(parseLegacyTime('12:15 AM')).toBe('00:15');
    expect(parseLegacyTime('2:30pm')).toBe('14:30');
    expect(parseLegacyTime('13:00 PM')).toBeNull();
  });
});

describe('fromLegacyMeetingInput', () => {
  it('converts the ModernCreateMeeting payload', () => {
    const { input, droppedParticipantNames } = fromLegacyMeetingInput(
      {
        title: 'Budget review',
        date: '2026-10-05',
        time: '16:30',
        duration: '30',
        location: { type: 'virtual', address: null, virtualPlatform: 'zoom', virtualLink: 'https://zoom.us/j/123' },
        participants: [{ name: 'Ana', email: 'ana@example.com' }, { name: 'Luis', email: '' }],
        preparation_tips: 'Bring numbers\nCheck slides',
        source: 'Manual',
        confidence: 100,
      },
      context,
    );
    expect(input).toMatchObject({
      title: 'Budget review',
      startAt: '2026-10-05T22:30:00.000Z',
      durationMinutes: 30,
      timezone: 'America/Mexico_City',
      source: 'manual',
      conference: { provider: 'zoom', url: 'https://zoom.us/j/123', password: null },
      participants: [{ email: 'ana@example.com', name: 'Ana' }],
      preparationTips: ['Bring numbers', 'Check slides'],
      notes: 'Participants: Luis',
      language: 'es',
    });
    expect(droppedParticipantNames).toEqual(['Luis']);
    expect(() => buildMeeting(input, { id: 'x1', userId: 'u', now: NOW, defaultTimezone: 'UTC', defaultLanguage: 'en' })).not.toThrow();
  });

  it('never keeps fabricated/unsafe links and requires title + start', () => {
    const { input } = fromLegacyMeetingInput(
      { title: 'x', date: '2026-10-05', time: '10:00', location: { type: 'physical', address: 'No location specified', virtualLink: 'javascript:1' } },
      context,
    );
    expect(input.location).toBeNull();
    expect(input.conference).toBeNull();
    expect(() => fromLegacyMeetingInput({ date: '2026-10-05', time: '10:00' }, context)).toThrow();
    expect(() => fromLegacyMeetingInput({ title: 'x', date: '2026-10-05' }, context)).toThrow();
  });
});

describe('legacy views', () => {
  const meeting = buildMeeting(
    {
      title: 'Standup',
      startAt: '2026-10-05T14:00:00.000Z',
      source: 'ai_chat',
      confidence: 70,
      conference: { provider: 'google_meet', url: 'https://meet.google.com/abc-defg-hij', password: null },
    },
    { id: 'm1', userId: 'u1', now: NOW, defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );

  it('renders the shape stage-3 screens read, in the device zone', () => {
    const view = toLegacyMeetingView(meeting, { timeZone: 'America/Mexico_City' });
    expect(view).toMatchObject({
      id: 'm1',
      date: '2026-10-05',
      time: '08:00',
      duration: 60,
      startTime: '2026-10-05T14:00:00.000Z',
      source: 'ChatGPT',
      sourceKey: 'ai_chat',
      location: { type: 'virtual', virtualPlatform: 'Google Meet', virtualLink: 'https://meet.google.com/abc-defg-hij' },
      created_date: NOW,
    });
    expect(view.start.dateTime).toBe(meeting.startAt);
  });

  it('keeps all-day dates stable across zones', () => {
    const allDay = { ...meeting, allDay: true, date: '2026-10-05', durationMinutes: 1440 };
    expect(toLegacyMeetingView(allDay, { timeZone: 'Pacific/Honolulu' }).date).toBe('2026-10-05');
  });

  it('converts AIInsights-style patches', () => {
    expect(fromLegacyMeetingPatch({ confidence: 100 }, meeting, { timeZone: 'UTC' })).toEqual({ confidence: 100 });
    const patch = fromLegacyMeetingPatch({ time: '09:30' }, meeting, { timeZone: 'America/Mexico_City' });
    expect(patch.startAt).toBe('2026-10-05T15:30:00.000Z');
  });

  it('maps preferences both ways', () => {
    const view = toLegacyPreferencesView(createDefaultPreferences());
    expect(view.alert_intensity).toBe('maximum');
    expect(fromLegacyPreferencesPatch({ id: 'x', theme: 'dark', alert_intensity: 'maximum', alert_enabled: false })).toEqual({
      alertIntensity: 'max',
      alertEnabled: false,
    });
  });
});
