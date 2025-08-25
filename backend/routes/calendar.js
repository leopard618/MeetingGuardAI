const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Get user's Google Calendar events
 */
router.get('/events', async (req, res) => {
  try {
    const { startDate, endDate, maxResults = 50 } = req.query;

    // Get user's Google tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', req.userId)
      .eq('token_type', 'google')
      .single();

    if (tokenError || !tokens) {
      return res.status(401).json({
        error: 'Google Calendar not connected',
        message: 'Please connect your Google Calendar first'
      });
    }

    // Check if token is expired and refresh if needed
    let accessToken = tokens.access_token;
    if (new Date() > new Date(tokens.expires_at)) {
      if (!tokens.refresh_token) {
        return res.status(401).json({
          error: 'Google token expired',
          message: 'Please reconnect your Google Calendar'
        });
      }

      try {
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: tokens.refresh_token,
            grant_type: 'refresh_token',
          }),
        });

        if (!refreshResponse.ok) {
          throw new Error('Failed to refresh token');
        }

        const refreshData = await refreshResponse.json();
        accessToken = refreshData.access_token;

        // Update token in database
        await supabase
          .from('user_tokens')
          .update({
            access_token: refreshData.access_token,
            expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
          })
          .eq('user_id', req.userId)
          .eq('token_type', 'google');

      } catch (refreshError) {
        console.error('Token refresh error:', refreshError);
        return res.status(401).json({
          error: 'Failed to refresh Google token',
          message: 'Please reconnect your Google Calendar'
        });
      }
    }

    // Build Google Calendar API URL
    const calendarUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    calendarUrl.searchParams.append('timeMin', startDate || new Date().toISOString());
    calendarUrl.searchParams.append('timeMax', endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
    calendarUrl.searchParams.append('maxResults', maxResults);
    calendarUrl.searchParams.append('singleEvents', 'true');
    calendarUrl.searchParams.append('orderBy', 'startTime');

    // Fetch events from Google Calendar
    const response = await fetch(calendarUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const events = data.items || [];

    // Store events in our database for sync
    if (events.length > 0) {
      const eventData = events.map(event => ({
        user_id: req.userId,
        google_event_id: event.id,
        title: event.summary,
        description: event.description,
        start_time: event.start.dateTime || event.start.date,
        end_time: event.end.dateTime || event.end.date,
        location: event.location,
        attendees: event.attendees,
        organizer: event.organizer,
        status: event.status,
        created_at: event.created,
        updated_at: event.updated
      }));

      // Upsert events to avoid duplicates
      await supabase
        .from('calendar_events')
        .upsert(eventData, { onConflict: 'user_id,google_event_id' });
    }

    res.json({
      events: events,
      nextPageToken: data.nextPageToken
    });

  } catch (error) {
    console.error('Get calendar events error:', error);
    res.status(500).json({
      error: 'Failed to get calendar events',
      message: error.message
    });
  }
});

/**
 * Create a Google Calendar event
 */
