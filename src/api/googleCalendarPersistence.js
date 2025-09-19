// Google Calendar Persistence Service
// Ensures Google Calendar tokens are properly stored and retrieved

import AsyncStorage from '@react-native-async-storage/async-storage';

class GoogleCalendarPersistenceService {
  constructor() {
    this.tokenKeys = {
      accessToken: 'google_access_token',
      refreshToken: 'google_refresh_token',
      expiry: 'google_token_expiry',
      userInfo: 'google_user_info'
    };
  }

  /**
   * Store Google OAuth tokens with enhanced persistence
   */
  async storeTokens(tokens) {
    try {
      console.log('💾 [Persistence] Storing Google tokens with enhanced persistence...');
      console.log('💾 [Persistence] Tokens received:', { 
        hasAccessToken: !!tokens.access_token, 
        hasRefreshToken: !!tokens.refresh_token, 
        expiresIn: tokens.expires_in 
      });

      // Store tokens with multiple fallback methods
      const storePromises = [];

      // Primary storage
      if (tokens.access_token) {
        storePromises.push(
          AsyncStorage.setItem(this.tokenKeys.accessToken, tokens.access_token)
            .then(() => console.log('✅ [Persistence] Access token stored'))
            .catch(err => console.error('❌ [Persistence] Failed to store access token:', err))
        );
      }

      if (tokens.refresh_token) {
        storePromises.push(
          AsyncStorage.setItem(this.tokenKeys.refreshToken, tokens.refresh_token)
            .then(() => console.log('✅ [Persistence] Refresh token stored'))
            .catch(err => console.error('❌ [Persistence] Failed to store refresh token:', err))
        );
      }

      if (tokens.expires_in) {
        const expiryTime = Date.now() + (tokens.expires_in * 1000);
        storePromises.push(
          AsyncStorage.setItem(this.tokenKeys.expiry, expiryTime.toString())
            .then(() => console.log('✅ [Persistence] Token expiry stored:', new Date(expiryTime).toISOString()))
            .catch(err => console.error('❌ [Persistence] Failed to store token expiry:', err))
        );
      }

      // Wait for all storage operations to complete
      await Promise.all(storePromises);

      // Verify tokens were stored
      await this.verifyTokenStorage();

      console.log('✅ [Persistence] All tokens stored successfully');
      return true;
    } catch (error) {
      console.error('❌ [Persistence] Error storing tokens:', error);
      return false;
    }
  }

