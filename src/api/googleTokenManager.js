// Unified Google Calendar Token Manager
// Handles all Google Calendar token operations with proper refresh logic

import AsyncStorage from '@react-native-async-storage/async-storage';

class GoogleTokenManager {
  constructor() {
    this.tokenCache = new Map();
    this.refreshPromise = null; // Prevent multiple simultaneous refresh attempts
  }

  /**
   * Get valid access token with automatic refresh
   */
  async getValidAccessToken() {
    try {
      console.log('🔄 [TokenManager] Getting valid access token...');

      // Check cache first
      const cachedToken = this.tokenCache.get('access_token');
      const cachedExpiry = this.tokenCache.get('expiry');
      
      if (cachedToken && cachedExpiry && Date.now() < cachedExpiry) {
        console.log('✅ [TokenManager] Using cached valid token');
        return cachedToken;
      }

      // Get tokens from storage
      const tokens = await this.getStoredTokens();
      
      if (!tokens.accessToken) {
        console.log('❌ [TokenManager] No access token found');
        return null;
      }

      // Check if token is expired
      if (tokens.expiry && Date.now() > tokens.expiry) {
        console.log('❌ [TokenManager] Access token has expired');
        console.log('❌ [TokenManager] Expiry time:', new Date(tokens.expiry).toISOString());
        console.log('❌ [TokenManager] Current time:', new Date().toISOString());

        // Try to refresh the token
        if (tokens.refreshToken) {
          console.log('🔄 [TokenManager] Attempting to refresh expired token...');
          
          // Prevent multiple simultaneous refresh attempts
          if (this.refreshPromise) {
            console.log('🔄 [TokenManager] Token refresh already in progress, waiting...');
            return await this.refreshPromise;
          }

          this.refreshPromise = this.refreshAccessToken(tokens.refreshToken);
          
          try {
            const newTokens = await this.refreshPromise;
            if (newTokens && newTokens.access_token) {
              console.log('✅ [TokenManager] Token refreshed successfully');
              // Store the new tokens
              await this.storeTokens(newTokens);
              // Update cache
              this.tokenCache.set('access_token', newTokens.access_token);
              this.tokenCache.set('expiry', Date.now() + (newTokens.expires_in * 1000));
              return newTokens.access_token;
            }
          } catch (refreshError) {
            console.error('❌ [TokenManager] Token refresh failed:', refreshError);
          } finally {
            this.refreshPromise = null;
          }
        }

        // Clear expired tokens if refresh failed
        await this.clearTokens();
        return null;
      }

      console.log('✅ [TokenManager] Valid access token found');
      // Update cache
      this.tokenCache.set('access_token', tokens.accessToken);
      this.tokenCache.set('expiry', tokens.expiry);
      return tokens.accessToken;
    } catch (error) {
      console.error('❌ [TokenManager] Error getting valid access token:', error);
      return null;
    }
  }

  /**
   * Get stored tokens from AsyncStorage
   */
  async getStoredTokens() {
    try {
      const accessToken = await AsyncStorage.getItem('google_access_token');
      const refreshToken = await AsyncStorage.getItem('google_refresh_token');
      const expiry = await AsyncStorage.getItem('google_token_expiry');

      return {
        accessToken,
        refreshToken,
        expiry: expiry ? parseInt(expiry) : null
      };
    } catch (error) {
      console.error('❌ [TokenManager] Error getting stored tokens:', error);
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
      console.log('🔄 [TokenManager] Storing tokens...');
      
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        expires_at: tokens.expires_at
      };

      // Store in AsyncStorage
      await AsyncStorage.setItem('google_access_token', tokenData.access_token);
      if (tokenData.refresh_token) {
        await AsyncStorage.setItem('google_refresh_token', tokenData.refresh_token);
      }
      
      // Calculate expiry time
      const expiryTime = Date.now() + (tokenData.expires_in * 1000);
      await AsyncStorage.setItem('google_token_expiry', expiryTime.toString());

      // Update cache
      this.tokenCache.set('access_token', tokenData.access_token);
      this.tokenCache.set('expiry', expiryTime);

      console.log('✅ [TokenManager] Tokens stored successfully');
      return true;
    } catch (error) {
      console.error('❌ [TokenManager] Error storing tokens:', error);
      return false;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      console.log('🔄 [TokenManager] Refreshing access token...');

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
        console.error('❌ [TokenManager] Google token refresh failed:', errorData);
        throw new Error(`Token refresh failed: ${errorData.error_description || response.statusText}`);
      }

      const tokenData = await response.json();
      console.log('✅ [TokenManager] Token refresh successful');
      return tokenData;
    } catch (error) {
      console.error('❌ [TokenManager] Token refresh error:', error);
      throw error;
    }
  }

  /**
   * Clear all stored tokens
   */
  async clearTokens() {
    try {
      console.log('🔄 [TokenManager] Clearing all tokens...');
      
      await AsyncStorage.multiRemove([
        'google_access_token',
        'google_refresh_token', 
        'google_token_expiry'
      ]);

      // Clear cache
      this.tokenCache.clear();

      console.log('✅ [TokenManager] All tokens cleared');
      return true;
    } catch (error) {
      console.error('❌ [TokenManager] Error clearing tokens:', error);
      return false;
    }
  }

  /**
   * Check if user has valid Google Calendar access
   */
  async hasValidAccess() {
    try {
      const token = await this.getValidAccessToken();
      return !!token;
    } catch (error) {
      console.error('❌ [TokenManager] Error checking access:', error);
      return false;
    }
  }

  /**
   * Validate token by making a test API call
   */
  async validateToken(accessToken) {
    try {
      console.log('🔄 [TokenManager] Validating token...');
      
      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        console.log('✅ [TokenManager] Token is valid');
        return true;
      } else {
        console.log('❌ [TokenManager] Token validation failed:', response.status);
        return false;
      }
    } catch (error) {
      console.error('❌ [TokenManager] Token validation error:', error);
      return false;
    }
  }
}

// Export singleton instance
export const googleTokenManager = new GoogleTokenManager();
export default googleTokenManager;
