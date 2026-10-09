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
