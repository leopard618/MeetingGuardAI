/**
 * Pure logic of the assistant's voice input (V2 Stage 1): locale mapping, error mapping and the
 * auto-send decision. No React / React Native imports; unit-tested.
 */
import type { Language } from '../../core/aiContract';

/** The microphone button's visible states. Problems surface as feedback, not as states. */
export type VoiceStatus = 'idle' | 'listening';

/** Something to tell the user about voice input (key under ai:voice.*). */
export const VOICE_PROBLEMS = ['denied', 'noSpeech', 'unavailable', 'error'] as const;
export type VoiceProblem = (typeof VOICE_PROBLEMS)[number];

/** BCP-47 tag for speech recognition and spoken replies (same pairs as the alert readout). */
export function voiceLocale(language: Language): string {
  return language === 'es' ? 'es-ES' : 'en-US';
}

/**
 * Maps a recognition error code to the feedback shown; null = stay silent (the user aborted,
 * or the platform reports a cancellation that needs no message).
 */
export function voiceProblemForError(code: string): VoiceProblem | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'no-speech':
      return 'noSpeech';
    case 'language-not-supported':
      return 'unavailable';
    default:
      return 'error';
  }
}

/**
 * A final transcript is sent by itself only when listening ended on its own (natural silence or
 * a final result) with usable text. Stopping early via the microphone button keeps the text in
 * the input for editing, and a failed session never auto-sends what was heard so far.
 */
export function shouldAutoSend(state: { endedByUser: boolean; failed: boolean }, text: string): boolean {
  return !state.endedByUser && !state.failed && text.trim().length > 0;
}

// -----------------------------------------------------------------------------------------------
// Voice confirmation of proposed actions (agreed with the client for V2 Stage 1)
// -----------------------------------------------------------------------------------------------

/**
 * Only whole-utterance matches count: "yes, confirm" confirms, but "yes but move it to 5pm" is
 * NOT a command and goes to the assistant as a normal message, so a spoken reply can never
 * execute something the user did not clearly approve. Matching follows the app language.
 */
// Apostrophes are stripped before matching, so phrases are stored without them ("thats right").
const CONFIRM_PHRASES: Record<Language, readonly string[]> = {
  en: [
    'yes', 'yes confirm', 'yes please', 'yes do it', 'yes thats right', 'yes that is right',
    'yeah', 'yeah thats right', 'yeah that is right', 'yep', 'sure', 'correct', 'exactly',
    'perfect', 'thats right', 'that is right', 'confirm', 'confirmed', 'confirm it', 'ok',
    'okay', 'go ahead', 'do it', 'sounds good', 'create it', 'book it', 'save it',
  ],
  es: [
    'si', 'sí', 'si confirma', 'sí confirma', 'si confirmo', 'sí confirmo', 'si claro',
    'sí claro', 'claro', 'correcto', 'exacto', 'perfecto', 'asi es', 'así es', 'eso es',
    'esta bien', 'está bien', 'confirma', 'confirmo', 'confirmar', 'confirmalo', 'confírmalo',
    'vale', 'ok', 'de acuerdo', 'adelante', 'hazlo', 'crealo', 'créalo',
  ],
};

const CANCEL_PHRASES: Record<Language, readonly string[]> = {
  en: [
    'no', 'nope', 'no cancel', 'no thanks', 'no dont', 'dont', 'cancel', 'cancel it',
    'cancel that', 'dismiss', 'dismiss it', 'stop', 'never mind', 'forget it', 'not now',
  ],
  es: [
    'no', 'no cancela', 'no gracias', 'mejor no', 'ahora no', 'no lo hagas', 'cancela',
    'cancelalo', 'cancélalo', 'cancelar', 'descartar', 'descarta', 'olvidalo', 'olvídalo',
    'dejalo', 'déjalo', 'para',
  ],
};

export type VoiceCommand = 'confirm' | 'cancel';

// Word-level fallback for compositions the phrase lists cannot enumerate ("yes i confirm",
// "ok confirm it now"). STRONG words carry the decision; FILLER words are allowed around them.
// Any word outside both sets means real content, and the utterance goes to the assistant.
const CONFIRM_STRONG: Record<Language, readonly string[]> = {
  en: ['yes', 'yeah', 'yep', 'confirm', 'confirmed', 'ok', 'okay', 'sure', 'correct', 'exactly', 'perfect'],
  es: ['si', 'sí', 'confirma', 'confirmo', 'confirmar', 'confirmalo', 'confírmalo', 'vale', 'ok', 'claro', 'correcto', 'exacto', 'perfecto'],
};
const CANCEL_STRONG: Record<Language, readonly string[]> = {
  en: ['no', 'nope', 'cancel', 'dismiss', 'stop', 'dont'],
  es: ['no', 'cancela', 'cancelar', 'cancelalo', 'cancélalo', 'descarta', 'descartar', 'olvidalo', 'olvídalo'],
};
const FILLER_WORDS: Record<Language, readonly string[]> = {
  en: ['i', 'it', 'that', 'is', 'im', 'please', 'now', 'the', 'this', 'one', 'all', 'them', 'both', 'do', 'lets', 'thanks'],
  es: ['lo', 'la', 'los', 'las', 'yo', 'que', 'es', 'esta', 'está', 'bien', 'asi', 'así', 'eso', 'por', 'favor', 'ahora', 'todo', 'todos', 'de', 'acuerdo', 'gracias'],
};

const MAX_COMMAND_WORDS = 5;

/**
 * The spoken command a final transcript amounts to while proposed actions are waiting, or null
 * when it is an ordinary message. Case and punctuation do not matter. A short utterance made
 * only of yes/confirm (or no/cancel) words plus harmless fillers counts; one that mixes both
 * directions, or contains any real content word, never does.
 */
export function voiceCommand(text: string, language: Language): VoiceCommand | null {
  const normalized = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[.,!?¡¿;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === '') return null;
  if (CONFIRM_PHRASES[language].includes(normalized)) return 'confirm';
  if (CANCEL_PHRASES[language].includes(normalized)) return 'cancel';

  const words = normalized.split(' ');
  if (words.length > MAX_COMMAND_WORDS) return null;
  const filler = FILLER_WORDS[language];
  const confirmStrong = words.some((word) => CONFIRM_STRONG[language].includes(word));
  const cancelStrong = words.some((word) => CANCEL_STRONG[language].includes(word));
  if (confirmStrong === cancelStrong) return null; // Neither, or contradictory ("yes cancel").
  const known = words.every(
    (word) => filler.includes(word) || CONFIRM_STRONG[language].includes(word) || CANCEL_STRONG[language].includes(word),
  );
  if (!known) return null;
  return confirmStrong ? 'confirm' : 'cancel';
}
