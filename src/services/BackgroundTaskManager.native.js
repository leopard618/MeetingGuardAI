import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import LocalNotificationScheduler from './LocalNotificationScheduler';
import { Meeting } from '../api/entities';

// expo-background-task (WorkManager on Android, BGTaskScheduler on iOS) replaces the deprecated
// expo-background-fetch. It only refreshes already-scheduled local notifications; alert
// delivery itself never depends on this task running.
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
    
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('❌ Background task failed:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

class BackgroundTaskManager {
  constructor() {
    this.isRegistered = false;
  }

  async initialize() {
    try {
      // Check if background tasks are available
      const status = await BackgroundTask.getStatusAsync();
      if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
        console.warn('⚠️ Background tasks are restricted on this device');
        return false;
      }

      // Register the background task once. The interval is in MINUTES (minimum 15) and is
      // only a hint - the OS decides when the task actually runs.
      const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
      if (!alreadyRegistered) {
        await BackgroundTask.registerTaskAsync(BACKGROUND_FETCH_TASK, {
          minimumInterval: 15,
        });
      }

      this.isRegistered = true;
      console.log('✅ Background task registered successfully');

      return true;
    } catch (error) {
      console.error('❌ Failed to register background fetch:', error);
      return false;
    }
  }

  async unregister() {
    try {
      if (this.isRegistered) {
        await BackgroundTask.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
        this.isRegistered = false;
        console.log('🛑 Background fetch unregistered');
      }
    } catch (error) {
      console.error('Failed to unregister background fetch:', error);
    }
  }

  async getStatus() {
    try {
      const status = await BackgroundTask.getStatusAsync();
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
      case BackgroundTask.BackgroundTaskStatus.Available:
        return 'Available';
      case BackgroundTask.BackgroundTaskStatus.Restricted:
        return 'Restricted';
      default:
        return 'Unknown';
    }
  }

  // Manual trigger for testing
  async triggerBackgroundTask() {
    try {
      console.log('🧪 Manually triggering background task...');
      const isTaskRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
      if (!isTaskRegistered) {
        console.warn('Background task not registered');
        return false;
      }
      // Development builds only: asks the OS worker to run registered tasks now.
      return await BackgroundTask.triggerTaskWorkerForTestingAsync();
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
