import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = 'https://meetingguard-backend.onrender.com';

class AuthService {
  constructor() {
    this.baseURL = BACKEND_URL;
  }

  /**
   * Manual sign up
   */
  async signUp(name, email, password) {
    try {
      console.log('=== AUTH SERVICE: MANUAL SIGN UP ===');
      console.log('Email:', email);
      console.log('Name:', name);

      const response = await fetch(`${this.baseURL}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          email,
          password
        })
      });

      const data = await response.json();
      console.log('Sign up response:', data);

      if (data.success) {
        // Store authentication data
        await AsyncStorage.setItem('authToken', data.jwtToken);
        await AsyncStorage.setItem('userData', JSON.stringify(data.user));
        await AsyncStorage.setItem('authMethod', 'manual');

        return {
          success: true,
          user: data.user,
          token: data.jwtToken
        };
      } else {
        return {
          success: false,
          error: data.error || 'Sign up failed'
        };
      }
    } catch (error) {
      console.error('Sign up error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
      };
    }
  }

  /**
   * Manual sign in
   */
  async signIn(email, password) {
    try {
      console.log('=== AUTH SERVICE: MANUAL SIGN IN ===');
      console.log('Email:', email);

      const response = await fetch(`${this.baseURL}/api/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      const data = await response.json();
      console.log('Sign in response:', data);

      if (data.success) {
        // Store authentication data
        await AsyncStorage.setItem('authToken', data.jwtToken);
        await AsyncStorage.setItem('userData', JSON.stringify(data.user));
        await AsyncStorage.setItem('authMethod', 'manual');

        return {
          success: true,
          user: data.user,
          token: data.jwtToken
        };
      } else {
        return {
          success: false,
          error: data.error || 'Sign in failed'
        };
      }
    } catch (error) {
      console.error('Sign in error:', error);
      return {
        success: false,
        error: 'Network error. Please try again.'
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
