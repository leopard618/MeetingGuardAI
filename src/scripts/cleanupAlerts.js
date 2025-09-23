// Emergency Alert Cleanup Script
// Run this to immediately clean up orphaned alert schedules

import AlertCleanup from '../utils/alertCleanup.js';

async function emergencyCleanup() {
  console.log('🚨 Starting emergency alert cleanup...');
  
  try {
    // Get current stats
    const statsBefore = await AlertCleanup.getAlertScheduleStats();
    console.log('📊 Alert schedules before cleanup:', statsBefore);
    
    // Clean up orphaned alerts
    const result = await AlertCleanup.cleanupOrphanedAlerts();
    console.log('✅ Cleanup result:', result);
    
    // Get stats after cleanup
    const statsAfter = await AlertCleanup.getAlertScheduleStats();
    console.log('📊 Alert schedules after cleanup:', statsAfter);
    
    console.log('🎉 Emergency cleanup completed successfully!');
  } catch (error) {
    console.error('❌ Emergency cleanup failed:', error);
  }
}

// Run if this script is executed directly
if (typeof window !== 'undefined') {
  // Browser environment
  window.emergencyCleanup = emergencyCleanup;
  console.log('Emergency cleanup function available as window.emergencyCleanup()');
} else {
  // Node environment
  emergencyCleanup();
}

export default emergencyCleanup;
