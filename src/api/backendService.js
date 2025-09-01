// Backend API Service
// Handles all communication with the deployed backend

import { BACKEND_CONFIG, getApiUrl, createAuthHeaders } from '../config/backend';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  REFRESH_TOKEN: 'refresh_token',
  USER_DATA: 'user_data',
};

class BackendService {
  constructor() {
    this.baseUrl = BACKEND_CONFIG.BASE_URL;
    this.token = null;
    this.refreshToken = null;
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
  }

  // Request helper with retry logic
  async makeRequest(endpoint, options = {}) {
    const url = getApiUrl(endpoint);
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
    }

    let lastError;
    
    for (let attempt = 1; attempt <= BACKEND_CONFIG.REQUEST_CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, config);
        
        // Handle 401 - try to refresh token
        if (response.status === 401 && this.refreshToken && attempt === 1) {
          const refreshed = await this.refreshAuthToken();
          if (refreshed) {
            // Retry with new token
            config.headers.Authorization = `Bearer ${this.token}`;
            continue;
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
        
        if (attempt < BACKEND_CONFIG.REQUEST_CONFIG.RETRY_ATTEMPTS) {
          await new Promise(resolve => 
            setTimeout(resolve, BACKEND_CONFIG.REQUEST_CONFIG.RETRY_DELAY * attempt)
          );
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

  // Health check
  async healthCheck() {
    try {
      const response = await fetch(getApiUrl('/health'));
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const backendService = new BackendService();
export default backendService;
