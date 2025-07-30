import AsyncStorage from '@react-native-async-storage/async-storage';

// Environment variables for Microsoft Graph API
let MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID;

try {
  const env = require('@env');
  MICROSOFT_CLIENT_ID = env.MICROSOFT_CLIENT_ID;
  MICROSOFT_CLIENT_SECRET = env.MICROSOFT_CLIENT_SECRET;
  MICROSOFT_TENANT_ID = env.MICROSOFT_TENANT_ID;
} catch (error) {
  MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
  MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
  MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID;
}

class MicrosoftGraphService {
  constructor() {
    this.clientId = MICROSOFT_CLIENT_ID;
    this.clientSecret = MICROSOFT_CLIENT_SECRET;
    this.tenantId = MICROSOFT_TENANT_ID;
    this.accessToken = null;
    this.refreshToken = null;
    this.baseUrl = 'https://graph.microsoft.com/v1.0';
    this.authUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0`;
  }

  /**
   * Initialize Microsoft Graph service
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      await this.loadStoredTokens();
      return this.isAuthenticated();
    } catch (error) {
      console.error('Microsoft Graph initialization failed:', error);
      return false;
    }
  }

  /**
   * Authenticate with Microsoft Graph
   * @returns {Promise<boolean>} Whether authentication was successful
   */
  async authenticate() {
    try {
      // For mobile apps, we'll use device code flow or web auth
      const authUrl = `${this.authUrl}/authorize?` +
        `client_id=${this.clientId}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent('https://meetingguard.com/auth/callback')}&` +
        `scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.ReadWrite offline_access')}&` +
        `response_mode=query`;

      // In a real implementation, this would open a web view for authentication
      // For now, we'll simulate the authentication flow
      console.log('Microsoft Graph authentication URL:', authUrl);
      
      // Simulate successful authentication
      this.accessToken = 'mock-access-token';
      this.refreshToken = 'mock-refresh-token';
      
