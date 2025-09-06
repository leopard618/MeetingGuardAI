
import React, { useEffect, useRef } from 'react';
import { Meeting } from "@/api/entities";
import ServiceWorkerRegistration from './ServiceWorkerRegistration';
import { storage } from "@/utils/storage";
import { AlertIntensity } from '@/utils/notificationUtils';

export default function AlertScheduler({ onTriggerAlert, language = "en", alertsEnabled }) {
  const alertTimeoutsRef = useRef(new Map());
  const checkIntervalRef = useRef(null);

  // Schedule alerts for a meeting with multiple timing options
  const scheduleAlertsForMeeting = async (meeting) => {
    const meetingTime = new Date(`${meeting.date} ${meeting.time}`);
    const now = new Date();

    // Clear existing alerts for this meeting
    const existingTimeouts = alertTimeoutsRef.current.get(meeting.id) || [];
    existingTimeouts.forEach(timeout => clearTimeout(timeout));

    const timeouts = [];
    const alertTimes = [];

    // Enhanced alert schedule with multiple timings
    const alertSchedule = [
      // 1 day before (Light intensity)
      { time: 24 * 60 * 60 * 1000, type: '1day', intensity: AlertIntensity.LIGHT },
      // 1 hour before (Medium intensity)
      { time: 60 * 60 * 1000, type: '1hour', intensity: AlertIntensity.MEDIUM },
      // 15 minutes before (Medium intensity)
      { time: 15 * 60 * 1000, type: '15min', intensity: AlertIntensity.MEDIUM },
      // 5 minutes before (Maximum intensity)
      { time: 5 * 60 * 1000, type: '5min', intensity: AlertIntensity.MAXIMUM },
      // 1 minute before (Maximum intensity)
      { time: 1 * 60 * 1000, type: '1min', intensity: AlertIntensity.MAXIMUM },
      // Meeting time (Maximum intensity)
      { time: 0, type: 'now', intensity: AlertIntensity.MAXIMUM }
    ];

    // Schedule all alerts
    alertSchedule.forEach(({ time, type, intensity }) => {
      const alertTime = meetingTime.getTime() - time;
      
      if (alertTime > now.getTime()) {
        const timeout = setTimeout(() => {
          console.log(`🔔 Alert triggered: ${type} for meeting ${meeting.title}`);
          onTriggerAlert(meeting, type, intensity);
        }, alertTime - now.getTime());
        
        timeouts.push(timeout);
        alertTimes.push(alertTime);
      }
    });

    alertTimeoutsRef.current.set(meeting.id, timeouts);

    // Save to storage for persistence
    try {
      const alertData = {
        meetingId: meeting.id,
        alertTimes: alertTimes,
        alertTypes: alertSchedule.map(s => s.type),
        scheduled: Date.now()
      };
      await storage.setItem(`alertSchedule_${meeting.id}`, JSON.stringify(alertData));
      console.log(`📅 Scheduled ${timeouts.length} alerts for meeting: ${meeting.title}`);
    } catch (error) {
      console.error('Failed to save alert schedule:', error);
    }
  };

  useEffect(() => {
    // Clear all scheduled alerts if alerts are disabled
    if (!alertsEnabled) {
      alertTimeoutsRef.current.forEach(timeouts => {
        timeouts.forEach(timeout => clearTimeout(timeout));
      });
      alertTimeoutsRef.current.clear(); // Clear the map itself
      // Also clear interval if it exists
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      return; // Exit early if alerts are disabled
    }

    // Load meetings and schedule alerts
    const loadAndScheduleMeetings = async () => {
      try {
        const meetings = await Meeting.list();
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Filter meetings for today and tomorrow
        const upcomingMeetings = meetings.filter(meeting =>
          meeting.date === today || meeting.date === tomorrow
        );

        for (const meeting of upcomingMeetings) {
          await scheduleAlertsForMeeting(meeting);
        }
      } catch (error) {
        console.error('Failed to load meetings for alerts:', error);
      }
    };

    const checkMissedAlerts = async () => {
      const now = Date.now();

      try {
        const keys = await storage.getAllKeys();
        for (const key of keys) {
          if (key.startsWith('alertSchedule_')) {
            try {
              const alertDataStr = await storage.getItem(key);
              const alertData = JSON.parse(alertDataStr);
              const meetingId = alertData.meetingId;

              // Check if any alert time has passed
              alertData.alertTimes.forEach((alertTime, index) => {
                // Ensure alertTime is numeric and valid before comparison
                if (typeof alertTime === 'number' && !isNaN(alertTime) && alertTime > alertData.scheduled && alertTime <= now) {
                  // This alert was missed, trigger it now
                  Meeting.get(meetingId).then(meeting => {
                    if (meeting) {
                      // Use the stored alert types or fallback to new format
                      const alertTypes = alertData.alertTypes || ['1day', '1hour', '15min', '5min', '1min', 'now'];
                      const alertType = alertTypes[index] || 'unknown';
                      
                      // Determine intensity based on alert type
                      let intensity = AlertIntensity.MAXIMUM;
                      if (alertType === '1day') intensity = AlertIntensity.LIGHT;
                      else if (alertType === '1hour' || alertType === '15min') intensity = AlertIntensity.MEDIUM;
                      
                      console.log(`🔔 Triggering missed alert: ${alertType} for meeting ${meeting.title}`);
                      onTriggerAlert(meeting, alertType, intensity);
                    }
                  }).catch(console.error);
                }
              });
            } catch (error) {
              console.error('Failed to parse or check alert schedule from storage:', error);
              // Optionally, remove malformed item from storage to prevent repeated errors
              await storage.removeItem(key);
            }
          }
        }
      } catch (error) {
        console.error('Failed to check missed alerts:', error);
      }
    };

    loadAndScheduleMeetings(); // Initial load and schedule

    checkMissedAlerts(); // Initial check for missed alerts

    // Set up periodic checking every minute only if not already running
    if (!checkIntervalRef.current) {
      checkIntervalRef.current = setInterval(async () => {
        if (alertsEnabled) { // Only run if alerts are currently enabled
          await checkMissedAlerts();
          await loadAndScheduleMeetings(); // Refresh schedules to catch new/updated meetings
        }
      }, 60 * 1000); // Check every minute
    }

    return () => {
      // Cleanup all timeouts when component unmounts or dependencies change
      alertTimeoutsRef.current.forEach(timeouts => {
        timeouts.forEach(timeout => clearTimeout(timeout));
      });
      alertTimeoutsRef.current.clear(); // Clear the map itself

      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null; // Reset the ref
      }
    };
  }, [onTriggerAlert, alertsEnabled]); // Re-run effect if onTriggerAlert or alertsEnabled changes

  // Only render ServiceWorkerRegistration if alerts are enabled
  return alertsEnabled ? <ServiceWorkerRegistration /> : null;
}
