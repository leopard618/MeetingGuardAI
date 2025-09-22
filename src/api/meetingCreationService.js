// Meeting Creation Service
// Handles complete meeting creation with Google Calendar integration

import { supabaseMeetingService } from './supabaseMeetingService.js';
import { googleCalendarService } from './googleCalendar.js';
import { googleTokenManager } from './googleTokenManager.js';
import AsyncStorage from '@react-native-async-storage/async-storage';

class MeetingCreationService {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    try {
      console.log('MeetingCreationService: Starting initialization...');
      
      // Check if user is authenticated
      const user = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('authToken');
      
      if (!user || !token) {
        console.log('MeetingCreationService: User not authenticated, but continuing with limited functionality');
        // Don't fail completely - allow creation without full auth
        this.isInitialized = true;
        return true;
      }

      console.log('MeetingCreationService: User authenticated, initializing Supabase service...');

      // Initialize Supabase meeting service
      const supabaseInitialized = await supabaseMeetingService.initialize();
      if (!supabaseInitialized) {
        console.log('MeetingCreationService: Supabase service not available, but continuing with limited functionality');
        // Don't fail completely - allow creation without Supabase
        this.isInitialized = true;
        return true;
      }

      // Check Google Calendar token status (optional)
      try {
        await this.checkGoogleCalendarStatus();
      } catch (error) {
        console.log('MeetingCreationService: Google Calendar check failed, but continuing:', error.message);
      }

