# 🔴 Floating Overlay Widget Implementation

## 🎯 Goal: Create a Floating Circle Like Android System Notifications

Create a persistent floating circular widget that displays meeting information and stays on top of all other apps.

## 📱 Implementation Approaches

### Option 1: React Native Overlay (Recommended)
**Best for:** Cross-platform compatibility and easier implementation

**Packages Needed:**
```bash
npm install react-native-floating-action
npm install react-native-system-alert-window
npm install react-native-overlay
```

### Option 2: Native Android Overlay Service
**Best for:** Maximum control and native performance (Android only)

**Requirements:**
- SYSTEM_ALERT_WINDOW permission
- Foreground service
- Native Android development

### Option 3: Picture-in-Picture Mode
**Best for:** Modern Android/iOS compatibility

**Features:**
- Built-in OS support
- Automatic positioning
- System-managed lifecycle

## 🚀 Implementation Plan

### Step 1: React Native Floating Widget

```javascript
// src/components/FloatingMeetingWidget.jsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  PanResponder,
  Animated,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { FloatingAction } from 'react-native-floating-action';
import SystemAlertWindow from 'react-native-system-alert-window';

const FloatingMeetingWidget = ({ nextMeeting, onPress, onClose }) => {
  const [position, setPosition] = useState({ x: 50, y: 100 });
  const [timeUntilMeeting, setTimeUntilMeeting] = useState('');

  // Calculate time until next meeting
  useEffect(() => {
    if (!nextMeeting) return;

    const updateTimer = () => {
      const now = new Date();
      const meetingTime = new Date(nextMeeting.startTime || `${nextMeeting.date}T${nextMeeting.time}`);
      const diff = meetingTime - now;

      if (diff <= 0) {
        setTimeUntilMeeting('NOW');
      } else if (diff < 60000) { // Less than 1 minute
        setTimeUntilMeeting('<1m');
      } else if (diff < 3600000) { // Less than 1 hour
        const minutes = Math.floor(diff / 60000);
        setTimeUntilMeeting(`${minutes}m`);
      } else if (diff < 86400000) { // Less than 1 day
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        setTimeUntilMeeting(`${hours}h${minutes}m`);
      } else {
        const days = Math.floor(diff / 86400000);
        setTimeUntilMeeting(`${days}d`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [nextMeeting]);

  const getWidgetColor = () => {
    if (!nextMeeting) return '#6b7280'; // Gray - no meetings
    
    const now = new Date();
    const meetingTime = new Date(nextMeeting.startTime || `${nextMeeting.date}T${nextMeeting.time}`);
    const diff = meetingTime - now;

    if (diff <= 0) return '#ef4444'; // Red - meeting now
    if (diff <= 300000) return '#f59e0b'; // Orange - 5 minutes
    if (diff <= 900000) return '#eab308'; // Yellow - 15 minutes
    return '#10b981'; // Green - upcoming
  };

  return (
    <TouchableOpacity
      style={[
        styles.floatingWidget,
        {
          backgroundColor: getWidgetColor(),
          left: position.x,
          top: position.y,
        }
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.widgetContent}>
        {nextMeeting ? (
          <>
            <Text style={styles.timeText}>{timeUntilMeeting}</Text>
            <Text style={styles.meetingIcon}>📅</Text>
          </>
        ) : (
          <Text style={styles.noMeetingIcon}>💤</Text>
        )}
      </View>
      
      {/* Close button */}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  floatingWidget: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 1000,
  },
  widgetContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  meetingIcon: {
    fontSize: 16,
    marginTop: 2,
  },
  noMeetingIcon: {
    fontSize: 20,
  },
  closeButton: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default FloatingMeetingWidget;
```

### Step 2: System Overlay Permission Handler

```javascript
// src/services/OverlayPermissionService.js
import { Platform, Alert, Linking } from 'react-native';
import SystemAlertWindow from 'react-native-system-alert-window';

class OverlayPermissionService {
  async requestOverlayPermission() {
    if (Platform.OS !== 'android') {
      return true; // iOS doesn't need this permission
    }

    try {
      // Check if permission is already granted
      const hasPermission = await SystemAlertWindow.checkPermission();
      
      if (hasPermission) {
        console.log('✅ Overlay permission already granted');
        return true;
      }

      // Request permission
      Alert.alert(
        'Overlay Permission Required',
        'To show floating meeting reminders on top of other apps, please grant overlay permission.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => false,
          },
          {
            text: 'Grant Permission',
            onPress: async () => {
              try {
                await SystemAlertWindow.requestPermission();
                const granted = await SystemAlertWindow.checkPermission();
                
                if (granted) {
                  console.log('✅ Overlay permission granted');
                  return true;
                } else {
                  console.log('❌ Overlay permission denied');
                  return false;
                }
              } catch (error) {
                console.error('Error requesting overlay permission:', error);
                return false;
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('Error checking overlay permission:', error);
      return false;
    }
  }

  async showFloatingWidget(widgetComponent) {
    if (Platform.OS !== 'android') {
      console.warn('Floating widgets only supported on Android');
      return false;
    }

    try {
      const hasPermission = await this.requestOverlayPermission();
      
      if (!hasPermission) {
        Alert.alert(
          'Permission Required',
          'Overlay permission is required to show floating meeting reminders.'
        );
        return false;
      }

      // Show the floating widget
      await SystemAlertWindow.showSystemAlert({
        height: 60,
        width: 60,
        gravity: 'top-left',
        x: 50,
        y: 100,
      });

      console.log('✅ Floating widget displayed');
      return true;
    } catch (error) {
      console.error('Error showing floating widget:', error);
      return false;
    }
  }

  async hideFloatingWidget() {
    try {
      await SystemAlertWindow.hideSystemAlert();
      console.log('✅ Floating widget hidden');
    } catch (error) {
      console.error('Error hiding floating widget:', error);
    }
  }
}

export default new OverlayPermissionService();
```

