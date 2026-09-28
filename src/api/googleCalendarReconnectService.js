/**
 * Simplified Google Calendar Reconnect Service
 * Uses the existing Google authentication to reconnect Google Calendar
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MovedToServerError } from '../utils/movedToServer';
import { Alert } from 'react-native';

class GoogleCalendarReconnectService {
  
  /**
   * Reconnect Google Calendar using existing Google authentication
   * This checks if the user is already signed in with Google and reuses those tokens
   */
  async reconnectUsingExistingAuth() {
    try {
      console.log('🔄 GoogleCalendarReconnectService: Starting reconnection using existing auth...');
      
      // Check if user is authenticated
      const userData = await AsyncStorage.getItem('user');
      if (!userData) {
        throw new Error('User not authenticated. Please sign in first.');
      }
      
      const user = JSON.parse(userData);
      console.log('👤 User found:', user.email);
      
      // Check if user signed in with Google (has googleId)
      if (!user.googleId && !user.google_id) {
        throw new Error('User did not sign in with Google. Google Calendar requires Google authentication.');
      }
      
      // Try to get existing Google tokens from the frontend
      const googleTokens = await this.getExistingGoogleTokens();
      console.log('🔑 Existing Google tokens check:', {
        hasAccessToken: !!googleTokens?.access_token,
        hasRefreshToken: !!googleTokens?.refresh_token
      });
      
      if (googleTokens && googleTokens.access_token) {
        // We have tokens locally, sync them with backend
        console.log('✅ Found existing Google tokens, syncing with backend...');
        const syncResult = await this.syncTokensWithBackend(googleTokens, user);
        
        if (syncResult.success) {
          // Initialize Google Calendar service
          const googleCalendarService = (await import('./googleCalendar')).default;
          const initialized = await googleCalendarService.initialize();
          
          if (initialized) {
            console.log('✅ Google Calendar reconnected successfully using existing tokens!');
            return {
              success: true,
              message: 'Google Calendar reconnected successfully using your existing Google authentication!'
            };
          } else {
            throw new Error('Failed to initialize Google Calendar service with existing tokens');
          }
        } else {
          throw new Error(`Failed to sync tokens with backend: ${syncResult.error}`);
        }
      } else {
        // No local tokens, need fresh authentication
        console.log('⚠️ No local Google tokens found, requesting fresh Google sign-in...');
        return await this.requestFreshGoogleAuth();
      }
      
    } catch (error) {
      console.error('❌ GoogleCalendarReconnectService: Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to reconnect Google Calendar'
      };
    }
  }
  
  /**
   * Get existing Google tokens from local storage
   */
  async getExistingGoogleTokens() {
    try {
      const [accessToken, refreshToken, expiry] = await Promise.all([
        AsyncStorage.getItem('google_access_token'),
        AsyncStorage.getItem('google_refresh_token'),
        AsyncStorage.getItem('google_token_expiry')
      ]);
      
      if (accessToken) {
        return {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiry
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error getting existing Google tokens:', error);
      return null;
    }
  }
  
  /**
   * Sync Google tokens with backend database.
   *
   * Disabled: this posted Google tokens to the retired Render backend. Token storage will move
   * to Firebase (server-side) in a later stage.
   */
  async syncTokensWithBackend(_tokens, _user) {
    const error = new MovedToServerError('backend-sync');
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  /**
   * Request fresh Google authentication
   */
  async requestFreshGoogleAuth() {
    try {
      console.log('🔄 Requesting fresh Google authentication...');
      
      // Get the main Google auth service
      const googleAuth = (await import('../hooks/useGoogleAuth')).useGoogleAuth;
      
      if (!googleAuth) {
        throw new Error('Google authentication service not available');
      }
      
      return {
        success: false,
        error: 'Please sign out and sign in again with Google to refresh your Google Calendar connection.',
        requiresReauth: true
      };
    } catch (error) {
      console.error('❌ Error requesting fresh Google auth:', error);
      return {
        success: false,
        error: error.message || 'Failed to initiate fresh Google authentication'
      };
    }
  }
}

export default new GoogleCalendarReconnectService();
