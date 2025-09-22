// Local Storage Cleanup Script
// Run this in your browser console or add to your app to clean up local storage

console.log('🧹 Starting local storage cleanup...');

// List of keys to remove
const keysToRemove = [
  'authToken',
  'refreshToken', 
  'user',
  'user_data',
  'google_access_token',
  'google_token_expiry',
  'google_refresh_token',
  'meeting_cache',
  'alert_schedules',
  'cached_meetings',
  'last_meeting_sync',
  'app_settings',
  'theme_preference',
  'language_preference'
];

// Remove each key
keysToRemove.forEach(key => {
  try {
    localStorage.removeItem(key);
    console.log(`✅ Removed: ${key}`);
  } catch (error) {
    console.log(`❌ Failed to remove ${key}:`, error);
  }
});

// For React Native AsyncStorage (if running in React Native)
if (typeof AsyncStorage !== 'undefined') {
  console.log('📱 Cleaning AsyncStorage...');
  
  AsyncStorage.multiRemove(keysToRemove)
    .then(() => {
      console.log('✅ AsyncStorage cleaned successfully');
    })
    .catch(error => {
      console.error('❌ Failed to clean AsyncStorage:', error);
    });
}

// Clear all alert schedules (if using the storage utility)
if (typeof storage !== 'undefined') {
  console.log('🗑️ Clearing alert schedules...');
  
  // Get all keys and remove alert-related ones
  storage.getAllKeys().then(keys => {
    const alertKeys = keys.filter(key => key.includes('alert') || key.includes('schedule'));
    return storage.multiRemove(alertKeys);
  }).then(() => {
    console.log('✅ Alert schedules cleared');
  }).catch(error => {
    console.error('❌ Failed to clear alert schedules:', error);
  });
}

console.log('🎉 Local storage cleanup completed!');
console.log('💡 You may need to restart your app for changes to take effect.');
