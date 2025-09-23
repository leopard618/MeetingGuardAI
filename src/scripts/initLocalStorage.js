// Initialize/Reset localStorage
// This will clear all alert schedules and reset localStorage to a clean state

async function initLocalStorage() {
  console.log('🔄 Initializing localStorage...');
  
  try {
    // Import storage utility
    const { storage } = await import('../utils/storage.js');
    
    // Get all keys to see what we're clearing
    const allKeys = await storage.getAllKeys();
    console.log('📋 Current localStorage keys:', allKeys);
    
    // Find and remove all alert schedules
    const alertKeys = allKeys.filter(key => key.startsWith('alertSchedule_'));
    console.log(`🔍 Found ${alertKeys.length} alert schedules to remove`);
    
    // Remove all alert schedules
    for (const key of alertKeys) {
      await storage.removeItem(key);
      console.log(`🗑️ Removed: ${key}`);
    }
    
    // Optionally clear ALL localStorage (uncomment if you want full reset)
    // localStorage.clear();
    // console.log('🧹 Cleared entire localStorage');
    
    console.log('✅ localStorage initialization completed!');
    console.log('🎉 All orphaned alert schedules removed');
    console.log('📊 AlertScheduler will recreate schedules for valid meetings only');
    
    return {
      success: true,
      alertSchedulesRemoved: alertKeys.length,
      message: 'localStorage initialized successfully'
    };
    
  } catch (error) {
    console.error('❌ Failed to initialize localStorage:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Full localStorage reset (if needed)
async function fullLocalStorageReset() {
  console.log('🚨 Performing FULL localStorage reset...');
  
  try {
    // Clear everything
    localStorage.clear();
    
    // Re-initialize with basic structure
    const basicData = {
      meetings: [],
      notes: [],
      apiKeys: [],
      userPreferences: [],
      users: []
    };
    
    localStorage.setItem('meetingGuardData', JSON.stringify(basicData));
    
    console.log('✅ Full localStorage reset completed');
    console.log('📋 Basic data structure recreated');
    
    return {
      success: true,
      message: 'Full localStorage reset completed'
    };
    
  } catch (error) {
    console.error('❌ Full reset failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Selective cleanup - only remove problematic items
async function selectiveCleanup() {
  console.log('🧹 Performing selective cleanup...');
  
  try {
    const { storage } = await import('../utils/storage.js');
    const allKeys = await storage.getAllKeys();
    
    const itemsToRemove = [
      // Alert schedules
      ...allKeys.filter(key => key.startsWith('alertSchedule_')),
      // Any corrupted data
      ...allKeys.filter(key => key.includes('undefined')),
      // Old cache entries
      ...allKeys.filter(key => key.startsWith('cache_')),
    ];
    
    console.log(`🔍 Found ${itemsToRemove.length} items to remove:`, itemsToRemove);
    
    for (const key of itemsToRemove) {
      await storage.removeItem(key);
      console.log(`🗑️ Removed: ${key}`);
    }
    
    console.log('✅ Selective cleanup completed');
    
    return {
      success: true,
      itemsRemoved: itemsToRemove.length,
      message: 'Selective cleanup completed'
    };
    
  } catch (error) {
    console.error('❌ Selective cleanup failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.initLocalStorage = initLocalStorage;
  window.fullLocalStorageReset = fullLocalStorageReset;
  window.selectiveCleanup = selectiveCleanup;
  
  console.log('💡 localStorage initialization functions available:');
  console.log('   - window.initLocalStorage() - Remove alert schedules only');
  console.log('   - window.selectiveCleanup() - Remove problematic items');
  console.log('   - window.fullLocalStorageReset() - Complete reset (use with caution)');
}

export { initLocalStorage, fullLocalStorageReset, selectiveCleanup };