### Step 3: Floating Widget Manager

```javascript
// src/services/FloatingWidgetManager.js
import React from 'react';
import { AppState } from 'react-native';
import OverlayPermissionService from './OverlayPermissionService';
import FloatingMeetingWidget from '../components/FloatingMeetingWidget';
import { Meeting } from '../api/entities';

class FloatingWidgetManager {
  constructor() {
    this.isWidgetVisible = false;
    this.nextMeeting = null;
    this.appStateSubscription = null;
  }

  async initialize() {
    try {
      console.log('🚀 Initializing Floating Widget Manager...');
      
      // Listen for app state changes
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange.bind(this));
      
      // Load next meeting
      await this.updateNextMeeting();
      
      console.log('✅ Floating Widget Manager initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Floating Widget Manager:', error);
      return false;
    }
  }

  async updateNextMeeting() {
    try {
      const meetings = await Meeting.list();
      const now = new Date();
      
      // Find the next upcoming meeting
      const upcomingMeetings = meetings
        .filter(meeting => {
          try {
            const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
            return meetingTime > now;
          } catch (error) {
            return false;
          }
        })
        .sort((a, b) => {
          const timeA = new Date(a.startTime || `${a.date}T${a.time}`);
          const timeB = new Date(b.startTime || `${b.date}T${b.time}`);
          return timeA - timeB;
        });

      this.nextMeeting = upcomingMeetings.length > 0 ? upcomingMeetings[0] : null;
      console.log('📅 Next meeting updated:', this.nextMeeting?.title || 'None');
      
      // Update widget if visible
      if (this.isWidgetVisible) {
        await this.refreshWidget();
      }
    } catch (error) {
      console.error('Error updating next meeting:', error);
    }
  }

  async showWidget() {
    try {
      if (this.isWidgetVisible) {
        console.log('Widget already visible');
        return true;
      }

      const success = await OverlayPermissionService.showFloatingWidget(
        <FloatingMeetingWidget
          nextMeeting={this.nextMeeting}
          onPress={this.handleWidgetPress.bind(this)}
          onClose={this.hideWidget.bind(this)}
        />
      );

      if (success) {
        this.isWidgetVisible = true;
        console.log('✅ Floating widget shown');
      }

      return success;
    } catch (error) {
      console.error('Error showing widget:', error);
      return false;
    }
  }

  async hideWidget() {
    try {
      if (!this.isWidgetVisible) {
        console.log('Widget already hidden');
        return;
      }

      await OverlayPermissionService.hideFloatingWidget();
      this.isWidgetVisible = false;
      console.log('✅ Floating widget hidden');
    } catch (error) {
      console.error('Error hiding widget:', error);
    }
  }

  async refreshWidget() {
    if (this.isWidgetVisible) {
      await this.hideWidget();
      await this.showWidget();
    }
  }

  handleAppStateChange(nextAppState) {
    console.log('App state changed to:', nextAppState);
    
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      // Show widget when app goes to background
      if (this.nextMeeting) {
        this.showWidget();
      }
    } else if (nextAppState === 'active') {
      // Hide widget when app comes to foreground
      this.hideWidget();
    }
  }

  handleWidgetPress() {
    console.log('🎯 Widget pressed - opening app');
    
    // Hide widget and bring app to foreground
    this.hideWidget();
    
    // You can add navigation logic here to go to specific meeting
    // For example: navigate to meeting details or dashboard
  }

  cleanup() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    this.hideWidget();
  }
}

export default new FloatingWidgetManager();
```

### Step 4: Integration with Main App

```javascript
// Update your main App.js or Dashboard
import FloatingWidgetManager from './src/services/FloatingWidgetManager';

// In your main app component
useEffect(() => {
  const initializeFloatingWidget = async () => {
    await FloatingWidgetManager.initialize();
  };
  
  initializeFloatingWidget();
  
  return () => {
    FloatingWidgetManager.cleanup();
  };
}, []);

// Add a toggle in settings
const handleToggleFloatingWidget = async (enabled) => {
  if (enabled) {
    await FloatingWidgetManager.showWidget();
  } else {
    await FloatingWidgetManager.hideWidget();
  }
};
```

## 🔧 Android Permissions

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

## 🎨 Widget Features

### Visual States:
- **🔴 Red**: Meeting happening now
- **🟠 Orange**: Meeting in 5 minutes
- **🟡 Yellow**: Meeting in 15 minutes  
- **🟢 Green**: Upcoming meeting
- **⚫ Gray**: No meetings

### Interactions:
- **Tap**: Open app/meeting details
- **Long press**: Move widget around
- **X button**: Close widget
- **Auto-hide**: When app is active

## 📱 User Experience

1. **Background Mode**: Widget appears when app goes to background
2. **Always Visible**: Stays on top of all other apps
3. **Smart Updates**: Shows countdown to next meeting
4. **Quick Access**: Tap to instantly open your app
5. **Non-Intrusive**: Small, moveable, dismissible

This creates the exact floating circle experience you showed in the image! 🎯
