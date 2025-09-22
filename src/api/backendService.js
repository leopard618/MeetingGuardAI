// Backend API Service
// Handles all communication with the deployed backend

import { BACKEND_CONFIG, getApiUrl, createAuthHeaders } from '../config/backend.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleAuthError } from '../utils/authUtils.js';

// Storage keys
const STORAGE_KEYS = {
  AUTH_TOKEN: 'authToken', // Match AuthContext storage key
  REFRESH_TOKEN: 'refresh_token',
  USER_DATA: 'user_data',
};

class BackendService {
  constructor() {
    this.baseUrl = BACKEND_CONFIG.BASE_URL;
    this.token = null;
    this.refreshToken = null;
    this.requestCache = new Map();
    this.lastHealthCheck = 0;
    this.healthCheckInterval = 30000; // 30 seconds minimum between health checks
    this.pendingRequests = new Map(); // Prevent duplicate requests
  }

  // Token management
  async setTokens(accessToken, refreshToken) {
    this.token = accessToken;
    this.refreshToken = refreshToken;
    
    await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, accessToken);
    if (refreshToken) {
      await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    }
  }

  async loadTokens() {
    try {
      this.token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      this.refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      
      console.log('BackendService: Loading tokens -', {
        hasToken: !!this.token,
        tokenLength: this.token ? this.token.length : 0,
        tokenStart: this.token ? this.token.substring(0, 20) + '...' : 'none',
        hasRefreshToken: !!this.refreshToken
      });
      
      return !!this.token;
    } catch (error) {
      console.error('Error loading tokens:', error);
      return false;
    }
  }

  async clearTokens() {
    this.token = null;
    this.refreshToken = null;
    
    await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    await AsyncStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    await AsyncStorage.removeItem(STORAGE_KEYS.USER_DATA);
    
    console.log('BackendService: All tokens cleared');
  }

  // Validate user authentication status
  async validateAuth() {
    try {
      if (!this.token) {
        console.log('BackendService: No token available for validation');
        return false;
      }

      // Try to get user profile to validate token
      const response = await fetch(getApiUrl(BACKEND_CONFIG.ENDPOINTS.AUTH.PROFILE), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
      });

      if (response.ok) {
        console.log('BackendService: Token validation successful');
        return true;
      } else if (response.status === 401) {
        console.log('BackendService: Token validation failed - 401');
        await this.clearTokens();
        return false;
      } else {
        console.log('BackendService: Token validation failed - status:', response.status);
        return false;
      }
    } catch (error) {
      console.error('BackendService: Token validation error:', error);
      return false;
    }
  }

  // Request helper with retry logic, rate limiting handling, and deduplication
  async makeRequest(endpoint, options = {}) {
    const url = getApiUrl(endpoint);
    const requestKey = `${options.method || 'GET'}:${url}`;
    
    // Check if same request is already pending
    if (this.pendingRequests.has(requestKey)) {
      console.log('BackendService: Request already pending, waiting for result');
      return this.pendingRequests.get(requestKey);
    }
    
    const config = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    // Add auth token if available
    if (this.token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${this.token}`;
      console.log('BackendService: Adding auth token to request:', this.token.substring(0, 20) + '...');
    } else {
      console.log('BackendService: No auth token available for request');
    }

    // Create promise for this request
    const requestPromise = this._executeRequest(url, config);
    this.pendingRequests.set(requestKey, requestPromise);
    
    try {
      const result = await requestPromise;
      return result;
    } finally {
      // Clean up pending request
      this.pendingRequests.delete(requestKey);
    }
  }

  // Internal method to execute the actual request
  async _executeRequest(url, config) {
    let lastError;
    
    for (let attempt = 1; attempt <= BACKEND_CONFIG.REQUEST_CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, config);
        
        // Handle 401 - try to refresh token or clear auth
        if (response.status === 401) {
          const errorData = await response.json().catch(() => ({}));
          console.log('BackendService: 401 error details:', errorData);
          
          // If user not found or account deactivated, clear tokens
          if (errorData.message && errorData.message.includes('User not found or account deactivated')) {
            console.log('BackendService: User not found or deactivated, clearing auth state');
            await handleAuthError(new Error(errorData.message));
            throw new Error('Authentication failed: User not found or account deactivated. Please sign in again.');
          }
          
          // Try to refresh token if we have a refresh token
          if (this.refreshToken && attempt === 1) {
            const refreshed = await this.refreshAuthToken();
            if (refreshed) {
              // Retry with new token
              config.headers.Authorization = `Bearer ${this.token}`;
              continue;
            }
          }
          
          // If refresh failed or no refresh token, clear auth
          console.log('BackendService: Token refresh failed or no refresh token, clearing auth');
          await this.clearTokens();
          throw new Error('Authentication failed: Please sign in again.');
        }
        
        // Handle 429 - Rate limiting with exponential backoff
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
          
          console.log(`BackendService: Rate limited (429), waiting ${waitTime}ms before retry ${attempt}/${BACKEND_CONFIG.REQUEST_CONFIG.RETRY_ATTEMPTS}`);
          
          if (attempt < BACKEND_CONFIG.REQUEST_CONFIG.RETRY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          } else {
            throw new Error('HTTP 429 - Rate limit exceeded. Please try again later.');
          }
        }
        
        // Handle other errors
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `HTTP ${response.status}`);
        }
        
        return await response.json();
        
      } catch (error) {
        lastError = error;
        
        // Don't retry on 429 errors after max attempts
        if (error.message.includes('HTTP 429')) {
          throw error;
        }
        
        if (attempt < BACKEND_CONFIG.REQUEST_CONFIG.RETRY_ATTEMPTS) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`BackendService: Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${BACKEND_CONFIG.REQUEST_CONFIG.RETRY_ATTEMPTS})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  // Token refresh
  async refreshAuthToken() {
    try {
      const response = await fetch(getApiUrl(BACKEND_CONFIG.ENDPOINTS.AUTH.REFRESH), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: this.refreshToken,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        await this.setTokens(data.access_token, data.refresh_token);
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
    
    // Clear tokens if refresh failed
    await this.clearTokens();
    return false;
  }

  // Authentication
  async getProfile() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.AUTH.PROFILE);
  }

  async updateProfile(profileData) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.AUTH.PROFILE, {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  }

  async logout() {
    try {
      await this.makeRequest(BACKEND_CONFIG.ENDPOINTS.AUTH.LOGOUT, {
        method: 'POST',
      });
    } finally {
      await this.clearTokens();
    }
  }

  // Meetings
  async getMeetings() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.MEETINGS.LIST);
  }

  async createMeeting(meetingData) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.MEETINGS.CREATE, {
      method: 'POST',
      body: JSON.stringify(meetingData),
    });
  }

  async getMeeting(id) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.MEETINGS.GET(id));
  }

  async updateMeeting(id, meetingData) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.MEETINGS.UPDATE(id), {
      method: 'PUT',
      body: JSON.stringify(meetingData),
    });
  }

  async deleteMeeting(id) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.MEETINGS.DELETE(id), {
      method: 'DELETE',
    });
  }

  async getMeetingParticipants(id) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.MEETINGS.PARTICIPANTS(id));
  }

  async addMeetingParticipant(id, participantData) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.MEETINGS.PARTICIPANTS(id), {
      method: 'POST',
      body: JSON.stringify(participantData),
    });
  }

  // Calendar
  async getCalendarEvents() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.CALENDAR.EVENTS);
  }

  async syncCalendar() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.CALENDAR.SYNC, {
      method: 'POST',
    });
  }

  async createCalendarEvent(eventData) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.CALENDAR.CREATE_EVENT, {
      method: 'POST',
      body: JSON.stringify(eventData),
    });
  }

  // AI
  async sendAIMessage(message, meetingId = null) {
    const endpoint = meetingId 
      ? BACKEND_CONFIG.ENDPOINTS.AI.MEETING_ANALYSIS(meetingId)
      : BACKEND_CONFIG.ENDPOINTS.AI.CHAT;
      
    return this.makeRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify({ message, meeting_id: meetingId }),
    });
  }

  // Files
  async getFiles() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.FILES.LIST);
  }

  async uploadFile(fileData) {
    const formData = new FormData();
    formData.append('file', fileData);
    
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.FILES.UPLOAD, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      body: formData,
    });
  }

  async deleteFile(id) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.FILES.DELETE(id), {
      method: 'DELETE',
    });
  }

  // Users
  async getUserPreferences() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.USERS.PREFERENCES);
  }

  async updateUserPreferences(preferences) {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.USERS.PREFERENCES, {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
  }

  async getUserStats() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.USERS.STATS);
  }

  async deleteAccount() {
    return this.makeRequest(BACKEND_CONFIG.ENDPOINTS.USERS.DELETE_ACCOUNT, {
      method: 'DELETE',
    });
  }

  // Health check with throttling
  async healthCheck() {
    const now = Date.now();
    
    // Throttle health checks to prevent rate limiting
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      console.log('BackendService: Health check throttled, using cached result');
      return true; // Assume healthy if recently checked
    }
    
    try {
      console.log('BackendService: Performing health check to:', getApiUrl('/health'));
      const response = await fetch(getApiUrl('/health'));
      console.log('BackendService: Health check response status:', response.status);
      
      this.lastHealthCheck = now;
      return response.ok;
    } catch (error) {
      console.error('BackendService: Health check failed:', error);
      this.lastHealthCheck = now;
      return false;
    }
  }
}

// Export singleton instance
export const backendService = new BackendService();
export default backendService;
