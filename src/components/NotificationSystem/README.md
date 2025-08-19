# Notification System

A comprehensive, multi-level notification system for meeting alerts with smart audio, vibration, and visual feedback.

## Features

### 🚨 Multi-Level Alert Intensity

- **Maximum Intensity**: Full-screen takeover with progressive audio, complex vibration patterns, and voice synthesis
- **Medium Intensity**: Persistent banner with standard audio and vibration patterns
- **Light Intensity**: Toast notification with brief sound and auto-dismiss

### 🔊 Smart Audio System

- Progressive volume increase for maximum intensity alerts
- Different frequency patterns based on alert type
- Voice synthesis announcing meeting details
- Mute/unmute functionality
- Cross-platform audio support (Web Audio API + HTML5 Audio)

### 📱 Mobile-Optimized

- Vibration patterns optimized for mobile devices
- Touch-friendly interface design
- Responsive layouts for different screen sizes
- Background persistence with service workers

### ⚙️ Customizable Settings

- Alert intensity preferences
- Sound, vibration, and speech toggles
- Auto-close settings
- Default snooze duration
- Persistent user preferences

## Architecture

```
NotificationSystem/
├── NotificationManager.jsx     # Main orchestrator
├── MaximumAlert.jsx           # Full-screen overlay
├── MediumAlert.jsx            # Persistent banner
├── LightAlert.jsx             # Toast notification
├── AlertCustomizer.jsx        # Settings interface
├── NotificationDemo.jsx       # Demo component
└── index.js                   # Exports
```

## Usage

### Basic Implementation

```jsx
import { NotificationManager } from '@/components/NotificationSystem';

function App() {
  const [alertMeeting, setAlertMeeting] = useState(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);

  const handleTriggerAlert = (meeting, intensity) => {
    setAlertMeeting(meeting);
    setIsAlertOpen(true);
  };

  return (
    <div>
      {/* Your app content */}
      
      <NotificationManager
        meeting={alertMeeting}
        isOpen={isAlertOpen}
        onClose={() => setIsAlertOpen(false)}
        onSnooze={(minutes) => console.log(`Snoozed for ${minutes} minutes`)}
        onPostpone={(newDateTime) => console.log('Postponed to:', newDateTime)}
        intensity="maximum" // Optional override
        language="en"
      />
    </div>
  );
}
```

### Integration with AlertScheduler

```jsx
import AlertScheduler from '@/components/AlertScheduler';
import { NotificationManager } from '@/components/NotificationSystem';

function MeetingApp() {
  const [currentAlert, setCurrentAlert] = useState(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);

  const handleTriggerAlert = (meeting, alertType, intensity) => {
    setCurrentAlert(meeting);
    setIsAlertOpen(true);
  };

  return (
    <div>
      <AlertScheduler
        onTriggerAlert={handleTriggerAlert}
        language="en"
        alertsEnabled={true}
      />
      
      <NotificationManager
        meeting={currentAlert}
        isOpen={isAlertOpen}
        onClose={() => setIsAlertOpen(false)}
        onSnooze={handleSnooze}
        onPostpone={handlePostpone}
        language="en"
      />
    </div>
  );
}
```

## Configuration

### Alert Intensity Levels

```javascript
import { AlertIntensity } from '@/utils/notificationUtils';

// Available intensity levels
AlertIntensity.MAXIMUM  // Full-screen takeover
AlertIntensity.MEDIUM   // Persistent banner
AlertIntensity.LIGHT    // Toast notification
```

### Default Configuration

```javascript
const defaultConfig = {
  intensity: AlertIntensity.MAXIMUM,
  soundEnabled: true,
  vibrationEnabled: true,
  speechEnabled: true,
  autoCloseEnabled: true,
  defaultSnoozeMinutes: 5
};
```

### Audio Configuration

