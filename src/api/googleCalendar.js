import * as Calendar from 'expo-calendar';
import * as AuthSession from 'expo-auth-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from '@env';

class GoogleCalendarService {
  constructor() {
    this.clientId = GOOGLE_CLIENT_ID;
    this.clientSecret = GOOGLE_CLIENT_SECRET;
    this.redirectUri = GOOGLE_REDIRECT_URI;
    this.calendarId = null;
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Initialize calendar permissions and authentication
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      // Request calendar permissions
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Calendar permission not granted');
      }

      // Get default calendar
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const defaultCalendar = calendars.find(cal => cal.isPrimary) || calendars[0];
      
      if (!defaultCalendar) {
        throw new Error('No calendar found');
      }

      this.calendarId = defaultCalendar.id;
      
      // Load stored tokens
      await this.loadStoredTokens();
      
      return true;
    } catch (error) {
      console.error('Calendar initialization failed:', error);
      return false;
    }
  }

  /**
   * Authenticate with Google
   * @returns {Promise<boolean>} Whether authentication was successful
   */
  async authenticate() {
    try {
      const discovery = {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
      };

      const request = new AuthSession.AuthRequest({
        clientId: this.clientId,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
        ],
        redirectUri: this.redirectUri,
        responseType: AuthSession.ResponseType.Code,
        extraParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      });

      const result = await request.promptAsync(discovery);

      if (result.type === 'success') {
        const tokenResult = await AuthSession.exchangeCodeAsync(
          {
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            code: result.params.code,
            redirectUri: this.redirectUri,
            extraParams: {
              code_verifier: request.codeVerifier,
            },
          },
          discovery
        );

        this.accessToken = tokenResult.accessToken;
        this.refreshToken = tokenResult.refreshToken;

        // Store tokens
        await this.storeTokens();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Google authentication failed:', error);
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

      // Parse date and time
      const startDate = new Date(`${date}T${time}:00`);
      const endDate = new Date(startDate.getTime() + duration * 60000);

      const eventDetails = {
        title,
        startDate,
        endDate,
        location,
        notes: description,
        alarms: [{ relativeOffset: -15 }], // 15 minutes before
      };

      // Add attendees if provided
      if (participants.length > 0) {
        eventDetails.attendees = participants.map(email => ({ email }));
      }

      const eventId = await Calendar.createEventAsync(this.calendarId, eventDetails);

      return {
        id: eventId,
        ...meetingData,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
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
      const existingEvent = await Calendar.getEventAsync(meetingId);
      if (!existingEvent) {
        throw new Error('Meeting not found');
      }

      const {
        title,
        date,
        time,
        duration,
        location,
        participants,
        description,
      } = updates;

      const eventUpdates = {};

      if (title) eventUpdates.title = title;
      if (location) eventUpdates.location = location;
      if (description) eventUpdates.notes = description;

      if (date && time) {
        const startDate = new Date(`${date}T${time}:00`);
        const endDate = new Date(startDate.getTime() + (duration || 60) * 60000);
        eventUpdates.startDate = startDate;
        eventUpdates.endDate = endDate;
      }

      if (participants) {
        eventUpdates.attendees = participants.map(email => ({ email }));
      }

      await Calendar.updateEventAsync(meetingId, eventUpdates);

      return {
        id: meetingId,
        ...updates,
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
      await Calendar.deleteEventAsync(meetingId);
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
      const events = await Calendar.getEventsAsync(
        [this.calendarId],
        startDate,
        endDate
      );

      return events.map(event => ({
        id: event.id,
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.location,
        description: event.notes,
        attendees: event.attendees || [],
        allDay: event.allDay,
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
      const events = await Calendar.getEventsAsync(
        [this.calendarId],
        startDate,
        endDate
      );

      return events.length === 0;
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

      const events = await Calendar.getEventsAsync([this.calendarId], dayStart, dayEnd);

      const availableSlots = [];
      let currentTime = new Date(dayStart);

      while (currentTime < dayEnd) {
        const slotEnd = new Date(currentTime.getTime() + duration * 60000);
        
        if (slotEnd <= dayEnd) {
          const conflictingEvent = events.find(event => 
            (event.startDate < slotEnd && event.endDate > currentTime)
          );

          if (!conflictingEvent) {
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
      await AsyncStorage.setItem('google_access_token', this.accessToken);
      if (this.refreshToken) {
        await AsyncStorage.setItem('google_refresh_token', this.refreshToken);
      }
    } catch (error) {
      console.error('Failed to store tokens:', error);
    }
  }

  /**
   * Load stored authentication tokens
   * @returns {Promise<void>}
   */
  async loadStoredTokens() {
    try {
      this.accessToken = await AsyncStorage.getItem('google_access_token');
      this.refreshToken = await AsyncStorage.getItem('google_refresh_token');
    } catch (error) {
      console.error('Failed to load tokens:', error);
    }
  }

  /**
   * Clear stored authentication tokens
   * @returns {Promise<void>}
   */
  async clearTokens() {
    try {
      await AsyncStorage.removeItem('google_access_token');
      await AsyncStorage.removeItem('google_refresh_token');
      this.accessToken = null;
      this.refreshToken = null;
    } catch (error) {
      console.error('Failed to clear tokens:', error);
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
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const defaultCalendar = calendars.find(cal => cal.id === this.calendarId);
      
      return {
        id: defaultCalendar?.id,
        title: defaultCalendar?.title,
        color: defaultCalendar?.color,
        isPrimary: defaultCalendar?.isPrimary,
        isAuthenticated: this.isAuthenticated(),
      };
    } catch (error) {
      console.error('Failed to get calendar info:', error);
      return null;
    }
  }
}

export default new GoogleCalendarService();