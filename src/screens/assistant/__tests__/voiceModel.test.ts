import { APP_LANGUAGES } from '../../../core/aiContract';
import { speechLanguageTag } from '../../../services/alerts/feedback';
import {
  VOICE_MAX_SESSION_MS,
  VOICE_SILENCE_AFTER_SPEECH_MS,
  VOICE_SILENCE_NO_SPEECH_MS,
  chooseTtsVoice,
  joinSegments,
  recognitionSupport,
  shouldAutoSend,
  voiceCommand,
  voiceLocale,
  voiceLocaleOverride,
  voiceProblemForError,
  routeFinalTranscript,
} from '../voiceModel';

describe('voiceLocale', () => {
  it('maps the app languages to the same tags as the alert readout', () => {
    expect(voiceLocale('en')).toBe('en-US');
    expect(voiceLocale('es')).toBe('es-ES');
    expect(voiceLocale('pt')).toBe('pt-BR');
    expect(voiceLocale('fr')).toBe('fr-FR');
    expect(voiceLocale('de')).toBe('de-DE');
    for (const language of APP_LANGUAGES) expect(voiceLocale(language)).toBe(speechLanguageTag(language));
  });

  it('uses the test-build override when one is set (Hindi and Mandarin verdicts)', () => {
    expect(voiceLocale('en', 'hi-IN')).toBe('hi-IN');
    expect(voiceLocale('en', null)).toBe('en-US');
  });
});

describe('voiceLocaleOverride', () => {
  it('accepts only the verdict test locales, in any spelling', () => {
    expect(voiceLocaleOverride('hi-IN')).toBe('hi-IN');
    expect(voiceLocaleOverride(' en_in ')).toBe('en-IN');
    expect(voiceLocaleOverride('zh-CN')).toBe('zh-CN');
    expect(voiceLocaleOverride('cmn-hans-cn')).toBe('cmn-Hans-CN');
  });

  it('ignores anything else, so a real build always speaks the UI language', () => {
    expect(voiceLocaleOverride(undefined)).toBeNull();
    expect(voiceLocaleOverride('')).toBeNull();
    expect(voiceLocaleOverride('pt-BR')).toBeNull();
    expect(voiceLocaleOverride('xx')).toBeNull();
    expect(voiceLocaleOverride(42)).toBeNull();
  });
});

describe('recognitionSupport', () => {
  it('is unknown when the platform lists nothing (Android 12 and lower)', () => {
    expect(recognitionSupport('pt-BR', { locales: [], installedLocales: [] })).toBe('unknown');
  });

  it('accepts the locale in either spelling, or another region of the language', () => {
    expect(recognitionSupport('pt-BR', { locales: ['en-US', 'pt_BR'], installedLocales: [] })).toBe('supported');
    expect(recognitionSupport('fr-FR', { locales: [], installedLocales: ['fr-CA'] })).toBe('supported');
    expect(recognitionSupport('de-DE', { locales: ['DE-de'], installedLocales: [] })).toBe('supported');
  });

  it('is unsupported when the language is missing from a non-empty list', () => {
    expect(recognitionSupport('de-DE', { locales: ['en-US', 'es-ES'], installedLocales: ['en-US'] })).toBe('unsupported');
  });
});

