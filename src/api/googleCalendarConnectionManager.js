// Google Calendar Connection Manager
// Ensures persistent Google Calendar connection across app sessions

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MovedToServerError } from '../utils/movedToServer';

class GoogleCalendarConnectionManager {
  constructor() {
    this.isConnected = false;
    this.connectionStatus = 'unknown';
    this.lastConnectionCheck = null;
  }

  /**
   * Initialize and restore Google Calendar connection
   */
  async initializeConnection() {
    try {
      console.log('🚀 [ConnectionManager] Initializing Google Calendar connection...');

      // Check for stored tokens
      const tokens = await this.getStoredTokens();
      
      if (!tokens.accessToken) {
        console.log('❌ [ConnectionManager] No access token found');
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        return {
          success: false,
          status: 'disconnected',
          message: 'No Google Calendar connection found. Please sign in to Google Calendar.'
        };
      }

      // Check if token is expired
      if (tokens.expiry && Date.now() > tokens.expiry) {
        console.log('❌ [ConnectionManager] Access token has expired');
        
        if (tokens.refreshToken) {
          console.log('🔄 [ConnectionManager] Attempting to refresh token...');
          const refreshResult = await this.refreshAccessToken(tokens.refreshToken);
          
          if (refreshResult.success) {
            console.log('✅ [ConnectionManager] Token refreshed successfully');
            this.isConnected = true;
            this.connectionStatus = 'connected';
            return {
              success: true,
              status: 'connected',
              message: 'Google Calendar connection restored'
            };
          } else {
            console.log('❌ [ConnectionManager] Token refresh failed');
            await this.clearStoredTokens();
            this.isConnected = false;
            this.connectionStatus = 'disconnected';
            return {
              success: false,
              status: 'token_refresh_failed',
              message: 'Google Calendar tokens expired and refresh failed. Please reconnect.',
              needsReauth: true
            };
          }
        } else {
          console.log('❌ [ConnectionManager] No refresh token available');
          await this.clearStoredTokens();
          this.isConnected = false;
          this.connectionStatus = 'disconnected';
          return {
            success: false,
            status: 'no_refresh_token',
            message: 'Google Calendar connection expired and no refresh token available. Please reconnect.',
            needsReauth: true
          };
        }
      }

      // Token is valid
      console.log('✅ [ConnectionManager] Valid access token found');
      this.isConnected = true;
      this.connectionStatus = 'connected';
      this.lastConnectionCheck = Date.now();
      
      return {
        success: true,
        status: 'connected',
        message: 'Google Calendar connection is active'
      };

    } catch (error) {
      console.error('❌ [ConnectionManager] Error initializing connection:', error);
      this.isConnected = false;
      this.connectionStatus = 'error';
      return {
        success: false,
        status: 'error',
        message: `Connection initialization failed: ${error.message}`
      };
    }
  }

  /**
   * Get stored tokens from AsyncStorage
   */
  async getStoredTokens() {
    try {
      const [accessToken, refreshToken, expiry] = await Promise.all([
        AsyncStorage.getItem('google_access_token'),
        AsyncStorage.getItem('google_refresh_token'),
        AsyncStorage.getItem('google_token_expiry')
      ]);

      return {
        accessToken,
        refreshToken,
        expiry: expiry ? parseInt(expiry) : null
      };
    } catch (error) {
      console.error('❌ [ConnectionManager] Error getting stored tokens:', error);
      return {
        accessToken: null,
        refreshToken: null,
        expiry: null
      };
    }
  }

