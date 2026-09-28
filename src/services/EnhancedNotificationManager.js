import * as Notifications from 'expo-notifications';
import LocalNotificationScheduler from './LocalNotificationScheduler';
import BackgroundTaskManager from './BackgroundTaskManager';
import { registerForPushNotificationsAsync, checkNotificationPermissions } from './NotificationPermissions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

class EnhancedNotificationManager {
  constructor() {
    this.pushToken = null;
    this.isInitialized = false;
    this.notificationListener = null;
    this.responseListener = null;
  }

  async initialize() {
    try {
      console.log('🚀 Initializing Enhanced Notification System...');
      
      // Check and request permissions
      try {
        const hasPermissions = await checkNotificationPermissions();
        if (!hasPermissions) {
          console.warn('⚠️ Notification permissions not granted, but continuing...');
        }
      } catch (permError) {
        console.warn('⚠️ Permission check failed, but continuing:', permError.message);
      }

      // Register for push notifications (optional)
      try {
        this.pushToken = await registerForPushNotificationsAsync();
        if (this.pushToken) {
          console.log('✅ Push token obtained:', this.pushToken);
          await this.registerTokenWithBackend(this.pushToken);
        }
      } catch (pushError) {
        console.warn('⚠️ Push notification setup failed, but continuing:', pushError.message);
      }

      // Initialize background task manager (optional)
      try {
        await BackgroundTaskManager.initialize();
      } catch (bgError) {
        console.warn('⚠️ Background task manager failed, but continuing:', bgError.message);
      }

      // Set up notification listeners (optional)
      try {
        this.setupNotificationListeners();
      } catch (listenerError) {
        console.warn('⚠️ Notification listeners setup failed, but continuing:', listenerError.message);
      }

      this.isInitialized = true;
      console.log('✅ Enhanced notification system initialized successfully (with fallbacks)');
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize notification system:', error);
      // Still return true to allow app to continue
      this.isInitialized = true;
      return true;
    }
  }

