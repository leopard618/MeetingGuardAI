
import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Meeting } from '../api/entities';
import ServiceWorkerRegistration from './ServiceWorkerRegistration';
import { storage } from '../utils/storage';
import { AlertIntensity } from '../utils/notificationUtils';

const AlertScheduler = forwardRef(({ onTriggerAlert, language = "en", alertsEnabled }, ref) => {
  const alertTimeoutsRef = useRef(new Map());
  const checkIntervalRef = useRef(null);

  // Expose function to manually schedule alerts for a specific meeting
  const scheduleAlertsForSpecificMeeting = async (meeting) => {
    if (!alertsEnabled) {
      console.log('Alerts disabled, skipping alert scheduling for meeting:', meeting.title);
      return;
    }
    
    console.log('📅 Manually scheduling alerts for meeting:', meeting.title);
    await scheduleAlertsForMeeting(meeting);
  };

  // Expose function to clear alerts for a specific meeting
  const clearAlertsForMeeting = async (meetingId) => {
    console.log('🗑️ Clearing alerts for meeting ID:', meetingId);
    
    // Clear timeouts
    const existingTimeouts = alertTimeoutsRef.current.get(meetingId) || [];
    existingTimeouts.forEach(timeout => clearTimeout(timeout));
    alertTimeoutsRef.current.delete(meetingId);
    
    // Clear from storage
    try {
      await storage.removeItem(`alertSchedule_${meetingId}`);
      console.log('✅ Cleared alert schedule from storage for meeting:', meetingId);
    } catch (error) {
      console.error('Failed to clear alert schedule from storage:', error);
    }
  };

  // Clear old alert schedules to prevent accumulation
  const clearOldAlertSchedules = async () => {
    try {
      const keys = await storage.getAllKeys();
      const now = Date.now();
      const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
      
      for (const key of keys) {
        if (key.startsWith('alertSchedule_')) {
          try {
            const alertDataStr = await storage.getItem(key);
            const alertData = JSON.parse(alertDataStr);
            
            // If the alert schedule is older than a week, remove it
            if (alertData.scheduled && alertData.scheduled < oneWeekAgo) {
              await storage.removeItem(key);
              console.log('🗑️ Removed old alert schedule:', key);
            }
          } catch (error) {
            // If we can't parse the data, remove it
            await storage.removeItem(key);
            console.log('🗑️ Removed malformed alert schedule:', key);
          }
        }
      }
    } catch (error) {
      console.error('Failed to clear old alert schedules:', error);
    }
  };

  // Load meetings and schedule alerts
  const loadAndScheduleMeetings = async () => {
    try {
      // First, clear old alert schedules
      await clearOldAlertSchedules();
      
      const meetings = await Meeting.list();
      const now = new Date();
      const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Filter meetings for the next week (to catch 1-day advance alerts)
      const upcomingMeetings = meetings.filter(meeting => {
        try {
          // Handle different date formats
          let meetingDate;
          if (meeting.date.includes('T')) {
            // ISO format
            meetingDate = new Date(meeting.date);
          } else {
            // YYYY-MM-DD format
            meetingDate = new Date(meeting.date + 'T00:00:00');
          }
          
          // Check if date is valid
          if (isNaN(meetingDate.getTime())) {
            console.log('Invalid date for meeting:', meeting.title, meeting.date);
            return false;
          }
          
          // Only include meetings from today onwards (don't include past meetings)
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const isUpcoming = meetingDate >= today && meetingDate <= oneWeekFromNow;
          
          if (isUpcoming) {
            console.log('Meeting scheduled for alerts:', meeting.title, 'Date:', meeting.date, 'Parsed:', meetingDate.toISOString());
          }
          
          return isUpcoming;
        } catch (error) {
          console.error('Error parsing meeting date:', meeting.title, meeting.date, error);
          return false;
        }
      });

      console.log(`📅 Found ${upcomingMeetings.length} meetings to schedule alerts for`);
      for (const meeting of upcomingMeetings) {
        await scheduleAlertsForMeeting(meeting);
      }
    } catch (error) {
      console.error('Failed to load meetings for alerts:', error);
    }
  };

  // Create a wrapper function for refreshing alerts
  const refreshAlerts = async () => {
    if (!alertsEnabled) {
      console.log('Alerts disabled, skipping refresh');
      return;
    }
    await loadAndScheduleMeetings();
  };

  // Schedule alerts for a meeting with multiple timing options
  const scheduleAlertsForMeeting = async (meeting) => {
    try {
      // Parse meeting date and time properly
      let meetingTime;
      if (meeting.date.includes('T')) {
        // ISO format
        meetingTime = new Date(meeting.date);
      } else {
        // YYYY-MM-DD format - combine with time
        const timeStr = meeting.time || '00:00';
        meetingTime = new Date(`${meeting.date}T${timeStr}:00`);
      }
      
      // Validate the meeting time
      if (isNaN(meetingTime.getTime())) {
        console.error('Invalid meeting time for:', meeting.title, meeting.date, meeting.time);
        return;
      }
      
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
    } catch (error) {
      console.error('Error scheduling alerts for meeting:', meeting.title, error);
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

              // Initialize triggered alerts array if it doesn't exist
              if (!alertData.triggeredAlerts) {
                alertData.triggeredAlerts = [];
              }

              // Check if any alert time has passed and hasn't been triggered yet
              alertData.alertTimes.forEach((alertTime, index) => {
                // Ensure alertTime is numeric and valid before comparison
                if (typeof alertTime === 'number' && !isNaN(alertTime) && alertTime > alertData.scheduled && alertTime <= now) {
                  // Check if this alert has already been triggered
                  const alertKey = `${meetingId}_${index}_${alertTime}`;
                  if (!alertData.triggeredAlerts.includes(alertKey)) {
                    // This alert was missed and hasn't been triggered yet, trigger it now
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
                        
                        // Mark this alert as triggered
                        alertData.triggeredAlerts.push(alertKey);
                        
                        // Save the updated alert data back to storage
                        storage.setItem(key, JSON.stringify(alertData)).catch(console.error);
                      }
                    }).catch(console.error);
                  }
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

    // Set up periodic checking every 5 minutes only if not already running
    if (!checkIntervalRef.current) {
      checkIntervalRef.current = setInterval(async () => {
        if (alertsEnabled) { // Only run if alerts are currently enabled
          await checkMissedAlerts();
          await loadAndScheduleMeetings(); // Refresh schedules to catch new/updated meetings
        }
      }, 5 * 60 * 1000); // Check every 5 minutes instead of every minute
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

  // Expose functions to parent components
  useImperativeHandle(ref, () => ({
    scheduleAlertsForMeeting: scheduleAlertsForSpecificMeeting,
    clearAlertsForMeeting: clearAlertsForMeeting,
    refreshAlerts: refreshAlerts
  }));

  // Only render ServiceWorkerRegistration if alerts are enabled
  return alertsEnabled ? <ServiceWorkerRegistration /> : null;
});

export default AlertScheduler;
