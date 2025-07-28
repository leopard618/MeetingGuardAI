import AsyncStorage from '@react-native-async-storage/async-storage';

// Unified storage interface that works in both web and React Native
class Storage {
  constructor() {
    this.isWeb = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  async getItem(key) {
    try {
      if (this.isWeb) {
        return window.localStorage.getItem(key);
      } else {
        return await AsyncStorage.getItem(key);
      }
    } catch (error) {
      console.error('Error getting item from storage:', error);
      return null;
    }
  }

  async setItem(key, value) {
    try {
      if (this.isWeb) {
        window.localStorage.setItem(key, value);
      } else {
        await AsyncStorage.setItem(key, value);
      }
    } catch (error) {
      console.error('Error setting item to storage:', error);
    }
  }

  async removeItem(key) {
    try {
      if (this.isWeb) {
        window.localStorage.removeItem(key);
      } else {
        await AsyncStorage.removeItem(key);
      }
    } catch (error) {
      console.error('Error removing item from storage:', error);
    }
  }

  async getAllKeys() {
    try {
      if (this.isWeb) {
        return Object.keys(window.localStorage);
      } else {
        return await AsyncStorage.getAllKeys();
      }
    } catch (error) {
      console.error('Error getting all keys from storage:', error);
      return [];
    }
  }

  async clear() {
    try {
      if (this.isWeb) {
        window.localStorage.clear();
      } else {
        await AsyncStorage.clear();
      }
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  }
}

export const storage = new Storage(); 