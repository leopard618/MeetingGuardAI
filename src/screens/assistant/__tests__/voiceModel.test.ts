import {
  VOICE_MAX_SESSION_MS,
  VOICE_SILENCE_AFTER_SPEECH_MS,
  VOICE_SILENCE_NO_SPEECH_MS,
  joinSegments,
  shouldAutoSend,
  voiceCommand,
  voiceLocale,
  voiceProblemForError,
  routeFinalTranscript,
} from '../voiceModel';

describe('voiceLocale', () => {
  it('maps the app languages to the same tags as the alert readout', () => {
    expect(voiceLocale('en')).toBe('en-US');
    expect(voiceLocale('es')).toBe('es-ES');
  });
});

describe('voiceProblemForError', () => {
  it('stays silent when the user aborted', () => {
    expect(voiceProblemForError('aborted')).toBeNull();
  });

  it('maps permission problems to denied', () => {
    expect(voiceProblemForError('not-allowed')).toBe('denied');
    expect(voiceProblemForError('service-not-allowed')).toBe('denied');
  });

  it('maps silence to a gentle retry hint', () => {
    expect(voiceProblemForError('no-speech')).toBe('noSpeech');
  });

  it('maps an unsupported language to unavailable', () => {
    expect(voiceProblemForError('language-not-supported')).toBe('unavailable');
  });

  it('maps everything else to a generic error', () => {
    expect(voiceProblemForError('network')).toBe('error');
    expect(voiceProblemForError('audio-capture')).toBe('error');
    expect(voiceProblemForError('busy')).toBe('error');
  });
});

describe('shouldAutoSend', () => {
  const natural = { endedByUser: false, failed: false };

  it('sends when listening ended by itself with usable text', () => {
    expect(shouldAutoSend(natural, 'Move my 4pm to 5pm')).toBe(true);
  });

  it('never sends what the user stopped to edit', () => {
    expect(shouldAutoSend({ endedByUser: true, failed: false }, 'Move my 4pm to 5pm')).toBe(false);
  });

  it('never sends after a failed session', () => {
    expect(shouldAutoSend({ endedByUser: false, failed: true }, 'Move my 4pm to 5pm')).toBe(false);
  });

  it('never sends blank transcripts', () => {
    expect(shouldAutoSend(natural, '')).toBe(false);
    expect(shouldAutoSend(natural, '   ')).toBe(false);
  });
});

describe('listening session timing', () => {
  it('allows a dictation pause well above typical platform cut-offs, within sane bounds', () => {
    expect(VOICE_SILENCE_AFTER_SPEECH_MS).toBeGreaterThanOrEqual(2500);
    expect(VOICE_SILENCE_AFTER_SPEECH_MS).toBeLessThanOrEqual(5000);
    expect(VOICE_SILENCE_NO_SPEECH_MS).toBeGreaterThan(VOICE_SILENCE_AFTER_SPEECH_MS);
    expect(VOICE_MAX_SESSION_MS).toBeGreaterThan(VOICE_SILENCE_NO_SPEECH_MS);
  });
});

describe('joinSegments', () => {
  it('joins finalized segments with single spaces', () => {
    expect(joinSegments('', 'schedule a meeting')).toBe('schedule a meeting');
    expect(joinSegments('schedule a meeting', 'with Ana tomorrow')).toBe('schedule a meeting with Ana tomorrow');
    expect(joinSegments('schedule a meeting', '')).toBe('schedule a meeting');
    expect(joinSegments('  padded  ', '  words  ')).toBe('padded words');
  });
});

