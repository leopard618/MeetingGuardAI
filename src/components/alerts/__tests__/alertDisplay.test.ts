import { NOW, fakeFormatTime, minutesFrom, translator } from '../../../services/alerts/__fixtures__/alertFixtures';
import { alertPhase, buildAlertDisplay, displayInputFromLegacyMeeting } from '../alertDisplay';

function deps(uiLanguage: 'en' | 'es', now = NOW) {
  // The real app passes useT(); a translator that honours the `lng` option is enough here.
  const en = translator('en');
  const es = translator('es');
  const t = (key: string, options?: Record<string, unknown>) =>
    ((options?.lng ?? uiLanguage) === 'es' ? es : en)(key, options);
  return { t, formatTime: fakeFormatTime, uiLanguage, use24Hour: true, now };
}

describe('alertPhase', () => {
  it('rounds up the minutes before start and down after it', () => {
    expect(alertPhase(minutesFrom(NOW, 4.5), NOW)).toEqual({ phase: 'upcoming', minutes: 5 });
    expect(alertPhase(minutesFrom(NOW, 0.2), NOW)).toEqual({ phase: 'now', minutes: 0 });
    expect(alertPhase(minutesFrom(NOW, -3.7), NOW)).toEqual({ phase: 'started', minutes: 3 });
  });
});

describe('buildAlertDisplay', () => {
  const input = {
    title: 'Revisión   semanal',
    startAt: minutesFrom(NOW, 5),
    durationMinutes: 30,
    locationText: 'Sala 2',
    joinUrl: null,
    language: 'es' as const,
  };

  it('localizes every text, the voice included, in the app language (not the meeting language)', () => {
    const display = buildAlertDisplay(input, deps('en'));
    expect(display).toMatchObject({
      title: 'Revisión semanal',
      phase: 'upcoming',
      minutes: 5,
      whenText: 'Starts in 5 minutes',
      timeText: '12:05 – 12:35',
      locationText: 'Sala 2',
      voiceLanguage: 'en',
    });
    expect(display.voiceText).toBe('Attention. Your meeting Revisión semanal starts in 5 minutes, at 12:05. Location: Sala 2.');

    const spanish = buildAlertDisplay({ ...input, language: 'en' }, deps('es'));
    expect(spanish.voiceLanguage).toBe('es');
    expect(spanish.voiceText).toBe(
      'Atención. Tu reunión Revisión semanal empieza en 5 minutos. Hora de inicio: 12:05. Lugar: Sala 2.',
    );
  });

  it('describes meetings that are starting or already started', () => {
    expect(buildAlertDisplay({ ...input, startAt: NOW.toISOString() }, deps('es')).whenText).toBe('Empieza ahora');
    const started = buildAlertDisplay({ ...input, startAt: minutesFrom(NOW, -2), language: 'en' }, deps('en'));
    expect(started.whenText).toBe('Started 2 minutes ago');
    expect(started.voiceText).toBe('Your meeting Revisión semanal has already started. Location: Sala 2.');
  });
});

describe('displayInputFromLegacyMeeting', () => {
  it('reads the legacy view shape (startTime, location view, conference details)', () => {
    expect(
      displayInputFromLegacyMeeting(
        {
          title: 'Sync',
          startTime: '2026-10-05T12:30:00.000Z',
          duration: 45,
          location: { type: 'virtual', address: null, virtualPlatform: 'Zoom', virtualLink: 'https://zoom.us/j/9' },
          conference_details: { provider: 'zoom', url: 'https://zoom.us/j/9', password: null },
          language: 'es',
        },
        'en',
      ),
    ).toEqual({
      title: 'Sync',
      startAt: '2026-10-05T12:30:00.000Z',
      durationMinutes: 45,
      locationText: 'Zoom',
      joinUrl: 'https://zoom.us/j/9',
      language: 'es',
    });
  });

  it('reads ad-hoc objects with local date/time and a string location', () => {
    const result = displayInputFromLegacyMeeting({ title: 'Test', date: '2026-10-05', time: '14:05', location: 'Room' }, 'en');
    expect(result).toMatchObject({ title: 'Test', durationMinutes: 60, locationText: 'Room', joinUrl: null, language: 'en' });
    expect(new Date(result!.startAt).getHours()).toBe(14);
    expect(displayInputFromLegacyMeeting({ title: 'No time' }, 'en')).toBeNull();
  });
});
