// Utility to clear old meeting cache and problematic data
// Run this to clean up any old meeting references causing repeated requests

import AsyncStorage from '@react-native-async-storage/async-storage';

export const clearOldMeetingCache = async () => {
  try {
    console.log('🧹 Clearing old meeting cache...');
    
    // Clear any stored meeting lists or references
    const keysToCheck = [
      'meetingguard_data',
      'meetings_cache',
      'recent_meetings',
      'cached_meetings',
      'meeting_list'
    ];
    
    for (const key of keysToCheck) {
      try {
        const data = await AsyncStorage.getItem(key);
        if (data) {
          const parsedData = JSON.parse(data);
          
          // If this is the main data store, just clear meetings
          if (key === 'meetingguard_data' && parsedData.meetings) {
            console.log(`🧹 Clearing ${parsedData.meetings.length} meetings from ${key}`);
            parsedData.meetings = [];
            await AsyncStorage.setItem(key, JSON.stringify(parsedData));
          } else if (Array.isArray(parsedData)) {
            // If it's a meeting array, clear it
            console.log(`🧹 Clearing ${parsedData.length} items from ${key}`);
            await AsyncStorage.removeItem(key);
          }
        }
      } catch (error) {
        console.log(`❌ Error clearing ${key}:`, error);
      }
    }
    
    console.log('✅ Old meeting cache cleared');
    return true;
  } catch (error) {
    console.error('❌ Error clearing old meeting cache:', error);
    return false;
  }
};

// Clear just the problematic meeting IDs
export const clearProblematicMeetings = async () => {
  try {
    const problematicIds = [
      '359ab1e2-e7a4-4834-9e63-80b52a10777d',
      '3ca4f9d1-2458-4318-bb5f-93651a040289',
      '4103b51a-fd88-49d2-95a3-ea5de478417e',
      'bac8057e-869f-4a07-855f-581148697db0',
      '946b36fb-58e5-4cfd-9918-e12844f142ba'
    ];
    
    console.log('🧹 Clearing problematic meeting IDs:', problematicIds);
    
    const data = await AsyncStorage.getItem('meetingguard_data');
    if (data) {
      const parsedData = JSON.parse(data);
      if (parsedData.meetings) {
        const originalCount = parsedData.meetings.length;
        parsedData.meetings = parsedData.meetings.filter(
          meeting => !problematicIds.includes(meeting.id)
        );
        const removedCount = originalCount - parsedData.meetings.length;
        console.log(`🧹 Removed ${removedCount} problematic meetings`);
        
        await AsyncStorage.setItem('meetingguard_data', JSON.stringify(parsedData));
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error clearing problematic meetings:', error);
    return false;
  }
};
