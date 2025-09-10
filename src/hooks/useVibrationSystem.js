import { useCallback } from 'react';
import { vibrationPatterns, supportsVibration } from '../utils/notificationUtils';

export function useVibrationSystem() {
  // Trigger vibration with specific pattern
  const vibrate = useCallback((intensity = 'maximum') => {
    if (!supportsVibration()) {
      console.log('Vibration not supported on this device');
      return;
    }

    const pattern = vibrationPatterns[intensity] || vibrationPatterns.maximum;
    
    try {
      navigator.vibrate(pattern);
    } catch (error) {
      console.error('Failed to trigger vibration:', error);
    }
  }, []);

  // Stop vibration
  const stopVibration = useCallback(() => {
    if (supportsVibration()) {
      try {
        navigator.vibrate(0);
      } catch (error) {
        console.error('Failed to stop vibration:', error);
      }
    }
  }, []);

  // Start repeating vibration pattern
  const startRepeatingVibration = useCallback((intensity = 'maximum', interval = 3000) => {
    if (!supportsVibration()) return null;

    const pattern = vibrationPatterns[intensity] || vibrationPatterns.maximum;
    
    const vibrationInterval = setInterval(() => {
      try {
        navigator.vibrate(pattern);
      } catch (error) {
        console.error('Failed to trigger repeating vibration:', error);
        clearInterval(vibrationInterval);
      }
    }, interval);

    return vibrationInterval;
  }, []);

  // Stop repeating vibration
  const stopRepeatingVibration = useCallback((intervalId) => {
    if (intervalId) {
      clearInterval(intervalId);
    }
    stopVibration();
  }, [stopVibration]);

  // Custom vibration pattern
  const vibrateCustom = useCallback((pattern) => {
    if (!supportsVibration()) return;

    try {
      navigator.vibrate(pattern);
    } catch (error) {
      console.error('Failed to trigger custom vibration:', error);
    }
  }, []);

  return {
    vibrate,
    stopVibration,
    startRepeatingVibration,
    stopRepeatingVibration,
    vibrateCustom,
    supportsVibration: supportsVibration()
  };
}
