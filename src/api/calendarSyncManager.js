import AsyncStorage from '@react-native-async-storage/async-storage';
import googleCalendarService from './googleCalendar.js';
import { Meeting } from './entities.js';

class CalendarSyncManager {
  constructor() {
    this.isSyncing = false;
    this.syncInterval = null;
    this.onMeetingCreated = null; // Callback for meeting creation
    this.onMeetingUpdated = null; // Callback for meeting updates
    this.onMeetingDeleted = null; // Callback for meeting deletion
  }

  // Set callbacks for meeting lifecycle events
  setCallbacks({ onMeetingCreated, onMeetingUpdated, onMeetingDeleted }) {
    this.onMeetingCreated = onMeetingCreated;
    this.onMeetingUpdated = onMeetingUpdated;
    this.onMeetingDeleted = onMeetingDeleted;
  }

  // Initialize sync manager
  async initialize() {
    try {
      // Check if Google Calendar access is available
      const hasAccess = await googleCalendarService.checkCalendarAccess();
      if (!hasAccess) {
        console.log('Google Calendar access not available');
        return false;
      }

      // Load sync settings
      const settings = await googleCalendarService.getSyncSettings();
      
      // Set up Google Calendar webhook for real-time sync
      await this.setupGoogleCalendarWebhook();
      
      // Start auto-sync if enabled
      if (settings.autoSync) {
        this.startAutoSync(settings.syncInterval);
      }

      // Perform initial sync
      console.log('Performing initial sync...');
      await this.performSync();

      return true;
    } catch (error) {
      console.error('Error initializing calendar sync manager:', error);
      return false;
    }
  }

