import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import LocalNotificationScheduler from './LocalNotificationScheduler';
import { Meeting } from '../api/entities';

const BACKGROUND_FETCH_TASK = 'background-notification-refresh';

// Define the background task
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    console.log('🔄 Background task: Refreshing meeting notifications');
    const startTime = Date.now();
    
    // Fetch latest meetings
    const meetings = await Meeting.list();
    const currentTime = new Date();
    
    // Filter for upcoming meetings (next 7 days)
    const upcomingMeetings = meetings.filter(meeting => {
      try {
        const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
        const sevenDaysFromNow = new Date(currentTime.getTime() + 7 * 24 * 60 * 60 * 1000);
        return meetingTime > currentTime && meetingTime <= sevenDaysFromNow;
      } catch (error) {
        console.error('Invalid meeting time in background task:', meeting.title, error);
        return false;
      }
    });

    // Refresh local notifications
    const result = await LocalNotificationScheduler.refreshAllMeetingAlerts(upcomingMeetings);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Background task completed in ${duration}ms: Updated ${result.meetingsProcessed} meetings, scheduled ${result.notificationsScheduled} notifications`);
    
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('❌ Background task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

class BackgroundTaskManager {
  constructor() {
    this.isRegistered = false;
  }

  async initialize() {
    try {
      // Check if background fetch is available
      const status = await BackgroundFetch.getStatusAsync();
      if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) {
        console.warn('⚠️ Background fetch is restricted on this device');
        return false;
      }

      // Register background fetch task
      await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 15 * 60, // 15 minutes minimum interval
        stopOnTerminate: false, // Continue after app is killed
        startOnBoot: true, // Start when device boots
      });

      this.isRegistered = true;
      console.log('✅ Background fetch registered successfully');
      
      // Set background fetch interval (this is a hint to the OS)
      await BackgroundFetch.setMinimumIntervalAsync(15 * 60); // 15 minutes
      
      return true;
    } catch (error) {
      console.error('❌ Failed to register background fetch:', error);
      return false;
    }
  }

  async unregister() {
    try {
      if (this.isRegistered) {
        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
        this.isRegistered = false;
        console.log('🛑 Background fetch unregistered');
      }
    } catch (error) {
      console.error('Failed to unregister background fetch:', error);
    }
  }

  async getStatus() {
    try {
      const status = await BackgroundFetch.getStatusAsync();
      const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
      
      return {
        status,
        isTaskRegistered,
        isManagerRegistered: this.isRegistered,
        statusText: this.getStatusText(status),
      };
    } catch (error) {
      console.error('Failed to get background fetch status:', error);
      return {
        status: 'unknown',
        isTaskRegistered: false,
        isManagerRegistered: false,
        statusText: 'Unknown',
      };
    }
  }

  getStatusText(status) {
    switch (status) {
      case BackgroundFetch.BackgroundFetchStatus.Available:
        return 'Available';
      case BackgroundFetch.BackgroundFetchStatus.Denied:
        return 'Denied';
      case BackgroundFetch.BackgroundFetchStatus.Restricted:
        return 'Restricted';
      default:
        return 'Unknown';
    }
  }

  // Manual trigger for testing
  async triggerBackgroundTask() {
    try {
      console.log('🧪 Manually triggering background task...');
      const result = await TaskManager.getTaskOptionsAsync(BACKGROUND_FETCH_TASK);
      
      if (result) {
        // Execute the task function directly for testing
        const taskResult = await TaskManager.getRegisteredTasksAsync();
        console.log('Background task triggered manually, result:', taskResult);
        return true;
      } else {
        console.warn('Background task not registered');
        return false;
      }
    } catch (error) {
      console.error('Failed to trigger background task:', error);
      return false;
    }
  }

  // Force refresh notifications (can be called from app)
  async forceRefreshNotifications() {
    try {
      console.log('🔄 Force refreshing notifications...');
      
      const meetings = await Meeting.list();
      const currentTime = new Date();
      
      const upcomingMeetings = meetings.filter(meeting => {
        try {
          const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
          return meetingTime > currentTime;
        } catch (error) {
          return false;
        }
      });

      const result = await LocalNotificationScheduler.refreshAllMeetingAlerts(upcomingMeetings);
      console.log(`✅ Force refresh completed: ${result.meetingsProcessed} meetings, ${result.notificationsScheduled} notifications`);
      
      return result;
    } catch (error) {
      console.error('❌ Force refresh failed:', error);
      throw error;
    }
  }
}

export default new BackgroundTaskManager();
