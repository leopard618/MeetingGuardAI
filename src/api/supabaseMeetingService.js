// Supabase Meeting Service
// Handles all meeting operations with Supabase backend

import { backendService } from './backendService.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleAuthError } from '../utils/authUtils.js';

class SupabaseMeetingService {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Check if we have auth token
      const token = await AsyncStorage.getItem('authToken');
      if (!token) {
        console.log('SupabaseMeetingService: No auth token found');
        return false;
      }
      
      // Load tokens into backend service
      const tokensLoaded = await backendService.loadTokens();
      if (!tokensLoaded) {
        console.log('SupabaseMeetingService: Failed to load tokens into backend service');
        return false;
      }
      
      // Validate authentication before proceeding
      const isValidAuth = await backendService.validateAuth();
      if (!isValidAuth) {
        console.log('SupabaseMeetingService: Authentication validation failed');
        return false;
      }
      
      this.isInitialized = true;
      console.log('SupabaseMeetingService: Initialized successfully with valid tokens');
      return true;
    } catch (error) {
      console.error('SupabaseMeetingService: Initialization failed:', error);
      return false;
    }
  }

  async list(sortBy = "-created_date") {
    try {
      console.log('SupabaseMeetingService: Fetching meetings from backend');
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Ensure tokens are loaded before making request
      await backendService.loadTokens();
      
      const response = await backendService.getMeetings();
      let meetings = response.meetings || [];
      
      console.log('SupabaseMeetingService: Received meetings:', meetings.length);
      
      // Sort meetings if needed
      if (sortBy === "-created_date") {
        meetings = meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      
      return meetings;
    } catch (error) {
      console.error('SupabaseMeetingService: Error fetching meetings:', error);
      
      // Handle authentication errors
      if (error.message.includes('Authentication failed') || error.message.includes('User not found')) {
        console.log('SupabaseMeetingService: Authentication failed, clearing auth state');
        await handleAuthError(error);
        this.isInitialized = false;
        return [];
      }
      
      // Handle rate limiting gracefully
      if (error.message.includes('HTTP 429')) {
        console.log('SupabaseMeetingService: Rate limited, returning empty array gracefully');
        return [];
      }
      
      // Fallback to empty array instead of throwing
      return [];
    }
  }

  async create(meetingData) {
    try {
      console.log('SupabaseMeetingService: Creating meeting with data:', meetingData);
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Ensure tokens are loaded before making request
      await backendService.loadTokens();

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

      // Prepare meeting data for backend
      const backendMeetingData = {
        title: meetingData.title,
        description: meetingData.description || '',
        date: meetingData.date,
        time: meetingData.time,
        duration: meetingData.duration || 60,
        location: meetingData.location || null,
        participants: meetingData.participants || [],
        attachments: meetingData.attachments || []
      };

      console.log('SupabaseMeetingService: Sending to backend:', backendMeetingData);

      const response = await backendService.createMeeting(backendMeetingData);
      const createdMeeting = response.meeting;
      
      console.log('SupabaseMeetingService: Meeting created successfully:', createdMeeting);
      
      return createdMeeting;
    } catch (error) {
      console.error('SupabaseMeetingService: Error creating meeting:', error);
      throw error;
    }
  }

  async update(id, updateData) {
    try {
      console.log('SupabaseMeetingService: Updating meeting with id:', id, 'and data:', updateData);
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Ensure tokens are loaded before making request
      await backendService.loadTokens();

      const response = await backendService.updateMeeting(id, updateData);
      const updatedMeeting = response.meeting;
      
      console.log('SupabaseMeetingService: Meeting updated successfully:', updatedMeeting);
      
      return updatedMeeting;
    } catch (error) {
      console.error('SupabaseMeetingService: Error updating meeting:', error);
      throw error;
    }
  }

  async delete(id) {
    try {
      console.log('SupabaseMeetingService: Deleting meeting with id:', id);
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Ensure tokens are loaded before making request
      await backendService.loadTokens();

      await backendService.deleteMeeting(id);
      
      console.log('SupabaseMeetingService: Meeting deleted successfully');
      
      return { success: true };
    } catch (error) {
      console.error('SupabaseMeetingService: Error deleting meeting:', error);
      throw error;
    }
  }

  async get(id) {
    try {
      console.log('SupabaseMeetingService: Getting meeting with id:', id);
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Ensure tokens are loaded before making request
      await backendService.loadTokens();

      const response = await backendService.getMeeting(id);
      const meeting = response.meeting;
      
      console.log('SupabaseMeetingService: Meeting retrieved:', meeting);
      
      return meeting;
    } catch (error) {
      console.error('SupabaseMeetingService: Error getting meeting:', error);
      
      // Handle authentication errors
      if (error.message.includes('Authentication failed') || error.message.includes('User not found')) {
        console.log('SupabaseMeetingService: Authentication failed, clearing auth state');
        await handleAuthError(error);
        this.isInitialized = false;
        return null;
      }
      
      // Handle rate limiting gracefully
      if (error.message.includes('HTTP 429')) {
        console.log('SupabaseMeetingService: Rate limited, returning null gracefully');
        return null;
      }
      
      return null;
    }
  }

  async getByDateRange(startDate, endDate) {
    try {
      console.log('SupabaseMeetingService: Getting meetings by date range:', startDate, 'to', endDate);
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Ensure tokens are loaded before making request
      await backendService.loadTokens();

      // Use the backend service to get meetings by date range
      const response = await backendService.makeRequest(`/meetings/range/${startDate}/${endDate}`);
      const meetings = response.meetings || [];
      
      console.log('SupabaseMeetingService: Retrieved meetings by range:', meetings.length);
      
      return meetings;
    } catch (error) {
      console.error('SupabaseMeetingService: Error getting meetings by range:', error);
      return [];
    }
  }

  // Helper method to check if service is available
  async isAvailable() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      // Ensure tokens are loaded
      await backendService.loadTokens();
      
      // Try to make a simple request to check if backend is available
      await backendService.healthCheck();
      return true;
    } catch (error) {
      console.log('SupabaseMeetingService: Service not available:', error.message);
      return false;
    }
  }

  // Schema definition for validation
  schema() {
    return {
      title: { type: 'string', required: true },
      date: { type: 'string', required: true },
      time: { type: 'string', required: true },
      duration: { type: 'number', default: 60 },
      description: { type: 'string' },
      location: { type: 'object' },
      participants: { type: 'array' },
      attachments: { type: 'array' }
    };
  }
}

// Export singleton instance
export const supabaseMeetingService = new SupabaseMeetingService();
export default supabaseMeetingService;
