// Quick Fix Script - Run this immediately to stop all errors
// Copy and paste this entire script into your browser console

(function quickFix() {
  console.log('🚨 QUICK FIX: Clearing all alert schedules...');
  
  // Method 1: Direct localStorage manipulation
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('alertSchedule_')) {
      keysToRemove.push(key);
    }
  }
  
  console.log(`🔍 Found ${keysToRemove.length} alert schedules to remove`);
  
  // Remove all alert schedules
  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    console.log(`🗑️ Removed: ${key}`);
  });
  
  // Method 2: Also clear any AsyncStorage items if using React Native
  if (typeof window !== 'undefined' && window.ReactNativeWebView) {
    // React Native environment
    try {
      import('@react-native-async-storage/async-storage').then(({ default: AsyncStorage }) => {
        AsyncStorage.getAllKeys().then(keys => {
          const alertKeys = keys.filter(key => key.startsWith('alertSchedule_'));
          return AsyncStorage.multiRemove(alertKeys);
        }).then(() => {
          console.log('✅ Also cleared AsyncStorage alert schedules');
        });
      });
    } catch (error) {
      console.log('ℹ️ AsyncStorage not available (normal for web)');
    }
  }
  
  console.log('✅ QUICK FIX COMPLETED!');
  console.log('🎉 All alert schedules removed - errors should stop now');
  console.log('📊 Refresh the page to see clean logs');
  
  return {
    removed: keysToRemove.length,
    message: 'Quick fix completed successfully'
  };
})();
