import AsyncStorage from '@react-native-async-storage/async-storage';
import googleCalendarConnectionManager from './googleCalendarConnectionManager.js';

class GoogleCalendarService {
  constructor() {
    this.baseUrl = 'https://www.googleapis.com/calendar/v3';
    this.calendarId = null;
    this.isInitialized = false;
    this.connectionManager = googleCalendarConnectionManager;
  }

  /**
   * Initialize the Google Calendar service
   */
  async initialize() {
    try {
      console.log('🔄 Initializing Google Calendar service...');
      
      // Use connection manager to restore connection
      const connectionResult = await this.connectionManager.initializeConnection();
      
      if (connectionResult.success) {
        console.log('✅ Google Calendar connection restored:', connectionResult.message);
        this.isInitialized = true;
        return true;
      } else {
        console.log('❌ Google Calendar connection not available:', connectionResult.message);
        this.isInitialized = false;
        return false;
      }
      
      // Test calendar access with error handling
      try {
        console.log('🔄 Testing calendar access...');
        const hasAccess = await this.checkCalendarAccess();
        console.log('Calendar access test result:', hasAccess);
        
        if (hasAccess) {
          // Get the primary calendar ID
          console.log('🔄 Getting primary calendar ID...');
          const calendarId = await this.getCalendarId();
          console.log('✅ Primary calendar ID:', calendarId);
          
          this.isInitialized = true;
          console.log('✅ Google Calendar service initialized successfully');
          return true;
        } else {
          console.log('❌ Google Calendar service initialization failed - no calendar access');
          this.isInitialized = false;
          return false;
        }
      } catch (calendarError) {
        console.warn('❌ Google Calendar access test failed:', calendarError.message);
        console.error('Calendar access error details:', {
          message: calendarError.message,
          stack: calendarError.stack,
          name: calendarError.name
        });
        this.isInitialized = false;
        return false;
      }
    } catch (error) {
      console.error('❌ Error initializing Google Calendar service:', error);
      console.error('Initialization error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Get calendar ID (primary calendar)
   */
  async getCalendarId() {
    try {
      if (this.calendarId) {
        return this.calendarId;
      }
      
      const calendars = await this.getCalendars();
      const primaryCalendar = calendars.find(cal => cal.primary);
      this.calendarId = primaryCalendar ? primaryCalendar.id : 'primary';
      return this.calendarId;
    } catch (error) {
      console.error('Error getting calendar ID:', error);
      // Fallback to primary calendar
      this.calendarId = 'primary';
      return this.calendarId;
    }
  }

  /**
   * Get calendar information
   */
  async getCalendarInfo() {
    try {
      const hasAccess = await this.checkCalendarAccess();
      const calendars = hasAccess ? await this.getCalendars() : [];
      
      return {
        isAuthenticated: hasAccess,
        isInitialized: this.isInitialized,
        primaryCalendar: calendars.find(cal => cal.primary) || null,
        totalCalendars: calendars.length,
        serviceName: 'Google Calendar',
        lastSync: await this.getLastSyncTime(),
      };
    } catch (error) {
      console.error('Error getting calendar info:', error);
      return {
        isAuthenticated: false,
        isInitialized: false,
        primaryCalendar: null,
        totalCalendars: 0,
        serviceName: 'Google Calendar',
        lastSync: null,
      };
    }
  }

  /**
   * Get today's meetings
   */
  async getTodayMeetings() {
    try {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const events = await this.getEvents({
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
      });

      return events.map(event => this.convertFromGoogleEvent(event));
    } catch (error) {
      console.error('Error getting today\'s meetings:', error);
      return [];
    }
  }

  /**
   * Get upcoming meetings
   */
  async getUpcomingMeetings(days = 7) {
    try {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);

      const events = await this.getEvents({
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
      });

      return events.map(event => this.convertFromGoogleEvent(event));
    } catch (error) {
      console.error('Error getting upcoming meetings:', error);
      return [];
    }
  }

  /**
   * Create a meeting
   */
  async createMeeting(meetingData) {
    try {
      const event = await this.createEvent(meetingData);
      return this.convertFromGoogleEvent(event);
    } catch (error) {
      console.error('Error creating meeting:', error);
      throw error;
    }
  }

  /**
   * Update a meeting
   */
  async updateMeeting(meetingId, meetingData) {
    try {
      const event = await this.updateEvent({ ...meetingData, id: meetingId });
      return this.convertFromGoogleEvent(event);
    } catch (error) {
      console.error('Error updating meeting:', error);
      throw error;
    }
  }

  /**
   * Delete a meeting
   */
  async deleteMeeting(meetingId) {
    try {
      await this.deleteEvent(meetingId);
      return true;
    } catch (error) {
      console.error('Error deleting meeting:', error);
      throw error;
    }
  }

  /**
   * Check availability for a time slot
   */
  async checkAvailability(startDate, endDate) {
    try {
      const events = await this.getEvents({
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
      });

      return events.length === 0;
    } catch (error) {
      console.error('Error checking availability:', error);
      return false;
    }
  }

  /**
   * Get access token from storage with automatic refresh
   */
  async getAccessToken() {
    try {
      console.log('🔄 Getting Google access token from storage...');
      const token = await AsyncStorage.getItem('google_access_token');
      const expiry = await AsyncStorage.getItem('google_token_expiry');
      const refreshToken = await AsyncStorage.getItem('google_refresh_token');
      
      console.log('Token found:', !!token);
      console.log('Expiry found:', !!expiry);
      console.log('Refresh token found:', !!refreshToken);
      
      if (!token) {
        console.log('❌ No Google access token found in storage');
        return null;
      }
      
      // Check if token is expired
      if (expiry && Date.now() > parseInt(expiry)) {
        console.log('❌ Google access token has expired');
        console.log('Token expiry time:', new Date(parseInt(expiry)).toISOString());
        console.log('Current time:', new Date().toISOString());
        
        // Try to refresh the token
        if (refreshToken) {
          console.log('🔄 Attempting to refresh expired token...');
          try {
            const newTokens = await this.refreshAccessToken(refreshToken);
            if (newTokens && newTokens.access_token) {
              console.log('✅ Token refreshed successfully');
              return newTokens.access_token;
            }
          } catch (refreshError) {
            console.error('❌ Token refresh failed:', refreshError);
          }
        }
        
        // Clear expired tokens if refresh failed
        await AsyncStorage.removeItem('google_access_token');
        await AsyncStorage.removeItem('google_token_expiry');
        await AsyncStorage.removeItem('google_refresh_token');
        console.log('✅ Expired tokens cleared from storage');
        return null;
      }
      
      console.log('✅ Valid access token found');
      console.log('Token expiry time:', expiry ? new Date(parseInt(expiry)).toISOString() : 'No expiry');
      console.log('Current time:', new Date().toISOString());
      return token;
    } catch (error) {
      console.error('❌ Error getting access token:', error);
      console.error('Token retrieval error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      console.log('🔄 Refreshing Google access token...');
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com',
          client_secret: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Token refresh failed:', response.status, errorText);
        throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
      }

      const tokens = await response.json();
      console.log('✅ Token refresh successful');
      
      // Store new tokens
      await this.storeTokens(tokens);
      
      return tokens;
    } catch (error) {
      console.error('❌ Error refreshing access token:', error);
      throw error;
    }
  }

  /**
   * Store tokens in AsyncStorage and sync with backend
   */
  async storeTokens(tokens) {
    try {
      console.log('💾 Storing Google tokens...');
      
      // Use connection manager
      const storeResult = await this.connectionManager.storeTokens(tokens);
      
      if (storeResult) {
        console.log('✅ Tokens stored successfully via persistence service');
        
        // Sync tokens with backend (don't fail if this fails)
        try {
          await this.syncTokensWithBackend(tokens);
          console.log('✅ Tokens synced with backend');
        } catch (backendError) {
          console.warn('⚠️ Backend sync failed, but tokens are stored locally:', backendError.message);
          // Don't throw - tokens are still stored locally
        }
      } else {
        console.error('❌ Failed to store tokens via persistence service');
        throw new Error('Failed to store tokens');
      }
    } catch (error) {
      console.error('❌ Error storing tokens:', error);
      throw error;
    }
  }

  /**
   * Clear all stored tokens
   */
  async clearTokens() {
    try {
      console.log('🔄 Clearing all Google tokens from storage...');
      
      await AsyncStorage.removeItem('google_access_token');
      await AsyncStorage.removeItem('google_refresh_token');
      await AsyncStorage.removeItem('google_token_expiry');
      
      this.isInitialized = false;
      console.log('✅ All Google tokens cleared successfully');
    } catch (error) {
      console.error('❌ Error clearing Google tokens:', error);
      throw error;
    }
  }

  /**
   * Sync tokens with backend database
   */
  async syncTokensWithBackend(tokens) {
    try {
      console.log('🔄 Syncing tokens with backend...');
      
      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        console.log('⚠️ Backend URL not configured, skipping token sync');
        return;
      }

      // Get user info from storage
      const userData = await AsyncStorage.getItem('user');
      if (!userData) {
        console.log('⚠️ No user data found, skipping token sync');
        return;
      }

      const user = JSON.parse(userData);
      const authToken = await AsyncStorage.getItem('authToken');

      if (!authToken) {
        console.log('⚠️ No auth token found, skipping token sync');
        return;
      }

      const response = await fetch(`${backendUrl}/api/auth/google/sync-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null
        })
      });

      if (response.ok) {
        console.log('✅ Tokens synced with backend successfully');
      } else {
        console.log('⚠️ Failed to sync tokens with backend:', response.status);
      }
    } catch (error) {
      console.error('❌ Error syncing tokens with backend:', error);
      // Don't throw error - token sync failure shouldn't break the app
    }
  }

  /**
   * Make authenticated request to Google Calendar API
   */
  async makeRequest(endpoint, options = {}) {
    try {
      console.log('🌐 Making Google Calendar API request to:', endpoint);
      
      const accessToken = await this.getAccessToken();
      
      if (!accessToken) {
        console.log('❌ No valid access token available for API request');
        return null;
      }
      console.log('✅ Access token available for API request');

      const defaultOptions = {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      };

      const requestOptions = {
        ...defaultOptions,
        ...options,
      };

      console.log('📤 Request options:', {
        method: requestOptions.method || 'GET',
        headers: Object.keys(requestOptions.headers),
        hasBody: !!requestOptions.body
      });

      const response = await fetch(`${this.baseUrl}${endpoint}`, requestOptions);

      console.log('📥 Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = `Google Calendar API error: ${response.status} - ${errorData.error?.message || response.statusText}`;
        
        console.log('❌ API Error Response:', errorData);
        
        // Handle specific error cases gracefully
        if (response.status === 404) {
          console.warn('Calendar endpoint not found:', errorMessage);
          return null;
        }
        
        // Don't throw error for authentication issues - just log and return null
        if (response.status === 401 || response.status === 403) {
          console.warn('Authentication error:', errorMessage);
          return null;
        }
        
        // For other errors, log but don't throw
        console.warn('Google Calendar API error:', errorMessage);
        return null;
      }

      const responseData = await response.json();
      console.log('✅ API request successful, response keys:', Object.keys(responseData));
      
      return responseData;
    } catch (error) {
      console.error('❌ Google Calendar request failed:', error.message);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      return null;
    }
  }

  /**
   * Get all calendars for the user
   */
  async getCalendars() {
    try {
      console.log('Fetching calendars...');
      const response = await this.makeRequest('/users/me/calendarList');
      
      // Add null checks to prevent the error
      if (!response) {
        console.log('No response received from Google Calendar API for calendars');
        return [];
      }
      
      if (!response.items) {
        console.log('No items in Google Calendar calendars response');
        return [];
      }
      
      console.log('Calendars fetched successfully:', response.items.length, 'calendars');
      return response.items;
    } catch (error) {
      console.error('Error fetching calendars:', error);
      // Return empty array instead of throwing error
      return [];
    }
  }

  /**
   * Get events from Google Calendar
   */
  async getEvents(options = {}) {
    try {
      console.log('🔄 Getting events from Google Calendar...');
      
      // Check if we have a valid access token first
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        console.log('❌ No valid access token available for fetching events');
        return [];
      }
      console.log('✅ Access token available');

      const {
        timeMin = new Date().toISOString(),
        timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults = 100,
        singleEvents = true,
        orderBy = 'startTime'
      } = options;

      console.log('📅 Event search parameters:', {
        timeMin,
        timeMax,
        maxResults,
        singleEvents,
        orderBy
      });

      // Ensure we have a valid calendar ID
      const calendarId = await this.getCalendarId();
      console.log('📋 Using calendar ID:', calendarId);

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        maxResults: maxResults.toString(),
        singleEvents: singleEvents.toString(),
        orderBy
      });

      const endpoint = `/calendars/${calendarId}/events?${params}`;
      console.log('🌐 Making request to:', endpoint);

      const response = await this.makeRequest(endpoint);
      
      // Add null checks to prevent the error
      if (!response) {
        console.log('❌ No response received from Google Calendar API');
        return [];
      }
      
      if (!response.items) {
        console.log('❌ No items in Google Calendar response');
        console.log('Response structure:', Object.keys(response));
        return [];
      }
      
      console.log('✅ Successfully fetched events:', response.items.length);
      if (response.items.length > 0) {
        console.log('📝 Sample event:', {
          id: response.items[0].id,
          summary: response.items[0].summary,
          start: response.items[0].start,
          end: response.items[0].end
        });
      }
      
      return response.items;
    } catch (error) {
      console.error('❌ Error fetching events:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      // Return empty array instead of throwing error
      return [];
    }
  }

  /**
   * Create event in Google Calendar
   */
  async createEvent(eventData) {
    try {
      console.log('Creating Google Calendar event:', {
        id: eventData.id,
        title: eventData.title,
        date: eventData.date,
        time: eventData.time,
        duration: eventData.duration
      });
      
      const googleEvent = this.convertToGoogleEvent(eventData);
      console.log('Converted to Google event format:', {
        summary: googleEvent.summary,
        start: googleEvent.start,
        end: googleEvent.end
      });
      
      // Ensure we have a valid calendar ID
      const calendarId = await this.getCalendarId();
      
      const response = await this.makeRequest(`/calendars/${calendarId}/events`, {
        method: 'POST',
        body: JSON.stringify(googleEvent),
      });

      // Store the mapping to prevent duplicates
      if (response && response.id && eventData.id) {
        await this.storeEventMapping(eventData.id, response.id);
        console.log('Event mapping stored:', eventData.id, '->', response.id);
      }

      return response;
    } catch (error) {
      console.error('Error creating Google Calendar event:', error);
      // Return null instead of throwing error to prevent app crashes
      return null;
    }
  }

  /**
   * Update event in Google Calendar
   */
  async updateEvent(eventData) {
    try {
      const googleEvent = this.convertToGoogleEvent(eventData);
      
      // Ensure we have a valid calendar ID
      const calendarId = await this.getCalendarId();
      
      const response = await this.makeRequest(`/calendars/${calendarId}/events/${eventData.id}`, {
        method: 'PUT',
        body: JSON.stringify(googleEvent),
      });

      return response;
    } catch (error) {
      console.error('Error updating Google Calendar event:', error);
      // Return null instead of throwing error to prevent app crashes
      return null;
    }
  }

  /**
   * Delete event from Google Calendar
   */
  async deleteEvent(eventId) {
    try {
      await this.makeRequest(`/calendars/${this.calendarId}/events/${eventId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('Error deleting Google Calendar event:', error);
      throw error;
    }
  }

  /**
   * Convert app event format to Google Calendar format
   */
  convertToGoogleEvent(eventData) {
    const {
      title,
      description,
      date,
      time,
      duration,
      location,
      attendees = [],
      reminders = {},
    } = eventData;

    // Safely parse dates with validation
    const parseDateTime = (dateStr, timeStr) => {
      try {
        console.log('Parsing date/time:', { dateStr, timeStr });
        
        // Handle different date/time formats
        let dateTimeString;
        
        if (dateStr && timeStr) {
          // If we have separate date and time, ensure proper format
          // Ensure time is in 24-hour format
          let formattedTime = timeStr;
          if (timeStr.includes('pm') || timeStr.includes('PM')) {
            // Convert 12-hour to 24-hour format
            const [hours, minutes] = timeStr.replace(/[ap]m/i, '').split(':');
            let hour = parseInt(hours);
            if (hour !== 12) hour += 12;
            formattedTime = `${hour.toString().padStart(2, '0')}:${minutes}:00`;
          } else if (timeStr.includes('am') || timeStr.includes('AM')) {
            // Handle AM time
            const [hours, minutes] = timeStr.replace(/[ap]m/i, '').split(':');
            let hour = parseInt(hours);
            if (hour === 12) hour = 0;
            formattedTime = `${hour.toString().padStart(2, '0')}:${minutes}:00`;
          } else if (!timeStr.includes(':')) {
            // If time is just a number, assume it's hours
            formattedTime = `${timeStr.padStart(2, '0')}:00:00`;
          } else if (timeStr.split(':').length === 2) {
            // If time is HH:MM, add seconds
            formattedTime = `${timeStr}:00`;
          }
          
          dateTimeString = `${dateStr}T${formattedTime}`;
          console.log('Formatted dateTimeString:', dateTimeString);
        } else if (dateStr && dateStr.includes('T')) {
          // If we have a full ISO string
          dateTimeString = dateStr;
        } else if (dateStr) {
          // If we only have date, assume 9 AM
          dateTimeString = `${dateStr}T09:00:00`;
        } else {
          // Fallback to current time + 1 hour
          return new Date(Date.now() + 60 * 60 * 1000);
        }

        const date = new Date(dateTimeString);
        if (isNaN(date.getTime())) {
          throw new Error('Invalid date');
        }
        
        console.log('Parsed date (local):', date.toString());
        return date;
      } catch (error) {
        console.error('Date parsing error:', error);
        // Fallback to current time + 1 hour
        return new Date(Date.now() + 60 * 60 * 1000);
      }
    };

    const startDate = parseDateTime(date, time);
    
    // Calculate end date based on duration (default 60 minutes)
    const endDate = new Date(startDate.getTime() + (duration || 60) * 60 * 1000);

    // Format dates in local timezone to avoid double conversion
    const formatLocalDateTime = (dateObj) => {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      const seconds = String(dateObj.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    return {
      summary: title,
      description: description || '',
      location: location?.address || location || '',
      start: {
        dateTime: formatLocalDateTime(startDate),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: formatLocalDateTime(endDate),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      attendees: attendees.map(attendee => ({ 
        email: typeof attendee === 'string' ? attendee : attendee.email 
      })),
      reminders: {
        useDefault: false,
        overrides: [
          {
            method: 'popup',
            minutes: reminders.popup || 10,
          },
          {
            method: 'email',
            minutes: reminders.email || 1440,
          },
        ],
      },
    };
  }

  /**
   * Convert Google Calendar event to app format
   */
  convertFromGoogleEvent(googleEvent) {
    try {
      const startDateTime = googleEvent.start?.dateTime || googleEvent.start?.date;
      const endDateTime = googleEvent.end?.dateTime || googleEvent.end?.date;
      
      // Parse the start date and time
      let date = '';
      let time = '';
      
      if (startDateTime) {
        const startDate = new Date(startDateTime);
        if (!isNaN(startDate.getTime())) {
          // Use local timezone to avoid date shifting
          const year = startDate.getFullYear();
          const month = String(startDate.getMonth() + 1).padStart(2, '0');
          const day = String(startDate.getDate()).padStart(2, '0');
          date = `${year}-${month}-${day}`;
          
          time = startDate.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: false 
          });
        }
      }
      
      // Calculate duration in minutes
      let duration = 60; // default 1 hour
      if (startDateTime && endDateTime) {
        const start = new Date(startDateTime);
        const end = new Date(endDateTime);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
        }
      }
      
      return {
        id: googleEvent.id,
        title: googleEvent.summary || 'Untitled Event',
        description: googleEvent.description || '',
        date: date,
        time: time,
        duration: duration,
        location: {
          address: googleEvent.location || '',
          type: 'physical'
        },
        participants: googleEvent.attendees?.map(a => ({ 
          name: a.displayName || '', 
          email: a.email 
        })) || [],
        startTime: startDateTime,
        endTime: endDateTime,
        lastModified: googleEvent.updated,
        created: googleEvent.created,
      };
    } catch (error) {
      console.error('Error converting Google event:', error);
      // Return a safe fallback
      return {
        id: googleEvent.id || 'unknown',
        title: googleEvent.summary || 'Untitled Event',
        description: googleEvent.description || '',
        date: new Date().toISOString().split('T')[0],
        time: '00:00',
        duration: 60,
        location: { address: googleEvent.location || '' },
        participants: [],
        startTime: googleEvent.start?.dateTime || googleEvent.start?.date,
        endTime: googleEvent.end?.dateTime || googleEvent.end?.date,
        lastModified: googleEvent.updated,
        created: googleEvent.created,
      };
    }
  }

  /**
   * Check if we have calendar access
   */
  async checkCalendarAccess() {
    try {
      console.log('🔄 Checking calendar access...');
      const accessToken = await this.getAccessToken();
      
      if (!accessToken) {
        console.log('❌ No access token available for calendar access check');
        return false;
      }
      console.log('✅ Access token available for calendar access check');
      
      // Try to fetch calendars to test access
      const response = await fetch(`${this.baseUrl}/users/me/calendarList`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      console.log('📥 Calendar access check response status:', response.status, response.statusText);
      
      if (response.ok) {
        console.log('✅ Calendar access confirmed');
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Calendar access denied:', errorData);
        console.error('Access denied details:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        return false;
      }
    } catch (error) {
      console.error('❌ Error checking calendar access:', error);
      console.error('Calendar access check error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      return false;
    }
  }

  /**
   * Get detailed connection status
   */
  async getConnectionStatus() {
    try {
      const hasToken = await this.getAccessToken();
      const hasAccess = hasToken ? await this.checkCalendarAccess() : false;
      
      return {
        hasToken: !!hasToken,
        hasAccess: hasAccess,
        isConnected: hasAccess,
        isInitialized: this.isInitialized,
        status: hasAccess ? 'connected' : (hasToken ? 'token_invalid' : 'no_token'),
        message: hasAccess ? 'Connected to Google Calendar' : 
                (hasToken ? 'Token expired or invalid' : 'No authentication token found')
      };
    } catch (error) {
      console.error('Error getting connection status:', error);
      return {
        hasToken: false,
        hasAccess: false,
        isConnected: false,
        isInitialized: false,
        status: 'error',
        message: `Connection error: ${error.message}`
      };
    }
  }

  /**
   * Check if calendar service is available
   */
  isAvailable() {
    return this.isInitialized && this.calendarId !== null;
  }

  /**
   * Check if we have valid authentication
   */
  async hasValidAuth() {
    try {
      const accessToken = await this.getAccessToken();
      return !!accessToken;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get last sync time
   */
  async getLastSyncTime() {
    try {
      const settings = await this.getSyncSettings();
      return settings.lastSyncTime;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get calendar sync settings
   */
  async getSyncSettings() {
    try {
      const settings = await AsyncStorage.getItem('google_calendar_sync_settings');
      return settings ? JSON.parse(settings) : {
        autoSync: true,
        syncInterval: 15,
        syncDirection: 'bidirectional',
        lastSyncTime: null,
      };
    } catch (error) {
      console.error('Error getting sync settings:', error);
      return {
        autoSync: true,
        syncInterval: 15,
        syncDirection: 'bidirectional',
        lastSyncTime: null,
      };
    }
  }

  /**
   * Store mapping between app event ID and Google Calendar event ID
   */
  async storeEventMapping(appEventId, googleEventId) {
    try {
      const mappings = await this.getEventMappings();
      mappings[appEventId] = googleEventId;
      await AsyncStorage.setItem('google_calendar_mappings', JSON.stringify(mappings));
    } catch (error) {
      console.error('Error storing event mapping:', error);
    }
  }

  /**
   * Get Google Calendar event ID for app event ID
   */
  async getGoogleEventId(appEventId) {
    try {
      const mappings = await this.getEventMappings();
      return mappings[appEventId];
    } catch (error) {
      console.error('Error getting Google event ID:', error);
      return null;
    }
  }

  /**
   * Remove event mapping
   */
  async removeEventMapping(appEventId) {
    try {
      const mappings = await this.getEventMappings();
      delete mappings[appEventId];
      await AsyncStorage.setItem('google_calendar_mappings', JSON.stringify(mappings));
    } catch (error) {
      console.error('Error removing event mapping:', error);
    }
  }

  /**
   * Get all event mappings
   */
  async getEventMappings() {
    try {
      const mappings = await AsyncStorage.getItem('google_calendar_mappings');
      return mappings ? JSON.parse(mappings) : {};
    } catch (error) {
      console.error('Error getting event mappings:', error);
      return {};
    }
  }

  /**
   * Set calendar sync settings
   */
  async setSyncSettings(settings) {
    try {
      await AsyncStorage.setItem('google_calendar_sync_settings', JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving sync settings:', error);
    }
  }
}

export default new GoogleCalendarService();
