/**
 * React Hook for Persistent Notification
 * Manages persistent notification based on app state and next meeting
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import PersistentNotificationService from '../services/PersistentNotificationService';

export const usePersistentNotification = (nextMeeting) => {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Initialize persistent notification service
    PersistentNotificationService.initialize();

    // Show notification immediately on mount (always visible mode)
    console.log('🔔 Initializing always-visible persistent notification');
    PersistentNotificationService.showPersistentNotification(nextMeeting);

    // Set up app state listener (but don't hide on active anymore)
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      console.log(`📱 App state changed: ${appState.current} → ${nextAppState}`);
      
      // Update notification on any state change (keep it always visible)
      console.log('📱 App state changed - updating persistent notification');
      await PersistentNotificationService.showPersistentNotification(nextMeeting);

      appState.current = nextAppState;
    });

    // Cleanup
    return () => {
      subscription?.remove();
      PersistentNotificationService.cleanup();
    };
  }, []);

  // Update notification when next meeting changes (always show, even if null)
  useEffect(() => {
    console.log('🔔 Next meeting changed, updating notification (always-visible mode)');
    // Always show notification, whether meeting exists or not
    PersistentNotificationService.showPersistentNotification(nextMeeting);
  }, [nextMeeting]);

  return {
    show: (meeting) => PersistentNotificationService.showPersistentNotification(meeting),
    hide: () => PersistentNotificationService.hidePersistentNotification(),
    isActive: () => PersistentNotificationService.isNotificationActive(),
  };
};

export default usePersistentNotification;

