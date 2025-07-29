import OpenAIService from './openai.js';
import GoogleCalendarService from './googleCalendar.js';

class MeetingManager {
  constructor() {
    this.openai = OpenAIService;
    this.calendar = GoogleCalendarService;
    this.isInitialized = false;
  }

  /**
   * Initialize the meeting manager
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      // Initialize calendar service
      const calendarInitialized = await this.calendar.initialize();
      
      if (!calendarInitialized) {
        console.warn('Calendar initialization failed');
      }

      // Validate OpenAI API key
      const openaiValid = await this.openai.validateAPIKey();
      
      if (!openaiValid) {
        console.warn('OpenAI API key validation failed');
      }

      this.isInitialized = calendarInitialized && openaiValid;
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

      // Check availability if date and time are specified
      if (meetingData.date && meetingData.time) {
        const startDate = new Date(`${meetingData.date}T${meetingData.time}:00`);
        const endDate = new Date(startDate.getTime() + (meetingData.duration || 60) * 60000);
        
        const isAvailable = await this.calendar.checkAvailability(startDate, endDate);
        if (!isAvailable) {
          return {
            success: false,
            message: 'The requested time slot is not available. Would you like me to suggest alternative times?',
            action: 'suggest_alternatives',
            originalRequest: meetingData,
          };
        }
      }

      // Create the meeting
      const createdMeeting = await this.calendar.createMeeting(meetingData);
      
      return {
        success: true,
        message: `Meeting "${createdMeeting.title}" has been created successfully!`,
        meeting: createdMeeting,
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

      const updatedMeeting = await this.calendar.updateMeeting(
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

      await this.calendar.deleteMeeting(meetingData.meetingId);

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

      const startDate = new Date(`${meetingData.date}T${meetingData.time}:00`);
      const endDate = new Date(startDate.getTime() + (meetingData.duration || 60) * 60000);
      
      const isAvailable = await this.calendar.checkAvailability(startDate, endDate);

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
      const date = meetingData.date ? new Date(meetingData.date) : new Date();
      const duration = meetingData.duration || 60;
      
      const availableSlots = await this.calendar.findAvailableSlots(
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
      const [todayMeetings, upcomingMeetings, calendarInfo] = await Promise.all([
        this.calendar.getTodayMeetings(),
        this.calendar.getUpcomingMeetings(7),
        this.calendar.getCalendarInfo(),
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
        const availableSlots = await this.calendar.findAvailableSlots(
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
   * Authenticate with Google Calendar
   * @returns {Promise<boolean>} Whether authentication was successful
   */
  async authenticate() {
    try {
      const success = await this.calendar.authenticate();
      if (success) {
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
    const calendarInfo = await this.calendar.getCalendarInfo();
    const openaiValid = await this.openai.validateAPIKey();

    return {
      isInitialized: this.isInitialized,
      calendarConnected: !!calendarInfo?.isAuthenticated,
      openaiConnected: openaiValid,
      calendarInfo,
    };
  }
}

export default new MeetingManager();