```javascript
const audioConfig = {
  maximum: {
    volume: { start: 0.3, max: 1.0, increment: 0.05 },
    frequency: { start: 900, variation: 200 },
    duration: 1.2,
    voiceEnabled: true,
    voiceVolume: 0.8,
    interval: 4000
  },
  medium: {
    volume: { start: 0.4, max: 0.6, increment: 0.03 },
    frequency: { start: 700, variation: 100 },
    duration: 0.7,
    voiceEnabled: true,
    voiceVolume: 0.6,
    interval: 6000
  },
  light: {
    volume: { start: 0.2, max: 0.3, increment: 0 },
    frequency: { start: 500, variation: 0 },
    duration: 0.3,
    voiceEnabled: false,
    voiceVolume: 0,
    interval: 0
  }
};
```

### Vibration Patterns

```javascript
const vibrationPatterns = {
  maximum: [300, 150, 300, 150, 300, 150, 300],
  medium: [200, 100, 200, 100, 200],
  light: [100]
};
```

## Hooks

### useNotificationSystem

Main hook for managing the notification system state and actions.

```jsx
import { useNotificationSystem } from '@/hooks/useNotificationSystem';

function MyComponent() {
  const {
    currentAlert,
    alertConfig,
    isActive,
    countdown,
    volume,
    isMuted,
    startAlert,
    stopAlert,
    snoozeAlert,
    postponeMeeting,
    toggleMute,
    updateAlertConfig
  } = useNotificationSystem();

  // Use the notification system
}
```

### useAudioSystem

Hook for managing audio playback and voice synthesis.

```jsx
import { useAudioSystem } from '@/hooks/useAudioSystem';

function AudioComponent() {
  const {
    volume,
    isMuted,
    initializeAudio,
    playAlarm,
    playVoice,
    startAlarmSequence,
    stopAlarmSequence,
    toggleMute
  } = useAudioSystem('maximum');

  // Use audio system
}
```

### useVibrationSystem

Hook for managing vibration patterns.

```jsx
import { useVibrationSystem } from '@/hooks/useVibrationSystem';

function VibrationComponent() {
  const {
    vibrate,
    stopVibration,
    startRepeatingVibration,
    stopRepeatingVibration,
    supportsVibration
  } = useVibrationSystem();

  // Use vibration system
}
```

## Utilities

### notificationUtils

Utility functions for the notification system.

```javascript
import {
  AlertIntensity,
  audioConfig,
  vibrationPatterns,
  getAlertConfig,
  supportsVibration,
  supportsAudioContext,
  supportsSpeechSynthesis,
  formatMeetingTime,
  generateVoiceMessage,
  validateAlertConfig,
  saveAlertConfig,
  loadAlertConfig
} from '@/utils/notificationUtils';
```

## Demo

Use the `NotificationDemo` component to test all notification features:

```jsx
import NotificationDemo from '@/components/NotificationSystem/NotificationDemo';

function DemoPage() {
  return <NotificationDemo />;
}
```

## Browser Support

- **Audio**: Web Audio API (desktop) + HTML5 Audio (mobile)
- **Vibration**: Web Vibration API (mobile devices)
- **Speech**: Web Speech Synthesis API
- **Storage**: AsyncStorage (React Native) + localStorage (web)

## Mobile Considerations

- Audio requires user interaction on mobile devices
- Vibration only works on supported mobile devices
- Touch-friendly interface design
- Responsive layouts for different screen sizes
- Background persistence with service workers

## Performance

- Efficient audio context management
- Optimized vibration patterns
- Smooth animations with Framer Motion
- Memory cleanup on component unmount
- Progressive enhancement for different device capabilities

## Accessibility

- Keyboard navigation support
- Screen reader compatibility
- High contrast color schemes
- Clear visual hierarchy
- Alternative text for icons

## Testing

The notification system includes comprehensive testing capabilities:

1. **Demo Component**: Interactive testing of all intensity levels
2. **Audio Testing**: Test different audio patterns and volumes
3. **Vibration Testing**: Test vibration patterns on mobile devices
4. **Visual Testing**: Test different alert layouts and animations
5. **Integration Testing**: Test with real meeting data

## Future Enhancements

- Push notification support
- Custom notification sounds
- Advanced scheduling options
- Integration with calendar APIs
- Analytics and user behavior tracking
- A/B testing for different alert styles
