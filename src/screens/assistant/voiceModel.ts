/**
 * Pure logic of the assistant's voice input (V2 Stage 1): locale mapping, error mapping and the
 * auto-send decision. No React / React Native imports; unit-tested.
 *
 * M12: every UI language (en, es, pt-BR, fr, de) speaks and listens in its own locale, from the
 * shared table in src/i18n/locale.ts (the alert voice readout uses the same one). A test build
 * can override the speech locale (Hindi and Mandarin verdicts) while the UI stays English.
 */
import type { AppLanguage } from '../../core/aiContract';
import { speechLocale } from '../../i18n/locale';

/** The microphone button's visible states. Problems surface as feedback, not as states. */
export type VoiceStatus = 'idle' | 'listening';

/** Something to tell the user about voice input (key under ai:voice.*). */
// 'languageUnavailable' (M12): the recognizer has no model for the language (a missing pack).
export const VOICE_PROBLEMS = ['denied', 'noSpeech', 'unavailable', 'languageUnavailable', 'error'] as const;
export type VoiceProblem = (typeof VOICE_PROBLEMS)[number];

/**
 * BCP-47 tag for speech recognition and spoken replies: the shared table (same tags as the alert
 * readout), or the test-build override when one is set (see voiceLocaleOverride).
 */
export function voiceLocale(language: AppLanguage, override: string | null = null): string {
  return override ?? speechLocale(language);
}

/**
 * Speech locales a TEST build may force (Hindi and Mandarin verdicts, M12). They are not app
 * languages: the UI, the voice commands and the server reply stay English. Android Google may
 * list Mandarin as 'cmn-Hans-CN' rather than 'zh-CN'; getSupportedLocales on the device says.
 */
export const VOICE_TEST_LOCALES = ['hi-IN', 'en-IN', 'zh-CN', 'cmn-Hans-CN'] as const;

/**
 * The override from the build flag (app.config.js extra.voiceLocaleTest, set from
 * EXPO_PUBLIC_VOICE_LOCALE_TEST only in local test APKs), or null. Anything outside
 * VOICE_TEST_LOCALES is ignored, so a typo can never silence voice input in a real build.
 */
export function voiceLocaleOverride(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const wanted = normalizeTag(raw.trim());
  return VOICE_TEST_LOCALES.find((tag) => normalizeTag(tag) === wanted) ?? null;
}

/** 'pt_BR' and 'PT-br' compare equal to 'pt-BR'. */
function normalizeTag(tag: string): string {
  return tag.replace(/_/g, '-').toLowerCase();
}

function primarySubtag(tag: string): string {
  return normalizeTag(tag).split('-')[0] ?? '';
}

/**
 * Whether the recognizer can listen in `tag`, from getSupportedLocales. Empty lists mean the
 * platform cannot say (Android 12 and lower, other recognizer services): 'unknown', and the app
 * tries anyway. A locale of the same language counts ('pt_BR' or 'pt-PT' for 'pt-BR'): the
 * recognizer reports a real mismatch itself as 'language-not-supported'.
 */
export function recognitionSupport(
  tag: string,
  lists: { locales: readonly string[]; installedLocales: readonly string[] },
): 'supported' | 'unsupported' | 'unknown' {
  const all = [...lists.locales, ...lists.installedLocales];
  if (all.length === 0) return 'unknown';
  const primary = primarySubtag(tag);
  return all.some((locale) => primarySubtag(locale) === primary) ? 'supported' : 'unsupported';
}

/** The fields of an expo-speech Voice that matter here. */
export interface TtsVoiceInfo {
  identifier: string;
  language: string;
  quality: string;
}

/**
 * Text-to-speech voice for `tag`: available = null when the device listed no voices at all
 * (unknown: speak with the language tag only), false when no voice speaks the language (then the
 * app shows a hint instead of reading the reply in another language's voice). `voice` is set only
 * when the system default for the tag would be worse: an Enhanced or Premium voice of the exact
 * locale, or, when the exact locale has no voice at all, a voice of the same language in another
 * region (pt-PT for pt-BR). Otherwise null, so the platform picks its default voice (iOS 17+
 * also lists novelty voices such as Bells or Zarvox under every locale; never pick one blindly).
 */
