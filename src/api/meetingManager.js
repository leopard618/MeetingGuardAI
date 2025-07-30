import OpenAIService from './openai.js';
import GoogleCalendarService from './googleCalendar.js';
import MicrosoftGraphService from './microsoftGraph.js';
import AppleCalendarService from './appleCalendar.js';
import CalDAVService from './caldav.js';
import VideoConferenceService from './videoConference.js';
import CommunicationService from './communication.js';

class MeetingManager {
  constructor() {
    this.openai = OpenAIService;
    this.calendars = {
      google: GoogleCalendarService,
      microsoft: MicrosoftGraphService,
      apple: AppleCalendarService,
      caldav: CalDAVService,
    };
    this.videoConference = VideoConferenceService;
    this.communication = CommunicationService;
    this.isInitialized = false;
    this.activeCalendar = 'google'; // Default calendar
  }

  /**
   * Initialize the meeting manager
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      // Initialize all calendar services
      const calendarInitPromises = Object.entries(this.calendars).map(async ([name, service]) => {
        const initialized = await service.initialize();
        if (!initialized) {
          console.warn(`${name} calendar initialization failed`);
        }
        return { name, initialized };
      });

      const calendarResults = await Promise.all(calendarInitPromises);
      const availableCalendars = calendarResults.filter(result => result.initialized);

      // Set active calendar to first available one
      if (availableCalendars.length > 0) {
        this.activeCalendar = availableCalendars[0].name;
      }

      // Initialize video conference service
      const videoConferenceInitialized = await this.videoConference.initialize();
      if (!videoConferenceInitialized) {
        console.warn('Video conference initialization failed');
      }

      // Initialize communication service
      const communicationInitialized = await this.communication.initialize();
      if (!communicationInitialized) {
        console.warn('Communication service initialization failed');
      }

      // Validate OpenAI API key
      const openaiValid = await this.openai.validateAPIKey();
      if (!openaiValid) {
        console.warn('OpenAI API key validation failed');
      }

      this.isInitialized = availableCalendars.length > 0 && openaiValid;
      return this.isInitialized;
    } catch (error) {
      console.error('Meeting manager initialization failed:', error);
      return false;
    }
  }

  /**
   * Process user message and generate AI response
   * @param {Array} messages - Chat messages history
   * @param {string} userInput - Current user input
   * @returns {Promise<Object>} AI response with meeting data
   */
  async processMessage(messages, userInput) {
    try {
      // Get current calendar context
      const calendarContext = await this.getCalendarContext();
      
      // Generate AI response with meeting context
      const aiResponse = await this.openai.generateMeetingResponse(
        [...messages, { type: 'user', content: userInput }],
        calendarContext
      );

      return aiResponse;
    } catch (error) {
      console.error('Failed to process message:', error);
      return {
        message: "I'm sorry, I'm having trouble processing your request right now. Please try again.",
        action: 'chat',
        meetingData: null,
        confidence: 0,
        requiresConfirmation: false,
      };
    }
  }

  /**
   * Execute meeting action based on AI response
   * @param {Object} aiResponse - AI response with action and meeting data
   * @returns {Promise<Object>} Result of the action
   */
  async executeMeetingAction(aiResponse) {
    const { action, meetingData, requiresConfirmation } = aiResponse;

    if (!meetingData || action === 'chat') {
      return { success: true, message: 'Chat response processed' };
    }

    try {
      switch (action) {
        case 'create':
          return await this.createMeeting(meetingData);
        
        case 'update':
          return await this.updateMeeting(meetingData);
        
        case 'delete':
          return await this.deleteMeeting(meetingData);
        
        case 'check':
          return await this.checkAvailability(meetingData);
        
        case 'suggest':
          return await this.suggestMeetings(meetingData);
        
        default:
          return { success: false, message: 'Unknown action' };
      }
    } catch (error) {
      console.error('Failed to execute meeting action:', error);
      return {
        success: false,
        message: `Failed to ${action} meeting: ${error.message}`,
      };
    }
  }