      this.isInitialized = true;
      console.log('MeetingCreationService: Initialized successfully');
      return true;
    } catch (error) {
      console.error('MeetingCreationService: Initialization failed, but continuing with limited functionality:', error);
      // Don't fail completely - allow creation with limited functionality
      this.isInitialized = true;
      return true;
    }
  }

  async checkGoogleCalendarStatus() {
    try {
      console.log('MeetingCreationService: Checking Google Calendar status...');
      
      const hasValidAccess = await googleTokenManager.hasValidAccess();
      if (hasValidAccess) {
        console.log('MeetingCreationService: Google Calendar access is valid');
        
        // Validate token by making a test call
        const accessToken = await googleTokenManager.getValidAccessToken();
        const isValid = await googleTokenManager.validateToken(accessToken);
        
        if (isValid) {
          console.log('MeetingCreationService: Google Calendar token is valid and working');
        } else {
          console.log('MeetingCreationService: Google Calendar token is invalid, will need to reconnect');
        }
      } else {
        console.log('MeetingCreationService: No valid Google Calendar access');
      }
    } catch (error) {
      console.error('MeetingCreationService: Error checking Google Calendar status:', error);
    }
  }

  async createMeeting(meetingData) {
    try {
      console.log('MeetingCreationService: Creating meeting with data:', meetingData);
      
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('MeetingCreationService not initialized');
        }
      }

      // Validate required fields
      if (!meetingData.title) {
        throw new Error('Meeting title is required');
      }
      
      if (!meetingData.date) {
        throw new Error('Meeting date is required');
      }
      
      if (!meetingData.time) {
        throw new Error('Meeting time is required');
      }

      // Get user information (optional)
      const userData = await AsyncStorage.getItem('user');
      let user = null;
      if (userData) {
        user = JSON.parse(userData);
        console.log('MeetingCreationService: Creating meeting for user:', user.email);
      } else {
        console.log('MeetingCreationService: No user data found, creating meeting without user context');
      }

      // Try to create meeting in Supabase first
      let createdMeeting = null;
      try {
        console.log('MeetingCreationService: Attempting to create meeting in Supabase...');
        createdMeeting = await supabaseMeetingService.create(meetingData);
        
        if (createdMeeting) {
          console.log('MeetingCreationService: Meeting created in Supabase:', createdMeeting.id);
        }
      } catch (supabaseError) {
        console.log('MeetingCreationService: Supabase creation failed:', supabaseError.message);
        // Continue with fallback creation
      }

      // If Supabase failed, create a local meeting object
      if (!createdMeeting) {
        console.log('MeetingCreationService: Creating local meeting object...');
        createdMeeting = {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          ...meetingData,
          created_at: new Date().toISOString(),
          source: 'local'
        };
        console.log('MeetingCreationService: Local meeting created:', createdMeeting.id);
      }

      console.log('MeetingCreationService: Meeting created successfully:', createdMeeting.id);

      // Try to create Google Calendar event (only if user is available)
      if (user) {
        try {
          console.log('MeetingCreationService: Attempting Google Calendar integration...');
          const googleEvent = await this.createGoogleCalendarEvent(createdMeeting, user);
          
          if (googleEvent) {
            console.log('MeetingCreationService: Google Calendar event created:', googleEvent.id);
            // Update meeting with Google event ID if needed
            // This could be stored in a separate field or table
          } else {
            console.log('MeetingCreationService: Google Calendar integration skipped or failed');
          }
        } catch (googleError) {
          console.error('MeetingCreationService: Google Calendar integration failed:', googleError);
          // Don't fail the meeting creation if Google Calendar fails
        }
      } else {
        console.log('MeetingCreationService: No user data, skipping Google Calendar integration');
      }

      return createdMeeting;
    } catch (error) {
      console.error('MeetingCreationService: Error creating meeting:', error);
      throw error;
    }
  }

  async createGoogleCalendarEvent(meeting, user) {
    try {
      console.log('MeetingCreationService: Creating Google Calendar event...');
      
      // Check if we have valid Google Calendar access
      const hasValidAccess = await googleTokenManager.hasValidAccess();
      if (!hasValidAccess) {
        console.log('MeetingCreationService: No valid Google Calendar access');
        return null;
      }

      // Get valid access token
      const accessToken = await googleTokenManager.getValidAccessToken();
      if (!accessToken) {
        console.log('MeetingCreationService: No valid access token available');
        return null;
      }

      // Create Google Calendar event directly
      const startDateTime = new Date(`${meeting.date}T${meeting.time}`);
      const endDateTime = new Date(startDateTime.getTime() + (meeting.duration || 60) * 60000);
      
      const event = {
        summary: meeting.title,
        description: meeting.description || '',
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'UTC'
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'UTC'
        },
        attendees: meeting.participants ? meeting.participants.map(p => ({
          email: p.email,
          displayName: p.name
        })) : [],
        location: meeting.location ? meeting.location.address || meeting.location.name : undefined,
        organizer: {
          email: user.email
        }
      };

      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });

      if (response.ok) {
        const googleEvent = await response.json();
        console.log('MeetingCreationService: Google Calendar event created successfully:', googleEvent.id);
        return googleEvent;
      } else {
        const errorData = await response.json();
        console.error('MeetingCreationService: Google Calendar API error:', errorData);
        return null;
      }
    } catch (error) {
      console.error('MeetingCreationService: Error creating Google Calendar event:', error);
      return null;
    }
  }

  async getMeetings() {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          return [];
        }
      }

      console.log('MeetingCreationService: Fetching meetings...');
      const meetings = await supabaseMeetingService.list();
      
      console.log('MeetingCreationService: Retrieved meetings:', meetings.length);
      return meetings;
    } catch (error) {
      console.error('MeetingCreationService: Error fetching meetings:', error);
      return [];
    }
  }

  async getMeeting(id) {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          return null;
        }
      }

      console.log('MeetingCreationService: Fetching meeting:', id);
      const meeting = await supabaseMeetingService.get(id);
      
      return meeting;
    } catch (error) {
      console.error('MeetingCreationService: Error fetching meeting:', error);
      return null;
    }
  }

  async updateMeeting(id, updateData) {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('MeetingCreationService not initialized');
        }
      }

      console.log('MeetingCreationService: Updating meeting:', id);
      const updatedMeeting = await supabaseMeetingService.update(id, updateData);
      
      return updatedMeeting;
    } catch (error) {
      console.error('MeetingCreationService: Error updating meeting:', error);
      throw error;
    }
  }

  async deleteMeeting(id) {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('MeetingCreationService not initialized');
        }
      }

      console.log('MeetingCreationService: Deleting meeting:', id);
      const result = await supabaseMeetingService.delete(id);
      
      return result;
    } catch (error) {
      console.error('MeetingCreationService: Error deleting meeting:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const meetingCreationService = new MeetingCreationService();
export default meetingCreationService;