router.post('/events', [
  body('title').isString().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString().trim(),
  body('startTime').isISO8601(),
  body('endTime').isISO8601(),
  body('location').optional().isString().trim(),
  body('attendees').optional().isArray(),
  body('reminders').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const {
      title,
      description,
      startTime,
      endTime,
      location,
      attendees,
      reminders
    } = req.body;

    // Get user's Google tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', req.userId)
      .eq('token_type', 'google')
      .single();

    if (tokenError || !tokens) {
      return res.status(401).json({
        error: 'Google Calendar not connected',
        message: 'Please connect your Google Calendar first'
      });
    }

    // Check if token is expired and refresh if needed
    let accessToken = tokens.access_token;
    if (new Date() > new Date(tokens.expires_at)) {
      if (!tokens.refresh_token) {
        return res.status(401).json({
          error: 'Google token expired',
          message: 'Please reconnect your Google Calendar'
        });
      }

      try {
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: tokens.refresh_token,
            grant_type: 'refresh_token',
          }),
        });

        if (!refreshResponse.ok) {
          throw new Error('Failed to refresh token');
        }

        const refreshData = await refreshResponse.json();
        accessToken = refreshData.access_token;

        // Update token in database
        await supabase
          .from('user_tokens')
          .update({
            access_token: refreshData.access_token,
            expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
          })
          .eq('user_id', req.userId)
          .eq('token_type', 'google');

      } catch (refreshError) {
        console.error('Token refresh error:', refreshError);
        return res.status(401).json({
          error: 'Failed to refresh Google token',
          message: 'Please reconnect your Google Calendar'
        });
      }
    }

    // Prepare event data for Google Calendar
    const eventData = {
      summary: title,
      description: description,
      start: {
        dateTime: startTime,
        timeZone: 'UTC'
      },
      end: {
        dateTime: endTime,
        timeZone: 'UTC'
      },
      location: location,
      attendees: attendees?.map(email => ({ email })) || [],
      reminders: reminders || {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 10 }
        ]
      }
    };

    // Create event in Google Calendar
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || response.statusText}`);
    }

    const event = await response.json();

    // Store event in our database
    const { error: dbError } = await supabase
      .from('calendar_events')
      .insert({
        user_id: req.userId,
        google_event_id: event.id,
        title: event.summary,
        description: event.description,
        start_time: event.start.dateTime || event.start.date,
        end_time: event.end.dateTime || event.end.date,
        location: event.location,
        attendees: event.attendees,
        organizer: event.organizer,
        status: event.status,
        created_at: event.created,
        updated_at: event.updated
      });

    if (dbError) {
      console.error('Error storing calendar event:', dbError);
    }

    res.status(201).json({
      event: event
    });

  } catch (error) {
    console.error('Create calendar event error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to create calendar event',
        message: error.message
      });
    }
  }
});

/**
 * Update a Google Calendar event
 */
router.put('/events/:eventId', [
  body('title').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString().trim(),
  body('startTime').optional().isISO8601(),
  body('endTime').optional().isISO8601(),
  body('location').optional().isString().trim(),
  body('attendees').optional().isArray(),
  body('reminders').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { eventId } = req.params;
    const updateData = { ...req.body };

    // Get user's Google tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', req.userId)
      .eq('token_type', 'google')
      .single();

    if (tokenError || !tokens) {
      return res.status(401).json({
        error: 'Google Calendar not connected',
        message: 'Please connect your Google Calendar first'
      });
    }

    // Check if token is expired and refresh if needed
    let accessToken = tokens.access_token;
    if (new Date() > new Date(tokens.expires_at)) {
      if (!tokens.refresh_token) {
        return res.status(401).json({
          error: 'Google token expired',
          message: 'Please reconnect your Google Calendar'
        });
      }

      try {
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: tokens.refresh_token,
            grant_type: 'refresh_token',
          }),
        });

        if (!refreshResponse.ok) {
          throw new Error('Failed to refresh token');
        }

        const refreshData = await refreshResponse.json();
        accessToken = refreshData.access_token;

        // Update token in database
        await supabase
          .from('user_tokens')
          .update({
            access_token: refreshData.access_token,
            expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
          })
          .eq('user_id', req.userId)
          .eq('token_type', 'google');

      } catch (refreshError) {
        console.error('Token refresh error:', refreshError);
        return res.status(401).json({
          error: 'Failed to refresh Google token',
          message: 'Please reconnect your Google Calendar'
        });
      }
    }

    // Prepare event data for Google Calendar
    const eventData = {};
    if (updateData.title) eventData.summary = updateData.title;
    if (updateData.description) eventData.description = updateData.description;
    if (updateData.startTime) eventData.start = { dateTime: updateData.startTime, timeZone: 'UTC' };
    if (updateData.endTime) eventData.end = { dateTime: updateData.endTime, timeZone: 'UTC' };
    if (updateData.location) eventData.location = updateData.location;
    if (updateData.attendees) eventData.attendees = updateData.attendees.map(email => ({ email }));
    if (updateData.reminders) eventData.reminders = updateData.reminders;

    // Update event in Google Calendar
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || response.statusText}`);
    }

    const event = await response.json();

    // Update event in our database
    const { error: dbError } = await supabase
      .from('calendar_events')
      .update({
        title: event.summary,
        description: event.description,
        start_time: event.start.dateTime || event.start.date,
        end_time: event.end.dateTime || event.end.date,
        location: event.location,
        attendees: event.attendees,
        organizer: event.organizer,
        status: event.status,
        updated_at: event.updated
      })
      .eq('user_id', req.userId)
      .eq('google_event_id', eventId);

    if (dbError) {
      console.error('Error updating calendar event:', dbError);
    }

    res.json({
      event: event
    });

  } catch (error) {
    console.error('Update calendar event error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to update calendar event',
        message: error.message
      });
    }
  }
});

/**
 * Delete a Google Calendar event
 */
router.delete('/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;

    // Get user's Google tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', req.userId)
      .eq('token_type', 'google')
      .single();

    if (tokenError || !tokens) {
      return res.status(401).json({
        error: 'Google Calendar not connected',
        message: 'Please connect your Google Calendar first'
      });
    }

    // Check if token is expired and refresh if needed
    let accessToken = tokens.access_token;
    if (new Date() > new Date(tokens.expires_at)) {
      if (!tokens.refresh_token) {
        return res.status(401).json({
          error: 'Google token expired',
          message: 'Please reconnect your Google Calendar'
        });
      }

      try {
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: tokens.refresh_token,
            grant_type: 'refresh_token',
          }),
        });

        if (!refreshResponse.ok) {
          throw new Error('Failed to refresh token');
        }

        const refreshData = await refreshResponse.json();
        accessToken = refreshData.access_token;

        // Update token in database
        await supabase
          .from('user_tokens')
          .update({
            access_token: refreshData.access_token,
            expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
          })
          .eq('user_id', req.userId)
          .eq('token_type', 'google');

      } catch (refreshError) {
        console.error('Token refresh error:', refreshError);
        return res.status(401).json({
          error: 'Failed to refresh Google token',
          message: 'Please reconnect your Google Calendar'
        });
      }
    }

    // Delete event from Google Calendar
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || response.statusText}`);
    }

    // Delete event from our database
    const { error: dbError } = await supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', req.userId)
      .eq('google_event_id', eventId);

    if (dbError) {
      console.error('Error deleting calendar event:', dbError);
    }

    res.json({
      message: 'Calendar event deleted successfully'
    });

  } catch (error) {
    console.error('Delete calendar event error:', error);
    res.status(500).json({
      error: 'Failed to delete calendar event',
      message: error.message
    });
  }
});

/**
 * Sync calendar events with local meetings
 */
router.post('/sync', async (req, res) => {
  try {
    // Get user's meetings and calendar events
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select('*')
      .eq('user_id', req.userId);

    const { data: calendarEvents, error: eventsError } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', req.userId);

    if (meetingsError || eventsError) {
      throw new Error('Failed to fetch data for sync');
    }

    // Simple sync logic - you can enhance this based on your needs
    const syncResult = {
      meetingsCount: meetings?.length || 0,
      calendarEventsCount: calendarEvents?.length || 0,
      synced: true
    };

    res.json({
      sync: syncResult
    });

  } catch (error) {
    console.error('Calendar sync error:', error);
    res.status(500).json({
      error: 'Failed to sync calendar',
      message: error.message
    });
  }
});

module.exports = router;
