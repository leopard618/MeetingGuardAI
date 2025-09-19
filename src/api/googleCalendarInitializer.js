// Google Calendar Initializer
// Ensures Google Calendar connection is properly restored on app start

import googleCalendarConnectionManager from './googleCalendarConnectionManager.js';
import googleCalendarService from './googleCalendar.js';

class GoogleCalendarInitializer {
  constructor() {
    this.isInitialized = false;
    this.initializationPromise = null;
  }

  /**
   * Initialize Google Calendar connection on app start
   */
  async initialize() {
    // Prevent multiple simultaneous initializations
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._performInitialization();
    return this.initializationPromise;
  }

  async _performInitialization() {
    try {
      console.log('🚀 [GoogleCalendarInitializer] Starting Google Calendar initialization...');

      // Step 1: Initialize connection manager
      console.log('🔄 [GoogleCalendarInitializer] Initializing connection manager...');
      const connectionResult = await googleCalendarConnectionManager.initializeConnection();

      if (!connectionResult.success) {
        console.log('❌ [GoogleCalendarInitializer] Connection manager initialization failed:', connectionResult.message);
        this.isInitialized = false;
        return {
          success: false,
          message: connectionResult.message,
          status: connectionResult.status
        };
      }

      console.log('✅ [GoogleCalendarInitializer] Connection manager initialized:', connectionResult.message);

      // Step 2: Test the connection
      console.log('🔄 [GoogleCalendarInitializer] Testing Google Calendar connection...');
      const testResult = await googleCalendarConnectionManager.testConnection();

      if (!testResult.success) {
        console.log('❌ [GoogleCalendarInitializer] Connection test failed:', testResult.message);
        this.isInitialized = false;
        return {
          success: false,
          message: testResult.message,
          status: 'connection_test_failed'
        };
      }

      console.log('✅ [GoogleCalendarInitializer] Connection test successful:', testResult.message);

      // Step 3: Initialize Google Calendar service
      console.log('🔄 [GoogleCalendarInitializer] Initializing Google Calendar service...');
      const serviceResult = await googleCalendarService.initialize();

      if (!serviceResult) {
        console.log('❌ [GoogleCalendarInitializer] Google Calendar service initialization failed');
        this.isInitialized = false;
        return {
          success: false,
          message: 'Google Calendar service initialization failed',
          status: 'service_init_failed'
        };
      }

      console.log('✅ [GoogleCalendarInitializer] Google Calendar service initialized successfully');

      // Step 4: Final verification
      console.log('🔄 [GoogleCalendarInitializer] Performing final verification...');
      const finalTest = await googleCalendarConnectionManager.ensureConnection();

      if (!finalTest) {
        console.log('❌ [GoogleCalendarInitializer] Final verification failed');
        this.isInitialized = false;
        return {
          success: false,
          message: 'Final verification failed',
          status: 'verification_failed'
        };
      }

      console.log('✅ [GoogleCalendarInitializer] Final verification successful');

      this.isInitialized = true;
      console.log('🎉 [GoogleCalendarInitializer] Google Calendar initialization completed successfully!');

      return {
        success: true,
        message: 'Google Calendar initialized successfully',
        status: 'connected'
      };

    } catch (error) {
      console.error('❌ [GoogleCalendarInitializer] Initialization error:', error);
      this.isInitialized = false;
      this.initializationPromise = null;
      
      return {
        success: false,
        message: `Initialization failed: ${error.message}`,
        status: 'error'
      };
    }
  }

  /**
   * Get initialization status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      isInitializing: !!this.initializationPromise
    };
  }

  /**
   * Force re-initialization
   */
  async reinitialize() {
    console.log('🔄 [GoogleCalendarInitializer] Force re-initialization requested...');
    this.isInitialized = false;
    this.initializationPromise = null;
    return this.initialize();
  }

  /**
   * Check if Google Calendar is ready to use
   */
  async isReady() {
    if (!this.isInitialized) {
      return false;
    }

    try {
      const connectionStatus = googleCalendarConnectionManager.getConnectionStatus();
      return connectionStatus.isConnected;
    } catch (error) {
      console.error('❌ [GoogleCalendarInitializer] Error checking readiness:', error);
      return false;
    }
  }

  /**
   * Get comprehensive status
   */
  async getComprehensiveStatus() {
    try {
      const initStatus = this.getStatus();
      const connectionStatus = googleCalendarConnectionManager.getConnectionStatus();
      const isReady = await this.isReady();

      return {
        initialization: initStatus,
        connection: connectionStatus,
        isReady: isReady,
        overall: isReady ? 'ready' : 'not_ready'
      };
    } catch (error) {
      console.error('❌ [GoogleCalendarInitializer] Error getting comprehensive status:', error);
      return {
        initialization: { isInitialized: false, isInitializing: false },
        connection: { isConnected: false, status: 'error' },
        isReady: false,
        overall: 'error'
      };
    }
  }
}

export default new GoogleCalendarInitializer();
