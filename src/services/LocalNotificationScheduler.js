import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

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
        console.log(`📱 Loaded ${this.scheduledNotifications.size} scheduled notifications from storage`);
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
    const isUrgent = alertType === 'now' || alertType === '1min' || alertType === '5min';
    
    const notificationRequest = {
      content: {
        title: this.getNotificationTitle(alertType, meeting),
        body: this.getNotificationBody(alertType, meeting),
        data: {
          meetingId: meeting.id,
          alertType,
          meeting: JSON.stringify(meeting),
          urgent: isUrgent,
        },
        sound: 'default',
        priority: isUrgent ? Notifications.AndroidImportance.MAX : Notifications.AndroidImportance.HIGH,
        sticky: isUrgent, // Make urgent notifications persistent
        autoDismiss: !isUrgent, // Don't auto-dismiss urgent alerts
        categoryIdentifier: 'meeting-alert',
        ...(Platform.OS === 'android' && {
          channelId: isUrgent ? 'urgent-meeting-alerts' : 'meeting-alerts',
        }),
      },
      trigger,
    };

    // Add iOS-specific critical alert for urgent notifications
    if (Platform.OS === 'ios' && isUrgent) {
      notificationRequest.content.critical = true;
      notificationRequest.content.criticalSoundName = 'default';
    }

    try {
      const scheduledId = await Notifications.scheduleNotificationAsync(notificationRequest);
      this.scheduledNotifications.set(notificationId, scheduledId);
      await this.saveScheduledNotifications();
      
      console.log(`📅 Scheduled ${alertType} notification for "${meeting.title}" at ${trigger.toISOString()}`);
      return scheduledId;
    } catch (error) {
      console.error('Failed to schedule notification:', error);
      return null;
    }
  }

  async scheduleMeetingAlerts(meeting) {
    const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
    const now = new Date();

    // Enhanced alert schedule with more granular timing
    const alertSchedule = [
      { type: '1day', offset: 24 * 60 * 60 * 1000 },
      { type: '4hour', offset: 4 * 60 * 60 * 1000 },
      { type: '1hour', offset: 60 * 60 * 1000 },
      { type: '30min', offset: 30 * 60 * 1000 },
      { type: '15min', offset: 15 * 60 * 1000 },
      { type: '10min', offset: 10 * 60 * 1000 },
      { type: '5min', offset: 5 * 60 * 1000 },
      { type: '2min', offset: 2 * 60 * 1000 },
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

    console.log(`📋 Scheduled ${scheduledIds.length} alerts for meeting: ${meeting.title}`);
    return scheduledIds;
  }

  getNotificationTitle(alertType, meeting) {
    switch (alertType) {
      case '1day': return '📅 Tomorrow\'s Meeting';
      case '4hour': return '⏰ Meeting in 4 Hours';
      case '1hour': return '⏰ Meeting in 1 Hour';
      case '30min': return '🔔 Meeting in 30 Minutes';
      case '15min': return '🔔 Meeting in 15 Minutes';
      case '10min': return '🚨 Meeting in 10 Minutes!';
      case '5min': return '🚨 Meeting in 5 Minutes!';
      case '2min': return '🔥 Meeting in 2 Minutes!';
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
      case '4hour':
        return `Prepare for: "${meeting.title}" starts at ${time}${location}`;
      case '1hour':
        return `Get ready: "${meeting.title}" starts at ${time}${location}`;
      case '30min':
        return `Final preparations: "${meeting.title}" starts at ${time}${location}`;
      case '15min':
        return `Almost time: "${meeting.title}" starts at ${time}${location}`;
      case '10min':
        return `Get ready to join: "${meeting.title}" starts at ${time}${location}`;
      case '5min':
        return `Join now: "${meeting.title}" is starting at ${time}${location}`;
      case '2min':
        return `URGENT: "${meeting.title}" starts in 2 minutes${location}`;
      case '1min':
        return `URGENT: "${meeting.title}" starts in 1 minute${location}`;
      case 'now':
        return `JOIN NOW: "${meeting.title}" is starting${location}`;
      default:
        return `Reminder: ${meeting.title}`;
    }
  }

  async cancelMeetingAlerts(meetingId) {
    const alertTypes = ['1day', '4hour', '1hour', '30min', '15min', '10min', '5min', '2min', '1min', 'now'];
    
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
    console.log(`🗑️ Cancelled all alerts for meeting ID: ${meetingId}`);
  }

  async refreshAllMeetingAlerts(meetings) {
    console.log('🔄 Refreshing all meeting alerts...');
    
    // Cancel all existing notifications
    await Notifications.cancelAllScheduledNotificationsAsync();
    this.scheduledNotifications.clear();

    // Filter for upcoming meetings only
    const now = new Date();
    const upcomingMeetings = meetings.filter(meeting => {
      try {
        const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
        return meetingTime > now;
      } catch (error) {
        console.error('Invalid meeting time:', meeting.title, error);
        return false;
      }
    });

    // Reschedule all upcoming meetings
    let totalScheduled = 0;
    for (const meeting of upcomingMeetings) {
      const scheduled = await this.scheduleMeetingAlerts(meeting);
      totalScheduled += scheduled.length;
    }

    await this.saveScheduledNotifications();
    console.log(`✅ Refreshed alerts: ${totalScheduled} notifications for ${upcomingMeetings.length} meetings`);
    
    return {
      meetingsProcessed: upcomingMeetings.length,
      notificationsScheduled: totalScheduled,
    };
  }

  async getScheduledNotificationCount() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.length;
  }

  async getScheduledNotifications() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.map(notification => ({
      id: notification.identifier,
      title: notification.content.title,
      body: notification.content.body,
      trigger: notification.trigger,
      data: notification.content.data,
    }));
  }

  async clearAllNotifications() {
    await Notifications.cancelAllScheduledNotificationsAsync();
    this.scheduledNotifications.clear();
    await this.saveScheduledNotifications();
    console.log('🧹 Cleared all scheduled notifications');
  }
}

export default new LocalNotificationScheduler();