  /**
   * Create a new meeting
   * @param {Object} meetingData - Meeting data
   * @returns {Promise<Object>} Creation result
   */
  async createMeeting(meetingData) {
    try {
      // Validate required fields
      if (!meetingData.title || !meetingData.date || !meetingData.time) {
        throw new Error('Missing required meeting information (title, date, time)');
      }

      const activeCalendar = this.calendars[this.activeCalendar];
      if (!activeCalendar) {
        throw new Error('No active calendar available');
      }

      // Check availability if date and time are specified
      if (meetingData.date && meetingData.time) {
        const startDate = new Date(`${meetingData.date}T${meetingData.time}:00`);
        const endDate = new Date(startDate.getTime() + (meetingData.duration || 60) * 60000);
        
        const isAvailable = await activeCalendar.checkAvailability(startDate, endDate);
        if (!isAvailable) {
          return {
            success: false,
            message: 'The requested time slot is not available. Would you like me to suggest alternative times?',
            action: 'suggest_alternatives',
            originalRequest: meetingData,
          };
        }
      }

      // Create video conference link if requested
      let videoConferenceData = null;
      if (meetingData.videoConference && meetingData.videoConference.provider) {
        try {
          videoConferenceData = await this.videoConference.createMeetingLink(
            meetingData.videoConference.provider,
            meetingData
          );
          meetingData.joinUrl = videoConferenceData.joinUrl;
        } catch (error) {
          console.warn('Failed to create video conference link:', error);
        }
      }

      // Create the meeting
      const createdMeeting = await activeCalendar.createMeeting(meetingData);
      
      // Send notifications if participants are specified
      if (meetingData.participants && meetingData.participants.length > 0) {
        try {
          const notificationChannels = meetingData.notificationChannels || ['email'];
          await this.communication.sendMeetingInvitation(
            { ...createdMeeting, joinUrl: videoConferenceData?.joinUrl },
            notificationChannels
          );
        } catch (error) {
          console.warn('Failed to send meeting invitations:', error);
        }
      }
      
      return {
        success: true,
        message: `Meeting "${createdMeeting.title}" has been created successfully!`,
        meeting: createdMeeting,
        videoConference: videoConferenceData,
      };
    } catch (error) {
      throw new Error(`Failed to create meeting: ${error.message}`);
    }
  }

  /**
   * Update an existing meeting
   * @param {Object} meetingData - Meeting data with ID
   * @returns {Promise<Object>} Update result
   */
  async updateMeeting(meetingData) {
    try {
      if (!meetingData.meetingId) {
        throw new Error('Meeting ID is required for updates');
      }

      const activeCalendar = this.calendars[this.activeCalendar];
      if (!activeCalendar) {
        throw new Error('No active calendar available');
      }

      const updatedMeeting = await activeCalendar.updateMeeting(
        meetingData.meetingId,
        meetingData
      );

      return {
        success: true,
        message: `Meeting "${updatedMeeting.title}" has been updated successfully!`,
        meeting: updatedMeeting,
      };
    } catch (error) {
      throw new Error(`Failed to update meeting: ${error.message}`);
    }
  }