export function chooseTtsVoice(
  tag: string,
  voices: readonly TtsVoiceInfo[],
): { available: boolean | null; voice: string | null } {
  if (voices.length === 0) return { available: null, voice: null };
  const exact = normalizeTag(tag);
  const primary = primarySubtag(tag);
  const better = (voice: TtsVoiceInfo): boolean => voice.quality === 'Enhanced' || voice.quality === 'Premium';
  const exactVoices = voices.filter((voice) => normalizeTag(voice.language) === exact);
  if (exactVoices.length > 0) {
    const enhanced = exactVoices.find(better);
    return { available: true, voice: enhanced ? enhanced.identifier : null };
  }
  const sameLanguage = voices.filter((voice) => primarySubtag(voice.language) === primary);
  const fallback = sameLanguage.find(better) ?? sameLanguage[0];
  return fallback ? { available: true, voice: fallback.identifier } : { available: false, voice: null };
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
      return 'languageUnavailable';
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
// Listening session timing (client feedback: the platform's own silence detection cut users off
// mid-dictation, so listening is continuous and the app times the pause itself)
// -----------------------------------------------------------------------------------------------

/** Pause allowed between words once something was heard; then listening ends and the text sends. */
export const VOICE_SILENCE_AFTER_SPEECH_MS = 3000;
/** Give up when nothing was heard at all. */
export const VOICE_SILENCE_NO_SPEECH_MS = 8000;
/** Hard cap on one listening session. */
export const VOICE_MAX_SESSION_MS = 60_000;

/** Android continuous mode delivers finalized segments one by one; join them with single spaces. */
export function joinSegments(committed: string, segment: string): string {
  const head = committed.trim();
  const tail = segment.trim();
  if (head === '') return tail;
  if (tail === '') return head;
  return `${head} ${tail}`;
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
// M12 (pt-BR, fr, de): the same rule. Ambiguous words never go into the STRONG lists: German
// "doch", French "si" (also "if"), Portuguese "para" (also "for"), German "los". Negations
// ("nicht", "pas") are never fillers, so "nicht richtig" or "pas parfait" is never a yes.
const CONFIRM_PHRASES: Record<AppLanguage, readonly string[]> = {
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
  pt: [
    'sim', 'sim confirma', 'sim confirmo', 'sim por favor', 'sim pode', 'isso', 'isso mesmo',
    'certo', 'esta certo', 'está certo', 'ta certo', 'tá certo', 'correto', 'exato', 'exatamente',
    'perfeito', 'claro', 'confirma', 'confirmo', 'confirmar', 'pode', 'pode ser', 'pode criar',
    'de acordo', 'combinado', 'ok', 'okay',
  ],
  fr: [
    'oui', 'oui merci', 'oui sil vous plait', 'oui sil vous plaît', 'ouais', 'daccord', 'ok', 'okay',
    'parfait', 'exact', 'exactement', 'correct', 'cest bon', 'cest ça', 'cest ca', 'cest parfait',
    'confirme', 'je confirme', 'confirmer', 'vas-y', 'vas y', 'allez-y', 'allez y', 'bien sûr',
    'bien sur', 'très bien', 'tres bien', 'entendu', 'valide',
  ],
  de: [
    'ja', 'ja bitte', 'ja genau', 'ja bestätigen', 'genau', 'richtig', 'stimmt', 'passt',
    'perfekt', 'klar', 'gerne', 'okay', 'ok', 'in ordnung', 'einverstanden', 'bestätigen',
    'bestätige', 'ich bestätige', 'mach das', 'mach es', 'los',
  ],
};

const CANCEL_PHRASES: Record<AppLanguage, readonly string[]> = {
  en: [
    'no', 'nope', 'no cancel', 'no thanks', 'no dont', 'dont', 'cancel', 'cancel it',
    'cancel that', 'dismiss', 'dismiss it', 'stop', 'never mind', 'forget it', 'not now',
  ],
  es: [
    'no', 'no cancela', 'no gracias', 'mejor no', 'ahora no', 'no lo hagas', 'cancela',
    'cancelalo', 'cancélalo', 'cancelar', 'descartar', 'descarta', 'olvidalo', 'olvídalo',
    'dejalo', 'déjalo', 'para',
  ],
  pt: [
    'não', 'nao', 'não obrigado', 'nao obrigado', 'cancela', 'cancelar', 'cancele', 'descarta',
    'descartar', 'esquece', 'esqueça', 'esqueca', 'deixa', 'deixa pra lá', 'deixa pra la',
    'agora não', 'agora nao', 'melhor não', 'melhor nao', 'pare',
  ],
  fr: [
    'non', 'non merci', 'annule', 'annuler', 'annule ça', 'annule ca', 'laisse tomber', 'oublie',
    'oublie ça', 'oublie ca', 'pas maintenant', 'stop', 'arrête', 'arrete', 'rejette',
  ],
  de: [
    'nein', 'nein danke', 'abbrechen', 'brich ab', 'stopp', 'stop', 'vergiss es', 'lass es',
    'lieber nicht', 'jetzt nicht', 'verwerfen',
  ],
};

export type VoiceCommand = 'confirm' | 'cancel';

// Word-level fallback for compositions the phrase lists cannot enumerate ("yes i confirm",
// "ok confirm it now"). STRONG words carry the decision; FILLER words are allowed around them.
// Any word outside both sets means real content, and the utterance goes to the assistant.
const CONFIRM_STRONG: Record<AppLanguage, readonly string[]> = {
  en: ['yes', 'yeah', 'yep', 'confirm', 'confirmed', 'ok', 'okay', 'sure', 'correct', 'exactly', 'perfect'],
  es: ['si', 'sí', 'confirma', 'confirmo', 'confirmar', 'confirmalo', 'confírmalo', 'vale', 'ok', 'claro', 'correcto', 'exacto', 'perfecto'],
  // "isso" stays a filler ("cancela isso" must cancel).
  pt: ['sim', 'confirma', 'confirmo', 'confirmar', 'certo', 'correto', 'exato', 'exatamente', 'perfeito', 'claro', 'pode', 'combinado', 'ok', 'okay'],
  fr: ['oui', 'ouais', 'daccord', 'confirme', 'confirmer', 'ok', 'okay', 'parfait', 'exact', 'exactement', 'correct', 'entendu', 'valide'],
  de: ['ja', 'genau', 'richtig', 'stimmt', 'passt', 'perfekt', 'klar', 'gerne', 'einverstanden', 'bestätigen', 'bestätige', 'ok', 'okay'],
};
const CANCEL_STRONG: Record<AppLanguage, readonly string[]> = {
  en: ['no', 'nope', 'cancel', 'dismiss', 'stop', 'dont'],
  es: ['no', 'cancela', 'cancelar', 'cancelalo', 'cancélalo', 'descarta', 'descartar', 'olvidalo', 'olvídalo'],
  pt: ['não', 'nao', 'cancela', 'cancelar', 'cancele', 'descarta', 'descartar'],
  fr: ['non', 'annule', 'annuler'],
  de: ['nein', 'abbrechen', 'stopp', 'verwerfen'],
};
const FILLER_WORDS: Record<AppLanguage, readonly string[]> = {
  en: ['i', 'it', 'that', 'is', 'im', 'please', 'now', 'the', 'this', 'one', 'all', 'them', 'both', 'do', 'lets', 'thanks'],
  es: ['lo', 'la', 'los', 'las', 'yo', 'que', 'es', 'esta', 'está', 'bien', 'asi', 'así', 'eso', 'por', 'favor', 'ahora', 'todo', 'todos', 'de', 'acuerdo', 'gracias'],
  pt: ['eu', 'o', 'a', 'isso', 'por', 'favor', 'agora', 'tudo', 'todos', 'obrigado', 'obrigada'],
  fr: ['je', 'le', 'la', 'les', 'ça', 'ca', 'tout', 'tous', 'maintenant', 'merci', 'sil', 'vous', 'plait', 'plaît'],
  de: ['ich', 'es', 'das', 'bitte', 'jetzt', 'alles', 'alle', 'danke'],
};

const MAX_COMMAND_WORDS = 5;

/**
 * The spoken command a final transcript amounts to while proposed actions are waiting, or null
 * when it is an ordinary message. Case and punctuation do not matter. A short utterance made
 * only of yes/confirm (or no/cancel) words plus harmless fillers counts; one that mixes both
 * directions, or contains any real content word, never does.
 */
export function voiceCommand(text: string, language: AppLanguage): VoiceCommand | null {
  const normalized = text
    .normalize('NFC') // Composed accents, so "não" and "bestätigen" match the lists.
    .toLowerCase()
    .replace(/['\u2019]/g, '')
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

/**
 * What a finished dictation should do. Extracted from the screen so the Stage 1 acceptance
 * property ("an unclear reply never executes anything") is a pure, tested decision rather than
 * inline screen code:
 *
 * - 'edit' keeps the text in the input and acts on nothing. This is a dictation the user stopped
 *   with the mic button, or one that arrived while the assistant was busy.
 * - 'command' only ever happens with proposals ON SCREEN and an unambiguous phrase. Without
 *   pending proposals, "yes" is just a message.
 * - 'send' is everything else, including every unclear, partial or qualified answer.
 */
export type VoiceRoute =
  | { kind: 'edit'; text: string }
  | { kind: 'command'; command: VoiceCommand }
  | { kind: 'send'; text: string };

export function routeFinalTranscript(input: {
  text: string;
  /** chatModel.sendableText: null while the assistant is busy or the text is blank. */
  sendable: string | null;
  /** False when the user stopped the dictation themselves, to edit it. */
  autoSend: boolean;
  hasPending: boolean;
  language: AppLanguage;
}): VoiceRoute {
  if (!input.autoSend || input.sendable === null) return { kind: 'edit', text: input.text };
  if (input.hasPending) {
    const command = voiceCommand(input.sendable, input.language);
    if (command !== null) return { kind: 'command', command };
  }
  return { kind: 'send', text: input.sendable };
}
