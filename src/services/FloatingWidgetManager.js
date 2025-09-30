import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Meeting } from '../api/entities';

class FloatingWidgetManager {
  constructor() {
    this.isEnabled = false;
    this.nextMeeting = null;
    this.appStateSubscription = null;
    this.updateInterval = null;
    this.callbacks = {
      onMeetingUpdate: null,
      onWidgetPress: null,
      onWidgetClose: null,
    };
  }

  async initialize() {
    try {
      console.log('🚀 Initializing Floating Widget Manager...');
      
      // Load widget settings
      const enabled = await AsyncStorage.getItem('floatingWidgetEnabled');
      this.isEnabled = enabled === 'true';
      
      // Listen for app state changes
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange.bind(this));
      
      // Start periodic updates
      this.startPeriodicUpdates();
      
      // Load initial meeting data
      await this.updateNextMeeting();
      
      console.log('✅ Floating Widget Manager initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Floating Widget Manager:', error);
      return false;
    }
  }

  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  async setEnabled(enabled) {
    this.isEnabled = enabled;
    await AsyncStorage.setItem('floatingWidgetEnabled', enabled.toString());
    
    if (enabled) {
      await this.updateNextMeeting();
    }
    
    console.log(`🔄 Floating widget ${enabled ? 'enabled' : 'disabled'}`);
  }

  async updateNextMeeting() {
    try {
      const meetings = await Meeting.list();
      const now = new Date();
      
      // Find the next upcoming meeting
      const upcomingMeetings = meetings
        .filter(meeting => {
          try {
            const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
            return meetingTime > now;
          } catch (error) {
            console.error('Invalid meeting time:', meeting.title, error);
            return false;
          }
        })
        .sort((a, b) => {
          const timeA = new Date(a.startTime || `${a.date}T${a.time}`);
          const timeB = new Date(b.startTime || `${b.date}T${b.time}`);
          return timeA - timeB;
        });

      const previousMeeting = this.nextMeeting;
      this.nextMeeting = upcomingMeetings.length > 0 ? upcomingMeetings[0] : null;
      
      // Only log if meeting changed
      if (!previousMeeting || !this.nextMeeting || previousMeeting.id !== this.nextMeeting.id) {
        console.log('📅 Next meeting updated:', this.nextMeeting?.title || 'None');
      }
      
      // Notify callback
      if (this.callbacks.onMeetingUpdate) {
        this.callbacks.onMeetingUpdate(this.nextMeeting);
      }
      
      return this.nextMeeting;
    } catch (error) {
      console.error('Error updating next meeting:', error);
      return null;
    }
  }

  startPeriodicUpdates() {
    // Update meeting data every 2 minutes
    this.updateInterval = setInterval(() => {
      this.updateNextMeeting();
    }, 2 * 60 * 1000);
  }

  stopPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  handleAppStateChange(nextAppState) {
    console.log('App state changed to:', nextAppState);
    
    // You can add logic here to show/hide widget based on app state
    // For now, we'll let the parent component handle visibility
  }

  handleWidgetPress() {
    console.log('🎯 Widget pressed');
    
    if (this.callbacks.onWidgetPress) {
      this.callbacks.onWidgetPress(this.nextMeeting);
    }
  }

  handleWidgetClose() {
    console.log('❌ Widget closed');
    
    if (this.callbacks.onWidgetClose) {
      this.callbacks.onWidgetClose();
    }
  }

  // Get widget data for rendering
  getWidgetData() {
    return {
      isEnabled: this.isEnabled,
      nextMeeting: this.nextMeeting,
      hasUpcomingMeeting: !!this.nextMeeting,
    };
  }

  // Get time until next meeting in milliseconds
  getTimeUntilNextMeeting() {
    if (!this.nextMeeting) return null;
    
    try {
      const now = new Date();
      const meetingTime = new Date(this.nextMeeting.startTime || `${this.nextMeeting.date}T${this.nextMeeting.time}`);
      return meetingTime - now;
    } catch (error) {
      console.error('Error calculating time until meeting:', error);
      return null;
    }
  }

  // Check if widget should be visible
  shouldShowWidget() {
    if (!this.isEnabled) return false;
    if (!this.nextMeeting) return false;
    
    const timeUntil = this.getTimeUntilNextMeeting();
    if (!timeUntil) return false;
    
    // Show widget if meeting is within 24 hours
    return timeUntil > 0 && timeUntil <= 24 * 60 * 60 * 1000;
  }

  // Get widget urgency level
  getWidgetUrgency() {
    const timeUntil = this.getTimeUntilNextMeeting();
    if (!timeUntil || timeUntil <= 0) return 'now';
    
    if (timeUntil <= 5 * 60 * 1000) return 'urgent'; // 5 minutes
    if (timeUntil <= 15 * 60 * 1000) return 'soon'; // 15 minutes
    if (timeUntil <= 60 * 60 * 1000) return 'upcoming'; // 1 hour
    return 'scheduled';
  }

  cleanup() {
    console.log('🧹 Cleaning up Floating Widget Manager...');
    
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    
    this.stopPeriodicUpdates();
    
    this.callbacks = {
      onMeetingUpdate: null,
      onWidgetPress: null,
      onWidgetClose: null,
    };
    
    console.log('✅ Floating Widget Manager cleaned up');
  }
}

export default new FloatingWidgetManager();
