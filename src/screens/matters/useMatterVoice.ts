/**
 * The assistant's voice on the matters screens (A3; docs/v1/ARCHITECTURE.md section 36): dictation
 * (the assistant chat's useVoiceInput, EN and ES), spoken answers that can be interrupted, and the
 * natural voice for the demo.
 *
 * - speak(text): the device voice (expo-speech) says the answer. A3 feedback: the
 *   microphone is OFF while it speaks, so the phone's speaker can never write the assistant's own
 *   words into the box. A tap on Speak (toggleMic) stops the voice and starts listening at once;
 *   a tap on stopSpeaking() only stops the voice.
 * - natural: the same answer from matterSpeak (OpenAI text-to-speech, MATTERS_NATURAL_VOICE, demo
 *   only), played with expo-audio from a cache file; it is stopped the same way.
 * Nothing the user says is logged.
 */
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';

import type { Language } from '../../core/aiContract';
import { createLogger } from '../../core/logger';
import { matterService } from '../../services/matters';
import { useVoiceInput } from '../assistant/useVoice';
import { voiceLocale, type VoiceProblem } from '../assistant/voiceModel';
import { base64ToBytes } from './matterVoice';

const log = createLogger('matters.voice');

export interface MatterVoiceHandlers {
  language: Language;
  onTranscript(text: string): void;
  onFinal(text: string, meta: { autoSend: boolean }): void;
  onProblem(problem: VoiceProblem): void;
  /** The natural voice could not speak (it is off, or failed): the device voice spoke instead. */
  onNaturalFailed?(): void;
}

export interface MatterVoice {
  listening: boolean;
  speaking: boolean;
  /** Starts dictation, or stops it early (the text stays for editing). */
  toggleMic(): void;
  speak(text: string, options?: { natural?: boolean; matterId?: string }): void;
  stopSpeaking(): void;
}

export function useMatterVoice(handlers: MatterVoiceHandlers): MatterVoice {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const player = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);

  const finished = (): void => {
    speakingRef.current = false;
    setSpeaking(false);
  };

  const stopSpeaking = (): void => {
    generation.current += 1;
    try {
      void Speech.stop();
    } catch (error) {
      log.warn('speech stop failed', error);
    }
    if (player.current) {
      try {
        player.current.pause();
        player.current.remove();
      } catch (error) {
        log.warn('player stop failed', error);
      }
      player.current = null;
    }
    finished();
  };

  const input = useVoiceInput({
    language: handlers.language,
    onTranscript: (text) => {
      // the microphone only runs while the assistant is quiet (see speak)
      if (!speakingRef.current) latest.current.onTranscript(text.trim());
    },
    onFinal: (text, meta) => {
      const heard = text.trim();
      if (heard === '' || speakingRef.current) return;
      latest.current.onFinal(heard, meta);
    },
    onProblem: (problem) => latest.current.onProblem(problem),
  });

  const speakDevice = (text: string, mine: number): void => {
    try {
      Speech.speak(text, {
        language: voiceLocale(latest.current.language),
        rate: 1.0,
        pitch: 1.0,
        onDone: () => {
          if (mine === generation.current) finished();
        },
        onStopped: () => {
          if (mine === generation.current) finished();
        },
        onError: (error: Error) => {
          log.warn('speech failed', error);
          if (mine === generation.current) finished();
        },
      });
    } catch (error) {
      log.warn('speech failed', error);
      finished();
    }
  };

  const speakNatural = async (text: string, mine: number, matterId: string | undefined): Promise<void> => {
    try {
      const audio = await matterService.speak({ text, language: latest.current.language, ...(matterId ? { matterId } : {}) });
      if (mine !== generation.current) return;
      const file = new File(Paths.cache, 'matter-answer.mp3');
      if (file.exists) file.delete();
      file.create();
      file.write(base64ToBytes(audio.audioBase64));
      const next = createAudioPlayer({ uri: file.uri });
      player.current = next;
      next.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish && mine === generation.current) {
          next.remove();
          player.current = null;
          finished();
        }
      });
      next.play();
    } catch (error) {
      log.warn('natural voice failed', error);
      if (mine !== generation.current) return;
      latest.current.onNaturalFailed?.();
      speakDevice(text, mine);
    }
  };

  const speak = (text: string, options: { natural?: boolean; matterId?: string } = {}): void => {
    const clean = text.trim();
    if (!clean) return;
    stopSpeaking();
    // never listen while speaking: the speaker would reach the microphone
    if (input.status === 'listening') input.toggle();
    const mine = generation.current;
    speakingRef.current = true;
    setSpeaking(true);
    if (options.natural) void speakNatural(clean, mine, options.matterId);
    else speakDevice(clean, mine);
  };

  // leaving the screen stops the voice
  useEffect(
    () => () => {
      generation.current += 1;
      try {
        void Speech.stop();
        player.current?.remove();
      } catch {
        // nothing to stop
      }
    },
    [],
  );

  return {
    listening: input.status === 'listening',
    speaking,
    toggleMic: () => {
      // Speak while the assistant talks: it stops, and the microphone starts
      if (speakingRef.current) stopSpeaking();
      input.toggle();
    },
    speak,
    stopSpeaking,
  };
}
