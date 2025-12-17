import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseAuthService from '../services/firebaseAuth';

const BACKEND_URL = process.env.BACKEND_URL || 'https://meetingguard-backend.onrender.com';

class AuthService {
  constructor() {
    this.baseURL = BACKEND_URL;
  }

  /**
   * Sign up with email and password (using Firebase)
   */
  async signUp(name, email, password) {
    try {
      console.log('=== AUTH SERVICE: FIREBASE SIGN UP ===');
      console.log('Email:', email);
      console.log('Name:', name);

      // Use Firebase Auth for sign up
      const result = await firebaseAuthService.signUpWithEmail(email, password, name);

      if (result.success) {
        // Firebase Auth state listener will handle user state
        // Just return success
        return {
          success: true,
          user: result.user,
        };
      } else {
        return {
          success: false,
          error: result.error || 'Sign up failed'
        };
      }
    } catch (error) {
      console.error('Sign up error:', error);
      return {
        success: false,
        error: error.message || 'Network error. Please try again.'
      };
    }
  }

  /**
   * Sign in with email and password (using Firebase)
   */
  async signIn(email, password) {
    try {
      console.log('=== AUTH SERVICE: FIREBASE SIGN IN ===');
      console.log('Email:', email);

      // Use Firebase Auth for sign in
      const result = await firebaseAuthService.signInWithEmail(email, password);

      if (result.success) {
        // Firebase Auth state listener will handle user state
        // Just return success
        return {
          success: true,
          user: result.user,
        };
      } else {
        return {
          success: false,
          error: result.error || 'Sign in failed'
        };
      }
    } catch (error) {
      console.error('Sign in error:', error);
      return {
        success: false,
        error: error.message || 'Network error. Please try again.'
      };
    }
  }

  /**
   * Check if user exists for Google sign in
   */
  async checkUserExists(email) {
    try {
      console.log('=== AUTH SERVICE: CHECK USER ===');
      console.log('Email:', email);

      const response = await fetch(`${this.baseURL}/api/auth/check-user/${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const data = await response.json();
      console.log('Check user response:', data);

      return data;
    } catch (error) {
      console.error('Check user error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Google OAuth sign in
   */
  async googleSignIn() {
    try {
      console.log('=== AUTH SERVICE: GOOGLE SIGN IN ===');
      
      // Start Google OAuth flow
      const redirectUri = `${this.baseURL}/oauth/google`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar&` +
        `access_type=offline&` +
        `prompt=consent`;

      console.log('Opening Google OAuth URL:', authUrl);
      
      // For React Native, you would use WebBrowser or similar
      // This is a placeholder - the actual implementation depends on your OAuth flow
      return {
        success: true,
        authUrl: authUrl
      };
    } catch (error) {
      console.error('Google sign in error:', error);
      return {
        success: false,
        error: 'Google sign in failed'
      };
    }
  }

  /**
   * Get stored authentication data
   */
  async getStoredAuth() {
    try {
      const token = await AsyncStorage.getItem('authToken');
      const userData = await AsyncStorage.getItem('userData');
      const authMethod = await AsyncStorage.getItem('authMethod');

      if (token && userData) {
        return {
          success: true,
          token,
          user: JSON.parse(userData),
          authMethod
        };
      } else {
        return {
          success: false,
          message: 'No stored authentication data'
        };
      }
    } catch (error) {
      console.error('Get stored auth error:', error);
      return {
        success: false,
        error: 'Failed to get stored authentication data'
      };
    }
  }

  /**
   * Clear stored authentication data
   */
  async clearAuth() {
    try {
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('userData');
      await AsyncStorage.removeItem('authMethod');
      await AsyncStorage.removeItem('google_access_token');
      await AsyncStorage.removeItem('google_user_info');

      return { success: true };
    } catch (error) {
      console.error('Clear auth error:', error);
      return {
        success: false,
        error: 'Failed to clear authentication data'
      };
    }
  }

  /**
   * Validate stored token
   */
  async validateToken() {
    try {
      const authData = await this.getStoredAuth();
      if (!authData.success) {
        return { valid: false };
      }

      // You can add token validation logic here
      // For now, we'll assume the token is valid if it exists
      return { valid: true, user: authData.user };
    } catch (error) {
      console.error('Validate token error:', error);
      return { valid: false };
    }
  }
}

export default new AuthService();
