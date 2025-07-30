import AsyncStorage from '@react-native-async-storage/async-storage';

class CalDAVService {
  constructor() {
    this.serverUrl = null;
    this.username = null;
    this.password = null;
    this.calendarUrl = null;
    this.isInitialized = false;
  }

  /**
   * Initialize CalDAV service
   * @param {Object} config - CalDAV configuration
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize(config = {}) {
    try {
      // Load stored configuration
      await this.loadStoredConfig();
      
      // If config is provided, use it
      if (config.serverUrl && config.username && config.password) {
        this.serverUrl = config.serverUrl;
        this.username = config.username;
        this.password = config.password;
        this.calendarUrl = config.calendarUrl || `${this.serverUrl}/calendars/${this.username}/default/`;
        
        await this.storeConfig();
      }

      if (!this.serverUrl || !this.username || !this.password) {
        throw new Error('CalDAV configuration incomplete');
      }

      // Test connection
      const isConnected = await this.testConnection();
      if (!isConnected) {
        throw new Error('Failed to connect to CalDAV server');
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('CalDAV initialization failed:', error);
      return false;
    }
  }

  /**
   * Test connection to CalDAV server
   * @returns {Promise<boolean>} Whether connection is successful
   */
  async testConnection() {
    try {
      const response = await this.makeRequest('', {
        method: 'PROPFIND',
        headers: {
          'Depth': '0',
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <propfind xmlns="DAV:">
            <prop>
              <resourcetype/>
              <current-user-principal/>
            </prop>
          </propfind>`,
      });

      return response.status === 207; // Multi-Status
    } catch (error) {
      console.error('CalDAV connection test failed:', error);
      return false;
    }
  }

  /**
   * Make authenticated request to CalDAV server
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<Response>} API response
   */
  async makeRequest(endpoint, options = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('CalDAV not initialized');
      }

      const url = `${this.calendarUrl}${endpoint}`;
      const authHeader = 'Basic ' + btoa(`${this.username}:${this.password}`);

      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/xml; charset=utf-8',
          ...options.headers,
        },
      });

      return response;
    } catch (error) {
      console.error('CalDAV API request failed:', error);
      throw error;
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

      // Generate unique event ID
      const eventId = `meeting-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const filename = `${eventId}.ics`;

      // Create iCalendar content
      const icalContent = this.createICalEvent({
        uid: eventId,
        title,
        startDate,
        endDate,
        location,
        description,
        participants,
      });

      const response = await this.makeRequest(filename, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
        },
        body: icalContent,
      });

      if (!response.ok) {
        throw new Error(`Failed to create event: ${response.status}`);
      }

      return {
        id: eventId,
        ...meetingData,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        filename,
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
      // First, get the existing event
      const existingEvent = await this.getMeeting(meetingId);
      if (!existingEvent) {
        throw new Error('Meeting not found');
      }

      // Merge updates with existing data
      const updatedData = { ...existingEvent, ...updates };

      // Create new iCalendar content
      const icalContent = this.createICalEvent({
        uid: meetingId,
        title: updatedData.title,
        startDate: new Date(updatedData.startDate),
        endDate: new Date(updatedData.endDate),
        location: updatedData.location,
        description: updatedData.description,
        participants: updatedData.participants || [],
      });

      const filename = `${meetingId}.ics`;
      const response = await this.makeRequest(filename, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
        },
        body: icalContent,
      });

      if (!response.ok) {
        throw new Error(`Failed to update event: ${response.status}`);
      }

      return {
        id: meetingId,
        ...updatedData,
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
      const filename = `${meetingId}.ics`;
      const response = await this.makeRequest(filename, {
        method: 'DELETE',
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      throw new Error(`Failed to delete meeting: ${error.message}`);
    }
  }

  /**
   * Get a specific meeting
   * @param {string} meetingId - Meeting ID
   * @returns {Promise<Object>} Meeting data
   */
  async getMeeting(meetingId) {
    try {
      const filename = `${meetingId}.ics`;
      const response = await this.makeRequest(filename);

      if (!response.ok) {
        return null;
      }

      const icalContent = await response.text();
      return this.parseICalEvent(icalContent);
    } catch (error) {
      console.error('Failed to get meeting:', error);
      return null;
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
      const timeRange = `?time-range=${startDate.toISOString()}/${endDate.toISOString()}`;
      const response = await this.makeRequest(timeRange, {
        method: 'REPORT',
        headers: {
          'Depth': '1',
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav">
            <d:prop xmlns:d="DAV:">
              <d:getetag/>
              <c:calendar-data/>
            </d:prop>
            <c:filter>
              <c:comp-filter name="VCALENDAR">
                <c:comp-filter name="VEVENT">
                  <c:time-range start="${startDate.toISOString()}" end="${endDate.toISOString()}"/>
                </c:comp-filter>
              </c:comp-filter>
            </c:filter>
          </c:calendar-query>`,
      });

      if (!response.ok) {
        throw new Error(`Failed to get events: ${response.status}`);
      }

      const xmlText = await response.text();
      return this.parseCalendarQueryResponse(xmlText);
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
   * Create iCalendar event content
   * @param {Object} eventData - Event data
   * @returns {string} iCalendar content
   */
  createICalEvent(eventData) {
    const {
      uid,
      title,
      startDate,
      endDate,
      location,
      description,
      participants,
    } = eventData;

    const formatDate = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    let ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MeetingGuard//Calendar//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${formatDate(startDate)}`,
      `DTEND:${formatDate(endDate)}`,
      `SUMMARY:${title}`,
    ];

    if (location) {
      ical.push(`LOCATION:${location}`);
    }

    if (description) {
      ical.push(`DESCRIPTION:${description.replace(/\n/g, '\\n')}`);
    }

    if (participants && participants.length > 0) {
      participants.forEach(email => {
        ical.push(`ATTENDEE:mailto:${email}`);
      });
    }

    ical.push(
      `DTSTAMP:${formatDate(new Date())}`,
      'END:VEVENT',
      'END:VCALENDAR'
    );

    return ical.join('\r\n');
  }

  /**
   * Parse iCalendar event content
   * @param {string} icalContent - iCalendar content
   * @returns {Object} Parsed event data
   */
  parseICalEvent(icalContent) {
    try {
      const lines = icalContent.split(/\r?\n/);
      const event = {};

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('UID:')) {
          event.id = line.substring(4);
        } else if (line.startsWith('SUMMARY:')) {
          event.title = line.substring(8);
        } else if (line.startsWith('DTSTART:')) {
          const dateStr = line.substring(8);
          event.startDate = this.parseICalDate(dateStr);
        } else if (line.startsWith('DTEND:')) {
          const dateStr = line.substring(6);
          event.endDate = this.parseICalDate(dateStr);
        } else if (line.startsWith('LOCATION:')) {
          event.location = line.substring(9);
        } else if (line.startsWith('DESCRIPTION:')) {
          event.description = line.substring(12).replace(/\\n/g, '\n');
        } else if (line.startsWith('ATTENDEE:')) {
          if (!event.participants) event.participants = [];
          const email = line.substring(9).replace('mailto:', '');
          event.participants.push(email);
        }
      }

      return event;
    } catch (error) {
      console.error('Failed to parse iCalendar event:', error);
      return null;
    }
  }

  /**
   * Parse iCalendar date string
   * @param {string} dateStr - iCalendar date string
   * @returns {Date} Parsed date
   */
  parseICalDate(dateStr) {
    // Remove timezone indicator and format
    const cleanDate = dateStr.replace('Z', '').replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
    return new Date(cleanDate);
  }

  /**
   * Parse calendar query response
   * @param {string} xmlText - XML response
   * @returns {Array} Array of events
   */
  parseCalendarQueryResponse(xmlText) {
    try {
      // Simple XML parsing for calendar data
      const events = [];
      const calendarDataMatches = xmlText.match(/<c:calendar-data[^>]*>([\s\S]*?)<\/c:calendar-data>/g);
      
      if (calendarDataMatches) {
        calendarDataMatches.forEach(match => {
          const icalContent = match.replace(/<c:calendar-data[^>]*>/, '').replace(/<\/c:calendar-data>/, '');
          const event = this.parseICalEvent(icalContent);
          if (event) {
            events.push(event);
          }
        });
      }

      return events;
    } catch (error) {
      console.error('Failed to parse calendar query response:', error);
      return [];
    }
  }

  /**
   * Store CalDAV configuration
   * @returns {Promise<void>}
   */
  async storeConfig() {
    try {
      const config = {
        serverUrl: this.serverUrl,
        username: this.username,
        password: this.password,
        calendarUrl: this.calendarUrl,
      };
      await AsyncStorage.setItem('caldav_config', JSON.stringify(config));
    } catch (error) {
      console.error('Failed to store CalDAV config:', error);
    }
  }

  /**
   * Load stored CalDAV configuration
   * @returns {Promise<void>}
   */
  async loadStoredConfig() {
    try {
      const configStr = await AsyncStorage.getItem('caldav_config');
      if (configStr) {
        const config = JSON.parse(configStr);
        this.serverUrl = config.serverUrl;
        this.username = config.username;
        this.password = config.password;
        this.calendarUrl = config.calendarUrl;
      }
    } catch (error) {
      console.error('Failed to load CalDAV config:', error);
    }
  }

  /**
   * Clear stored configuration
   * @returns {Promise<void>}
   */
  async clearConfig() {
    try {
      await AsyncStorage.removeItem('caldav_config');
      this.serverUrl = null;
      this.username = null;
      this.password = null;
      this.calendarUrl = null;
      this.isInitialized = false;
    } catch (error) {
      console.error('Failed to clear CalDAV config:', error);
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
   * Get calendar information
   * @returns {Promise<Object>} Calendar information
   */
  async getCalendarInfo() {
    try {
      if (!this.isInitialized) {
        return null;
      }

      return {
        serverUrl: this.serverUrl,
        username: this.username,
        calendarUrl: this.calendarUrl,
        isAuthenticated: this.isInitialized,
      };
    } catch (error) {
      console.error('Failed to get calendar info:', error);
      return null;
    }
  }
}

export default new CalDAVService(); 