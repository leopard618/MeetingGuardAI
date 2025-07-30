import * as Calendar from 'expo-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';

class AppleCalendarService {
  constructor() {
    this.calendarId = null;
    this.isInitialized = false;
  }

  /**
   * Initialize Apple Calendar service
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      // Request calendar permissions
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Calendar permission not granted');
      }

      // Get Apple Calendar (iCloud)
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const appleCalendar = calendars.find(cal => 
        cal.source?.name === 'iCloud' || 
        cal.source?.name === 'Default' ||
        cal.isPrimary
      );
      
      if (!appleCalendar) {
        throw new Error('Apple Calendar not found');
      }

      this.calendarId = appleCalendar.id;
      this.isInitialized = true;
      
      return true;
    } catch (error) {
      console.error('Apple Calendar initialization failed:', error);
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
      if (!this.isInitialized) {
        throw new Error('Apple Calendar not initialized');
      }

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
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      if (!this.isInitialized) {
        throw new Error('Apple Calendar not initialized');
      }

      const existingEvent = await Calendar.getEventAsync(meetingId);
      if (!existingEvent) {
        throw new Error('Meeting not found');
      }

      const eventUpdates = {};

      if (updates.title) eventUpdates.title = updates.title;
      if (updates.location) eventUpdates.location = updates.location;
      if (updates.description) eventUpdates.notes = updates.description;

      if (updates.date && updates.time) {
        const startDate = new Date(`${updates.date}T${updates.time}:00`);
        const endDate = new Date(startDate.getTime() + (updates.duration || 60) * 60000);
        eventUpdates.startDate = startDate;
        eventUpdates.endDate = endDate;
      }

      if (updates.participants) {
        eventUpdates.attendees = updates.participants.map(email => ({ email }));
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
      if (!this.isInitialized) {
        throw new Error('Apple Calendar not initialized');
      }

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
      if (!this.isInitialized) {
        throw new Error('Apple Calendar not initialized');
      }

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
        timeZone: event.timeZone,
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
      if (!this.isInitialized) {
        return false;
      }

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
      if (!this.isInitialized) {
        return [];
      }

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
   * Get calendar information
   * @returns {Promise<Object>} Calendar information
   */
  async getCalendarInfo() {
    try {
      if (!this.isInitialized) {
        return null;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const appleCalendar = calendars.find(cal => cal.id === this.calendarId);
      
      return {
        id: appleCalendar?.id,
        title: appleCalendar?.title,
        color: appleCalendar?.color,
        source: appleCalendar?.source?.name,
        isPrimary: appleCalendar?.isPrimary,
        isAuthenticated: this.isInitialized,
      };
    } catch (error) {
      console.error('Failed to get calendar info:', error);
      return null;
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} Whether user is authenticated
   */
  isAuthenticated() {
    return this.isInitialized;
  }

  /**
   * Sync with iCloud
   * @returns {Promise<boolean>} Whether sync was successful
   */
  async syncWithICloud() {
    try {
      if (!this.isInitialized) {
        return false;
      }

      // Force a calendar refresh
      await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      return true;
    } catch (error) {
      console.error('Failed to sync with iCloud:', error);
      return false;
    }
  }
}

export default new AppleCalendarService(); 