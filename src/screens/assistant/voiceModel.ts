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
const CONFIRM_PHRASES: Record<Language, readonly string[]> = {
  en: ['yes', 'yes confirm', 'yes please', 'confirm', 'confirmed', 'ok', 'okay', 'go ahead', 'do it', 'sounds good'],
  es: ['si', 'sí', 'si confirma', 'sí confirma', 'si confirmo', 'sí confirmo', 'confirma', 'confirmo', 'confirmar', 'vale', 'ok', 'de acuerdo', 'adelante', 'hazlo'],
};

const CANCEL_PHRASES: Record<Language, readonly string[]> = {
  en: ['no', 'no cancel', 'cancel', 'cancel it', 'dismiss', 'stop', 'never mind', 'forget it'],
  es: ['no', 'no cancela', 'cancela', 'cancelalo', 'cancélalo', 'cancelar', 'descartar', 'descarta', 'olvidalo', 'olvídalo', 'para'],
};

export type VoiceCommand = 'confirm' | 'cancel';

/**
 * The spoken command a final transcript amounts to while proposed actions are waiting, or null
 * when it is an ordinary message. Case and punctuation do not matter; anything longer than the
 * known phrases is never treated as a command.
 */
export function voiceCommand(text: string, language: Language): VoiceCommand | null {
  const normalized = text
    .toLowerCase()
    .replace(/[.,!?¡¿;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === '') return null;
  if (CONFIRM_PHRASES[language].includes(normalized)) return 'confirm';
  if (CANCEL_PHRASES[language].includes(normalized)) return 'cancel';
  return null;
}
