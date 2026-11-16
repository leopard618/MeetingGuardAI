/**
 * Voice hooks of the assistant chat (V2 Stage 1).
 *
 * - useVoiceInput: microphone input via expo-speech-recognition. One tap starts listening (the
 *   permission is asked on first use); interim transcripts stream through onTranscript so the
 *   user always sees what was understood. Listening that ends by itself delivers the text with
 *   autoSend = true; tapping the microphone again stops early and keeps the text for editing
 *   (autoSend = false). Problems surface as ai:voice.* feedback keys, never as crashes.
 * - useSpokenReplies: speaks new assistant replies aloud with the same TTS engine as the alert
 *   readout. Only replies that arrive while the toggle is on are spoken (history never is).
 * - useSpokenReplySetting: the per-device "spoken replies" toggle (AsyncStorage; storage
 *   failures fall back to off without breaking the screen).
 *
 * M12 (pt-BR, fr, de): before listening, the recognizer's supported locales are checked where the
 * platform reports them (iOS, Android 13+), so a missing language pack shows a clear
 * 'languageUnavailable' message instead of a generic failure. Before speaking, the device's TTS
 * voices are checked once per language: with no voice for the language nothing is spoken (never
 * the reply in another language's voice) and onNoVoice fires once per language and app session.
 * A local test APK may force the speech locale (EXPO_PUBLIC_VOICE_LOCALE_TEST, Hindi and Mandarin
 * verdicts) while the UI stays English.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { AppLanguage } from '../../core/aiContract';
import { createLogger } from '../../core/logger';
import type { ChatMessage } from '../../services/ai/types';
import {
  VOICE_MAX_SESSION_MS,
  VOICE_SILENCE_AFTER_SPEECH_MS,
  VOICE_SILENCE_NO_SPEECH_MS,
  chooseTtsVoice,
  joinSegments,
  recognitionSupport,
  shouldAutoSend,
  voiceLocale,
  voiceLocaleOverride,
  voiceProblemForError,
  type VoiceProblem,
  type VoiceStatus,
} from './voiceModel';

const log = createLogger('assistant.voice');

const SPOKEN_REPLIES_KEY = 'mg:assistant.spokenReplies';

/** Test-build speech locale (app.config.js extra.voiceLocaleTest), or null in every real build. */
function readVoiceLocaleOverride(): string | null {
  try {
    const extra = Constants.expoConfig?.extra as { voiceLocaleTest?: unknown } | undefined;
    return voiceLocaleOverride(extra?.voiceLocaleTest);
  } catch {
    return null;
  }
}
const VOICE_LOCALE_OVERRIDE = readVoiceLocaleOverride();

/** The speech locale for listening and speaking in `language` (the test override wins). */
function speechTag(language: AppLanguage): string {
  return voiceLocale(language, VOICE_LOCALE_OVERRIDE);
}

/** Give up on the supported-locales lookup after this long and just try to listen. */
const LOCALE_CHECK_TIMEOUT_MS = 1500;
/** Tags the recognizer confirmed (a missing pack is asked again: the user may install it). */
const recognitionConfirmed = new Set<string>();

/**
 * Whether listening in `tag` should start. Only a definite 'unsupported' stops it; an empty list
 * (Android 12 and lower), an error or a slow lookup mean unknown, and the recognizer is tried.
 */
