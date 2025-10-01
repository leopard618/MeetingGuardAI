// Simplified Background Task Manager (without native modules)
// This version works without expo-task-manager for immediate testing

import LocalNotificationScheduler from './LocalNotificationScheduler';
import { Meeting } from '../api/entities';
import { AppState } from 'react-native';

class BackgroundTaskManager {
  constructor() {
    this.isRegistered = false;
    this.refreshInterval = null;
    this.appStateSubscription = null;
  }

  async initialize() {
    try {
      console.log('🚀 Initializing Simple Background Task Manager...');
      
      // Set up app state listener for manual refresh
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange.bind(this));
      
      // Start periodic refresh when app is active
      this.startPeriodicRefresh();
      
      this.isRegistered = true;
      console.log('✅ Simple background task manager initialized');
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize background task manager:', error);
      return false;
    }
  }

  handleAppStateChange(nextAppState) {
    console.log('App state changed to:', nextAppState);
    
    if (nextAppState === 'active') {
      // Refresh notifications when app becomes active
      this.forceRefreshNotifications();
      this.startPeriodicRefresh();
    } else {
      // Stop periodic refresh when app goes to background
      this.stopPeriodicRefresh();
    }
  }

  startPeriodicRefresh() {
    // Refresh notifications every 5 minutes when app is active
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(() => {
      this.forceRefreshNotifications();
    }, 5 * 60 * 1000); // 5 minutes
    
    console.log('✅ Started periodic notification refresh (5 minutes)');
  }

  stopPeriodicRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('🛑 Stopped periodic notification refresh');
    }
  }

  async unregister() {
    try {
      this.stopPeriodicRefresh();
      
      if (this.appStateSubscription) {
        this.appStateSubscription.remove();
        this.appStateSubscription = null;
      }
      
      this.isRegistered = false;
      console.log('🛑 Background task manager unregistered');
    } catch (error) {
      console.error('Failed to unregister background task manager:', error);
    }
  }

  async getStatus() {
    return {
      status: 'Available',
      isTaskRegistered: this.isRegistered,
      isManagerRegistered: this.isRegistered,
      statusText: this.isRegistered ? 'Active (Simple Mode)' : 'Inactive',
    };
  }

  // Manual trigger for testing
  async triggerBackgroundTask() {
    try {
      console.log('🧪 Manually triggering background task...');
      const result = await this.forceRefreshNotifications();
      console.log('Background task triggered manually, result:', result);
      return true;
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
