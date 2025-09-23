// Alert Cleanup Utility
// Helps clean up orphaned alert schedules from localStorage

import { storage } from './storage.js';
import { Meeting } from '../api/entities.js';

export class AlertCleanup {
  static async cleanupOrphanedAlerts() {
    try {
      console.log('🧹 Starting cleanup of orphaned alert schedules...');
      
      const keys = await storage.getAllKeys();
      const alertKeys = keys.filter(key => key.startsWith('alertSchedule_'));
      
      if (alertKeys.length === 0) {
        console.log('✅ No alert schedules found to clean');
        return;
      }
      
      let removedCount = 0;
      let checkedCount = 0;
      
      for (const key of alertKeys) {
        try {
          checkedCount++;
          const meetingId = key.replace('alertSchedule_', '');
          
          // Check if the meeting still exists
          const meeting = await Meeting.get(meetingId);
          
          if (!meeting) {
            // Meeting doesn't exist, remove the alert schedule
            await storage.removeItem(key);
            removedCount++;
            console.log(`🗑️ Removed alert schedule for non-existent meeting: ${meetingId}`);
          }
          
          // Add a small delay to prevent overwhelming the API
          if (checkedCount % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          // If we get a 404 or error, assume meeting doesn't exist and remove alert
          if (error.message?.includes('404')) {
            await storage.removeItem(key);
            removedCount++;
            console.log(`🗑️ Removed alert schedule for 404 meeting: ${key}`);
          } else {
            console.error(`Error checking meeting for alert ${key}:`, error);
          }
        }
      }
      
      console.log(`✅ Alert cleanup completed: checked ${checkedCount}, removed ${removedCount} orphaned schedules`);
      return { checked: checkedCount, removed: removedCount };
    } catch (error) {
      console.error('Failed to cleanup orphaned alerts:', error);
      return { checked: 0, removed: 0 };
    }
  }
  
  static async removeAllAlertSchedules() {
    try {
      const keys = await storage.getAllKeys();
      const alertKeys = keys.filter(key => key.startsWith('alertSchedule_'));
      
      for (const key of alertKeys) {
        await storage.removeItem(key);
      }
      
      console.log(`🗑️ Removed all ${alertKeys.length} alert schedules`);
      return alertKeys.length;
    } catch (error) {
      console.error('Failed to remove all alert schedules:', error);
      return 0;
    }
  }
  
  static async getAlertScheduleStats() {
    try {
      const keys = await storage.getAllKeys();
      const alertKeys = keys.filter(key => key.startsWith('alertSchedule_'));
      
      const stats = {
        total: alertKeys.length,
        valid: 0,
        invalid: 0,
        old: 0
      };
      
      const now = Date.now();
      const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
      
      for (const key of alertKeys) {
        try {
          const alertDataStr = await storage.getItem(key);
          const alertData = JSON.parse(alertDataStr);
          
          if (alertData.scheduled < oneWeekAgo) {
            stats.old++;
          } else {
            stats.valid++;
          }
        } catch (error) {
          stats.invalid++;
        }
      }
      
      return stats;
    } catch (error) {
      console.error('Failed to get alert schedule stats:', error);
      return { total: 0, valid: 0, invalid: 0, old: 0 };
    }
  }
}

export default AlertCleanup;
