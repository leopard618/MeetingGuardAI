/**
 * Persistent Notification Service
 * Shows an ongoing notification in the system tray when app is in background
 * Like WhatsApp/Telegram - always visible, cannot be dismissed
 */

import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

class PersistentNotificationService {
  constructor() {
    this.isActive = false;
    this.updateInterval = null;
    this.currentNotificationId = null;
    this.nextMeeting = null;
  }

  /**
   * Initialize persistent notification system
   */
  async initialize() {
    try {
      console.log('🔔 Initializing Persistent Notification Service...');

      // Create persistent notification channel (Android) - SILENT section
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('persistent-meeting', {
          name: 'Meeting Guard',
          importance: Notifications.AndroidImportance.LOW, // LOW = Silent section
          sound: null, // Silent - no sound
          vibrationPattern: null, // No vibration
          enableVibrate: false,
          enableLights: false,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          bypassDnd: false,
          showBadge: false,
        });
      }

      // Configure notification behavior
      await Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          // For persistent notification, always show it
          if (notification.request.content.data?.type === 'persistent') {
            return {
              shouldShowAlert: true,
              shouldPlaySound: false,
              shouldSetBadge: false,
            };
          }
          
          // For regular notifications
          return {
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          };
        },
      });

      console.log('✅ Persistent Notification Service initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize persistent notification:', error);
      return false;
    }
  }

  /**
   * Show persistent notification with meeting info
   */
  async showPersistentNotification(meeting) {
    try {
      // ALWAYS show notification, even if no meeting
      this.nextMeeting = meeting;
      
      let title, body, priority;
      
      if (!meeting) {
        // No meeting - show default status
        console.log('📱 No meeting scheduled - showing default notification');
        title = '🔔 Meeting Guard';
        body = 'No upcoming meetings\nTap to create a meeting';
        priority = 'low';
      } else {
        console.log('📱 Attempting to show persistent notification for meeting:', {
          title: meeting.title,
          date: meeting.date,
          time: meeting.time,
          startTime: meeting.startTime
        });
        
        // Calculate time until meeting
        const { countdown, minutesUntil } = this.calculateCountdown(meeting);
        
        console.log(`📱 Time calculation: ${minutesUntil} minutes until meeting`);
        
        // Determine priority based on time
        priority = this.getPriority(minutesUntil);
        
        // Create notification content with meeting info
        title = minutesUntil <= 0 ? '🔴 Meeting Guard - ACTIVE NOW' : '🔔 Meeting Guard - Active';
        body = `Next: ${meeting.title}\n${countdown}`;
      }
      
      console.log(`📱 Showing persistent notification: ${body}`);

      // Cancel previous notification if exists
      if (this.currentNotificationId) {
        await Notifications.dismissNotificationAsync(this.currentNotificationId);
      }

      // Show new persistent notification in SILENT section
      this.currentNotificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: {
            type: 'persistent',
            meetingId: meeting?.id || 'no-meeting',
            meeting: meeting || null,
          },
          sticky: true, // Cannot be dismissed by swiping
          priority: 'low', // Always LOW priority = Silent section
          sound: null, // No sound
          vibrate: false,
          autoDismiss: false,
          categoryIdentifier: 'MEETING_REMINDER',
        },
        trigger: null, // Show immediately
        ...(Platform.OS === 'android' && {
          identifier: 'persistent-meeting-notification',
          channelId: 'persistent-meeting', // Use our SILENT channel
        }),
      });

      this.isActive = true;

      // Start update interval (update every minute)
      this.startUpdateInterval();

      return this.currentNotificationId;
    } catch (error) {
      console.error('❌ Failed to show persistent notification:', error);
      return null;
    }
  }

  /**
   * Update persistent notification with new countdown
   */
  async updatePersistentNotification() {
    try {
      if (!this.isActive) {
        return;
      }

      let title, body, priority;

      if (!this.nextMeeting) {
        // No meeting - show default status
        title = '🔔 Meeting Guard';
        body = 'No upcoming meetings\nTap to create a meeting';
        priority = 'low';
      } else {
        const { countdown, minutesUntil } = this.calculateCountdown(this.nextMeeting);
        priority = this.getPriority(minutesUntil);

        // If meeting has passed, reset to "no meeting" state
        if (minutesUntil < -5) {
          console.log('⏰ Meeting has passed, showing "no meeting" notification');
          this.nextMeeting = null;
          title = '🔔 Meeting Guard';
          body = 'No upcoming meetings\nTap to create a meeting';
          priority = 'low';
        } else {
          title = minutesUntil <= 0 
            ? '🔴 Meeting Guard - ACTIVE NOW' 
            : '🔔 Meeting Guard - Active';
          
          body = `Next: ${this.nextMeeting.title}\n${countdown}`;
        }
      }

      // Cancel previous and show updated
      if (this.currentNotificationId) {
        await Notifications.dismissNotificationAsync(this.currentNotificationId);
      }

      this.currentNotificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: {
            type: 'persistent',
            meetingId: this.nextMeeting?.id || 'no-meeting',
            meeting: this.nextMeeting || null,
          },
          sticky: true,
          priority: 'low', // Always LOW = Silent section
          sound: null, // No sound
          vibrate: false,
          autoDismiss: false,
          categoryIdentifier: 'MEETING_REMINDER',
        },
        trigger: null,
        ...(Platform.OS === 'android' && {
          identifier: 'persistent-meeting-notification',
          channelId: 'persistent-meeting', // Use our SILENT channel
        }),
      });

      console.log(`🔄 Updated persistent notification: ${body}`);
    } catch (error) {
      console.error('❌ Failed to update persistent notification:', error);
    }
  }

  /**
   * Hide persistent notification
   */
  async hidePersistentNotification() {
    try {
      console.log('🔕 Hiding persistent notification');

      if (this.currentNotificationId) {
        await Notifications.dismissNotificationAsync(this.currentNotificationId);
        this.currentNotificationId = null;
      }

      this.stopUpdateInterval();
      this.isActive = false;
      this.nextMeeting = null;

      return true;
    } catch (error) {
      console.error('❌ Failed to hide persistent notification:', error);
      return false;
    }
  }

  /**
   * Start interval to update notification every minute
   */
  startUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.updatePersistentNotification();
    }, 60000); // Update every 60 seconds
  }

  /**
   * Stop update interval
   */
  stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Calculate countdown to meeting
   */
  calculateCountdown(meeting) {
    const now = new Date();
    const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
    const diffMs = meetingTime - now;
    const minutesUntil = Math.floor(diffMs / 60000);

    let countdown = '';

    if (minutesUntil <= 0) {
      countdown = '🔴 Meeting is NOW!';
    } else if (minutesUntil < 60) {
      countdown = `⚠️ In ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}`;
    } else if (minutesUntil < 1440) { // Less than 24 hours
      const hours = Math.floor(minutesUntil / 60);
      const mins = minutesUntil % 60;
      if (mins === 0) {
        countdown = `In ${hours} hour${hours !== 1 ? 's' : ''}`;
      } else {
        countdown = `In ${hours}h ${mins}m`;
      }
    } else {
      const days = Math.floor(minutesUntil / 1440);
      countdown = `In ${days} day${days !== 1 ? 's' : ''}`;
    }

    return { countdown, minutesUntil };
  }

  /**
   * Get notification priority based on time until meeting
   */
  getPriority(minutesUntil) {
    if (minutesUntil <= 0) return 'max';        // NOW
    if (minutesUntil <= 5) return 'high';       // 5 minutes
    if (minutesUntil <= 60) return 'default';   // 1 hour
    return 'low';                                // > 1 hour
  }

  /**
   * Check if persistent notification is active
   */
  isNotificationActive() {
    return this.isActive;
  }

  /**
   * Get current meeting being displayed
   */
  getCurrentMeeting() {
    return this.nextMeeting;
  }

  /**
   * Cleanup - stop all intervals and hide notification
   */
  async cleanup() {
    console.log('🧹 Cleaning up Persistent Notification Service...');
    await this.hidePersistentNotification();
    this.stopUpdateInterval();
  }
}

// Export singleton instance
const persistentNotificationService = new PersistentNotificationService();

// Make available globally for debugging
if (typeof global !== 'undefined') {
  global.persistentNotificationService = persistentNotificationService;
}

export default persistentNotificationService;

