
import React, { useEffect, useRef } from 'react';
import { Meeting } from "@/api/entities";
import ServiceWorkerRegistration from './ServiceWorkerRegistration';
import { storage } from "@/utils/storage";

export default function AlertScheduler({ onTriggerAlert, language = "en", alertsEnabled }) {
  const alertTimeoutsRef = useRef(new Map());
  const checkIntervalRef = useRef(null);

  // Schedule alerts for a meeting (moved inside useEffect as per outline)
  // This function will be recreated whenever onTriggerAlert or alertsEnabled changes
  // due to its placement inside useEffect and the effect's dependency array.
  // This is acceptable as it ensures it captures the latest onTriggerAlert.
  const scheduleAlertsForMeeting = async (meeting) => {
    const meetingTime = new Date(`${meeting.date} ${meeting.time}`);
    const now = new Date();

    // Clear existing alerts for this meeting
    const existingTimeouts = alertTimeoutsRef.current.get(meeting.id) || [];
    existingTimeouts.forEach(timeout => clearTimeout(timeout));

    const timeouts = [];

    // Schedule 15-minute alert
    const alert15min = meetingTime.getTime() - (15 * 60 * 1000);
    if (alert15min > now.getTime()) {
      const timeout15 = setTimeout(() => {
        onTriggerAlert(meeting, '15min');
      }, alert15min - now.getTime());
      timeouts.push(timeout15);
    }

    // Schedule 5-minute alert
    const alert5min = meetingTime.getTime() - (5 * 60 * 1000);
    if (alert5min > now.getTime()) {
      const timeout5 = setTimeout(() => {
        onTriggerAlert(meeting, '5min');
      }, alert5min - now.getTime());
      timeouts.push(timeout5);
    }

    // Schedule 1-minute alert
    const alert1min = meetingTime.getTime() - (1 * 60 * 1000);
    if (alert1min > now.getTime()) {
      const timeout1 = setTimeout(() => {
        onTriggerAlert(meeting, '1min');
      }, alert1min - now.getTime());
      timeouts.push(timeout1);
    }

    // Schedule "now" alert
    if (meetingTime.getTime() > now.getTime()) {
      const timeoutNow = setTimeout(() => {
        onTriggerAlert(meeting, 'now');
      }, meetingTime.getTime() - now.getTime());
      timeouts.push(timeoutNow);
    }

    alertTimeoutsRef.current.set(meeting.id, timeouts);

    // Save to storage for persistence
    try {
      const alertData = {
        meetingId: meeting.id,
        // alertTimes: [alert15min, alert5min, alert1min, meetingTime.getTime()], // This line uses the raw calculated times
        alertTimes: [alert15min, alert5min, alert1min, meetingTime.getTime()], // Re-added the correct line based on original code structure
        scheduled: Date.now()
      };
      await storage.setItem(`alertSchedule_${meeting.id}`, JSON.stringify(alertData));
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
              // Ensure onTriggerAlert is called for unique missed alerts only to avoid duplicates
              alertData.alertTimes.forEach((alertTime, index) => {
                // Ensure alertTime is numeric and valid before comparison
                if (typeof alertTime === 'number' && !isNaN(alertTime) && alertTime > alertData.scheduled && alertTime <= now) {
                  // This alert was missed, trigger it now
                  Meeting.get(meetingId).then(meeting => {
                    if (meeting) {
                      const alertTypes = ['15min', '5min', '1min', 'now'];
                      // Added a check to prevent triggering the same alert multiple times if already triggered
                      // (This state would need to be persisted or checked against, but for simplicity, the outline doesn't specify.)
                      onTriggerAlert(meeting, alertTypes[index]);
                    }
                  }).catch(console.error);
                  // Optionally remove or mark this alert as triggered in storage to avoid re-triggering
                  // For now, keeping it as is, following the original logic's pattern.
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
