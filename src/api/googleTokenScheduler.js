// Google Token Automatic Refresh Scheduler
// This service automatically refreshes Google tokens before they expire

import AsyncStorage from '@react-native-async-storage/async-storage';
import googleTokenManager from './googleTokenManager.js';

class GoogleTokenScheduler {
  constructor() {
    this.refreshInterval = null;
    this.isRunning = false;
    this.refreshIntervalMinutes = 30; // Check every 30 minutes
  }

  /**
   * Start automatic token refresh scheduler
   */
  async startAutoRefresh() {
    if (this.isRunning) {
      console.log('🔄 [TokenScheduler] Auto-refresh already running');
      return;
    }

    console.log('🚀 [TokenScheduler] Starting automatic token refresh scheduler');
    this.isRunning = true;

    // Initial check
    await this.checkAndRefreshTokens();

    // Set up periodic checks
    this.refreshInterval = setInterval(async () => {
      await this.checkAndRefreshTokens();
    }, this.refreshIntervalMinutes * 60 * 1000);

    console.log(`✅ [TokenScheduler] Auto-refresh started (checking every ${this.refreshIntervalMinutes} minutes)`);
  }

  /**
   * Stop automatic token refresh scheduler
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 [TokenScheduler] Auto-refresh stopped');
  }

  /**
   * Check tokens and refresh if needed
   */
  async checkAndRefreshTokens() {
    try {
      console.log('🔍 [TokenScheduler] Checking token status...');

      // Get current tokens
      const tokens = await this.getStoredTokens();
      
      if (!tokens || !tokens.accessToken || !tokens.refreshToken) {
        console.log('⚠️ [TokenScheduler] No tokens found, skipping refresh');
        return;
      }

      // Check if token needs refresh (15 minutes before expiry)
      const fifteenMinutesFromNow = Date.now() + (15 * 60 * 1000);
      const needsRefresh = tokens.expiry && fifteenMinutesFromNow > tokens.expiry;

      if (needsRefresh) {
        const timeUntilExpiry = tokens.expiry - Date.now();
        const minutesUntilExpiry = Math.floor(timeUntilExpiry / (60 * 1000));

        console.log(`🔄 [TokenScheduler] Token expires in ${minutesUntilExpiry} minutes, refreshing now...`);

        try {
          const newTokens = await googleTokenManager.refreshAccessToken(tokens.refreshToken);
          
          if (newTokens && newTokens.access_token) {
            console.log('✅ [TokenScheduler] Token refreshed successfully');
            
            // Store the new tokens
            await this.storeTokens(newTokens);
            
            // Update expiry time
            const expiryTime = Date.now() + (newTokens.expires_in * 1000);
            await AsyncStorage.setItem('google_token_expiry', expiryTime.toString());
            
            console.log('✅ [TokenScheduler] New token expires at:', new Date(expiryTime).toISOString());
          } else {
            console.error('❌ [TokenScheduler] Token refresh returned invalid data');
          }
        } catch (refreshError) {
          console.error('❌ [TokenScheduler] Automatic token refresh failed:', refreshError.message);
          
          // If refresh fails, we might need user to reconnect
          if (refreshError.message.includes('invalid_grant') || 
              refreshError.message.includes('Client Secret not configured')) {
            console.log('⚠️ [TokenScheduler] Token refresh failed - user may need to reconnect');
            
            // Store a flag that user needs to reconnect
            await AsyncStorage.setItem('google_calendar_needs_reconnect', 'true');
          }
        }
      } else {
        const timeUntilExpiry = tokens.expiry - Date.now();
        const minutesUntilExpiry = Math.floor(timeUntilExpiry / (60 * 1000));
        console.log(`✅ [TokenScheduler] Token is valid for ${minutesUntilExpiry} more minutes`);
      }
    } catch (error) {
      console.error('❌ [TokenScheduler] Error checking tokens:', error);
    }
  }

  /**
   * Get stored tokens
   */
  async getStoredTokens() {
    try {
      const [accessToken, refreshToken, expiryStr] = await Promise.all([
        AsyncStorage.getItem('google_access_token'),
        AsyncStorage.getItem('google_refresh_token'),
        AsyncStorage.getItem('google_token_expiry')
      ]);

      if (!accessToken || !refreshToken) {
        return null;
      }

      return {
        accessToken,
        refreshToken,
        expiry: expiryStr ? parseInt(expiryStr) : null
      };
    } catch (error) {
      console.error('❌ [TokenScheduler] Error getting stored tokens:', error);
      return null;
    }
  }

  /**
   * Store tokens
   */
  async storeTokens(tokens) {
    try {
      const expiryTime = Date.now() + (tokens.expires_in * 1000);
      
      await Promise.all([
        AsyncStorage.setItem('google_access_token', tokens.access_token),
        tokens.refresh_token ? AsyncStorage.setItem('google_refresh_token', tokens.refresh_token) : Promise.resolve(),
        AsyncStorage.setItem('google_token_expiry', expiryTime.toString())
      ]);

      console.log('✅ [TokenScheduler] Tokens stored successfully');
    } catch (error) {
      console.error('❌ [TokenScheduler] Error storing tokens:', error);
      throw error;
    }
  }

  /**
   * Check if user needs to reconnect
   */
  async needsReconnect() {
    try {
      const needsReconnect = await AsyncStorage.getItem('google_calendar_needs_reconnect');
      return needsReconnect === 'true';
    } catch (error) {
      console.error('❌ [TokenScheduler] Error checking reconnect status:', error);
      return false;
    }
  }

  /**
   * Clear reconnect flag
   */
  async clearReconnectFlag() {
    try {
      await AsyncStorage.removeItem('google_calendar_needs_reconnect');
      console.log('✅ [TokenScheduler] Reconnect flag cleared');
    } catch (error) {
      console.error('❌ [TokenScheduler] Error clearing reconnect flag:', error);
    }
  }

  /**
   * Get token status for debugging
   */
  async getTokenStatus() {
    try {
      const tokens = await this.getStoredTokens();
      
      if (!tokens) {
        return {
          hasTokens: false,
          status: 'No tokens found'
        };
      }

      const now = Date.now();
      const timeUntilExpiry = tokens.expiry - now;
      const minutesUntilExpiry = Math.floor(timeUntilExpiry / (60 * 1000));
      const isExpired = now > tokens.expiry;
      const needsReconnect = await this.needsReconnect();

      return {
        hasTokens: true,
        hasAccessToken: !!tokens.accessToken,
        hasRefreshToken: !!tokens.refreshToken,
        isExpired,
        minutesUntilExpiry,
        expiryTime: new Date(tokens.expiry).toISOString(),
        needsReconnect,
        status: isExpired ? 'Expired' : needsReconnect ? 'Needs Reconnect' : 'Valid'
      };
    } catch (error) {
      return {
        hasTokens: false,
        status: `Error: ${error.message}`
      };
    }
  }
}

// Export singleton instance
const googleTokenScheduler = new GoogleTokenScheduler();

// Make available globally for debugging
if (typeof window !== 'undefined') {
  window.googleTokenScheduler = googleTokenScheduler;
  window.checkGoogleTokenStatus = () => googleTokenScheduler.getTokenStatus();
}

export default googleTokenScheduler;
