# Background Notification System Implementation

## 🎯 Goal: WhatsApp/Telegram-Style Always-On Meeting Alerts

Create a robust, multi-layered notification system that ensures users never miss meetings, even when the app is completely closed.

## 🏗️ Architecture Overview

### Layer 1: Local Scheduled Notifications (Primary)
- **Technology**: `expo-notifications` + `@react-native-async-storage/async-storage`
- **Purpose**: Schedule notifications directly on device
- **Reliability**: High (works even when app is killed)
- **Limitations**: Limited to 64 notifications on iOS

### Layer 2: Push Notifications (Backup)
- **Technology**: Firebase Cloud Messaging (FCM) or Expo Push Notifications
- **Purpose**: Server-triggered notifications
- **Reliability**: Very High (server-controlled)
- **Benefits**: Unlimited notifications, real-time updates

### Layer 3: Background Tasks (Maintenance)
- **Technology**: `expo-task-manager` + `expo-background-fetch`
- **Purpose**: Refresh notification schedules periodically
- **Reliability**: Medium (OS-dependent)
- **Benefits**: Keeps local schedules updated

### Layer 4: Server-Side Scheduling (Ultimate Backup)
- **Technology**: Node.js + node-cron + Firebase Admin SDK
- **Purpose**: Ensure notifications are sent regardless of device state
- **Reliability**: Highest (independent of device)
- **Benefits**: Cross-platform, always works

## 📱 Implementation Steps

### Step 1: Install Required Dependencies

```bash
# Core notification dependencies
expo install expo-notifications expo-device expo-constants

# Background tasks
expo install expo-task-manager expo-background-fetch

# Push notifications (choose one)
# Option A: Expo Push Notifications (easier)
expo install expo-notifications

# Option B: Firebase (more features)
npm install @react-native-firebase/app @react-native-firebase/messaging
```

### Step 2: Configure Permissions

```javascript
// src/services/NotificationPermissions.js
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

export async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('meeting-alerts', {
      name: 'Meeting Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      alert('Failed to get push token for push notification!');
      return;
    }
    
    token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log('Push token:', token);
  } else {
    alert('Must use physical device for Push Notifications');
  }

  return token;
}
```

### Step 3: Local Notification Scheduler

```javascript
// src/services/LocalNotificationScheduler.js
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

class LocalNotificationScheduler {
  constructor() {
    this.scheduledNotifications = new Map();
    this.loadScheduledNotifications();
  }

  async loadScheduledNotifications() {
    try {
      const stored = await AsyncStorage.getItem('scheduledNotifications');
      if (stored) {
        this.scheduledNotifications = new Map(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load scheduled notifications:', error);
    }
  }

  async saveScheduledNotifications() {
    try {
      await AsyncStorage.setItem(
        'scheduledNotifications',
        JSON.stringify([...this.scheduledNotifications])
      );
    } catch (error) {
      console.error('Failed to save scheduled notifications:', error);
    }
  }

  async scheduleNotification(meeting, alertType, triggerTime) {
    const notificationId = `${meeting.id}-${alertType}`;
    
    // Cancel existing notification if it exists
    if (this.scheduledNotifications.has(notificationId)) {
      await Notifications.cancelScheduledNotificationAsync(
        this.scheduledNotifications.get(notificationId)
      );
    }

    const trigger = new Date(triggerTime);
    
    const notificationRequest = {
      content: {
        title: this.getNotificationTitle(alertType, meeting),
        body: this.getNotificationBody(alertType, meeting),
        data: {
          meetingId: meeting.id,
          alertType,
          meeting: JSON.stringify(meeting)
        },
        sound: 'default',
        priority: Notifications.AndroidImportance.MAX,
        sticky: alertType === 'now' || alertType === '1min', // Persistent for critical alerts
        autoDismiss: alertType !== 'now', // Don't auto-dismiss meeting start alerts
      },
      trigger,
    };

    try {
      const scheduledId = await Notifications.scheduleNotificationAsync(notificationRequest);
      this.scheduledNotifications.set(notificationId, scheduledId);
      await this.saveScheduledNotifications();
      
      console.log(`📅 Scheduled ${alertType} notification for ${meeting.title} at ${trigger.toISOString()}`);
      return scheduledId;
    } catch (error) {
      console.error('Failed to schedule notification:', error);
      return null;
    }
  }

  async scheduleMeetingAlerts(meeting) {
    const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
    const now = new Date();

    const alertSchedule = [
      { type: '1day', offset: 24 * 60 * 60 * 1000 },
      { type: '1hour', offset: 60 * 60 * 1000 },
      { type: '15min', offset: 15 * 60 * 1000 },
      { type: '5min', offset: 5 * 60 * 1000 },
      { type: '1min', offset: 1 * 60 * 1000 },
      { type: 'now', offset: 0 },
    ];

    const scheduledIds = [];

    for (const alert of alertSchedule) {
      const triggerTime = meetingTime.getTime() - alert.offset;
      
      if (triggerTime > now.getTime()) {
        const id = await this.scheduleNotification(meeting, alert.type, triggerTime);
        if (id) scheduledIds.push(id);
      }
    }

    return scheduledIds;
  }

  getNotificationTitle(alertType, meeting) {
    switch (alertType) {
      case '1day': return '📅 Tomorrow\'s Meeting';
      case '1hour': return '⏰ Meeting in 1 Hour';
      case '15min': return '🔔 Meeting in 15 Minutes';
      case '5min': return '🚨 Meeting in 5 Minutes!';
      case '1min': return '🔥 Meeting Starting Soon!';
      case 'now': return '🚀 Meeting Starting Now!';
      default: return '📋 Meeting Reminder';
    }
  }

  getNotificationBody(alertType, meeting) {
    const time = meeting.time || 'Time TBD';
    const location = meeting.location ? ` at ${meeting.location}` : '';
    
    switch (alertType) {
      case '1day': 
        return `Don't forget: "${meeting.title}" tomorrow at ${time}${location}`;
      case '1hour':
        return `Get ready: "${meeting.title}" starts at ${time}${location}`;
      case '15min':
        return `Final preparations: "${meeting.title}" starts at ${time}${location}`;
      case '5min':
        return `Join now: "${meeting.title}" is starting at ${time}${location}`;
      case '1min':
        return `URGENT: "${meeting.title}" starts in 1 minute${location}`;
      case 'now':
        return `JOIN NOW: "${meeting.title}" is starting${location}`;
      default:
        return `Reminder: ${meeting.title}`;
    }
  }

  async cancelMeetingAlerts(meetingId) {
    const alertTypes = ['1day', '1hour', '15min', '5min', '1min', 'now'];
    
    for (const alertType of alertTypes) {
      const notificationId = `${meetingId}-${alertType}`;
      if (this.scheduledNotifications.has(notificationId)) {
        await Notifications.cancelScheduledNotificationAsync(
          this.scheduledNotifications.get(notificationId)
        );
        this.scheduledNotifications.delete(notificationId);
      }
    }
    
    await this.saveScheduledNotifications();
  }

  async refreshAllMeetingAlerts(meetings) {
    // Cancel all existing notifications
    await Notifications.cancelAllScheduledNotificationsAsync();
    this.scheduledNotifications.clear();

    // Reschedule all upcoming meetings
    for (const meeting of meetings) {
      await this.scheduleMeetingAlerts(meeting);
    }

    console.log(`🔄 Refreshed alerts for ${meetings.length} meetings`);
  }
}

