import React from 'react';
import MaximumAlert from './MaximumAlert';
import MediumAlert from './MediumAlert';
import LightAlert from './LightAlert';

export default function NotificationManager({ 
  meeting, 
  isOpen, 
  onClose, 
  onSnooze, 
  onPostpone, 
  language = "en", 
  alertType = "15min", 
  intensity = null, 
  onAlertCustomized 
}) {
  // Determine which alert to show based on intensity or alertType
  const getAlertIntensity = () => {
    if (intensity) return intensity;
    
    // Default mapping based on alertType
    switch (alertType) {
      case '5min':
      case '1min':
      case 'now':
        return 'maximum';
      case '15min':
        return 'medium';
      default:
        return 'light';
    }
  };

  const currentIntensity = getAlertIntensity();

  // Render the appropriate alert component
  switch (currentIntensity) {
    case 'maximum':
      return (
        <MaximumAlert
          meeting={meeting}
          isOpen={isOpen}
          onClose={onClose}
          onSnooze={onSnooze}
          onPostpone={onPostpone}
          language={language}
        />
      );
    
    case 'medium':
      return (
        <MediumAlert
          meeting={meeting}
          isOpen={isOpen}
          onClose={onClose}
          onSnooze={onSnooze}
          language={language}
        />
      );
    
    case 'light':
      return (
        <LightAlert
          meeting={meeting}
          isOpen={isOpen}
          onClose={onClose}
          language={language}
        />
      );
    
    default:
      return null;
  }
}
