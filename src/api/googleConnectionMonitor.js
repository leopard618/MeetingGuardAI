// Google Connection Monitor
// Monitors Google Calendar connection and automatically logs out user if disconnected

import AsyncStorage from '@react-native-async-storage/async-storage';
import googleTokenManager from './googleTokenManager.js';

class GoogleConnectionMonitor {
  constructor() {
    this.isMonitoring = false;
    this.monitorInterval = null;
    this.checkIntervalMinutes = 5; // Check every 5 minutes
    this.consecutiveFailures = 0;
    this.maxFailuresBeforeLogout = 3; // Logout after 3 consecutive failures
  }

  /**
   * Start monitoring Google connection
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('🔍 [ConnectionMonitor] Already monitoring Google connection');
      return;
    }

    console.log('🚀 [ConnectionMonitor] Starting Google connection monitoring...');
    
    this.isMonitoring = true;
    this.consecutiveFailures = 0;

    // Initial check
    this.checkConnection();

    // Set up periodic checks
    this.monitorInterval = setInterval(() => {
      this.checkConnection();
    }, this.checkIntervalMinutes * 60 * 1000);

    console.log(`✅ [ConnectionMonitor] Monitoring started (checking every ${this.checkIntervalMinutes} minutes)`);
  }

  /**
   * Stop monitoring Google connection
   */
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;
    this.consecutiveFailures = 0;
    console.log('🛑 [ConnectionMonitor] Google connection monitoring stopped');
  }

  /**
   * Check Google connection health
   */
  async checkConnection() {
    try {
      console.log('🔍 [ConnectionMonitor] Checking Google connection health...');

      // Check if we have valid tokens
      const hasValidTokens = await googleTokenManager.hasValidAccess();
      
      if (!hasValidTokens) {
        console.log('❌ [ConnectionMonitor] No valid Google tokens found');
        this.handleConnectionFailure('No valid tokens');
        return;
      }

      // Try to make a simple API call to verify connection
      const accessToken = await googleTokenManager.getValidAccessToken();
      
      if (!accessToken) {
        console.log('❌ [ConnectionMonitor] Could not get valid access token');
        this.handleConnectionFailure('Token retrieval failed');
        return;
      }

      // Test the token with a simple calendar API call
      const testResult = await this.testGoogleCalendarAPI(accessToken);
      
      if (testResult.success) {
        console.log('✅ [ConnectionMonitor] Google Calendar connection is healthy');
        this.consecutiveFailures = 0; // Reset failure count on success
      } else {
        console.log('❌ [ConnectionMonitor] Google Calendar API test failed:', testResult.error);
        this.handleConnectionFailure(testResult.error);
      }

    } catch (error) {
      console.error('❌ [ConnectionMonitor] Error checking connection:', error);
      this.handleConnectionFailure(error.message);
    }
  }

  /**
   * Test Google Calendar API with a simple call
   */
  async testGoogleCalendarAPI(accessToken) {
    try {
      console.log('🧪 [ConnectionMonitor] Testing Google Calendar API...');

      // Use the correct endpoint for calendar list
      const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=1', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        console.log('✅ [ConnectionMonitor] Google Calendar API test successful');
        return { success: true };
      } else {
        const errorText = await response.text();
        console.log('❌ [ConnectionMonitor] Google Calendar API test failed:', response.status, errorText);
        
        // Check for specific error types
        if (response.status === 401) {
          return { success: false, error: 'Unauthorized - token expired or invalid' };
        } else if (response.status === 403) {
          return { success: false, error: 'Forbidden - insufficient permissions' };
        } else if (response.status === 404) {
          return { success: false, error: 'Calendar service not found - check permissions' };
        } else {
          return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }
      }
    } catch (error) {
      console.error('❌ [ConnectionMonitor] Google Calendar API test error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle connection failure
   */
  async handleConnectionFailure(reason) {
    this.consecutiveFailures++;
    
    console.log(`⚠️ [ConnectionMonitor] Connection failure ${this.consecutiveFailures}/${this.maxFailuresBeforeLogout}: ${reason}`);

    if (this.consecutiveFailures >= this.maxFailuresBeforeLogout) {
      console.log('🚨 [ConnectionMonitor] Maximum consecutive failures reached - triggering automatic logout');
      
      // Stop monitoring to prevent additional logout attempts
      this.stopMonitoring();
      
      // Trigger automatic logout
      await this.triggerAutomaticLogout(reason);
    } else {
      console.log(`⏳ [ConnectionMonitor] Will retry... (${this.maxFailuresBeforeLogout - this.consecutiveFailures} attempts remaining)`);
    }
  }

  /**
   * Trigger automatic logout due to Google disconnection
   */
  async triggerAutomaticLogout(reason) {
    try {
      console.log('🚨 [ConnectionMonitor] Triggering automatic logout due to Google disconnection');
      console.log('🚨 [ConnectionMonitor] Reason:', reason);
      
      // Clear all authentication data
      await AsyncStorage.multiRemove([
        'user',
        'authToken',
        'google_access_token',
        'google_refresh_token',
        'google_token_expiry',
        'google_calendar_connected',
        'google_calendar_connected_at'
      ]);
      
      console.log('✅ [ConnectionMonitor] All auth data cleared - user will be automatically logged out');
      
      // Store the reason for logout for user feedback
      await AsyncStorage.setItem('logout_reason', JSON.stringify({
        reason: 'google_disconnected',
        details: reason,
        timestamp: new Date().toISOString()
      }));
      
      // The AuthContext will detect the cleared tokens and automatically log out the user
      // This triggers a clean re-authentication flow
      
    } catch (error) {
      console.error('❌ [ConnectionMonitor] Error during automatic logout:', error);
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      checkInterval: this.checkIntervalMinutes,
      consecutiveFailures: this.consecutiveFailures,
      maxFailures: this.maxFailuresBeforeLogout
    };
  }

  /**
   * Check if user was logged out due to Google disconnection
   */
  async getLogoutReason() {
    try {
      const reasonData = await AsyncStorage.getItem('logout_reason');
      if (reasonData) {
        const reason = JSON.parse(reasonData);
        // Clear the reason after reading it
        await AsyncStorage.removeItem('logout_reason');
        return reason;
      }
      return null;
    } catch (error) {
      console.error('❌ [ConnectionMonitor] Error getting logout reason:', error);
      return null;
    }
  }
}

// Export singleton instance
const googleConnectionMonitor = new GoogleConnectionMonitor();

// Make available globally for debugging
if (typeof window !== 'undefined') {
  window.googleConnectionMonitor = googleConnectionMonitor;
}

export default googleConnectionMonitor;