  /**
   * Delete a meeting
   * @param {Object} meetingData - Meeting data with ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteMeeting(meetingData) {
    try {
      if (!meetingData.meetingId) {
        throw new Error('Meeting ID is required for deletion');
      }

      const activeCalendar = this.calendars[this.activeCalendar];
      if (!activeCalendar) {
        throw new Error('No active calendar available');
      }

      await activeCalendar.deleteMeeting(meetingData.meetingId);

      return {
        success: true,
        message: 'Meeting has been deleted successfully!',
      };
    } catch (error) {
      throw new Error(`Failed to delete meeting: ${error.message}`);
    }
  }

  /**
   * Check availability for a time slot
   * @param {Object} meetingData - Meeting data
   * @returns {Promise<Object>} Availability result
   */
  async checkAvailability(meetingData) {
    try {
      if (!meetingData.date || !meetingData.time) {
        throw new Error('Date and time are required to check availability');
      }

      const activeCalendar = this.calendars[this.activeCalendar];
      if (!activeCalendar) {
        throw new Error('No active calendar available');
      }

      const startDate = new Date(`${meetingData.date}T${meetingData.time}:00`);
      const endDate = new Date(startDate.getTime() + (meetingData.duration || 60) * 60000);
      
      const isAvailable = await activeCalendar.checkAvailability(startDate, endDate);

      return {
        success: true,
        message: isAvailable 
          ? 'The requested time slot is available!' 
          : 'The requested time slot is not available.',
        isAvailable,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to check availability: ${error.message}`);
    }
  }

  /**
   * Suggest alternative meeting times
   * @param {Object} meetingData - Original meeting request
   * @returns {Promise<Object>} Suggestion result
   */
  async suggestMeetings(meetingData) {
    try {
      const activeCalendar = this.calendars[this.activeCalendar];
      if (!activeCalendar) {
        throw new Error('No active calendar available');
      }

      const date = meetingData.date ? new Date(meetingData.date) : new Date();
      const duration = meetingData.duration || 60;
      
      const availableSlots = await activeCalendar.findAvailableSlots(
        date,
        duration,
        '09:00',
        '17:00'
      );

      if (availableSlots.length === 0) {
        return {
          success: false,
          message: 'No available time slots found for the requested date.',
        };
      }

      const suggestions = availableSlots.slice(0, 5).map(slot => ({
        date: slot.start.toISOString().split('T')[0],
        time: slot.start.toTimeString().slice(0, 5),
        startTime: slot.start.toISOString(),
        endTime: slot.end.toISOString(),
      }));

      return {
        success: true,
        message: `Here are some available time slots for ${date.toDateString()}:`,
        suggestions,
      };
    } catch (error) {
      throw new Error(`Failed to suggest meetings: ${error.message}`);
    }
  }

  /**
   * Get calendar context for AI
   * @returns {Promise<Object>} Calendar context
   */
  async getCalendarContext() {
    try {
      const activeCalendar = this.calendars[this.activeCalendar];
      if (!activeCalendar) {
        return {
          todayMeetings: [],
          upcomingMeetings: [],
          calendarInfo: null,
          currentTime: new Date().toISOString(),
        };
      }

      const [todayMeetings, upcomingMeetings, calendarInfo] = await Promise.all([
        activeCalendar.getTodayMeetings(),
        activeCalendar.getUpcomingMeetings(7),
        activeCalendar.getCalendarInfo(),
      ]);

      return {
        todayMeetings: todayMeetings.slice(0, 5), // Limit to 5 meetings
        upcomingMeetings: upcomingMeetings.slice(0, 10), // Limit to 10 meetings
        calendarInfo,
        currentTime: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Failed to get calendar context:', error);
      return {
        todayMeetings: [],
        upcomingMeetings: [],
        calendarInfo: null,
        currentTime: new Date().toISOString(),
      };
    }
  }

  /**
   * Get meeting suggestions based on user input
   * @param {string} userInput - User input text
   * @returns {Promise<Array>} Meeting suggestions
   */
  async getMeetingSuggestions(userInput) {
    try {
      const activeCalendar = this.calendars[this.activeCalendar];
      if (!activeCalendar) {
        return [];
      }

      const extractedData = await this.openai.extractMeetingData(userInput);
      
      if (!extractedData) {
        return [];
      }

      // If we have a date, suggest available times
      if (extractedData.date) {
        const suggestions = await this.suggestMeetings(extractedData);
        return suggestions.suggestions || [];
      }

      // Otherwise, suggest common meeting times for today and tomorrow
      const suggestions = [];
      const today = new Date();
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      for (const date of [today, tomorrow]) {
        const availableSlots = await activeCalendar.findAvailableSlots(
          date,
          60,
          '09:00',
          '17:00'
        );

        suggestions.push(...availableSlots.slice(0, 3).map(slot => ({
          date: slot.start.toISOString().split('T')[0],
          time: slot.start.toTimeString().slice(0, 5),
          startTime: slot.start.toISOString(),
          endTime: slot.end.toISOString(),
        })));
      }

      return suggestions.slice(0, 6);
    } catch (error) {
      console.error('Failed to get meeting suggestions:', error);
      return [];
    }
  }

  /**
   * Authenticate with calendar service
   * @param {string} calendarName - Calendar name ('google', 'microsoft', 'apple', 'caldav')
   * @returns {Promise<boolean>} Whether authentication was successful
   */
  async authenticate(calendarName = this.activeCalendar) {
    try {
      const calendar = this.calendars[calendarName];
      if (!calendar) {
        throw new Error(`Calendar '${calendarName}' not found`);
      }

      const success = await calendar.authenticate();
      if (success) {
        this.activeCalendar = calendarName;
        this.isInitialized = true;
      }
      return success;
    } catch (error) {
      console.error('Authentication failed:', error);
      return false;
    }
  }

  /**
   * Check if the service is ready
   * @returns {boolean} Whether the service is ready
   */
  isReady() {
    return this.isInitialized;
  }

  /**
   * Get service status
   * @returns {Promise<Object>} Service status
   */
  async getStatus() {
    const calendarStatuses = {};
    for (const [name, service] of Object.entries(this.calendars)) {
      const info = await service.getCalendarInfo();
      calendarStatuses[name] = {
        isAuthenticated: service.isAuthenticated(),
        info,
      };
    }

    const openaiValid = await this.openai.validateAPIKey();
    const videoConferenceStatus = await this.videoConference.getStatus();
    const communicationStatus = await this.communication.getStatus();

    return {
      isInitialized: this.isInitialized,
      activeCalendar: this.activeCalendar,
      calendars: calendarStatuses,
      openaiConnected: openaiValid,
      videoConference: videoConferenceStatus,
      communication: communicationStatus,
    };
  }

  /**
   * Set active calendar
   * @param {string} calendarName - Calendar name ('google', 'microsoft', 'apple', 'caldav')
   * @returns {Promise<boolean>} Whether the calendar was set successfully
   */
  async setActiveCalendar(calendarName) {
    if (!this.calendars[calendarName]) {
      throw new Error(`Calendar '${calendarName}' not found`);
    }

    const calendar = this.calendars[calendarName];
    if (!calendar.isAuthenticated()) {
      throw new Error(`Calendar '${calendarName}' is not authenticated`);
    }

    this.activeCalendar = calendarName;
    return true;
  }

  /**
   * Get available calendars
   * @returns {Array} Array of available calendars
   */
  getAvailableCalendars() {
    return Object.entries(this.calendars).map(([name, service]) => ({
      name,
      displayName: this.getCalendarDisplayName(name),
      isAuthenticated: service.isAuthenticated(),
      isActive: name === this.activeCalendar,
    }));
  }

  /**
   * Get calendar display name
   * @param {string} calendarName - Calendar name
   * @returns {string} Display name
   */
  getCalendarDisplayName(calendarName) {
    const displayNames = {
      google: 'Google Calendar',
      microsoft: 'Microsoft Outlook',
      apple: 'Apple Calendar',
      caldav: 'CalDAV',
    };
    return displayNames[calendarName] || calendarName;
  }

  /**
   * Get available video conference providers
   * @returns {Array} Array of available providers
   */
  getAvailableVideoProviders() {
    return this.videoConference.getAvailableProviders();
  }

  /**
   * Get available communication channels
   * @returns {Array} Array of available channels
   */
  getAvailableCommunicationChannels() {
    return this.communication.getAvailableChannels();
  }

  /**
   * Send meeting reminder
   * @param {string} meetingId - Meeting ID
   * @param {Array} channels - Communication channels
   * @returns {Promise<Object>} Send result
   */
  async sendMeetingReminder(meetingId, channels = ['whatsapp', 'email']) {
    try {
      const activeCalendar = this.calendars[this.activeCalendar];
      const meeting = await activeCalendar.getMeeting(meetingId);
      
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      return await this.communication.sendMeetingReminder(meeting, channels);
    } catch (error) {
      console.error('Failed to send meeting reminder:', error);
      throw error;
    }
  }

  /**
   * Send meeting update
   * @param {string} meetingId - Meeting ID
   * @param {Object} updates - Meeting updates
   * @param {Array} channels - Communication channels
   * @returns {Promise<Object>} Send result
   */
  async sendMeetingUpdate(meetingId, updates, channels = ['email', 'slack']) {
    try {
      const activeCalendar = this.calendars[this.activeCalendar];
      const updatedMeeting = await activeCalendar.updateMeeting(meetingId, updates);
      
      return await this.communication.sendMeetingUpdate(updatedMeeting, channels);
    } catch (error) {
      console.error('Failed to send meeting update:', error);
      throw error;
    }
  }

  /**
   * Send meeting cancellation
   * @param {string} meetingId - Meeting ID
   * @param {Array} channels - Communication channels
   * @returns {Promise<Object>} Send result
   */
  async sendMeetingCancellation(meetingId, channels = ['whatsapp', 'email', 'sms']) {
    try {
      const activeCalendar = this.calendars[this.activeCalendar];
      const meeting = await activeCalendar.getMeeting(meetingId);
      
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      return await this.communication.sendMeetingCancellation(meeting, channels);
    } catch (error) {
      console.error('Failed to send meeting cancellation:', error);
      throw error;
    }
  }

  /**
   * Set notification preferences
   * @param {Object} preferences - Notification preferences
   * @returns {Promise<void>}
   */
  async setNotificationPreferences(preferences) {
    return await this.communication.setNotificationPreferences(preferences);
  }

  /**
   * Get notification preferences
   * @returns {Object} Notification preferences
   */
  getNotificationPreferences() {
    return this.communication.getNotificationPreferences();
  }
}

export default new MeetingManager();