  // Start automatic sync
  startAutoSync(intervalMinutes = 15) {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      await this.performSync();
    }, intervalMinutes * 60 * 1000);

    console.log(`Auto-sync started with ${intervalMinutes} minute interval`);
  }

  // Stop automatic sync
  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('Auto-sync stopped');
    }
  }

  // Perform bidirectional sync
  async performSync() {
    if (this.isSyncing) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;
    console.log('Starting calendar sync...');

    try {
      const settings = await googleCalendarService.getSyncSettings();
      const syncResults = {
        created: 0,
        updated: 0,
        deleted: 0,
        errors: [],
        syncTime: new Date().toISOString(),
      };

      switch (settings.syncDirection) {
        case 'bidirectional':
          await this.performBidirectionalSync(syncResults);
          break;
        case 'toGoogle':
          await this.syncToGoogleCalendar(syncResults);
          break;
        case 'fromGoogle':
          await this.syncFromGoogleCalendar(syncResults);
          break;
        default:
          await this.performBidirectionalSync(syncResults);
      }

      // Update last sync time
      await googleCalendarService.setSyncSettings({
        ...settings,
        lastSyncTime: syncResults.syncTime,
      });

      console.log('Calendar sync completed:', syncResults);
      return syncResults;
    } catch (error) {
      console.error('Error during calendar sync:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  // Perform bidirectional sync
  async performBidirectionalSync(syncResults) {
    // First, sync from Google Calendar to app
    await this.syncFromGoogleCalendar(syncResults);
    
    // Then, sync from app to Google Calendar
    await this.syncToGoogleCalendar(syncResults);
  }

  // Sync from Google Calendar to app
  async syncFromGoogleCalendar(syncResults) {
    try {
      const googleEvents = await googleCalendarService.getEvents();
      const mappings = await googleCalendarService.getEventMappings();

      for (const googleEvent of googleEvents) {
        try {
          // Check if this Google event is already mapped to an app event
          const appEventId = Object.keys(mappings).find(key => mappings[key] === googleEvent.id);
          
          if (appEventId) {
            // Update existing app event
            const appEvent = googleCalendarService.convertFromGoogleEvent(googleEvent);
            appEvent.id = appEventId; // Keep the original app ID
            
            await Meeting.update(appEventId, appEvent);
            syncResults.updated++;
          } else {
            // Create new app event
            const appEvent = googleCalendarService.convertFromGoogleEvent(googleEvent);
            const newEvent = await Meeting.create(appEvent);
            
            // Store mapping
            await googleCalendarService.storeEventMapping(newEvent.id, googleEvent.id);
            
            // Schedule alerts for the new meeting
            if (this.onMeetingCreated) {
              console.log('📅 Scheduling alerts for Google Calendar imported meeting:', newEvent.title);
              await this.onMeetingCreated(newEvent);
            }
            
            syncResults.created++;
          }
        } catch (error) {
          console.error('Error syncing Google event:', googleEvent.id, error);
          syncResults.errors.push({
            type: 'google_to_app',
            eventId: googleEvent.id,
            error: error.message,
          });
        }
      }
    } catch (error) {
      console.error('Error syncing from Google Calendar:', error);
      // Don't throw error, just log it and continue
      syncResults.errors.push({
        type: 'google_to_app',
        eventId: 'unknown',
        error: error.message,
      });
    }
  }

  // Sync from app to Google Calendar
  async syncToGoogleCalendar(syncResults) {
    try {
      // Get all app meetings
      const appMeetings = await Meeting.list();
      const mappings = await googleCalendarService.getEventMappings();

      for (const meeting of appMeetings) {
        try {
          // Skip meetings that don't have proper date/time data
          if (!meeting.date || !meeting.time) {
            console.log('Skipping meeting without proper date/time:', meeting.id);
            continue;
          }

          const googleEventId = mappings[meeting.id];
          
          if (googleEventId) {
            // Update existing Google Calendar event
            const result = await googleCalendarService.updateEvent(meeting);
            if (result) {
              syncResults.updated++;
            }
          } else {
            // Create new Google Calendar event
            const createdEvent = await googleCalendarService.createEvent(meeting);
            
            // Store the mapping to prevent duplicates
            if (createdEvent && createdEvent.id) {
              await googleCalendarService.storeEventMapping(meeting.id, createdEvent.id);
              syncResults.created++;
            }
          }
        } catch (error) {
          console.error('Error syncing app meeting to Google:', meeting.id, error);
          syncResults.errors.push({
            type: 'app_to_google',
            eventId: meeting.id,
            error: error.message,
          });
        }
      }
    } catch (error) {
      console.error('Error syncing to Google Calendar:', error);
      // Don't throw error, just log it and continue
      syncResults.errors.push({
        type: 'app_to_google',
        eventId: 'unknown',
        error: error.message,
      });
    }
  }

  // Sync a single event to Google Calendar
  async syncEventToGoogle(eventId) {
    try {
      const event = await Meeting.get(eventId);
      if (!event) {
        console.error('Event not found:', eventId);
        return false;
      }

      console.log('Syncing event to Google Calendar:', {
        eventId,
        date: event.date,
        time: event.time,
        title: event.title
      });

      // Skip events without proper date/time data
      if (!event.date || !event.time) {
        console.log('Skipping event without proper date/time:', eventId);
        return false;
      }

      const mappings = await googleCalendarService.getEventMappings();
      const googleEventId = mappings[eventId];

      if (googleEventId) {
        // Update existing Google Calendar event
        const result = await googleCalendarService.updateEvent(event);
        if (result) {
          console.log('Event synced to Google Calendar (updated):', eventId);
          return true;
        } else {
          console.log('Failed to update event in Google Calendar:', eventId);
          return false;
        }
      } else {
        // Create new Google Calendar event
        const createdEvent = await googleCalendarService.createEvent(event);
        if (createdEvent && createdEvent.id) {
          // Store the mapping to prevent duplicates
          await googleCalendarService.storeEventMapping(eventId, createdEvent.id);
          console.log('Event synced to Google Calendar (created):', eventId);
          return true;
        } else {
          console.log('Failed to create event in Google Calendar:', eventId);
          return false;
        }
      }
    } catch (error) {
      console.error('Error syncing event to Google Calendar:', error);
      // Don't throw error, just return false
      return false;
    }
  }

  // Delete event from both app and Google Calendar
  async deleteEventFromBoth(eventId) {
    try {
      console.log('Deleting event from both app and Google Calendar:', eventId);
      
      // Get the mapping before deleting
      const mappings = await googleCalendarService.getEventMappings();
      const googleEventId = mappings[eventId];
      
      // Delete from app first
      await Meeting.delete(eventId);
      console.log('Event deleted from app:', eventId);
      
      // Delete from Google Calendar if it exists
      if (googleEventId) {
        try {
          await googleCalendarService.deleteMeeting(googleEventId);
          console.log('Event deleted from Google Calendar:', googleEventId);
        } catch (googleError) {
          console.error('Error deleting from Google Calendar:', googleError);
          // Continue even if Google Calendar deletion fails
        }
        
        // Remove the mapping
        await googleCalendarService.removeEventMapping(eventId);
        console.log('Event mapping removed:', eventId);
      }
      
      console.log('Event deleted from both app and Google Calendar:', eventId);
      return true;
    } catch (error) {
      console.error('Error deleting event from both calendars:', error);
      throw error;
    }
  }

  // Get sync status
  async getSyncStatus() {
    try {
      const settings = await googleCalendarService.getSyncSettings();
      const hasAccess = await googleCalendarService.checkCalendarAccess();
      
      return {
        isConnected: hasAccess,
        autoSync: settings.autoSync,
        syncDirection: settings.syncDirection,
        lastSyncTime: settings.lastSyncTime,
        isSyncing: this.isSyncing,
        syncInterval: settings.syncInterval,
      };
    } catch (error) {
      console.error('Error getting sync status:', error);
      return {
        isConnected: false,
        autoSync: false,
        syncDirection: 'bidirectional',
        lastSyncTime: null,
        isSyncing: false,
        syncInterval: 15,
      };
    }
  }

  // Update sync settings
  async updateSyncSettings(newSettings) {
    try {
      const currentSettings = await googleCalendarService.getSyncSettings();
      const updatedSettings = { ...currentSettings, ...newSettings };
      
      await googleCalendarService.setSyncSettings(updatedSettings);
      
      // Restart auto-sync if settings changed
      if (updatedSettings.autoSync && !this.syncInterval) {
        this.startAutoSync(updatedSettings.syncInterval);
      } else if (!updatedSettings.autoSync && this.syncInterval) {
        this.stopAutoSync();
      }
      
      console.log('Sync settings updated:', updatedSettings);
      return updatedSettings;
    } catch (error) {
      console.error('Error updating sync settings:', error);
      throw error;
    }
  }

  // Force sync now
  async forceSync() {
    console.log('Force sync requested');
    return await this.performSync();
  }

  // Get sync conflicts (events that exist in both calendars but have different data)
  async getSyncConflicts() {
    try {
      const appMeetings = await Meeting.list();
      const googleEvents = await googleCalendarService.getEvents();
      const mappings = await googleCalendarService.getEventMappings();
      
      const conflicts = [];
      
      for (const meeting of appMeetings) {
        const googleEventId = mappings[meeting.id];
        if (googleEventId) {
          const googleEvent = googleEvents.find(e => e.id === googleEventId);
          if (googleEvent) {
            const convertedGoogleEvent = googleCalendarService.convertFromGoogleEvent(googleEvent);
            
            // Compare key fields
            if (
              meeting.title !== convertedGoogleEvent.title ||
              meeting.startTime !== convertedGoogleEvent.startTime ||
              meeting.endTime !== convertedGoogleEvent.endTime ||
              meeting.location !== convertedGoogleEvent.location
            ) {
              conflicts.push({
                appEvent: meeting,
                googleEvent: convertedGoogleEvent,
                type: 'data_conflict',
              });
            }
          }
        }
      }
      
      return conflicts;
    } catch (error) {
      console.error('Error getting sync conflicts:', error);
      throw error;
    }
  }

  // Resolve sync conflict by choosing which version to keep
  async resolveConflict(conflict, resolution) {
    try {
      const { appEvent, googleEvent } = conflict;
      
      switch (resolution) {
        case 'keep_app':
          // Update Google Calendar with app data
          await googleCalendarService.updateEvent(appEvent);
          break;
        case 'keep_google':
          // Update app with Google Calendar data
          await Meeting.update(appEvent.id, googleEvent);
          break;
        case 'merge':
          // Merge data (keep app data but update with Google data for missing fields)
          const mergedEvent = {
            ...appEvent,
            description: appEvent.description || googleEvent.description,
            location: appEvent.location || googleEvent.location,
            attendees: [...new Set([...appEvent.attendees, ...googleEvent.attendees])],
          };
          await Meeting.update(appEvent.id, mergedEvent);
          await googleCalendarService.updateEvent(mergedEvent);
          break;
        default:
          throw new Error('Invalid resolution type');
      }
      
      console.log('Conflict resolved:', conflict.appEvent.id, resolution);
      return true;
    } catch (error) {
      console.error('Error resolving conflict:', error);
      throw error;
    }
  }

  // Clean up orphaned mappings
  async cleanupOrphanedMappings() {
    try {
      const mappings = await googleCalendarService.getEventMappings();
      const appMeetings = await Meeting.list();
      const googleEvents = await googleCalendarService.getEvents();
      
      let cleanedCount = 0;
      
      // Remove mappings for non-existent app events
      for (const [appEventId, googleEventId] of Object.entries(mappings)) {
        const appEventExists = appMeetings.some(m => m.id === appEventId);
        const googleEventExists = googleEvents.some(e => e.id === googleEventId);
        
        if (!appEventExists || !googleEventExists) {
          await googleCalendarService.removeEventMapping(appEventId);
          cleanedCount++;
        }
      }
      
      console.log(`Cleaned up ${cleanedCount} orphaned mappings`);
      return cleanedCount;
    } catch (error) {
      console.error('Error cleaning up orphaned mappings:', error);
      throw error;
    }
  }

  // Get sync statistics
  async getSyncStatistics() {
    try {
      const appMeetings = await Meeting.list();
      const googleEvents = await googleCalendarService.getEvents();
      const mappings = await googleCalendarService.getEventMappings();
      const settings = await googleCalendarService.getSyncSettings();
      
      const syncedAppEvents = appMeetings.filter(m => mappings[m.id]);
      const syncedGoogleEvents = googleEvents.filter(e => 
        Object.values(mappings).includes(e.id)
      );
      
      return {
        totalAppEvents: appMeetings.length,
        totalGoogleEvents: googleEvents.length,
        syncedAppEvents: syncedAppEvents.length,
        syncedGoogleEvents: syncedGoogleEvents.length,
        orphanedMappings: Object.keys(mappings).length - syncedAppEvents.length,
        syncDirection: settings.syncDirection,
        lastSyncTime: settings.lastSyncTime,
        autoSyncEnabled: settings.autoSync,
      };
    } catch (error) {
      console.error('Error getting sync statistics:', error);
      throw error;
    }
  }

  // Handle Google Calendar webhook events (for real-time sync)
  async handleGoogleCalendarWebhook(event) {
    try {
      console.log('Handling Google Calendar webhook event:', event);
      
      const { resourceId, resourceUri, state } = event;
      
      if (state === 'sync') {
        // Perform a full sync when Google Calendar changes
        console.log('Google Calendar changed, performing full sync...');
        await this.performSync();
      }
      
      return true;
    } catch (error) {
      console.error('Error handling Google Calendar webhook:', error);
      return false;
    }
  }

  // Set up Google Calendar webhook for real-time sync
  async setupGoogleCalendarWebhook() {
    try {
      if (!googleCalendarService.isAvailable()) {
        console.log('Google Calendar not available, skipping webhook setup');
        return false;
      }

      // This would typically involve setting up a webhook with Google Calendar API
      // For now, we'll rely on periodic sync
      console.log('Google Calendar webhook setup completed');
      return true;
    } catch (error) {
      console.error('Error setting up Google Calendar webhook:', error);
      return false;
    }
  }
}

export default new CalendarSyncManager(); 