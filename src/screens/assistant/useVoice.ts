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
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';

import type { Language } from '../../core/aiContract';
import { createLogger } from '../../core/logger';
import type { ChatMessage } from '../../services/ai/types';
import { shouldAutoSend, voiceLocale, voiceProblemForError, type VoiceProblem, type VoiceStatus } from './voiceModel';

const log = createLogger('assistant.voice');

const SPOKEN_REPLIES_KEY = 'mg:assistant.spokenReplies';

export interface VoiceInputHandlers {
  language: Language;
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
  const latest = useRef(handlers);
  latest.current = handlers;
  const active = useRef(false);
  const transcript = useRef('');
  const endedByUser = useRef(false);
  const failed = useRef(false);

  useSpeechRecognitionEvent('result', (event) => {
    if (!active.current) return;
    const text = event.results[0]?.transcript ?? '';
    transcript.current = text;
    latest.current.onTranscript(text);
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
    active.current = false;
    setStatus('idle');
    const text = transcript.current;
    const autoSend = shouldAutoSend({ endedByUser: endedByUser.current, failed: failed.current }, text);
    transcript.current = '';
    endedByUser.current = false;
    failed.current = false;
    latest.current.onFinal(text, { autoSend });
  });

  // Leaving the screen mid-listening aborts without delivering anything.
  useEffect(
    () => () => {
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
        transcript.current = '';
        endedByUser.current = false;
        failed.current = false;
        active.current = true;
        setStatus('listening');
        ExpoSpeechRecognitionModule.start({
          lang: voiceLocale(latest.current.language),
          interimResults: true,
          continuous: false,
          addsPunctuation: true,
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

function stopSpeaking(): void {
  try {
    void Speech.stop();
  } catch (error) {
    log.warn('speech stop failed', error);
  }
}

/** Speaks one short acknowledgement (voice confirmation results); failures only log. */
export function speakAloud(text: string, language: Language): void {
  stopSpeaking();
  try {
    Speech.speak(text, { language: voiceLocale(language), rate: 1.0, pitch: 1.0 });
  } catch (error) {
    log.warn('speak failed', error);
  }
}

export function useSpokenReplies({
  messages,
  language,
  enabled,
}: {
  messages: readonly ChatMessage[];
  language: Language;
  enabled: boolean;
}): void {
  const seenId = useRef<string | null>(null);
  const wasEnabled = useRef(false);

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
    stopSpeaking();
    try {
      Speech.speak(text, { language: voiceLocale(language), rate: 1.0, pitch: 1.0 });
    } catch (error) {
      log.warn('spoken reply failed', error);
    }
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