export default new LocalNotificationScheduler();
```

### Step 4: Push Notification Service

```javascript
// src/services/PushNotificationService.js
import { registerForPushNotificationsAsync } from './NotificationPermissions';

class PushNotificationService {
  constructor() {
    this.pushToken = null;
    this.initialize();
  }

  async initialize() {
    this.pushToken = await registerForPushNotificationsAsync();
    
    if (this.pushToken) {
      // Send token to your backend
      await this.registerTokenWithBackend(this.pushToken);
    }
  }

  async registerTokenWithBackend(token) {
    try {
      const response = await fetch(`${process.env.BACKEND_URL}/api/notifications/register-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await AsyncStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          pushToken: token,
          platform: Platform.OS,
        }),
      });

      if (response.ok) {
        console.log('✅ Push token registered with backend');
      }
    } catch (error) {
      console.error('Failed to register push token:', error);
    }
  }

  async schedulePushNotification(meeting, alertType, triggerTime) {
    if (!this.pushToken) return;

    try {
      const response = await fetch(`${process.env.BACKEND_URL}/api/notifications/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await AsyncStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          pushToken: this.pushToken,
          meeting,
          alertType,
          triggerTime: new Date(triggerTime).toISOString(),
        }),
      });

      if (response.ok) {
        console.log(`📤 Scheduled push notification for ${meeting.title} - ${alertType}`);
      }
    } catch (error) {
      console.error('Failed to schedule push notification:', error);
    }
  }
}

export default new PushNotificationService();
```

### Step 5: Background Task Manager

```javascript
// src/services/BackgroundTaskManager.js
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import LocalNotificationScheduler from './LocalNotificationScheduler';
import { Meeting } from '../api/entities';

const BACKGROUND_FETCH_TASK = 'background-notification-refresh';

// Define the background task
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    console.log('🔄 Background task: Refreshing meeting notifications');
    
    // Fetch latest meetings
    const meetings = await Meeting.list();
    const upcomingMeetings = meetings.filter(meeting => {
      const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
      return meetingTime > new Date();
    });

    // Refresh local notifications
    await LocalNotificationScheduler.refreshAllMeetingAlerts(upcomingMeetings);
    
    console.log(`✅ Background task completed: Updated ${upcomingMeetings.length} meetings`);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('❌ Background task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

class BackgroundTaskManager {
  async initialize() {
    try {
      // Register background fetch
      await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 15 * 60, // 15 minutes
        stopOnTerminate: false, // Continue after app is killed
        startOnBoot: true, // Start when device boots
      });

      console.log('✅ Background fetch registered');
    } catch (error) {
      console.error('❌ Failed to register background fetch:', error);
    }
  }

  async unregister() {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
  }
}

