// Export React Native compatible notification components
export { default as NotificationManager } from './NotificationManager';
export { default as MaximumAlert } from './MaximumAlert';
export { default as MediumAlert } from './MediumAlert';
export { default as LightAlert } from './LightAlert';
export { default as NotificationDemo } from './NotificationDemo';

// Export utilities (simplified for React Native)
export const AlertIntensity = {
  LIGHT: 'light',
  MEDIUM: 'medium',
  MAXIMUM: 'maximum'
};

// Simple utility functions for React Native
export const formatMeetingTime = (meeting) => {
  if (!meeting || !meeting.date || !meeting.time) return 'Unknown time';
  
  const meetingTime = new Date(`${meeting.date} ${meeting.time}`);
  const now = new Date();
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  
  if (diffMins <= 0) return 'NOW';
  if (diffMins < 60) return `${diffMins} min`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ${diffMins % 60}min`;
  return `${Math.floor(diffMins / 1440)}d ${Math.floor((diffMins % 1440) / 60)}h`;
};

export const snoozeOptions = [5, 15, 60];

// Simple configuration for React Native
export const defaultAlertConfig = {
  intensity: 'maximum',
  soundEnabled: true,
  vibrationEnabled: true,
  speechEnabled: true,
  autoCloseEnabled: true,
  defaultSnoozeMinutes: 15
};
