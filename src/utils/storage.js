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

// User management functions
export const userStorage = {
  // Get all users from storage
  async getAllUsers() {
    try {
      const usersJson = await AsyncStorage.getItem('users');
      return usersJson ? JSON.parse(usersJson) : [];
    } catch (error) {
      console.error('Error getting users:', error);
      return [];
    }
  },

  // Save all users to storage
  async saveAllUsers(users) {
    try {
      await AsyncStorage.setItem('users', JSON.stringify(users));
    } catch (error) {
      console.error('Error saving users:', error);
    }
  },

  // Check if user exists by email
  async userExists(email) {
    const users = await this.getAllUsers();
    return users.some(user => user.email === email);
  },

  // Sign up new user
  async signUp(userData) {
    try {
      const users = await this.getAllUsers();
      
      // Check if user already exists
      if (users.some(user => user.email === userData.email)) {
        throw new Error('User with this email already exists');
      }
      
      // Add new user
      const newUser = {
        ...userData,
        id: Date.now().toString(), // Simple ID generation
        createdAt: new Date().toISOString(),
      };
      
      users.push(newUser);
      await this.saveAllUsers(users);
      
      console.log('User signed up successfully:', newUser.email);
      return { success: true, user: newUser };
    } catch (error) {
      console.error('Sign up error:', error);
      return { success: false, error: error.message };
    }
  },

  // Sign in user
  async signIn(email, password) {
    try {
      const users = await this.getAllUsers();
      const user = users.find(u => u.email === email);
      
      if (!user) {
        throw new Error('User not found. Please sign up first.');
      }
      
      // For Google OAuth users, we don't check password
      if (user.googleId) {
        console.log('Google user signed in:', user.email);
        return { success: true, user };
      }
      
      // For regular users, check password (you can add password hashing here)
      if (user.password !== password) {
        throw new Error('Invalid password');
      }
      
      console.log('User signed in successfully:', user.email);
      return { success: true, user };
    } catch (error) {
      console.error('Sign in error:', error);
      return { success: false, error: error.message };
    }
  },

  // Add Google OAuth user
  async addGoogleUser(googleUserData) {
    try {
      const users = await this.getAllUsers();
      
      // Check if user already exists
      const existingUser = users.find(user => user.email === googleUserData.email);
      
      if (existingUser) {
        // Update existing user with Google info
        existingUser.googleId = googleUserData.id;
        existingUser.name = googleUserData.name;
        existingUser.picture = googleUserData.picture;
        existingUser.lastSignIn = new Date().toISOString();
        
        await this.saveAllUsers(users);
        console.log('Existing user updated with Google info:', existingUser.email);
        return { success: true, user: existingUser, isNewUser: false };
      } else {
        // Create new Google user
        const newGoogleUser = {
          id: googleUserData.id,
          email: googleUserData.email,
          name: googleUserData.name,
          picture: googleUserData.picture,
          googleId: googleUserData.id,
          createdAt: new Date().toISOString(),
          lastSignIn: new Date().toISOString(),
        };
        
        users.push(newGoogleUser);
        await this.saveAllUsers(users);
        
        console.log('New Google user created:', newGoogleUser.email);
        return { success: true, user: newGoogleUser, isNewUser: true };
      }
    } catch (error) {
      console.error('Add Google user error:', error);
      return { success: false, error: error.message };
    }
  },

  // Get current user
  async getCurrentUser() {
    try {
      const userJson = await AsyncStorage.getItem('current_user');
      return userJson ? JSON.parse(userJson) : null;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  },

  // Set current user
  async setCurrentUser(user) {
    try {
      await AsyncStorage.setItem('current_user', JSON.stringify(user));
    } catch (error) {
      console.error('Error setting current user:', error);
    }
  },

  // Clear current user
  async clearCurrentUser() {
    try {
      await AsyncStorage.removeItem('current_user');
    } catch (error) {
      console.error('Error clearing current user:', error);
    }
  },
};

export default userStorage; 