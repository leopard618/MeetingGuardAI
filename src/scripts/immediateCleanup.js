// Immediate Alert Cleanup Script
// Run this in the browser console to immediately clean up ALL orphaned alert schedules

(async function immediateCleanup() {
  console.log('🚨 Starting IMMEDIATE alert cleanup...');
  
  try {
    // Get access to storage utility
    const { storage } = await import('../utils/storage.js');
    
    // Get all keys
    const keys = await storage.getAllKeys();
    const alertKeys = keys.filter(key => key.startsWith('alertSchedule_'));
    
    console.log(`🔍 Found ${alertKeys.length} alert schedules to check/remove`);
    
    if (alertKeys.length === 0) {
      console.log('✅ No alert schedules found to clean');
      return;
    }
    
    // Remove all alert schedules immediately
    let removedCount = 0;
    for (const key of alertKeys) {
      try {
        await storage.removeItem(key);
        removedCount++;
        console.log(`🗑️ Removed: ${key}`);
      } catch (error) {
        console.error(`❌ Failed to remove ${key}:`, error);
      }
    }
    
    console.log(`✅ IMMEDIATE cleanup completed: Removed ${removedCount} alert schedules`);
    console.log('🎉 All orphaned alerts should be gone now!');
    console.log('📊 The AlertScheduler will recreate schedules for valid meetings on next run');
    
    return { removed: removedCount, total: alertKeys.length };
  } catch (error) {
    console.error('❌ Immediate cleanup failed:', error);
    return { removed: 0, total: 0 };
  }
})();

// Also make it available as a global function
window.immediateAlertCleanup = async function() {
  // Same logic as above but callable from console
  try {
    const { storage } = await import('../utils/storage.js');
    const keys = await storage.getAllKeys();
    const alertKeys = keys.filter(key => key.startsWith('alertSchedule_'));
    
    console.log(`🔍 Found ${alertKeys.length} alert schedules to remove`);
    
    let removedCount = 0;
    for (const key of alertKeys) {
      try {
        await storage.removeItem(key);
        removedCount++;
      } catch (error) {
        console.error(`Failed to remove ${key}:`, error);
      }
    }
    
    console.log(`✅ Removed ${removedCount} alert schedules immediately`);
    return { removed: removedCount, total: alertKeys.length };
  } catch (error) {
    console.error('Immediate cleanup failed:', error);
    return { removed: 0, total: 0 };
  }
};

console.log('💡 Run window.immediateAlertCleanup() in the console to clean up all alert schedules immediately');
