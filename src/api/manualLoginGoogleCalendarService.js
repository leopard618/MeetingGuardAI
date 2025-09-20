// Manual Login Google Calendar Service
// Handles Google Calendar connection for users who logged in manually

import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { GOOGLE_OAUTH_CONFIG } from '../config/googleAuth.js';
import { GOOGLE_REDIRECT_URI } from '@env';

// Ensure auth sessions complete when app is foregrounded again
WebBrowser.maybeCompleteAuthSession();

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
   * Start the OAuth flow for Google Calendar
   */
  async startOAuthFlow() {
    try {
      console.log('ManualLoginGoogleCalendarService: Starting OAuth flow');
      
      // Use environment variable for redirect URI with fallback
      const oauthRedirectUri = GOOGLE_REDIRECT_URI || 'https://meetingguard-backend.onrender.com/oauth/google';
      
      // Create auth request
      const request = new AuthSession.AuthRequest({
        clientId: GOOGLE_OAUTH_CONFIG.CLIENT_ID,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ],
        redirectUri: oauthRedirectUri,
        responseType: AuthSession.ResponseType.Code,
        extraParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      });

      console.log('ManualLoginGoogleCalendarService: Auth request created');
      console.log('ManualLoginGoogleCalendarService: Redirect URI:', oauthRedirectUri);

      // Start the auth session
      const result = await request.promptAsync({
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth'
      });

      console.log('ManualLoginGoogleCalendarService: Auth session result:', result);

      if (result.type === 'success' && result.params.code) {
        console.log('ManualLoginGoogleCalendarService: Authorization code received');
        
        // Exchange code for tokens
        const tokens = await this.exchangeCodeForTokens(result.params.code, oauthRedirectUri);
        
        if (tokens) {
          return {
            success: true,
            tokens: tokens
          };
        } else {
          return {
            success: false,
            error: 'Failed to exchange authorization code for tokens'
          };
        }
      } else if (result.type === 'cancel') {
        return {
          success: false,
          error: 'User cancelled Google Calendar authorization'
        };
      } else {
        return {
          success: false,
          error: result.error?.message || 'Authorization failed'
        };
      }
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: OAuth flow error:', error);
      return {
        success: false,
        error: error.message || 'OAuth flow failed'
      };
    }
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  async exchangeCodeForTokens(code, redirectUri) {
    try {
      console.log('ManualLoginGoogleCalendarService: Exchanging code for tokens');
      
      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }

      const response = await fetch(`${backendUrl}/api/auth/google/callback?code=${encodeURIComponent(code)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      console.log('ManualLoginGoogleCalendarService: Token exchange response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('ManualLoginGoogleCalendarService: Tokens received successfully');
        
        return {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          expires_at: data.expires_at,
          token_type: data.token_type || 'Bearer'
        };
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('ManualLoginGoogleCalendarService: Token exchange failed:', errorData);
        throw new Error(errorData.error || `Token exchange failed: ${response.status}`);
      }
    } catch (error) {
      console.error('ManualLoginGoogleCalendarService: Error exchanging code for tokens:', error);
      throw error;
    }
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