  /**
   * Retrieve Google OAuth tokens with enhanced error handling
   */
  async getTokens() {
    try {
      console.log('🔍 [Persistence] Retrieving Google tokens...');

      const [accessToken, refreshToken, expiry] = await Promise.all([
        AsyncStorage.getItem(this.tokenKeys.accessToken),
        AsyncStorage.getItem(this.tokenKeys.refreshToken),
        AsyncStorage.getItem(this.tokenKeys.expiry)
      ]);

      console.log('🔍 [Persistence] Token retrieval results:', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasExpiry: !!expiry,
        expiryTime: expiry ? new Date(parseInt(expiry)).toISOString() : 'No expiry'
      });

      return {
        accessToken,
        refreshToken,
        expiry: expiry ? parseInt(expiry) : null
      };
    } catch (error) {
      console.error('❌ [Persistence] Error retrieving tokens:', error);
      return {
        accessToken: null,
        refreshToken: null,
        expiry: null
      };
    }
  }

  /**
   * Get valid access token with automatic refresh
   */
  async getValidAccessToken() {
    try {
      console.log('🔄 [Persistence] Getting valid access token...');

      const tokens = await this.getTokens();

      if (!tokens.accessToken) {
        console.log('❌ [Persistence] No access token found');
        return null;
      }

      // Check if token is expired
      if (tokens.expiry && Date.now() > tokens.expiry) {
        console.log('❌ [Persistence] Access token has expired');
        console.log('❌ [Persistence] Expiry time:', new Date(tokens.expiry).toISOString());
        console.log('❌ [Persistence] Current time:', new Date().toISOString());

        // Try to refresh the token
        if (tokens.refreshToken) {
          console.log('🔄 [Persistence] Attempting to refresh expired token...');
          try {
            const newTokens = await this.refreshAccessToken(tokens.refreshToken);
            if (newTokens && newTokens.access_token) {
              console.log('✅ [Persistence] Token refreshed successfully');
              // Store the new tokens
              await this.storeTokens(newTokens);
              return newTokens.access_token;
            }
          } catch (refreshError) {
            console.error('❌ [Persistence] Token refresh failed:', refreshError);
          }
        }

        // Clear expired tokens if refresh failed
        await this.clearTokens();
        return null;
      }

      console.log('✅ [Persistence] Valid access token found');
      return tokens.accessToken;
    } catch (error) {
      console.error('❌ [Persistence] Error getting valid access token:', error);
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      console.log('🔄 [Persistence] Refreshing access token...');

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
          client_secret: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Token refresh failed: ${errorData.error_description || response.statusText}`);
      }

      const tokenData = await response.json();
      console.log('✅ [Persistence] Token refresh successful');
      
      return tokenData;
    } catch (error) {
      console.error('❌ [Persistence] Token refresh error:', error);
      throw error;
    }
  }

  /**
   * Clear all stored tokens
   */
  async clearTokens() {
    try {
      console.log('🗑️ [Persistence] Clearing all Google tokens...');

      const clearPromises = Object.values(this.tokenKeys).map(key =>
        AsyncStorage.removeItem(key)
          .then(() => console.log(`✅ [Persistence] Cleared ${key}`))
          .catch(err => console.error(`❌ [Persistence] Failed to clear ${key}:`, err))
      );

      await Promise.all(clearPromises);
      console.log('✅ [Persistence] All tokens cleared');
    } catch (error) {
      console.error('❌ [Persistence] Error clearing tokens:', error);
    }
  }

  /**
   * Verify that tokens are properly stored
   */
  async verifyTokenStorage() {
    try {
      console.log('🔍 [Persistence] Verifying token storage...');

      const tokens = await this.getTokens();
      
      const verification = {
        accessTokenStored: !!tokens.accessToken,
        refreshTokenStored: !!tokens.refreshToken,
        expiryStored: !!tokens.expiry,
        allStored: !!(tokens.accessToken && tokens.refreshToken && tokens.expiry)
      };

      console.log('🔍 [Persistence] Storage verification:', verification);

      if (!verification.allStored) {
        console.warn('⚠️ [Persistence] Some tokens are missing from storage');
      }

      return verification;
    } catch (error) {
      console.error('❌ [Persistence] Error verifying token storage:', error);
      return {
        accessTokenStored: false,
        refreshTokenStored: false,
        expiryStored: false,
        allStored: false
      };
    }
  }

  /**
   * Get comprehensive connection status
   */
  async getConnectionStatus() {
    try {
      console.log('🔍 [Persistence] Getting connection status...');

      const tokens = await this.getTokens();
      const hasValidToken = await this.getValidAccessToken();

      const status = {
        hasTokens: !!(tokens.accessToken && tokens.refreshToken),
        hasValidToken: !!hasValidToken,
        isExpired: tokens.expiry ? Date.now() > tokens.expiry : false,
        expiryTime: tokens.expiry ? new Date(tokens.expiry).toISOString() : null,
        currentTime: new Date().toISOString(),
        connectionStatus: hasValidToken ? 'connected' : 'disconnected'
      };

      console.log('🔍 [Persistence] Connection status:', status);
      return status;
    } catch (error) {
      console.error('❌ [Persistence] Error getting connection status:', error);
      return {
        hasTokens: false,
        hasValidToken: false,
        isExpired: false,
        expiryTime: null,
        currentTime: new Date().toISOString(),
        connectionStatus: 'error'
      };
    }
  }

  /**
   * Initialize and restore connection on app start
   */
  async initializeConnection() {
    try {
      console.log('🚀 [Persistence] Initializing Google Calendar connection...');

      const status = await this.getConnectionStatus();
      
      if (status.hasValidToken) {
        console.log('✅ [Persistence] Google Calendar connection restored successfully');
        return {
          success: true,
          status: 'connected',
          message: 'Google Calendar connection restored'
        };
      } else if (status.hasTokens && status.isExpired) {
        console.log('🔄 [Persistence] Attempting to refresh expired connection...');
        const validToken = await this.getValidAccessToken();
        if (validToken) {
          console.log('✅ [Persistence] Google Calendar connection refreshed successfully');
          return {
            success: true,
            status: 'connected',
            message: 'Google Calendar connection refreshed'
          };
        }
      }

      console.log('❌ [Persistence] Google Calendar connection not available');
      return {
        success: false,
        status: 'disconnected',
        message: 'Google Calendar connection not available'
      };
    } catch (error) {
      console.error('❌ [Persistence] Error initializing connection:', error);
      return {
        success: false,
        status: 'error',
        message: `Connection initialization failed: ${error.message}`
      };
    }
  }
}

export default new GoogleCalendarPersistenceService();
