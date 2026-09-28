// Manual Login Google Calendar Service
// Handles Google Calendar connection for users who logged in manually

import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MovedToServerError } from '../utils/movedToServer';

class ManualLoginGoogleCalendarService {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    try {
      this.isInitialized = true;
      console.log('ManualLoginGoogleCalendarService: Initialized successfully');
      return true;
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Initialization failed:', error);
      return false;
    }
  }

  /**
   * Connect Google Calendar for manual login users
   * This will prompt the user to authorize Google Calendar access
   */
  async connectGoogleCalendar() {
    try {
      console.log('ManualLoginGoogleCalendarService: Starting Google Calendar connection');
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Check if user is already connected
      const existingTokens = await this.getStoredTokens();
      if (existingTokens && existingTokens.access_token) {
        console.log('ManualLoginGoogleCalendarService: User already has Google Calendar tokens');
        return {
          success: true,
          message: 'Google Calendar is already connected',
          tokens: existingTokens
        };
      }

      // Start OAuth flow
      const result = await this.startOAuthFlow();
      
      if (result.success) {
        // Store tokens
        await this.storeTokens(result.tokens);
        
        // Sync with backend
        await this.syncTokensWithBackend(result.tokens);
        
        console.log('ManualLoginGoogleCalendarService: Google Calendar connected successfully');
        return {
          success: true,
          message: 'Google Calendar connected successfully',
          tokens: result.tokens
        };
      } else {
        console.error('ManualLoginGoogleCalendarService: Google Calendar connection failed:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error connecting Google Calendar:', error);
      return {
        success: false,
        error: error.message || 'Failed to connect Google Calendar'
      };
    }
  }

  /**
   * Start the OAuth flow for Google Calendar.
   *
   * Disabled: the old flow redirected to the retired Render backend and exchanged the code
   * there. Google Calendar access will be rebuilt with native Google Sign-In (incremental
   * calendar scope) and a Firebase Cloud Function for the code exchange.
   */
  async startOAuthFlow() {
    const error = new MovedToServerError('google-calendar-connect');
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  /**
   * Exchange authorization code for tokens - requires the client secret, so it can only
   * happen on the server (Firebase Cloud Function, later stage).
   */
  async exchangeCodeForTokens(_code, _redirectUri) {
    throw new MovedToServerError('google-calendar-connect');
  }

  /**
   * Store tokens in AsyncStorage
   */
  async storeTokens(tokens) {
    try {
      console.log('ManualLoginGoogleCalendarService: Storing tokens');
      
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        expires_at: tokens.expires_at,
        token_type: tokens.token_type || 'Bearer',
        stored_at: new Date().toISOString()
      };

      await AsyncStorage.setItem('google_calendar_tokens', JSON.stringify(tokenData));
      console.log('ManualLoginGoogleCalendarService: Tokens stored successfully');
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error storing tokens:', error);
      throw error;
    }
  }

  /**
   * Get stored tokens from AsyncStorage
   */
  async getStoredTokens() {
    try {
      const tokenData = await AsyncStorage.getItem('google_calendar_tokens');
      if (tokenData) {
        return JSON.parse(tokenData);
      }
      return null;
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error getting stored tokens:', error);
      return null;
    }
  }

  /**
   * Sync tokens with backend
   */
  async syncTokensWithBackend(tokens) {
    try {
      console.log('ManualLoginGoogleCalendarService: Syncing tokens with backend');
      
      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }

      // Get auth token for authenticated request
      const authToken = await AsyncStorage.getItem('authToken');
      if (!authToken) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${backendUrl}/api/auth/google/sync-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          expires_at: tokens.expires_at
        })
      });

      console.log('ManualLoginGoogleCalendarService: Token sync response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('ManualLoginGoogleCalendarService: Tokens synced with backend successfully');
        return data;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('ManualLoginGoogleCalendarService: Token sync failed:', errorData);
        throw new Error(errorData.error || `Token sync failed: ${response.status}`);
      }
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error syncing tokens with backend:', error);
      throw error;
    }
  }

  /**
   * Check if Google Calendar is connected
   */
  async isConnected() {
    try {
      const tokens = await this.getStoredTokens();
      return !!(tokens && tokens.access_token);
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error checking connection status:', error);
      return false;
    }
  }

  /**
   * Disconnect Google Calendar
   */
  async disconnect() {
    try {
      console.log('ManualLoginGoogleCalendarService: Disconnecting Google Calendar');
      
      // Clear stored tokens
      await AsyncStorage.removeItem('google_calendar_tokens');
      
      // Clear backend tokens
      const backendUrl = process.env.BACKEND_URL;
      const authToken = await AsyncStorage.getItem('authToken');
      
      if (backendUrl && authToken) {
        try {
          await fetch(`${backendUrl}/api/auth/google/clear-tokens`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
        } catch (error) {
          console.warn('ManualLoginGoogleCalendarService: Failed to clear backend tokens:', error);
        }
      }
      
      console.log('ManualLoginGoogleCalendarService: Google Calendar disconnected successfully');
      return { success: true };
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error disconnecting Google Calendar:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get access token for API calls
   */
  async getAccessToken() {
    try {
      const tokens = await this.getStoredTokens();
      if (!tokens || !tokens.access_token) {
        return null;
      }

      // Check if token is expired
      if (tokens.expires_at && new Date() >= new Date(tokens.expires_at)) {
        console.log('ManualLoginGoogleCalendarService: Access token expired, attempting refresh');
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          const newTokens = await this.getStoredTokens();
          return newTokens.access_token;
        }
        return null;
      }

      return tokens.access_token;
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error getting access token:', error);
      return null;
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken() {
    try {
      console.log('ManualLoginGoogleCalendarService: Refreshing access token');
      
      const tokens = await this.getStoredTokens();
      if (!tokens || !tokens.refresh_token) {
        console.log('ManualLoginGoogleCalendarService: No refresh token available');
        return false;
      }

      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }

      const response = await fetch(`${backendUrl}/api/auth/google/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: tokens.refresh_token
        })
      });

      if (response.ok) {
        const data = await response.json();
        const newTokens = {
          ...tokens,
          access_token: data.access_token,
          expires_in: data.expires_in,
          expires_at: data.expires_at
        };
        
        await this.storeTokens(newTokens);
        console.log('ManualLoginGoogleCalendarService: Access token refreshed successfully');
        return true;
      } else {
        console.error('ManualLoginGoogleCalendarService: Token refresh failed');
        return false;
      }
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error refreshing access token:', error);
      return false;
    }
  }
}

// Export singleton instance
export const manualLoginGoogleCalendarService = new ManualLoginGoogleCalendarService();
export default manualLoginGoogleCalendarService;