describe('voiceCommand', () => {
  it('recognizes explicit confirmations in both languages', () => {
    expect(voiceCommand('yes, confirm', 'en')).toBe('confirm');
    expect(voiceCommand('Confirm', 'en')).toBe('confirm');
    expect(voiceCommand('OK!', 'en')).toBe('confirm');
    expect(voiceCommand('sí, confirma', 'es')).toBe('confirm');
    expect(voiceCommand('Vale', 'es')).toBe('confirm');
  });

  it('recognizes word combinations around the strong words', () => {
    expect(voiceCommand('yes I confirm', 'en')).toBe('confirm');
    expect(voiceCommand('Yes, please confirm it', 'en')).toBe('confirm');
    expect(voiceCommand('ok confirm it now', 'en')).toBe('confirm');
    expect(voiceCommand('yes do it please', 'en')).toBe('confirm');
    expect(voiceCommand('no, cancel it please', 'en')).toBe('cancel');
    expect(voiceCommand('cancel them all', 'en')).toBe('cancel');
    expect(voiceCommand('sí, lo confirmo', 'es')).toBe('confirm');
    expect(voiceCommand('cancela todo por favor', 'es')).toBe('cancel');
  });

  it('refuses contradictions and content words in the fallback', () => {
    expect(voiceCommand('yes cancel', 'en')).toBeNull();
    expect(voiceCommand('do not confirm', 'en')).toBeNull();
    expect(voiceCommand('yes confirm the meeting with Ana', 'en')).toBeNull();
    expect(voiceCommand('yes i confirm but make it earlier', 'en')).toBeNull();
  });

  it('recognizes natural affirmations, with or without apostrophes', () => {
    expect(voiceCommand("yeah that's right", 'en')).toBe('confirm');
    expect(voiceCommand('yeah thats right', 'en')).toBe('confirm');
    expect(voiceCommand("That's right.", 'en')).toBe('confirm');
    expect(voiceCommand('Perfect', 'en')).toBe('confirm');
    expect(voiceCommand('así es', 'es')).toBe('confirm');
    expect(voiceCommand('perfecto', 'es')).toBe('confirm');
  });

  it('recognizes explicit cancellations in both languages', () => {
    expect(voiceCommand('no', 'en')).toBe('cancel');
    expect(voiceCommand('Cancel it.', 'en')).toBe('cancel');
    expect(voiceCommand('cancela', 'es')).toBe('cancel');
    expect(voiceCommand('No, cancela', 'es')).toBe('cancel');
  });

  it('ignores case and punctuation but never partial matches', () => {
    expect(voiceCommand('YES', 'en')).toBe('confirm');
    expect(voiceCommand('yes, but move it to 5pm', 'en')).toBeNull();
    expect(voiceCommand('confirm the second one only', 'en')).toBeNull();
    expect(voiceCommand('no idea what is on today', 'en')).toBeNull();
  });

  it('follows the app language strictly', () => {
    expect(voiceCommand('confirma', 'en')).toBeNull();
    expect(voiceCommand('go ahead', 'es')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(voiceCommand('', 'en')).toBeNull();
    expect(voiceCommand('  . ', 'en')).toBeNull();
  });
});

describe('routeFinalTranscript (Stage 1: an unclear reply never executes anything)', () => {
  const base = { autoSend: true, hasPending: true, language: 'en' as const };

  function route(text: string, overrides: Partial<Parameters<typeof routeFinalTranscript>[0]> = {}) {
    return routeFinalTranscript({ text, sendable: text.trim() || null, ...base, ...overrides });
  }

  it('confirms and cancels on an unambiguous phrase while proposals are on screen', () => {
    expect(route('yes, I confirm')).toEqual({ kind: 'command', command: 'confirm' });
    expect(route('cancel')).toEqual({ kind: 'command', command: 'cancel' });
    expect(route('sí, confirmo', { language: 'es' })).toEqual({ kind: 'command', command: 'confirm' });
  });

  it('SENDS every unclear, qualified or contradictory reply instead of executing it', () => {
    for (const text of [
      'yes but make it earlier',
      'yes cancel',
      'do not confirm',
      'confirm the second one only',
      'yes I confirm but move it to 5pm',
      'no idea what is on today',
    ]) {
      expect(route(text)).toEqual({ kind: 'send', text });
    }
  });

  it('never treats a bare yes as a command when nothing is proposed', () => {
    expect(route('yes, I confirm', { hasPending: false })).toEqual({ kind: 'send', text: 'yes, I confirm' });
  });

  it('keeps a dictation the user stopped to edit, and acts on nothing', () => {
    expect(route('yes, I confirm', { autoSend: false })).toEqual({ kind: 'edit', text: 'yes, I confirm' });
  });

  it('acts on nothing while the assistant is busy', () => {
    expect(route('yes, I confirm', { sendable: null })).toEqual({ kind: 'edit', text: 'yes, I confirm' });
  });

  it('follows the app language, so a Spanish phrase is a message in English', () => {
    expect(route('confirma')).toEqual({ kind: 'send', text: 'confirma' });
    expect(route('go ahead', { language: 'es' })).toEqual({ kind: 'send', text: 'go ahead' });
  });
});