async function canListenIn(tag: string): Promise<boolean> {
  if (recognitionConfirmed.has(tag)) return true;
  if (typeof ExpoSpeechRecognitionModule.getSupportedLocales !== 'function') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOCALE_CHECK_TIMEOUT_MS);
  });
  try {
    const lists = await Promise.race([ExpoSpeechRecognitionModule.getSupportedLocales({}), timeout]);
    if (!lists) return true;
    const support = recognitionSupport(tag, {
      locales: Array.isArray(lists.locales) ? lists.locales : [],
      installedLocales: Array.isArray(lists.installedLocales) ? lists.installedLocales : [],
    });
    if (support === 'supported') recognitionConfirmed.add(tag);
    if (support !== 'unsupported') return true;
    if (Platform.OS === 'android') {
      // Without a service package this lists the ON-DEVICE recognizer only, while start() uses the
      // default (often online) service, which may well support the language. A hint only: try,
      // and the recognizer's own 'language-not-supported' error maps to languageUnavailable.
      log.info('voice locale not listed by the on-device recognizer, trying anyway', { tag });
      return true;
    }
    if (VOICE_LOCALE_OVERRIDE !== null) {
      // Verdict builds: the device may name the locale differently ('cmn-Hans-CN'); try anyway.
      log.warn('voice test locale not listed by the recognizer', { tag });
      return true;
    }
    return false;
  } catch (error) {
    log.warn('voice supported locales lookup failed', error);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Continuous recognition (the app times the pause itself, so a thinking break never cuts the
 * user off) needs Android 13+; iOS always supports it. Older Androids keep the platform's own
 * end-of-speech detection, softened by the intent extras passed at start().
 */
function supportsContinuous(): boolean {
  if (Platform.OS === 'ios') return true;
  const version = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  return Number.isFinite(version) && version >= 33;
}

export interface VoiceInputHandlers {
  language: AppLanguage;
  /** Live transcript while listening (interim and final). */
  onTranscript(text: string): void;
  /** Listening finished. autoSend = true only when it ended by itself with usable text. */
  onFinal(text: string, meta: { autoSend: boolean }): void;
  /** Something to tell the user (key under ai:voice.*). */
  onProblem(problem: VoiceProblem): void;
}

export interface VoiceInput {
  status: VoiceStatus;
  /** Starts listening, or stops early (keeping the text for editing) while listening. */
  toggle(): void;
}

export function useVoiceInput(handlers: VoiceInputHandlers): VoiceInput {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  // Refs, not state: event handlers fire between renders and must see the latest values.
  // Written in an effect, never during render: the handlers only ever fire after a commit.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const active = useRef(false);
  const transcript = useRef('');
  /** Android continuous mode: finalized segments so far (iOS streams the whole transcript). */
  const committed = useRef('');
  const endedByUser = useRef(false);
  const failed = useRef(false);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = (): void => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    silenceTimer.current = null;
    sessionTimer.current = null;
  };

  /** Natural finish: stop the recognizer; the final result + end events deliver the outcome. */
  const finishListening = (): void => {
    if (!active.current) return;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error) {
      log.warn('voice stop failed', error);
    }
  };

  const armSilenceTimer = (ms: number): void => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(finishListening, ms);
  };

  useSpeechRecognitionEvent('start', () => {
    if (!active.current) return;
    armSilenceTimer(VOICE_SILENCE_NO_SPEECH_MS);
    sessionTimer.current = setTimeout(finishListening, VOICE_MAX_SESSION_MS);
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!active.current) return;
    const text = event.results[0]?.transcript ?? '';
    if (Platform.OS === 'android') {
      // Android continuous sessions emit one result per segment; keep the finalized ones.
      transcript.current = joinSegments(committed.current, text);
      if (event.isFinal) committed.current = transcript.current;
    } else {
      // iOS streams the cumulative transcript of the whole session.
      transcript.current = text;
    }
    latest.current.onTranscript(transcript.current);
    armSilenceTimer(VOICE_SILENCE_AFTER_SPEECH_MS);
  });

  useSpeechRecognitionEvent('nomatch', () => {
    if (!active.current) return;
    failed.current = true;
    latest.current.onProblem('noSpeech');
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!active.current) return;
    failed.current = true;
    const problem = voiceProblemForError(event.error);
    if (problem) latest.current.onProblem(problem);
    if (problem === 'error') log.warn('voice recognition error', { code: event.error });
  });

  // Always the last event of a session, after any error; delivers the outcome exactly once.
  useSpeechRecognitionEvent('end', () => {
    if (!active.current) return;
    clearTimers();
    active.current = false;
    setStatus('idle');
    const text = transcript.current;
    const autoSend = shouldAutoSend({ endedByUser: endedByUser.current, failed: failed.current }, text);
    transcript.current = '';
    committed.current = '';
    endedByUser.current = false;
    failed.current = false;
    latest.current.onFinal(text, { autoSend });
  });

  // Leaving the screen mid-listening aborts without delivering anything.
  useEffect(
    () => () => {
      clearTimers();
      if (!active.current) return;
      active.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch (error) {
        log.warn('voice abort failed', error);
      }
    },
    [],
  );

  const toggle = (): void => {
    if (active.current) {
      endedByUser.current = true;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (error) {
        log.warn('voice stop failed', error);
      }
      return;
    }
    void (async () => {
      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          latest.current.onProblem('unavailable');
          return;
        }
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          latest.current.onProblem('denied');
          return;
        }
        const lang = speechTag(latest.current.language);
        if (!(await canListenIn(lang))) {
          latest.current.onProblem('languageUnavailable');
          return;
        }
        transcript.current = '';
        committed.current = '';
        endedByUser.current = false;
        failed.current = false;
        active.current = true;
        setStatus('listening');
        ExpoSpeechRecognitionModule.start({
          lang,
          interimResults: true,
          // The app times the end of speech itself (silence timers above), so a thinking pause
          // never cuts dictation off. Androids without continuous support keep the platform
          // behavior, softened by the silence-length extras below.
          continuous: supportsContinuous(),
          addsPunctuation: true,
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: VOICE_SILENCE_AFTER_SPEECH_MS,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: VOICE_SILENCE_AFTER_SPEECH_MS,
          },
        });
      } catch (error) {
        active.current = false;
        setStatus('idle');
        log.warn('voice start failed', error);
        latest.current.onProblem('error');
      }
    })();
  };

  return { status, toggle };
}

