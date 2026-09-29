import { buildMeeting } from '../../../core/types';
import {
  fromLegacyIntensity,
  fromLegacyMeetingInput,
  fromLegacyPreferencesPatch,
  normalizeMeetingSource,
  parseLegacyTime,
} from '../legacyInput';

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
  it('converts a v1.0.9 meeting payload', () => {
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

describe('fromLegacyPreferencesPatch', () => {
  it('keeps known snake_case fields and ignores legacy-only keys', () => {
    expect(fromLegacyPreferencesPatch({ id: 'x', theme: 'dark', alert_intensity: 'maximum', alert_enabled: false })).toEqual({
      alertIntensity: 'max',
      alertEnabled: false,
    });
  });

  it('drops invalid values', () => {
    expect(fromLegacyPreferencesPatch({ language: 'fr', alert_volume: 3, alert_sound_type: 'loud' })).toEqual({});
  });
});