  setupNotificationListeners() {
    // Listen for notifications received while app is running
    this.notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('📱 Notification received:', notification);
    });

    // Listen for user interactions with notifications
    this.responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('👆 Notification response:', response);
      this.handleNotificationResponse(response);
    });
  }

  async handleNotificationResponse(response) {
    try {
      const { notification, actionIdentifier } = response || {};
      
      if (!notification || !notification.request || !notification.request.content) {
        console.warn('⚠️ Invalid notification response structure');
        return;
      }

      const data = notification.request.content.data || {};
      const { meetingId, alertType, meeting } = data;

      console.log(`🎯 User interacted with notification`, { actionIdentifier, meetingId, alertType });

      // Parse meeting data safely
      let meetingData = null;
      try {
        meetingData = typeof meeting === 'string' ? JSON.parse(meeting) : meeting;
      } catch (parseError) {
        console.warn('⚠️ Could not parse meeting data:', parseError.message);
        meetingData = { title: 'Meeting', id: meetingId };
      }

      // Handle different actions
      switch (actionIdentifier) {
        case 'view':
          console.log('📋 User wants to view meeting:', meetingData?.title || 'Unknown');
          break;
        
        case 'snooze':
          if (meetingData) {
            await this.snoozeMeetingNotification(meetingData, 5);
          }
          break;
        
        default:
          console.log('📱 User tapped notification:', meetingData?.title || 'Unknown');
          break;
      }
    } catch (error) {
      console.error('❌ Error handling notification response:', error);
    }
  }

  async snoozeMeetingNotification(meeting, snoozeMinutes = 5) {
    try {
      const snoozeTime = new Date(Date.now() + snoozeMinutes * 60 * 1000);
      
      await LocalNotificationScheduler.scheduleNotification(
        meeting,
        'snooze',
        snoozeTime.getTime()
      );
      
      console.log(`😴 Snoozed notification for ${meeting.title} for ${snoozeMinutes} minutes`);
    } catch (error) {
      console.error('Failed to snooze notification:', error);
    }
  }

  async registerTokenWithBackend(token) {
    try {
      const authToken = await AsyncStorage.getItem('authToken');
      if (!authToken) {
        console.warn('No auth token available for backend registration');
        return;
      }

      const response = await fetch(`${process.env.BACKEND_URL}/api/notifications/register-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          pushToken: token,
          platform: Platform.OS,
          deviceId: await this.getDeviceId(),
        }),
      });

      if (response.ok) {
        console.log('✅ Push token registered with backend');
      } else {
        console.warn('⚠️ Failed to register push token with backend:', response.status);
      }
    } catch (error) {
      console.error('Failed to register push token with backend:', error);
    }
  }

  async getDeviceId() {
    try {
      let deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) {
        deviceId = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await AsyncStorage.setItem('deviceId', deviceId);
      }
      return deviceId;
    } catch (error) {
      return `${Platform.OS}-${Date.now()}`;
    }
  }

  async scheduleMeetingNotifications(meeting) {
    if (!this.isInitialized) {
      console.warn('⚠️ Notification system not initialized');
      return false;
    }

    try {
      console.log(`📅 Scheduling notifications for meeting: ${meeting.title}`);
      
      // Schedule local notifications (primary method)
      const localResult = await LocalNotificationScheduler.scheduleMeetingAlerts(meeting);
      
      // Schedule push notifications as backup (if backend is available)
      if (this.pushToken) {
        await this.schedulePushNotifications(meeting);
      }

      console.log(`✅ Scheduled ${localResult.length} local notifications for: ${meeting.title}`);
      return true;
    } catch (error) {
      console.error('Failed to schedule meeting notifications:', error);
      return false;
    }
  }

  async schedulePushNotifications(meeting) {
    try {
      const authToken = await AsyncStorage.getItem('authToken');
      if (!authToken) return;

      const response = await fetch(`${process.env.BACKEND_URL}/api/notifications/schedule-meeting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          meeting,
          pushToken: this.pushToken,
        }),
      });

      if (response.ok) {
        console.log(`📤 Scheduled push notifications for: ${meeting.title}`);
      }
    } catch (error) {
      console.error('Failed to schedule push notifications:', error);
    }
  }

  async cancelMeetingNotifications(meetingId) {
    try {
      console.log(`🗑️ Cancelling notifications for meeting: ${meetingId}`);
      
      // Cancel local notifications
      await LocalNotificationScheduler.cancelMeetingAlerts(meetingId);
      
      // Cancel push notifications via backend
      if (this.pushToken) {
        await this.cancelPushNotifications(meetingId);
      }

      console.log(`✅ Cancelled notifications for meeting: ${meetingId}`);
      return true;
    } catch (error) {
      console.error('Failed to cancel meeting notifications:', error);
      return false;
    }
  }

  async cancelPushNotifications(meetingId) {
    try {
      const authToken = await AsyncStorage.getItem('authToken');
      if (!authToken) return;

      const response = await fetch(`${process.env.BACKEND_URL}/api/notifications/cancel-meeting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          meetingId,
          pushToken: this.pushToken,
        }),
      });

      if (response.ok) {
        console.log(`📤 Cancelled push notifications for meeting: ${meetingId}`);
      }
    } catch (error) {
      console.error('Failed to cancel push notifications:', error);
    }
  }

  async refreshAllNotifications() {
    try {
      console.log('🔄 Refreshing all notifications...');
      
      // Force refresh via background task manager
      const result = await BackgroundTaskManager.forceRefreshNotifications();
      
      console.log(`✅ Refreshed notifications: ${result.meetingsProcessed} meetings, ${result.notificationsScheduled} notifications`);
      return result;
    } catch (error) {
      console.error('Failed to refresh notifications:', error);
      throw error;
    }
  }

  async getNotificationStatus() {
    try {
      const [
        hasPermissions,
        scheduledCount,
        backgroundStatus,
        scheduledNotifications
      ] = await Promise.all([
        checkNotificationPermissions(),
        LocalNotificationScheduler.getScheduledNotificationCount(),
        BackgroundTaskManager.getStatus(),
        LocalNotificationScheduler.getScheduledNotifications()
      ]);

      return {
        isInitialized: this.isInitialized,
        hasPermissions,
        pushToken: this.pushToken,
        scheduledCount,
        backgroundStatus,
        scheduledNotifications: scheduledNotifications.slice(0, 10), // First 10 for preview
      };
    } catch (error) {
      console.error('Failed to get notification status:', error);
      return {
        isInitialized: false,
        hasPermissions: false,
        pushToken: null,
        scheduledCount: 0,
        backgroundStatus: { status: 'unknown' },
        scheduledNotifications: [],
      };
    }
  }

  async clearAllNotifications() {
    try {
      await LocalNotificationScheduler.clearAllNotifications();
      console.log('🧹 Cleared all notifications');
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  }

  cleanup() {
    if (this.notificationListener) {
      // removeNotificationSubscription() no longer exists in expo-notifications; subscriptions remove themselves.
      this.notificationListener.remove();
      this.notificationListener = null;
    }
    if (this.responseListener) {
      this.responseListener.remove();
      this.responseListener = null;
    }
  }
}

export default new EnhancedNotificationManager();