/** Bumped by every stop, so a reply still waiting for the voice lookup is never spoken late. */
let speechGeneration = 0;

function stopSpeaking(): void {
  speechGeneration += 1;
  try {
    void Speech.stop();
  } catch (error) {
    log.warn('speech stop failed', error);
  }
}

type TtsChoice = ReturnType<typeof chooseTtsVoice>;
/** One voices lookup per speech tag and app session (an unknown answer is asked again). */
const ttsChoices = new Map<string, Promise<TtsChoice>>();
/** Tags whose "no voice" hint was already shown (once per language and app session). */
const noVoiceHinted = new Set<string>();

function ttsChoiceFor(tag: string): Promise<TtsChoice> {
  const cached = ttsChoices.get(tag);
  if (cached) return cached;
  const lookup = (async (): Promise<TtsChoice> => {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      return chooseTtsVoice(tag, Array.isArray(voices) ? voices : []);
    } catch (error) {
      log.warn('speech voices lookup failed', error);
      return { available: null, voice: null };
    }
  })();
  ttsChoices.set(tag, lookup);
  void lookup.then((choice) => {
    if (choice.available === null) ttsChoices.delete(tag);
  });
  return lookup;
}

export interface SpeakOptions {
  /** No TTS voice speaks the language on this device; called once per language and session. */
  onNoVoice?: () => void;
}

/**
 * Speaks `text` in the language's own voice. With no voice for the language nothing is spoken
 * (a reply in another language's voice is worse than silence) and onNoVoice fires once. On iOS
 * the chosen voice is passed explicitly, so a device with only another region's voice (pt-PT for
 * pt-BR) still speaks Portuguese rather than falling back to the system language.
 */
async function speakInLanguage(text: string, language: AppLanguage, options: SpeakOptions, what: string): Promise<void> {
  stopSpeaking();
  const generation = speechGeneration;
  const tag = speechTag(language);
  const choice = await ttsChoiceFor(tag);
  if (generation !== speechGeneration) return;
  if (choice.available === false) {
    if (!noVoiceHinted.has(tag)) {
      noVoiceHinted.add(tag);
      log.info('no speech voice for the language', { tag });
      options.onNoVoice?.();
    }
    return;
  }
  try {
    Speech.speak(text, {
      language: tag,
      rate: 1.0,
      pitch: 1.0,
      ...(Platform.OS === 'ios' && choice.voice ? { voice: choice.voice } : {}),
      onError: (error: Error) => log.warn(`${what} failed`, error),
    });
  } catch (error) {
    log.warn(`${what} failed`, error);
  }
}

/** Speaks one short acknowledgement (voice confirmation results); failures only log. */
export function speakAloud(text: string, language: AppLanguage, options: SpeakOptions = {}): void {
  void speakInLanguage(text, language, options, 'speak');
}

export function useSpokenReplies({
  messages,
  language,
  enabled,
  onNoVoice,
}: {
  messages: readonly ChatMessage[];
  language: AppLanguage;
  enabled: boolean;
  onNoVoice?: () => void;
}): void {
  const seenId = useRef<string | null>(null);
  const wasEnabled = useRef(false);
  // A ref, so a new callback identity on every render never re-runs the speaking effect.
  const noVoice = useRef(onNoVoice);
  useEffect(() => {
    noVoice.current = onNoVoice;
  });

  useEffect(() => {
    let lastAssistant: ChatMessage | null = null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message && message.role === 'assistant') {
        lastAssistant = message;
        break;
      }
    }

    if (!enabled) {
      if (wasEnabled.current) stopSpeaking();
      wasEnabled.current = false;
      seenId.current = lastAssistant?.id ?? null;
      return;
    }
    if (!wasEnabled.current) {
      // The toggle just turned on: the existing conversation counts as read, never spoken.
      wasEnabled.current = true;
      seenId.current = lastAssistant?.id ?? null;
      return;
    }
    if (!lastAssistant || lastAssistant.id === seenId.current) return;
    seenId.current = lastAssistant.id;
    const text = lastAssistant.content.trim();
    if (!text) return;
    void speakInLanguage(text, language, { onNoVoice: () => noVoice.current?.() }, 'spoken reply');
  }, [messages, enabled, language]);

  useEffect(() => () => stopSpeaking(), []);
}

export function useSpokenReplySetting(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SPOKEN_REPLIES_KEY)
      .then((value) => {
        if (!cancelled && value === '1') setEnabled(true);
      })
      .catch((error: unknown) => log.warn('spoken replies setting read failed', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (value: boolean): void => {
    setEnabled(value);
    AsyncStorage.setItem(SPOKEN_REPLIES_KEY, value ? '1' : '0').catch((error: unknown) =>
      log.warn('spoken replies setting write failed', error),
    );
  };

  return [enabled, update];
}
