import { shouldAutoSend, voiceLocale, voiceProblemForError } from '../voiceModel';

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
