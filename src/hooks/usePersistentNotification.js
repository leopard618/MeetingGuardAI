/**
 * React Hook for Persistent Notification
 * Manages persistent notification based on app state and next meeting
 * ONLY shows notification when app is in background/inactive, NOT when active
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import PersistentNotificationService from '../services/PersistentNotificationService';

export const usePersistentNotification = (nextMeeting) => {
  const appState = useRef(AppState.currentState);
  const meetingRef = useRef(nextMeeting);

  // Update meeting ref when it changes
  useEffect(() => {
    meetingRef.current = nextMeeting;
  }, [nextMeeting]);

  useEffect(() => {
    // Initialize persistent notification service
    PersistentNotificationService.initialize();

    // DON'T show on mount - only when app goes to background
    console.log('🔔 Persistent notification service initialized (will show when app minimized)');

    // Set up app state listener
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      console.log(`📱 App state changed: ${appState.current} → ${nextAppState}`);
      
      // ONLY show notification when app goes to background or inactive
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('📱 App minimized - showing persistent notification in tray');
        await PersistentNotificationService.showPersistentNotification(meetingRef.current);
      } 
      // Hide notification when app becomes active (foreground)
      else if (nextAppState === 'active') {
        console.log('📱 App active - hiding persistent notification');
        await PersistentNotificationService.hidePersistentNotification();
      }

      appState.current = nextAppState;
    });

    // Cleanup
    return () => {
      subscription?.remove();
      PersistentNotificationService.cleanup();
    };
  }, []);

  return {
    show: (meeting) => PersistentNotificationService.showPersistentNotification(meeting),
    hide: () => PersistentNotificationService.hidePersistentNotification(),
    isActive: () => PersistentNotificationService.isNotificationActive(),
  };
};

export default usePersistentNotification;

