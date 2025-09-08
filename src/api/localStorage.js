import AsyncStorage from '@react-native-async-storage/async-storage';

// Local Storage API Client to replace base44 functionality
class LocalStorageAPI {
  constructor() {
    this.storageKey = 'meetingguard_data';
    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      const existingData = await AsyncStorage.getItem(this.storageKey);
      if (!existingData) {
        const initialData = {
          meetings: [],
          userPreferences: [],
          apiKeys: [],
          notes: [],
          users: []
        };
        await AsyncStorage.setItem(this.storageKey, JSON.stringify(initialData));
      }
    } catch (error) {
      console.error('Error initializing storage:', error);
    }
  }

  async getData() {
    try {
      const data = await AsyncStorage.getItem(this.storageKey);
      return JSON.parse(data || '{}');
    } catch (error) {
      console.error('Error getting data from storage:', error);
      return {};
    }
  }

  async setData(data) {
    try {
      await AsyncStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Error setting data to storage:', error);
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async getCurrentUser() {
    try {
      // First try to get user from AsyncStorage (where AuthContext stores it)
      const userFromAuth = await AsyncStorage.getItem('user');
      if (userFromAuth) {
        const parsedUser = JSON.parse(userFromAuth);
        console.log('getCurrentUser: Found user from AuthContext:', parsedUser);
        return parsedUser;
      }
      
      // Fallback to the old method
      const data = await this.getData();
      const userFromData = data.users?.find(user => user.isCurrent);
      if (userFromData) {
        console.log('getCurrentUser: Found user from data.users:', userFromData);
        return userFromData;
      }
      
      // Final fallback
      console.log('getCurrentUser: No user found, using default');
      return {
        id: 'default-user',
        email: 'user@example.com',
        name: 'Default User',
        isCurrent: true
      };
    } catch (error) {
      console.error('Error getting current user:', error);
      return {
        id: 'default-user',
        email: 'user@example.com',
        name: 'Default User',
        isCurrent: true
      };
    }
  }

  // Clear all meetings from storage
  async clearAllMeetings() {
    try {
      const data = await this.getData();
      data.meetings = [];
      await this.setData(data);
      console.log('All meetings cleared from storage');
      return true;
    } catch (error) {
      console.error('Error clearing meetings:', error);
      return false;
    }
  }
}

export const localStorageAPI = new LocalStorageAPI();