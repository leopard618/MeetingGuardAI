import { useState, useRef, useCallback, useEffect } from 'react';
import { audioConfig, supportsAudioContext, supportsSpeechSynthesis } from '../utils/notificationUtils';

export function useAudioSystem(intensity = 'maximum') {
  const [volume, setVolume] = useState(0.3);
  const [isMuted, setIsMuted] = useState(false);
  const [audioInitialized, setAudioInitialized] = useState(false);
  
  const audioContextRef = useRef(null);
  const audioElementRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const volumeIntervalRef = useRef(null);
  const speechRef = useRef(null);

  // Initialize audio context
  const initializeAudio = useCallback(async () => {
    if (audioInitialized) return;

    try {
      // Check if we're on mobile (React Native)
      const isMobile = typeof navigator !== 'undefined' && 
                      navigator.userAgent && 
                      /Mobile|Android|iPhone|iPad/.test(navigator.userAgent);

      if (isMobile) {
        // For mobile, we'll use HTML5 audio element
        if (!audioElementRef.current) {
          audioElementRef.current = new Audio();
          audioElementRef.current.loop = false;
          audioElementRef.current.preload = 'auto';
        }
        setAudioInitialized(true);
      } else if (supportsAudioContext()) {
        // For desktop, use Web Audio API
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
        setAudioInitialized(true);
      }
    } catch (error) {
      console.error('Failed to initialize audio:', error);
    }
  }, [audioInitialized]);

  // Play alarm sound
  const playAlarm = useCallback(async () => {
    if (isMuted) return;

    const config = audioConfig[intensity] || audioConfig.maximum;
    if (!config) return;

    try {
      const isMobile = typeof navigator !== 'undefined' && 
                      navigator.userAgent && 
                      /Mobile|Android|iPhone|iPad/.test(navigator.userAgent);

      if (isMobile && audioElementRef.current) {
        // Mobile audio using HTML5 Audio
        audioElementRef.current.currentTime = 0;
        audioElementRef.current.volume = Math.min(volume, config.volume.max);
        
        const playPromise = audioElementRef.current.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
      } else if (audioContextRef.current) {
        // Desktop audio using Web Audio API
        const oscillator = audioContextRef.current.createOscillator();
        const gainNode = audioContextRef.current.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContextRef.current.destination);
        
        // Set frequency and volume based on intensity
        const frequency = config.frequency.start;
        const maxVolume = config.volume.max;
        const currentVolume = Math.min(volume, maxVolume);
        
        oscillator.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
        oscillator.frequency.setValueAtTime(
          frequency + config.frequency.variation, 
          audioContextRef.current.currentTime + config.duration / 2
        );
        
        gainNode.gain.setValueAtTime(0, audioContextRef.current.currentTime);
        gainNode.gain.linearRampToValueAtTime(currentVolume, audioContextRef.current.currentTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + config.duration);
        
        oscillator.start(audioContextRef.current.currentTime);
        oscillator.stop(audioContextRef.current.currentTime + config.duration);
      }
    } catch (error) {
      console.error('Failed to play alarm:', error);
    }
  }, [intensity, volume, isMuted]);

  // Play voice synthesis
  const playVoice = useCallback((message, language = 'en') => {
    if (isMuted || !supportsSpeechSynthesis()) return;

    const config = audioConfig[intensity] || audioConfig.maximum;
    if (!config.voiceEnabled) return;

    try {
      // Cancel any existing speech
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = language === 'es' ? 'es-ES' : 'en-US';
      utterance.volume = config.voiceVolume;
      utterance.rate = 0.9; // Slightly slower for clarity
      utterance.pitch = 1.0;

      speechRef.current = utterance;
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('Failed to play voice:', error);
    }
  }, [intensity, isMuted]);

  // Start alarm sequence with progressive volume
  const startAlarmSequence = useCallback(async () => {
    if (isMuted) return;

    const config = audioConfig[intensity] || audioConfig.maximum;
    if (!config || config.interval === 0) return;

    // Initial alarm
    await playAlarm();

    // Set up repeating alarm
    alarmIntervalRef.current = setInterval(async () => {
      if (!isMuted) {
        await playAlarm();
      }
    }, config.interval);

    // Progressive volume increase
    if (config.volume.increment > 0) {
      volumeIntervalRef.current = setInterval(() => {
        setVolume(prev => Math.min(config.volume.max, prev + config.volume.increment));
      }, 1500);
    }
  }, [intensity, isMuted, playAlarm]);

  // Stop alarm sequence
  const stopAlarmSequence = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current);
      volumeIntervalRef.current = null;
    }

    // Stop speech
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }

    // Reset volume
    setVolume(0.3);
  }, []);

  // Mute/unmute
  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
    if (isMuted) {
      // Unmuting - restart audio sequence
      startAlarmSequence();
    } else {
      // Muting - stop audio sequence
      stopAlarmSequence();
    }
  }, [isMuted, startAlarmSequence, stopAlarmSequence]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAlarmSequence();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopAlarmSequence]);

  return {
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    audioInitialized,
    initializeAudio,
    playAlarm,
    playVoice,
    startAlarmSequence,
    stopAlarmSequence,
    toggleMute
  };
}
