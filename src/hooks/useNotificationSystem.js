import { useState, useRef, useCallback, useEffect } from 'react';
import { useAudioSystem } from './useAudioSystem.js';
import { useVibrationSystem } from './useVibrationSystem.js';
import { 
  getAlertConfig, 
  generateVoiceMessage, 
  formatMeetingTime,
  AlertIntensity 
} from '../utils/notificationUtils';
import { storage } from '../utils/storage';

export function useNotificationSystem() {
  const [currentAlert, setCurrentAlert] = useState(null);
  const [alertConfig, setAlertConfig] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
  const audioSystem = useAudioSystem();
  const vibrationSystem = useVibrationSystem();
  
  const countdownIntervalRef = useRef(null);
  const vibrationIntervalRef = useRef(null);

  // Load alert configuration from storage
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configStr = await storage.getItem('alertSystemConfig');
        if (configStr) {
          const config = JSON.parse(configStr);
          setAlertConfig(config);
        } else {
          setAlertConfig({
            intensity: AlertIntensity.MAXIMUM,
            soundEnabled: true,
            vibrationEnabled: true,
            speechEnabled: true,
            autoCloseEnabled: true,
            defaultSnoozeMinutes: 5
          });
        }
      } catch (error) {
        console.error('Failed to load alert configuration:', error);
        setAlertConfig({
          intensity: AlertIntensity.MAXIMUM,
          soundEnabled: true,
          vibrationEnabled: true,
          speechEnabled: true,
          autoCloseEnabled: true,
          defaultSnoozeMinutes: 5
        });
      }
    };

    loadConfig();
  }, []);

  // Start alert sequence
  const startAlert = useCallback(async (meeting, intensity = null, language = 'en') => {
    if (!meeting) return;

    const alertIntensity = intensity || alertConfig?.intensity || AlertIntensity.MAXIMUM;
    const config = getAlertConfig(alertIntensity);
    
    setCurrentAlert({
      meeting,
      intensity: alertIntensity,
      config,
      language,
      startTime: Date.now()
    });
    
    setIsActive(true);

    // Initialize audio
    await audioSystem.initializeAudio();

    // Start audio sequence
    if (alertConfig?.soundEnabled !== false) {
      await audioSystem.startAlarmSequence();
    }

    // Start vibration
    if (alertConfig?.vibrationEnabled !== false && vibrationSystem.supportsVibration) {
      vibrationIntervalRef.current = vibrationSystem.startRepeatingVibration(
        alertIntensity, 
        config.audio.interval
      );
    }

    // Play voice message
    if (alertConfig?.speechEnabled !== false) {
      const voiceMessage = generateVoiceMessage(meeting, alertIntensity, language);
      audioSystem.playVoice(voiceMessage, language);
    }

    // Start countdown if auto-close is enabled
    if (config.persistence.autoCloseDelay > 0 && alertConfig?.autoCloseEnabled !== false) {
      setCountdown(config.persistence.autoCloseDelay);
      
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            stopAlert();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  }, [alertConfig, audioSystem, vibrationSystem]);

  // Stop alert sequence
  const stopAlert = useCallback(() => {
    setIsActive(false);
    setCurrentAlert(null);
    setCountdown(0);

    // Stop audio
    audioSystem.stopAlarmSequence();

    // Stop vibration
    if (vibrationIntervalRef.current) {
      vibrationSystem.stopRepeatingVibration(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }

    // Clear countdown
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, [audioSystem, vibrationSystem]);

  // Snooze alert
  const snoozeAlert = useCallback(async (minutes = null) => {
    if (!currentAlert) return;

    const snoozeMinutes = minutes || alertConfig?.defaultSnoozeMinutes || 5;
    const snoozeUntil = Date.now() + (snoozeMinutes * 60 * 1000);

    try {
      await storage.setItem(`meetingAlert_${currentAlert.meeting?.id}`, JSON.stringify({
        snoozedUntil: snoozeUntil,
        snoozeMinutes: snoozeMinutes,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('Failed to save snooze state:', error);
    }

    stopAlert();
    return snoozeMinutes;
  }, [currentAlert, alertConfig, stopAlert]);

  // Postpone meeting
  const postponeMeeting = useCallback(async (newDate, newTime) => {
    if (!currentAlert) return;

    try {
      // Update meeting in storage/database
      const Meeting = (await import('@/api/entities')).Meeting;
      await Meeting.update(currentAlert.meeting.id, {
        date: newDate,
        time: newTime
      });

      await storage.setItem(`meetingAlert_${currentAlert.meeting?.id}`, JSON.stringify({
        postponed: true,
        newDate: newDate,
        newTime: newTime,
        timestamp: Date.now()
      }));

      stopAlert();
      return { date: newDate, time: newTime };
    } catch (error) {
      console.error('Failed to postpone meeting:', error);
      throw error;
    }
  }, [currentAlert, stopAlert]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    audioSystem.toggleMute();
  }, [audioSystem]);

  // Update alert configuration
  const updateAlertConfig = useCallback(async (newConfig) => {
    try {
      const updatedConfig = { ...alertConfig, ...newConfig };
      setAlertConfig(updatedConfig);
      await storage.setItem('alertSystemConfig', JSON.stringify(updatedConfig));
      return true;
    } catch (error) {
      console.error('Failed to update alert configuration:', error);
      return false;
    }
  }, [alertConfig]);

  // Get meeting time info
  const getMeetingTimeInfo = useCallback(() => {
    if (!currentAlert?.meeting) return { timeText: '', minutesUntil: 0 };
    
    const timeText = formatMeetingTime(currentAlert.meeting);
    const meetingTime = new Date(`${currentAlert.meeting.date} ${currentAlert.meeting.time}`);
    const now = new Date();
    const minutesUntil = Math.ceil((meetingTime - now) / (1000 * 60));
    
    return { timeText, minutesUntil };
  }, [currentAlert]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAlert();
    };
  }, [stopAlert]);

  return {
    // State
    currentAlert,
    alertConfig,
    isActive,
    countdown,
    
    // Audio system
    volume: audioSystem.volume,
    isMuted: audioSystem.isMuted,
    
    // Actions
    startAlert,
    stopAlert,
    snoozeAlert,
    postponeMeeting,
    toggleMute,
    updateAlertConfig,
    
    // Utilities
    getMeetingTimeInfo,
    supportsVibration: vibrationSystem.supportsVibration
  };
}
