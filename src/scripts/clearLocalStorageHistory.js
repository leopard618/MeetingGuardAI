// Complete localStorage History Cleanup
// This will remove ALL alert-related data and prevent 404 errors

function clearLocalStorageHistory() {
  console.log('🧹 Starting complete localStorage cleanup...');
  
  try {
    // Get all localStorage keys
    const allKeys = Object.keys(localStorage);
    console.log(`📋 Total localStorage keys found: ${allKeys.length}`);
    
    // Categories of items to remove
    const itemsToRemove = {
      alertSchedules: [],
      cacheItems: [],
      tempData: [],
      errorData: [],
      other: []
    };
    
    // Categorize and collect items to remove
    allKeys.forEach(key => {
      if (key.startsWith('alertSchedule_')) {
        itemsToRemove.alertSchedules.push(key);
      } else if (key.startsWith('cache_') || key.includes('Cache')) {
        itemsToRemove.cacheItems.push(key);
      } else if (key.startsWith('temp_') || key.includes('temp')) {
        itemsToRemove.tempData.push(key);
      } else if (key.includes('error') || key.includes('Error')) {
        itemsToRemove.errorData.push(key);
      } else if (key.includes('undefined') || key.includes('null') || key === '') {
        itemsToRemove.other.push(key);
      }
    });
    
    // Report what we found
    console.log('📊 Items found to remove:');
    console.log(`   🔔 Alert schedules: ${itemsToRemove.alertSchedules.length}`);
    console.log(`   💾 Cache items: ${itemsToRemove.cacheItems.length}`);
    console.log(`   🗂️ Temp data: ${itemsToRemove.tempData.length}`);
    console.log(`   ❌ Error data: ${itemsToRemove.errorData.length}`);
    console.log(`   🔧 Other problematic: ${itemsToRemove.other.length}`);
    
    // Remove all problematic items
    let totalRemoved = 0;
    
    Object.values(itemsToRemove).forEach(categoryItems => {
      categoryItems.forEach(key => {
        try {
          localStorage.removeItem(key);
          totalRemoved++;
          console.log(`🗑️ Removed: ${key}`);
        } catch (error) {
          console.error(`❌ Failed to remove ${key}:`, error);
        }
      });
    });
    
    console.log(`✅ Cleanup completed! Removed ${totalRemoved} items`);
    console.log('🎉 All alert-related history cleared - no more 404 errors!');
    
    return {
      success: true,
      totalRemoved,
      breakdown: {
        alertSchedules: itemsToRemove.alertSchedules.length,
        cacheItems: itemsToRemove.cacheItems.length,
        tempData: itemsToRemove.tempData.length,
        errorData: itemsToRemove.errorData.length,
        other: itemsToRemove.other.length
      }
    };
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    return { success: false, error: error.message };
  }
}

// Nuclear option - clear everything and rebuild
function nuclearReset() {
  console.log('☢️ NUCLEAR RESET: Clearing ALL localStorage...');
  
  try {
    // Backup important data first
    const backup = {
      authToken: localStorage.getItem('authToken'),
      user_data: localStorage.getItem('user_data'),
      refresh_token: localStorage.getItem('refresh_token')
    };
    
    // Clear everything
    localStorage.clear();
    
    // Restore only essential auth data
    if (backup.authToken) localStorage.setItem('authToken', backup.authToken);
    if (backup.user_data) localStorage.setItem('user_data', backup.user_data);
    if (backup.refresh_token) localStorage.setItem('refresh_token', backup.refresh_token);
    
    // Initialize clean data structure
    const cleanData = {
      meetings: [],
      notes: [],
      apiKeys: [],
      userPreferences: [],
      users: []
    };
    
    localStorage.setItem('meetingGuardData', JSON.stringify(cleanData));
    
    console.log('✅ Nuclear reset completed');
    console.log('🔑 Auth tokens preserved');
    console.log('📊 Clean data structure created');
    
    return { success: true, message: 'Nuclear reset completed' };
    
  } catch (error) {
    console.error('❌ Nuclear reset failed:', error);
    return { success: false, error: error.message };
  }
}

// Quick emergency fix
function emergencyFix() {
  console.log('🚨 EMERGENCY FIX: Removing only alert schedules...');
  
  const alertKeys = Object.keys(localStorage).filter(key => key.startsWith('alertSchedule_'));
  
  console.log(`🔍 Found ${alertKeys.length} alert schedules to remove`);
  
  alertKeys.forEach(key => {
    localStorage.removeItem(key);
    console.log(`🗑️ Removed: ${key}`);
  });
  
  console.log('⚡ Emergency fix completed - errors should stop immediately!');
  
  return { success: true, removed: alertKeys.length };
}

// Make all functions globally available
if (typeof window !== 'undefined') {
  window.clearLocalStorageHistory = clearLocalStorageHistory;
  window.nuclearReset = nuclearReset;
  window.emergencyFix = emergencyFix;
  
  console.log('🛠️ localStorage cleanup functions available:');
  console.log('   🚨 window.emergencyFix() - Quick fix for immediate relief');
  console.log('   🧹 window.clearLocalStorageHistory() - Comprehensive cleanup');
  console.log('   ☢️ window.nuclearReset() - Complete reset (preserves auth)');
}

// Auto-run emergency fix if this script is loaded
console.log('🔧 Auto-running emergency fix...');
emergencyFix();

export { clearLocalStorageHistory, nuclearReset, emergencyFix };