      await this.storeTokens();
      return true;
    } catch (error) {
      console.error('Microsoft Graph authentication failed:', error);
      return false;
    }
  }

  /**
   * Make authenticated request to Microsoft Graph API
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async makeRequest(endpoint, options = {}) {
    try {
      if (!this.accessToken) {
        throw new Error('Not authenticated');
      }

      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, try to refresh
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            return this.makeRequest(endpoint, options);
          }
        }
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Microsoft Graph API request failed:', error);
      throw error;
    }
  }

  /**
   * Refresh access token
   * @returns {Promise<boolean>} Whether refresh was successful
   */
  async refreshAccessToken() {
    try {
      if (!this.refreshToken) {
        return false;
      }

      const response = await fetch(`${this.authUrl}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;

      await this.storeTokens();
      return true;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      return false;
    }
  }

  /**
   * Create a new meeting/event
   * @param {Object} meetingData - Meeting data
   * @returns {Promise<Object>} Created meeting
   */
  async createMeeting(meetingData) {
    try {
      const {
        title,
        date,
        time,
        duration = 60,
        location,
        participants = [],
        description,
      } = meetingData;

      const startDate = new Date(`${date}T${time}:00`);
      const endDate = new Date(startDate.getTime() + duration * 60000);

      const eventData = {
        subject: title,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: 'UTC',
        },
        location: {
          displayName: location,
        },
        body: {
          contentType: 'HTML',
          content: description || '',
        },
        attendees: participants.map(email => ({
          emailAddress: { address: email },
          type: 'required',
        })),
        reminderMinutesBeforeStart: 15,
      };

      const response = await this.makeRequest('/me/events', {
        method: 'POST',
        body: JSON.stringify(eventData),
      });

      return {
        id: response.id,
        ...meetingData,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        webLink: response.webLink,
      };
    } catch (error) {
      console.error('Failed to create meeting:', error);
      throw new Error(`Failed to create meeting: ${error.message}`);
    }
  }

  /**
   * Update an existing meeting
   * @param {string} meetingId - Meeting ID
   * @param {Object} updates - Meeting updates
   * @returns {Promise<Object>} Updated meeting
   */
  async updateMeeting(meetingId, updates) {
    try {
      const eventData = {};

      if (updates.title) eventData.subject = updates.title;
      if (updates.location) eventData.location = { displayName: updates.location };
      if (updates.description) eventData.body = { contentType: 'HTML', content: updates.description };

      if (updates.date && updates.time) {
        const startDate = new Date(`${updates.date}T${updates.time}:00`);
        const endDate = new Date(startDate.getTime() + (updates.duration || 60) * 60000);
        
        eventData.start = {
          dateTime: startDate.toISOString(),
          timeZone: 'UTC',
        };
        eventData.end = {
          dateTime: endDate.toISOString(),
          timeZone: 'UTC',
        };
      }

      if (updates.participants) {
        eventData.attendees = updates.participants.map(email => ({
          emailAddress: { address: email },
          type: 'required',
        }));
      }

      const response = await this.makeRequest(`/me/events/${meetingId}`, {
        method: 'PATCH',
        body: JSON.stringify(eventData),
      });

      return {
        id: meetingId,
        ...updates,
        webLink: response.webLink,
      };
    } catch (error) {
      console.error('Failed to update meeting:', error);
      throw new Error(`Failed to update meeting: ${error.message}`);
    }
  }

  /**
   * Delete a meeting
   * @param {string} meetingId - Meeting ID
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteMeeting(meetingId) {
    try {
      await this.makeRequest(`/me/events/${meetingId}`, {
        method: 'DELETE',
      });
      return true;
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      throw new Error(`Failed to delete meeting: ${error.message}`);
    }
  }

  /**
   * Get meetings for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Array of meetings
   */
  async getMeetings(startDate, endDate) {
    try {
      const startTime = startDate.toISOString();
      const endTime = endDate.toISOString();

      const response = await this.makeRequest(
        `/me/calendarView?startDateTime=${startTime}&endDateTime=${endTime}&$orderby=start/dateTime`
      );

      return response.value.map(event => ({
        id: event.id,
        title: event.subject,
        startDate: event.start.dateTime,
        endDate: event.end.dateTime,
        location: event.location?.displayName,
        description: event.body?.content,
        attendees: event.attendees?.map(a => a.emailAddress.address) || [],
        webLink: event.webLink,
        isAllDay: event.isAllDay,
      }));
    } catch (error) {
      console.error('Failed to get meetings:', error);
      throw new Error(`Failed to get meetings: ${error.message}`);
    }
  }

  /**
   * Get today's meetings
   * @returns {Promise<Array>} Today's meetings
   */
  async getTodayMeetings() {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return this.getMeetings(startOfDay, endOfDay);
  }

  /**
   * Get upcoming meetings
   * @param {number} days - Number of days to look ahead
   * @returns {Promise<Array>} Upcoming meetings
   */
  async getUpcomingMeetings(days = 7) {
    const now = new Date();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return this.getMeetings(now, endDate);
  }

  /**
   * Check availability for a time slot
   * @param {Date} startDate - Start date/time
   * @param {Date} endDate - End date/time
   * @returns {Promise<boolean>} Whether the time slot is available
   */
  async checkAvailability(startDate, endDate) {
    try {
      const meetings = await this.getMeetings(startDate, endDate);
      return meetings.length === 0;
    } catch (error) {
      console.error('Failed to check availability:', error);
      return false;
    }
  }

  /**
   * Find available time slots
   * @param {Date} date - Date to check
   * @param {number} duration - Duration in minutes
   * @param {string} startTime - Start time (HH:MM)
   * @param {string} endTime - End time (HH:MM)
   * @returns {Promise<Array>} Available time slots
   */
  async findAvailableSlots(date, duration = 60, startTime = '09:00', endTime = '17:00') {
    try {
      const [startHour, startMinute] = startTime.split(':').map(Number);
      const [endHour, endMinute] = endTime.split(':').map(Number);

      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute);
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute);

      const meetings = await this.getMeetings(dayStart, dayEnd);

      const availableSlots = [];
      let currentTime = new Date(dayStart);

      while (currentTime < dayEnd) {
        const slotEnd = new Date(currentTime.getTime() + duration * 60000);
        
        if (slotEnd <= dayEnd) {
          const conflictingMeeting = meetings.find(meeting => {
            const meetingStart = new Date(meeting.startDate);
            const meetingEnd = new Date(meeting.endDate);
            return (meetingStart < slotEnd && meetingEnd > currentTime);
          });

          if (!conflictingMeeting) {
            availableSlots.push({
              start: new Date(currentTime),
              end: slotEnd,
            });
          }
        }

        currentTime = new Date(currentTime.getTime() + 30 * 60000); // Check every 30 minutes
      }

      return availableSlots;
    } catch (error) {
      console.error('Failed to find available slots:', error);
      return [];
    }
  }

  /**
   * Store authentication tokens
   * @returns {Promise<void>}
   */
  async storeTokens() {
    try {
      await AsyncStorage.setItem('microsoft_access_token', this.accessToken);
      if (this.refreshToken) {
        await AsyncStorage.setItem('microsoft_refresh_token', this.refreshToken);
      }
    } catch (error) {
      console.error('Failed to store Microsoft tokens:', error);
    }
  }

  /**
   * Load stored authentication tokens
   * @returns {Promise<void>}
   */
  async loadStoredTokens() {
    try {
      this.accessToken = await AsyncStorage.getItem('microsoft_access_token');
      this.refreshToken = await AsyncStorage.getItem('microsoft_refresh_token');
    } catch (error) {
      console.error('Failed to load Microsoft tokens:', error);
    }
  }

  /**
   * Clear stored authentication tokens
   * @returns {Promise<void>}
   */
  async clearTokens() {
    try {
      await AsyncStorage.removeItem('microsoft_access_token');
      await AsyncStorage.removeItem('microsoft_refresh_token');
      this.accessToken = null;
      this.refreshToken = null;
    } catch (error) {
      console.error('Failed to clear Microsoft tokens:', error);
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} Whether user is authenticated
   */
  isAuthenticated() {
    return !!this.accessToken;
  }

  /**
   * Get calendar information
   * @returns {Promise<Object>} Calendar information
   */
  async getCalendarInfo() {
    try {
      const response = await this.makeRequest('/me/calendar');
      
      return {
        id: response.id,
        name: response.name,
        color: response.color,
        isDefault: response.isDefaultCalendar,
        isAuthenticated: this.isAuthenticated(),
      };
    } catch (error) {
      console.error('Failed to get calendar info:', error);
      return null;
    }
  }
}

export default new MicrosoftGraphService(); 