describe('chooseTtsVoice', () => {
  const voice = (identifier: string, language: string, quality = 'Default') => ({ identifier, language, quality });

  it('is unknown when the device lists no voices', () => {
    expect(chooseTtsVoice('pt-BR', [])).toEqual({ available: null, voice: null });
  });

  it('prefers the exact locale, then an enhanced voice', () => {
    const voices = [voice('pt-pt', 'pt-PT', 'Enhanced'), voice('pt-br', 'pt-BR'), voice('pt-br-hq', 'pt-BR', 'Enhanced')];
    expect(chooseTtsVoice('pt-BR', voices)).toEqual({ available: true, voice: 'pt-br-hq' });
  });

  it('leaves the voice to the platform when the exact locale has only default voices', () => {
    // iOS 17+ lists novelty voices (Bells, Zarvox) under every locale: never pick one blindly.
    const voices = [voice('bells', 'fr-FR'), voice('thomas', 'fr-FR'), voice('fr-ca', 'fr-CA', 'Enhanced')];
    expect(chooseTtsVoice('fr-FR', voices)).toEqual({ available: true, voice: null });
    expect(chooseTtsVoice('fr-FR', [...voices, voice('amelie-hq', 'fr-FR', 'Premium')])).toEqual({ available: true, voice: 'amelie-hq' });
  });

  it('falls back to another region of the same language', () => {
    expect(chooseTtsVoice('pt-BR', [voice('en', 'en-US'), voice('pt-pt', 'pt_PT')])).toEqual({ available: true, voice: 'pt-pt' });
  });

  it('reports a missing language instead of picking another language', () => {
    expect(chooseTtsVoice('de-DE', [voice('en', 'en-US'), voice('es', 'es-ES')])).toEqual({ available: false, voice: null });
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

  it('maps an unsupported language to its own message (a missing language pack, M12)', () => {
    expect(voiceProblemForError('language-not-supported')).toBe('languageUnavailable');
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

  it('confirms and cancels in Portuguese, French and German (M12)', () => {
    for (const text of ['sim', 'Sim, confirmo.', 'isso mesmo', 'pode criar', 'tá certo', 'sim, por favor', 'eu confirmo']) {
      expect(voiceCommand(text, 'pt')).toBe('confirm');
    }
    for (const text of ['não', 'Não, obrigado.', 'cancela isso', 'deixa pra lá', 'cancela tudo']) {
      expect(voiceCommand(text, 'pt')).toBe('cancel');
    }
    for (const text of ['oui', "Oui, d'accord.", "d'accord", "oui s'il vous plaît", "c'est bon", 'vas-y', 'je confirme', 'oui merci']) {
      expect(voiceCommand(text, 'fr')).toBe('confirm');
    }
    for (const text of ['non', 'Non merci.', 'annule', 'annule tout', 'laisse tomber']) {
      expect(voiceCommand(text, 'fr')).toBe('cancel');
    }
    for (const text of ['ja', 'Ja, bitte.', 'genau', 'in Ordnung', 'ich bestätige', 'ja bestätigen', 'Bestätigen.']) {
      expect(voiceCommand(text, 'de')).toBe('confirm');
    }
    for (const text of ['nein', 'Nein, danke.', 'abbrechen', 'alles abbrechen', 'lieber nicht']) {
      expect(voiceCommand(text, 'de')).toBe('cancel');
    }
  });

  it('never takes a qualified or negated answer as a command in pt, fr and de', () => {
    expect(voiceCommand('sim mas amanhã', 'pt')).toBeNull();
    expect(voiceCommand('sim, mas às 5', 'pt')).toBeNull();
    expect(voiceCommand('oui mais demain', 'fr')).toBeNull();
    expect(voiceCommand('oui mais à 17h', 'fr')).toBeNull();
    expect(voiceCommand('pas parfait', 'fr')).toBeNull();
    expect(voiceCommand('ja aber morgen', 'de')).toBeNull();
    expect(voiceCommand('ja aber um 5', 'de')).toBeNull();
    expect(voiceCommand('nicht richtig', 'de')).toBeNull();
    // Ambiguous words never decide: "si" is also "if", "para" is also "for", "doch" is a contradiction.
    expect(voiceCommand('si', 'fr')).toBeNull();
    expect(voiceCommand('para', 'pt')).toBeNull();
    expect(voiceCommand('doch', 'de')).toBeNull();
    // Contradictions stay null.
    expect(voiceCommand('sim não', 'pt')).toBeNull();
    expect(voiceCommand('oui non', 'fr')).toBeNull();
    expect(voiceCommand('ja nein', 'de')).toBeNull();
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
