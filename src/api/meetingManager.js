import OpenAIService from './openai.js';
import GoogleCalendarService from './googleCalendar.js';
import { Meeting } from './entities.js';
import { validateMeetingData } from '../utils/index.js';
import CalendarSyncManager from './calendarSyncManager.js';

class MeetingManager {
  constructor() {
    this.openai = OpenAIService;
    this.calendar = GoogleCalendarService;
    this.syncManager = CalendarSyncManager;
    this.isInitialized = false;
  }

  /**
   * Initialize the meeting manager
   */
  async initialize() {
    try {
      // Initialize calendar service
      const calendarInitialized = await this.calendar.initialize();
      
      if (!calendarInitialized) {
        console.warn('Calendar initialization failed - will continue without calendar features');
      }

      // Initialize sync manager if calendar is available
      if (calendarInitialized) {
        const syncInitialized = await this.syncManager.initialize();
        if (syncInitialized) {
          console.log('Calendar sync manager initialized successfully');
        } else {
          console.warn('Calendar sync manager initialization failed');
        }
      }

      // Validate OpenAI API key
      const openaiValid = await this.openai.validateAPIKey();

      // Meeting manager is initialized if OpenAI is valid, even if calendar fails
      this.isInitialized = openaiValid;
      return this.isInitialized;
    } catch (error) {
      console.error('Meeting manager initialization failed:', error);
      return false;
    }
  }