export default new BackgroundTaskManager();
```

### Step 6: Integration with Existing System

```javascript
// src/services/EnhancedNotificationManager.js
import LocalNotificationScheduler from './LocalNotificationScheduler';
import PushNotificationService from './PushNotificationService';
import BackgroundTaskManager from './BackgroundTaskManager';

class EnhancedNotificationManager {
  constructor() {
    this.initialize();
  }

  async initialize() {
    // Initialize all notification services
    await PushNotificationService.initialize();
    await BackgroundTaskManager.initialize();
    
    console.log('🚀 Enhanced notification system initialized');
  }

  async scheduleMeetingNotifications(meeting) {
    // Schedule both local and push notifications for redundancy
    await LocalNotificationScheduler.scheduleMeetingAlerts(meeting);
    
    // Schedule push notifications as backup
    const alertSchedule = [
      { type: '1day', offset: 24 * 60 * 60 * 1000 },
      { type: '1hour', offset: 60 * 60 * 1000 },
      { type: '15min', offset: 15 * 60 * 1000 },
      { type: '5min', offset: 5 * 60 * 1000 },
      { type: '1min', offset: 1 * 60 * 1000 },
      { type: 'now', offset: 0 },
    ];

    const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
    
    for (const alert of alertSchedule) {
      const triggerTime = meetingTime.getTime() - alert.offset;
      if (triggerTime > Date.now()) {
        await PushNotificationService.schedulePushNotification(meeting, alert.type, triggerTime);
      }
    }
  }

  async cancelMeetingNotifications(meetingId) {
    await LocalNotificationScheduler.cancelMeetingAlerts(meetingId);
    // Also cancel push notifications via backend API
  }

  async refreshAllNotifications() {
    const meetings = await Meeting.list();
    const upcomingMeetings = meetings.filter(meeting => {
      const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
      return meetingTime > new Date();
    });

    await LocalNotificationScheduler.refreshAllMeetingAlerts(upcomingMeetings);
  }
}

export default new EnhancedNotificationManager();
```

## 🔧 Backend Implementation

### Server-Side Push Notification Scheduler

```javascript
// backend/services/NotificationScheduler.js
const cron = require('node-cron');
const admin = require('firebase-admin');
const { Meeting, User } = require('../models');

class NotificationScheduler {
  constructor() {
    this.scheduledJobs = new Map();
    this.startScheduler();
  }

  startScheduler() {
    // Check for notifications to send every minute
    cron.schedule('* * * * *', async () => {
      await this.checkAndSendNotifications();
    });
  }

  async checkAndSendNotifications() {
    try {
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

      // Find meetings that need notifications in the next 5 minutes
      const meetings = await Meeting.findAll({
        where: {
          startTime: {
            [Op.between]: [now, fiveMinutesFromNow]
          }
        },
        include: [User]
      });

      for (const meeting of meetings) {
        await this.sendMeetingNotification(meeting);
      }
    } catch (error) {
      console.error('Error checking notifications:', error);
    }
  }

  async sendMeetingNotification(meeting) {
    const user = meeting.User;
    if (!user.pushToken) return;

    const message = {
      token: user.pushToken,
      notification: {
        title: '🚀 Meeting Starting Now!',
        body: `"${meeting.title}" is starting now!`,
      },
      data: {
        meetingId: meeting.id.toString(),
        type: 'meeting-alert',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'meeting-alerts',
          priority: 'max',
          defaultVibrate: true,
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: '🚀 Meeting Starting Now!',
              body: `"${meeting.title}" is starting now!`,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    try {
      await admin.messaging().send(message);
      console.log(`✅ Sent notification for meeting: ${meeting.title}`);
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }
}

module.exports = new NotificationScheduler();
```

## 🚀 Usage Integration

Update your existing AlertScheduler to use the new system:

```javascript
// Update src/components/AlertScheduler.jsx
import EnhancedNotificationManager from '../services/EnhancedNotificationManager';

// Replace the existing scheduleAlertsForMeeting function
const scheduleAlertsForMeeting = async (meeting) => {
  await EnhancedNotificationManager.scheduleMeetingNotifications(meeting);
};
```

## 📱 Testing Strategy

1. **Local Testing**: Test with app in foreground/background/killed
2. **Push Testing**: Use Expo Push Tool or Firebase Console
3. **Background Testing**: Test background fetch with device settings
4. **Server Testing**: Test cron jobs and push delivery

## 🔒 Reliability Features

1. **Redundancy**: Local + Push + Server notifications
2. **Persistence**: Notifications survive app kills and device restarts
3. **Fallback**: Multiple layers ensure delivery
4. **Monitoring**: Comprehensive logging and error handling

This implementation provides WhatsApp/Telegram-level reliability for meeting notifications!
