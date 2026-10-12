import { shouldAutoSend, voiceCommand, voiceLocale, voiceProblemForError } from '../voiceModel';

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

describe('voiceCommand', () => {
  it('recognizes explicit confirmations in both languages', () => {
    expect(voiceCommand('yes, confirm', 'en')).toBe('confirm');
    expect(voiceCommand('Confirm', 'en')).toBe('confirm');
    expect(voiceCommand('OK!', 'en')).toBe('confirm');
    expect(voiceCommand('sí, confirma', 'es')).toBe('confirm');
    expect(voiceCommand('Vale', 'es')).toBe('confirm');
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