  /**
   * Process user message and generate AI response
   */
  async processMessage(messages, userInput) {
    try {
      // Check if this is a meeting-related request
      const isMeetingRequest = this.isMeetingRelatedRequest(userInput);
      
      if (isMeetingRequest) {
        // Get current calendar context
        const calendarContext = await this.getCalendarContext();
        
        // Check if user is asking about meeting details
        if (this.isMeetingDetailsRequest(userInput)) {
          return await this.handleMeetingDetailsRequest(userInput, calendarContext);
        }
        
        // Generate AI response with meeting context
        const aiResponse = await this.openai.generateMeetingResponse(
          [...messages, { type: 'user', content: userInput }],
          calendarContext
        );

        return aiResponse;
      } else {
        // Use regular chat for non-meeting questions
        const chatResponse = await this.openai.generateChatResponse(
          [...messages, { type: 'user', content: userInput }]
        );

        return {
          message: chatResponse.content,
          action: 'chat',
          meetingData: null,
          confidence: 0.8,
          requiresConfirmation: false,
        };
      }
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
   * Check if the user input is related to meeting management
   */
  isMeetingRelatedRequest(userInput) {
    const meetingKeywords = [
      'create', 'schedule', 'book', 'set up', 'arrange', 'plan',
      'meeting', 'appointment', 'call', 'conference', 'standup',
      'delete', 'cancel', 'remove', 'update', 'modify', 'change',
      'show', 'list', 'view', 'see', 'check', 'availability',
      'tomorrow', 'today', 'next week', 'this week', 'date', 'time',
      'participant', 'attendee', 'invite', 'location', 'virtual',
      'zoom', 'teams', 'google meet', 'hybrid', 'physical',
      'what', 'when', 'where', 'who', 'details', 'information'
    ];

    const input = userInput.toLowerCase();
    return meetingKeywords.some(keyword => input.includes(keyword));
  }

  /**
   * Check if user is asking for meeting details
   */
  isMeetingDetailsRequest(userInput) {
    const detailsKeywords = [
      'what meetings', 'show meetings', 'list meetings', 'my meetings',
      'today meetings', 'tomorrow meetings', 'upcoming meetings',
      'meeting details', 'meeting information', 'meeting schedule',
      'what do i have', 'what\'s on my calendar', 'what\'s scheduled',
      'details about', 'information about', 'tell me about',
      'show my', 'list my', 'what meetings', 'my schedule',
      'calendar', 'agenda', 'appointments', 'events'
    ];

    const input = userInput.toLowerCase();
    return detailsKeywords.some(keyword => input.includes(keyword));
  }

  /**
   * Find meeting ID by title or other criteria
   */
  findMeetingId(meetings, searchCriteria) {
    const { title, date, time } = searchCriteria;
    
    console.log('MeetingManager: Finding meeting ID for criteria:', searchCriteria);
    console.log('MeetingManager: Available meetings:', meetings.map(m => ({ id: m.id, title: m.title, date: m.date, time: m.time })));
    
    if (!title) {
      console.log('MeetingManager: No title provided for meeting search');
      return null;
    }
    
    // Try to find by exact title match first
    let match = meetings.find(m => 
      m.title && m.title.toLowerCase() === title.toLowerCase()
    );
    
    if (match) {
      console.log('MeetingManager: Found exact title match:', match.id);
      return match.id;
    }
    
    // Try to find by title and date
    if (date) {
      match = meetings.find(m => 
        m.title && m.title.toLowerCase() === title.toLowerCase() &&
        m.date === date
      );
      
      if (match) {
        console.log('MeetingManager: Found title and date match:', match.id);
        return match.id;
      }
    }
    
    // Try to find by title, date, and time
    if (date && time) {
      match = meetings.find(m => 
        m.title && m.title.toLowerCase() === title.toLowerCase() &&
        m.date === date && m.time === time
      );
      
      if (match) {
        console.log('MeetingManager: Found title, date, and time match:', match.id);
        return match.id;
      }
    }
    
    // If no exact match, return the first meeting with similar title
    const similarMatch = meetings.find(m => 
      m.title && m.title.toLowerCase().includes(title.toLowerCase())
    );
    
    if (similarMatch) {
      console.log('MeetingManager: Found similar title match:', similarMatch.id);
      return similarMatch.id;
    }
    
    console.log('MeetingManager: No meeting found for criteria:', searchCriteria);
    return null;
  }

  /**
   * Handle meeting details requests
   */
  async handleMeetingDetailsRequest(userInput, calendarContext) {
    try {
      const input = userInput.toLowerCase();
      let responseMessage = '';
      let meetings = [];

      // Determine what type of meeting details the user wants
      if (input.includes('today') || input.includes('today\'s')) {
        meetings = calendarContext.todayMeetings || [];
        responseMessage = this.formatMeetingsResponse(meetings, 'today');
      } else if (input.includes('tomorrow') || input.includes('tomorrow\'s')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        meetings = (calendarContext.meetings || []).filter(m => m.date === tomorrowStr);
        responseMessage = this.formatMeetingsResponse(meetings, 'tomorrow');
      } else if (input.includes('upcoming') || input.includes('next week') || input.includes('this week')) {
        meetings = calendarContext.upcomingMeetings || [];
        responseMessage = this.formatMeetingsResponse(meetings, 'upcoming');
      } else if (input.includes('all') || input.includes('my meetings') || input.includes('my schedule')) {
        meetings = calendarContext.meetings || [];
        responseMessage = this.formatMeetingsResponse(meetings, 'all');
      } else {
        // Default to upcoming meetings
        meetings = calendarContext.upcomingMeetings || [];
        responseMessage = this.formatMeetingsResponse(meetings, 'upcoming');
      }

      // Add helpful suggestions if no meetings found
      if (!meetings || meetings.length === 0) {
        responseMessage += "\n\n💡 **Suggestions:**\n";
        responseMessage += "• Try asking about 'upcoming meetings' or 'all meetings'\n";
        responseMessage += "• Create a new meeting by saying 'Create a meeting for tomorrow at 2 PM'\n";
        responseMessage += "• Check your Google Calendar for any existing meetings";
      } else {
        // Add information about how to update/delete meetings
        responseMessage += "\n\n💡 **To update or delete a meeting:**\n";
        responseMessage += "• Say 'Update the ADSF meeting' or 'Delete the team standup'\n";
        responseMessage += "• I'll help you modify the meeting details";
      }

      return {
        message: responseMessage,
        action: 'chat',
        meetingData: null,
        confidence: 0.9,
        requiresConfirmation: false,
      };
    } catch (error) {
      console.error('Error handling meeting details request:', error);
      return {
        message: "I'm sorry, I couldn't retrieve your meeting details. Please try again.",
        action: 'chat',
        meetingData: null,
        confidence: 0,
        requiresConfirmation: false,
      };
    }
  }

  /**
   * Format meetings response for user
   */
  formatMeetingsResponse(meetings, type) {
    if (!meetings || meetings.length === 0) {
      switch (type) {
        case 'today':
          return "You have no meetings scheduled for today.";
        case 'tomorrow':
          return "You have no meetings scheduled for tomorrow.";
        case 'upcoming':
          return "You have no upcoming meetings in the next 7 days.";
        case 'all':
          return "You have no meetings in your calendar.";
        default:
          return "You have no meetings scheduled.";
      }
    }

    let response = '';
    switch (type) {
      case 'today':
        response = `You have ${meetings.length} meeting${meetings.length === 1 ? '' : 's'} scheduled for today:\n\n`;
        break;
      case 'tomorrow':
        response = `You have ${meetings.length} meeting${meetings.length === 1 ? '' : 's'} scheduled for tomorrow:\n\n`;
        break;
      case 'upcoming':
        response = `You have ${meetings.length} upcoming meeting${meetings.length === 1 ? '' : 's'} in the next 7 days:\n\n`;
        break;
      case 'all':
        response = `You have ${meetings.length} meeting${meetings.length === 1 ? '' : 's'} in your calendar:\n\n`;
        break;
      default:
        response = `Here are your meetings:\n\n`;
    }

    meetings.forEach((meeting, index) => {
      const meetingDate = new Date(meeting.date + ' ' + (meeting.time || '00:00'));
      const formattedDate = meetingDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      response += `${index + 1}. **${meeting.title}**\n`;
      response += `   📅 ${formattedDate}\n`;
      if (meeting.duration) {
        response += `   ⏱️ ${meeting.duration} minutes\n`;
      }
      if (meeting.location?.address) {
        response += `   📍 ${meeting.location.address}\n`;
      }
      if (meeting.participants && meeting.participants.length > 0) {
        response += `   👥 ${meeting.participants.length} participant${meeting.participants.length === 1 ? '' : 's'}\n`;
      }
      if (meeting.description) {
        response += `   📝 ${meeting.description}\n`;
      }
      if (meeting.source) {
        response += `   📱 ${meeting.source === 'local' ? 'Local' : 'Google Calendar'}\n`;
      }
      response += '\n';
    });

    return response.trim();
  }

  /**
   * Execute meeting action based on AI response
   */
  async executeMeetingAction(aiResponse) {
    const { action, meetingData, requiresConfirmation } = aiResponse;
    
    console.log('Executing meeting action:', { action, meetingData, requiresConfirmation });

    if (!meetingData || action === 'chat') {
      console.log('No meeting data or chat action, returning success');
      return { success: true, message: 'Chat response processed' };
    }

    try {
      // For update and delete actions, ensure we have a meetingId
      if ((action === 'update' || action === 'delete') && !meetingData.meetingId) {
        console.log('No meetingId provided, attempting to find it from existing meetings');
        
        // Get current meetings to find the ID
        const calendarContext = await this.getCalendarContext();
        const allMeetings = calendarContext.meetings || [];
        
        const meetingId = this.findMeetingId(allMeetings, {
          title: meetingData.title,
          date: meetingData.date,
          time: meetingData.time
        });
        
        if (meetingId) {
          console.log('Found meeting ID:', meetingId);
          meetingData.meetingId = meetingId;
        } else {
          console.error('Could not find meeting ID for:', meetingData.title);
          return {
            success: false,
            message: `Could not find the meeting "${meetingData.title}" to ${action}. Please check the meeting title and try again.`,
          };
        }
      }

      switch (action) {
        case 'create':
          console.log('Creating meeting with data:', meetingData);
          return await this.createMeeting(meetingData);
        
        case 'update':
          console.log('Updating meeting with data:', meetingData);
          return await this.updateMeeting(meetingData);
        
        case 'delete':
          console.log('Deleting meeting with data:', meetingData);
          return await this.deleteMeeting(meetingData);
        
        case 'check':
          console.log('Checking availability with data:', meetingData);
          return await this.checkAvailability(meetingData);
        
        default:
          console.log('Unknown action:', action);
          return { success: false, message: 'Unknown action' };
      }
    } catch (error) {
      console.error('Failed to execute meeting action:', error);
      return {
        success: false,
        message: `Failed to execute action: ${error.message}`,
      };
    }
  }

  /**
   * Create a new meeting
   */
  async createMeeting(meetingData) {
    try {
      console.log('MeetingManager: Creating meeting with data:', meetingData);
      console.log('MeetingManager: Title:', meetingData.title);
      console.log('MeetingManager: Date:', meetingData.date);
      console.log('MeetingManager: Time:', meetingData.time);
      console.log('MeetingManager: Duration:', meetingData.duration);
      console.log('MeetingManager: Location:', meetingData.location);
      console.log('MeetingManager: Participants:', meetingData.participants);
      
      // Validate and fix meeting data
      const validatedData = validateMeetingData(meetingData);
      if (!validatedData) {
        throw new Error('Invalid meeting data - missing required fields');
      }
      
      // Create local meeting
      const meeting = await Meeting.create(validatedData);
      console.log('MeetingManager: Local meeting created successfully:', meeting);
      
      // Automatically sync to Google Calendar if available
      if (this.calendar.isAvailable()) {
        try {
          console.log('MeetingManager: Syncing meeting to Google Calendar...');
          const syncResult = await this.syncManager.syncEventToGoogle(meeting.id);
          
          if (syncResult) {
            console.log('MeetingManager: Meeting synced to Google Calendar successfully');
            return {
              success: true,
              message: 'Meeting created and synced to Google Calendar successfully',
              meeting: meeting,
              synced: true,
            };
          } else {
            console.warn('MeetingManager: Failed to sync meeting to Google Calendar, but local meeting was created');
            return {
              success: true,
              message: 'Meeting created locally (Google Calendar sync failed)',
              meeting: meeting,
              synced: false,
            };
          }
        } catch (syncError) {
          console.error('MeetingManager: Error syncing to Google Calendar:', syncError);
          return {
            success: true,
            message: 'Meeting created locally (Google Calendar sync failed)',
            meeting: meeting,
            synced: false,
          };
        }
      } else {
        console.log('MeetingManager: Google Calendar not available, meeting created locally only');
        return {
          success: true,
          message: 'Meeting created successfully',
          meeting: meeting,
          synced: false,
        };
      }
    } catch (error) {
      console.error('MeetingManager: Failed to create meeting:', error);
      return {
        success: false,
        message: `Failed to create meeting: ${error.message}`,
      };
    }
  }

  /**
   * Update an existing meeting
   */
  async updateMeeting(meetingData) {
    try {
      console.log('MeetingManager: Updating meeting with data:', meetingData);
      
      // Check if meetingId is provided
      if (!meetingData.meetingId) {
        console.error('MeetingManager: No meetingId provided for update');
        return {
          success: false,
          message: 'Cannot update meeting: Meeting ID is required. Please specify which meeting you want to update.',
        };
      }
      
      // Update local meeting
      const meeting = await Meeting.update(meetingData.meetingId, meetingData);
      console.log('MeetingManager: Local meeting updated successfully:', meeting);
      
      // Automatically sync to Google Calendar if available
      if (this.calendar.isAvailable()) {
        try {
          console.log('MeetingManager: Syncing updated meeting to Google Calendar...');
          const syncResult = await this.syncManager.syncEventToGoogle(meeting.id);
          
          if (syncResult) {
            console.log('MeetingManager: Meeting update synced to Google Calendar successfully');
            return {
              success: true,
              message: 'Meeting updated and synced to Google Calendar successfully',
              meeting: meeting,
              synced: true,
            };
          } else {
            console.warn('MeetingManager: Failed to sync meeting update to Google Calendar, but local meeting was updated');
            return {
              success: true,
              message: 'Meeting updated locally (Google Calendar sync failed)',
              meeting: meeting,
              synced: false,
            };
          }
        } catch (syncError) {
          console.error('MeetingManager: Error syncing update to Google Calendar:', syncError);
          return {
            success: true,
            message: 'Meeting updated locally (Google Calendar sync failed)',
            meeting: meeting,
            synced: false,
          };
        }
      } else {
        console.log('MeetingManager: Google Calendar not available, meeting updated locally only');
        return {
          success: true,
          message: 'Meeting updated successfully',
          meeting: meeting,
          synced: false,
        };
      }
    } catch (error) {
      console.error('MeetingManager: Failed to update meeting:', error);
      return {
        success: false,
        message: `Failed to update meeting: ${error.message}`,
      };
    }
  }

  /**
   * Delete a meeting
   */
  async deleteMeeting(meetingData) {
    try {
      console.log('MeetingManager: Deleting meeting with data:', meetingData);
      console.log('MeetingManager: Meeting ID for deletion:', meetingData.meetingId);
      console.log('MeetingManager: Meeting title for deletion:', meetingData.title);
      
      // Check if meetingId is provided
      if (!meetingData.meetingId) {
        console.error('MeetingManager: No meetingId provided for deletion');
        return {
          success: false,
          message: 'Cannot delete meeting: Meeting ID is required. Please specify which meeting you want to delete.',
        };
      }
      
      // Verify the meeting exists before deleting
      try {
        const existingMeeting = await Meeting.get(meetingData.meetingId);
        if (!existingMeeting) {
          console.error('MeetingManager: Meeting not found with ID:', meetingData.meetingId);
          return {
            success: false,
            message: `Meeting not found with ID: ${meetingData.meetingId}. Please check the meeting details and try again.`,
          };
        }
        console.log('MeetingManager: Found existing meeting to delete:', existingMeeting.title);
      } catch (error) {
        console.error('MeetingManager: Error checking if meeting exists:', error);
        return {
          success: false,
          message: `Error verifying meeting: ${error.message}`,
        };
      }
      
      // Delete from both local storage and Google Calendar
      if (this.calendar.isAvailable()) {
        try {
          console.log('MeetingManager: Deleting meeting from both local storage and Google Calendar...');
          const deleteResult = await this.syncManager.deleteEventFromBoth(meetingData.meetingId);
          
          if (deleteResult) {
            console.log('MeetingManager: Meeting deleted from both local storage and Google Calendar successfully');
            return {
              success: true,
              message: `Meeting "${meetingData.title}" deleted from both local storage and Google Calendar successfully`,
              synced: true,
            };
          } else {
            console.warn('MeetingManager: Failed to delete from both, falling back to local deletion only');
            // Fallback to local deletion only
            const localDeleteResult = await Meeting.delete(meetingData.meetingId);
            return {
              success: true,
              message: `Meeting "${meetingData.title}" deleted locally (Google Calendar deletion failed)`,
              synced: false,
            };
          }
        } catch (syncError) {
          console.error('MeetingManager: Error deleting from both calendars:', syncError);
          // Fallback to local deletion only
          const localDeleteResult = await Meeting.delete(meetingData.meetingId);
          return {
            success: true,
            message: `Meeting "${meetingData.title}" deleted locally (Google Calendar deletion failed)`,
            synced: false,
          };
        }
      } else {
        // Google Calendar not available, delete locally only
        const deleteResult = await Meeting.delete(meetingData.meetingId);
        console.log('MeetingManager: Delete result:', deleteResult);
        
        console.log('MeetingManager: Meeting deleted locally only');
        return {
          success: true,
          message: `Meeting "${meetingData.title}" deleted successfully`,
          synced: false,
        };
      }
    } catch (error) {
      console.error('MeetingManager: Failed to delete meeting:', error);
      console.error('MeetingManager: Error details:', {
        message: error.message,
        stack: error.stack,
        meetingId: meetingData.meetingId,
        title: meetingData.title
      });
      return {
        success: false,
        message: `Failed to delete meeting: ${error.message}`,
      };
    }
  }

  /**
   * Check availability for a time slot
   */
  async checkAvailability(meetingData) {
    try {
      if (!this.calendar.isAvailable()) {
        throw new Error('Calendar service not available');
      }

      const startDate = new Date(meetingData.date + 'T' + meetingData.time);
      const endDate = new Date(startDate.getTime() + (meetingData.duration || 60) * 60 * 1000);
      
      const isAvailable = await this.calendar.checkAvailability(startDate, endDate);
      
      return {
        success: true,
        message: isAvailable ? 'Time slot is available' : 'Time slot is not available',
        isAvailable: isAvailable,
      };
    } catch (error) {
      console.error('Failed to check availability:', error);
      return {
        success: false,
        message: `Failed to check availability: ${error.message}`,
      };
    }
  }

  /**
   * Get calendar context for AI
   */
  async getCalendarContext() {
    try {
      // Check if calendar is available and has valid auth
      if (!this.calendar.isAvailable()) {
        console.log('Calendar not available, returning empty context');
        return {
          isConnected: false,
          meetings: [],
          todayMeetings: [],
          upcomingMeetings: [],
        };
      }

      // Double-check authentication before making requests
      const hasAuth = await this.calendar.hasValidAuth();
      if (!hasAuth) {
        console.log('Calendar not authenticated, returning empty context');
        return {
          isConnected: false,
          meetings: [],
          todayMeetings: [],
          upcomingMeetings: [],
        };
      }

      // Make calendar requests with error handling
      let todayMeetings = [];
      let upcomingMeetings = [];
      
      try {
        todayMeetings = await this.calendar.getTodayMeetings() || [];
      } catch (error) {
        console.warn('Failed to get today meetings:', error.message);
      }
      
      try {
        upcomingMeetings = await this.calendar.getUpcomingMeetings(7) || [];
      } catch (error) {
        console.warn('Failed to get upcoming meetings:', error.message);
      }
      
      // Also get local meetings to include in context
      let localMeetings = [];
      try {
        localMeetings = await Meeting.list() || [];
        console.log('MeetingManager: Loaded local meetings for context:', localMeetings.length);
      } catch (error) {
        console.warn('Failed to get local meetings:', error.message);
      }
      
      // Combine all meetings and ensure IDs are present
      const allMeetings = [
        ...localMeetings.map(m => ({ ...m, source: 'local' })),
        ...todayMeetings.map(m => ({ ...m, source: 'google' })),
        ...upcomingMeetings.map(m => ({ ...m, source: 'google' }))
      ];
      
      console.log('MeetingManager: Total meetings in context:', allMeetings.length);
      console.log('MeetingManager: Meeting IDs in context:', allMeetings.map(m => ({ id: m.id, title: m.title, source: m.source })));
      
      return {
        isConnected: true,
        meetings: allMeetings,
        todayMeetings: todayMeetings,
        upcomingMeetings: upcomingMeetings,
        localMeetings: localMeetings,
      };
    } catch (error) {
      console.warn('Error getting calendar context:', error.message);
      return {
        isConnected: false,
        meetings: [],
        todayMeetings: [],
        upcomingMeetings: [],
        localMeetings: [],
      };
    }
  }

  /**
   * Get service status
   */
  async getStatus() {
    try {
      const calendarInfo = await this.calendar.getCalendarInfo();
      const openaiValid = await this.openai.validateAPIKey();
      
      return {
        isInitialized: this.isInitialized,
        openaiConnected: openaiValid,
        calendarConnected: calendarInfo.isAuthenticated,
        calendarInfo: calendarInfo,
      };
    } catch (error) {
      console.error('Error getting status:', error);
      return {
        isInitialized: false,
        openaiConnected: false,
        calendarConnected: false,
        calendarInfo: {
          isAuthenticated: false,
          isInitialized: false,
          primaryCalendar: null,
          totalCalendars: 0,
          serviceName: 'Google Calendar',
          lastSync: null,
        },
      };
    }
  }

  /**
   * Check if service is ready
   */
  isReady() {
    return this.isInitialized;
  }

  /**
   * Get sync status and statistics
   */
  async getSyncStatus() {
    try {
      if (!this.calendar.isAvailable()) {
        return {
          isConnected: false,
          autoSync: false,
          syncDirection: 'none',
          lastSyncTime: null,
          isSyncing: false,
          syncInterval: 0,
        };
      }

      const syncStatus = await this.syncManager.getSyncStatus();
      const syncStats = await this.syncManager.getSyncStatistics();
      
      return {
        ...syncStatus,
        statistics: syncStats,
      };
    } catch (error) {
      console.error('MeetingManager: Error getting sync status:', error);
      return {
        isConnected: false,
        autoSync: false,
        syncDirection: 'none',
        lastSyncTime: null,
        isSyncing: false,
        syncInterval: 0,
        statistics: null,
      };
    }
  }

  /**
   * Force synchronization between local and Google Calendar
   */
  async forceSync() {
    try {
      if (!this.calendar.isAvailable()) {
        return {
          success: false,
          message: 'Google Calendar not available for synchronization',
        };
      }

      console.log('MeetingManager: Force sync requested');
      const syncResults = await this.syncManager.forceSync();
      
      return {
        success: true,
        message: `Sync completed: ${syncResults.created} created, ${syncResults.updated} updated, ${syncResults.deleted} deleted`,
        results: syncResults,
      };
    } catch (error) {
      console.error('MeetingManager: Error during force sync:', error);
      return {
        success: false,
        message: `Sync failed: ${error.message}`,
      };
    }
  }

  /**
   * Update sync settings
   */
  async updateSyncSettings(settings) {
    try {
      if (!this.calendar.isAvailable()) {
        return {
          success: false,
          message: 'Google Calendar not available for sync settings update',
        };
      }

      const updatedSettings = await this.syncManager.updateSyncSettings(settings);
      
      return {
        success: true,
        message: 'Sync settings updated successfully',
        settings: updatedSettings,
      };
    } catch (error) {
      console.error('MeetingManager: Error updating sync settings:', error);
      return {
        success: false,
        message: `Failed to update sync settings: ${error.message}`,
      };
    }
  }
}

export default new MeetingManager();