  /**
   * Store tokens in AsyncStorage
   */
  async storeTokens(tokens) {
    try {
      console.log('💾 [ConnectionManager] Storing Google tokens...');

      const storePromises = [];

      if (tokens.access_token) {
        storePromises.push(
          AsyncStorage.setItem('google_access_token', tokens.access_token)
        );
      }

      if (tokens.refresh_token) {
        storePromises.push(
          AsyncStorage.setItem('google_refresh_token', tokens.refresh_token)
        );
      }

      if (tokens.expires_in) {
        const expiryTime = Date.now() + (tokens.expires_in * 1000);
        storePromises.push(
          AsyncStorage.setItem('google_token_expiry', expiryTime.toString())
        );
      }

      await Promise.all(storePromises);
      
      console.log('✅ [ConnectionManager] Tokens stored successfully');
      this.isConnected = true;
      this.connectionStatus = 'connected';
      
      return true;
    } catch (error) {
      console.error('❌ [ConnectionManager] Error storing tokens:', error);
      return false;
    }
  }

  /**
   * Refresh access token using refresh token.
   *
   * Needs the OAuth client secret -> server only (Firebase Cloud Function, later stage).
   */
  async refreshAccessToken(_refreshToken) {
    const error = new MovedToServerError('google-token-refresh');
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  /**
   * Clear all stored tokens
   */
  async clearStoredTokens() {
    try {
      console.log('🗑️ [ConnectionManager] Clearing stored tokens...');

      const clearPromises = [
        AsyncStorage.removeItem('google_access_token'),
        AsyncStorage.removeItem('google_refresh_token'),
        AsyncStorage.removeItem('google_token_expiry')
      ];

      await Promise.all(clearPromises);
      
      console.log('✅ [ConnectionManager] Tokens cleared successfully');
      this.isConnected = false;
      this.connectionStatus = 'disconnected';
      
      return true;
    } catch (error) {
      console.error('❌ [ConnectionManager] Error clearing tokens:', error);
      return false;
    }
  }

  /**
   * Get valid access token
   */
  async getValidAccessToken() {
    try {
      const tokens = await this.getStoredTokens();
      
      if (!tokens.accessToken) {
        return null;
      }

      // Check if token is expired
      if (tokens.expiry && Date.now() > tokens.expiry) {
        if (tokens.refreshToken) {
          const refreshResult = await this.refreshAccessToken(tokens.refreshToken);
          if (refreshResult.success) {
            return refreshResult.tokens.access_token;
          }
        }
        return null;
      }

      return tokens.accessToken;
    } catch (error) {
      console.error('❌ [ConnectionManager] Error getting valid access token:', error);
      return null;
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      status: this.connectionStatus,
      lastCheck: this.lastConnectionCheck
    };
  }

  /**
   * Test Google Calendar connection
   */
  async testConnection() {
    try {
      console.log('🧪 [ConnectionManager] Testing Google Calendar connection...');

      const accessToken = await this.getValidAccessToken();
      
      if (!accessToken) {
        return {
          success: false,
          message: 'No valid access token available'
        };
      }

      // Test with a simple API call
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        console.log('✅ [ConnectionManager] Google Calendar connection test successful');
        this.isConnected = true;
        this.connectionStatus = 'connected';
        this.lastConnectionCheck = Date.now();
        
        return {
          success: true,
          message: 'Google Calendar connection is working'
        };
      } else {
        console.log('❌ [ConnectionManager] Google Calendar connection test failed');
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        
        return {
          success: false,
          message: 'Google Calendar connection test failed'
        };
      }
    } catch (error) {
      console.error('❌ [ConnectionManager] Connection test error:', error);
      this.isConnected = false;
      this.connectionStatus = 'error';
      
      return {
        success: false,
        message: `Connection test failed: ${error.message}`
      };
    }
  }

  /**
   * Ensure connection is active (auto-refresh if needed)
   */
  async ensureConnection() {
    try {
      // If we haven't checked recently, test the connection
      if (!this.lastConnectionCheck || (Date.now() - this.lastConnectionCheck) > 300000) { // 5 minutes
        const testResult = await this.testConnection();
        return testResult.success;
      }

      return this.isConnected;
    } catch (error) {
      console.error('❌ [ConnectionManager] Error ensuring connection:', error);
      return false;
    }
  }
}

export default new GoogleCalendarConnectionManager();
