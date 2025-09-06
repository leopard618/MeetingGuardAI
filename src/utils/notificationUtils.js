// Notification System Utilities
// Constants, types, and helper functions for the multi-level notification system

// Alert Intensity Levels
export const AlertIntensity = {
  LIGHT: 'light',
  MEDIUM: 'medium',
  MAXIMUM: 'maximum'
};

// Audio Configuration by Intensity
export const audioConfig = {
  maximum: {
    volume: { start: 0.3, max: 1.0, increment: 0.05 },
    frequency: { start: 900, variation: 200 },
    duration: 1.2,
    voiceEnabled: true,
    voiceVolume: 0.8,
    interval: 4000 // 4 seconds between alarms
  },
  medium: {
    volume: { start: 0.4, max: 0.6, increment: 0.03 },
    frequency: { start: 700, variation: 100 },
    duration: 0.7,
    voiceEnabled: true,
    voiceVolume: 0.6,
    interval: 6000 // 6 seconds between alarms
  },
  light: {
    volume: { start: 0.2, max: 0.3, increment: 0 },
    frequency: { start: 500, variation: 0 },
    duration: 0.3,
    voiceEnabled: false,
    voiceVolume: 0,
    interval: 0 // No repeating for light alerts
  }
};

// Vibration Patterns by Intensity
export const vibrationPatterns = {
  maximum: [300, 150, 300, 150, 300, 150, 300],
  medium: [200, 100, 200, 100, 200],
  light: [100]
};

// Alert Persistence Settings
export const persistenceConfig = {
  maximum: {
    type: 'non-dismissible',
    autoCloseDelay: 30, // seconds
    canSnooze: true,
    canPostpone: true
  },
  medium: {
    type: 'minimizable',
    autoCloseDelay: 0, // no auto-close
    canSnooze: true,
    canPostpone: false
  },
  light: {
    type: 'dismissible',
    autoCloseDelay: 3, // seconds
    canSnooze: false,
    canPostpone: false
  }
};

// Snooze Options (in minutes)
export const snoozeOptions = [5, 15, 60];

// Default Alert Configuration
export const defaultAlertConfig = {
  intensity: AlertIntensity.MAXIMUM,
  soundEnabled: true,
  vibrationEnabled: true,
  speechEnabled: true,
  autoCloseEnabled: true,
  defaultSnoozeMinutes: 5
};

/**
 * Get alert configuration based on intensity
 */
export function getAlertConfig(intensity) {
  return {
    audio: audioConfig[intensity] || audioConfig.maximum,
    vibration: vibrationPatterns[intensity] || vibrationPatterns.maximum,
    persistence: persistenceConfig[intensity] || persistenceConfig.maximum
  };
}

/**
 * Check if device supports vibration
 */
export function supportsVibration() {
  return 'vibrate' in navigator;
}

/**
 * Check if device supports audio context
 */
export function supportsAudioContext() {
  return 'AudioContext' in window || 'webkitAudioContext' in window;
}

/**
 * Check if device supports speech synthesis
 */
export function supportsSpeechSynthesis() {
  return 'speechSynthesis' in window;
}

/**
 * Format meeting time for display
 */
export function formatMeetingTime(meeting) {
  if (!meeting || !meeting.date || !meeting.time) return '';
  
  const meetingTime = new Date(`${meeting.date} ${meeting.time}`);
  const now = new Date();
  const diffMs = meetingTime - now;
  const diffMinutes = Math.ceil(diffMs / (1000 * 60));
  
  if (diffMinutes <= 0) {
    return 'NOW';
  } else if (diffMinutes === 1) {
    return 'in 1 minute';
  } else {
    return `in ${diffMinutes} minutes`;
  }
}

/**
 * Generate voice message based on meeting, alert type, and intensity
 */
export function generateVoiceMessage(meeting, alertType = 'now', intensity, language = 'en') {
  if (!meeting) return '';
  
  const timeText = formatMeetingTime(meeting);
  const meetingTitle = meeting.title || 'Meeting';
  
  // Get time description based on alert type
  const getTimeDescription = (type, lang) => {
    if (lang === 'es') {
      switch (type) {
        case '1day': return 'en 1 día';
        case '1hour': return 'en 1 hora';
        case '15min': return 'en 15 minutos';
        case '5min': return 'en 5 minutos';
        case '1min': return 'en 1 minuto';
        case 'now': return 'comenzando ahora';
        default: return timeText === 'NOW' ? 'comenzando ahora' : timeText;
      }
    } else {
      switch (type) {
        case '1day': return 'in 1 day';
        case '1hour': return 'in 1 hour';
        case '15min': return 'in 15 minutes';
        case '5min': return 'in 5 minutes';
        case '1min': return 'in 1 minute';
        case 'now': return 'starting now';
        default: return timeText === 'NOW' ? 'starting now' : timeText;
      }
    }
  };
  
  const timeDesc = getTimeDescription(alertType, language);
  
  if (language === 'es') {
    switch (intensity) {
      case AlertIntensity.MAXIMUM:
        return `Alerta urgente. Reunión ${meetingTitle} ${timeDesc}`;
      case AlertIntensity.MEDIUM:
        return `Atención. Reunión ${meetingTitle} ${timeDesc}`;
      case AlertIntensity.LIGHT:
        return `Recordatorio. Reunión ${meetingTitle} ${timeDesc}`;
      default:
        return `Reunión ${meetingTitle} ${timeDesc}`;
    }
  } else {
    switch (intensity) {
      case AlertIntensity.MAXIMUM:
        return `Urgent alert. ${meetingTitle} meeting ${timeDesc}`;
      case AlertIntensity.MEDIUM:
        return `Attention. ${meetingTitle} meeting ${timeDesc}`;
      case AlertIntensity.LIGHT:
        return `Reminder. ${meetingTitle} meeting ${timeDesc}`;
      default:
        return `${meetingTitle} meeting ${timeDesc}`;
    }
  }
}

/**
 * Validate alert configuration
 */
export function validateAlertConfig(config) {
  const validIntensities = Object.values(AlertIntensity);
  
  if (!validIntensities.includes(config.intensity)) {
    console.warn('Invalid alert intensity, defaulting to maximum');
    config.intensity = AlertIntensity.MAXIMUM;
  }
  
  if (typeof config.soundEnabled !== 'boolean') {
    config.soundEnabled = true;
  }
  
  if (typeof config.vibrationEnabled !== 'boolean') {
    config.vibrationEnabled = true;
  }
  
  if (typeof config.speechEnabled !== 'boolean') {
    config.speechEnabled = true;
  }
  
  return config;
}

/**
 * Save alert configuration to storage
 */
export async function saveAlertConfig(config, storage) {
  try {
    const validatedConfig = validateAlertConfig(config);
    await storage.setItem('alertSystemConfig', JSON.stringify(validatedConfig));
    return true;
  } catch (error) {
    console.error('Failed to save alert configuration:', error);
    return false;
  }
}

/**
 * Load alert configuration from storage
 */
export async function loadAlertConfig(storage) {
  try {
    const configStr = await storage.getItem('alertSystemConfig');
    if (configStr) {
      const config = JSON.parse(configStr);
      return validateAlertConfig(config);
    }
    return defaultAlertConfig;
  } catch (error) {
    console.error('Failed to load alert configuration:', error);
    return defaultAlertConfig;
  }
}
