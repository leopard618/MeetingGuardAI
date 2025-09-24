const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

// Helper function to create Google Calendar event
async function createGoogleCalendarEvent({ accessToken, meeting, userEmail }) {
  try {
    const startDateTime = new Date(`${meeting.date}T${meeting.time}`);
    const endDateTime = new Date(startDateTime.getTime() + meeting.duration * 60000);
    
    console.log('Creating Google Calendar event with:', {
      title: meeting.title,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      participantCount: meeting.participants?.length || 0,
      location: meeting.location,
      participantsRaw: meeting.participants
    });

    // Build attendees list from participants
    const attendees = [];
    if (meeting.participants && Array.isArray(meeting.participants)) {
      console.log('Processing participants for Google Calendar:', meeting.participants);
      
      meeting.participants.forEach((p, index) => {
        console.log(`Participant ${index}:`, {
          name: p.name,
          email: p.email,
          hasEmail: !!p.email,
          emailTrimmed: p.email?.trim()
        });
        
        if (p.email && p.email.trim()) {
          const attendee = {
            email: p.email.trim(),
            displayName: p.name || p.email.trim()
          };
          attendees.push(attendee);
          console.log(`Added attendee ${index}:`, attendee);
        } else {
          console.log(`Skipped participant ${index} - no valid email`);
        }
      });
    } else {
      console.log('No participants found or participants is not an array:', {
        participants: meeting.participants,
        isArray: Array.isArray(meeting.participants)
      });
    }

    console.log('Final Google Calendar attendees:', attendees);
    console.log('Attendees count:', attendees.length);

    // Build location and description based on meeting type
    let locationField = '';
    let descriptionParts = [meeting.description || ''];

    if (meeting.location) {
      const locationType = meeting.location.type || 'physical';
      const hasPhysicalLocation = meeting.location.address && meeting.location.address.trim();
      const hasVirtualLink = meeting.location.virtualLink && meeting.location.virtualLink.trim();
      
      console.log('Processing location:', {
        type: locationType,
        address: meeting.location.address,
        virtualLink: meeting.location.virtualLink,
        hasPhysicalLocation,
        hasVirtualLink
      });
      
      // Determine the primary location field based on what we have
      if (locationType === 'virtual') {
        // Pure virtual meeting
        locationField = `Virtual Meeting (${meeting.location.virtualPlatform || 'Online'})`;
      } else if (locationType === 'hybrid') {
        // Hybrid meeting - prioritize physical location in location field
        locationField = hasPhysicalLocation ? meeting.location.address : 'Hybrid Meeting';
      } else {
        // Physical meeting (but might have a generated meeting link)
        locationField = hasPhysicalLocation ? meeting.location.address : 'Physical Meeting';
      }
      
      // Add virtual meeting details to description if present
      if (hasVirtualLink) {
        descriptionParts.push(`\n🔗 Meeting Link: ${meeting.location.virtualLink}`);
        
        if (meeting.location.virtualPlatform) {
          descriptionParts.push(`📹 Platform: ${meeting.location.virtualPlatform}`);
        }
        
        // If this is a physical meeting with a generated link, explain it
        if (locationType === 'physical') {
          descriptionParts.push('\n💡 This physical meeting also has a virtual option available');
        }
      }
      
      // Add physical location to description for hybrid meetings
      if (locationType === 'hybrid' && hasPhysicalLocation) {
        descriptionParts.push(`📍 Physical Location: ${meeting.location.address}`);
        descriptionParts.push('\n🔄 This is a hybrid meeting - join either physically or virtually');
      }
    }

    // Add participants to description if we have them
    if (attendees.length > 0) {
      descriptionParts.push('\n👥 Participants:');
      attendees.forEach(attendee => {
        descriptionParts.push(`• ${attendee.displayName} (${attendee.email})`);
      });
    }

    const event = {
      summary: meeting.title,
      description: descriptionParts.filter(part => part.trim()).join('\n'),
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'UTC'
      },
      attendees: attendees,
      location: locationField || undefined,
      organizer: {
        email: userEmail
      }
    };

    console.log('Final Google Calendar event:', {
      summary: event.summary,
      location: event.location,
      attendeesCount: event.attendees.length,
      attendees: event.attendees,
      descriptionLength: event.description.length,
      description: event.description
    });

    console.log('Sending to Google Calendar API:', JSON.stringify(event, null, 2));

    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Google Calendar event created successfully:', {
        id: result.id,
        htmlLink: result.htmlLink,
        attendeesCount: result.attendees?.length || 0,
        attendeesFromResponse: result.attendees,
        location: result.location,
        description: result.description
      });
      return result;
    } else {
      const errorData = await response.json();
      console.error('Google Calendar API error:', errorData);
      console.error('Response status:', response.status);
      console.error('Response headers:', response.headers);
      return null;
    }
  } catch (error) {
    console.error('Error creating Google Calendar event:', error);
    return null;
  }
}

const router = express.Router();

/**
 * Get all meetings for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    console.log('Get meetings request:', {
      userId: req.userId,
      userEmail: req.user?.email
    });

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select(`
        *,
        participants:meeting_participants(*),
        attachments:meeting_attachments(*)
      `)
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    console.log('Get meetings database result:', {
      meetingsCount: meetings ? meetings.length : 0,
      error: error ? { code: error.code, message: error.message } : null
    });

    if (error) {
      throw error;
    }

    res.json({
      meetings: meetings || []
    });

  } catch (error) {
    console.error('Get meetings error:', error);
    res.status(500).json({
      error: 'Failed to get meetings',
      message: error.message
    });
  }
});

/**
 * Get a specific meeting by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log('Get meeting request:', {
      id: id,
      userId: req.userId,
      userEmail: req.user?.email
    });

    // First check if meeting exists for this user
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select(`
        *,
        participants:meeting_participants(*),
        attachments:meeting_attachments(*)
      `)
      .eq('id', id)
      .eq('user_id', req.userId)
      .limit(1);

    console.log('Get meeting database result:', {
      meetingsCount: meetings ? meetings.length : 0,
      error: error ? { code: error.code, message: error.message } : null,
      firstMeeting: meetings && meetings.length > 0 ? { id: meetings[0].id, title: meetings[0].title } : null
    });

    if (error) {
      console.log('Database error occurred:', error);
      throw error;
    }

    // Check if meeting was found
    if (!meetings || meetings.length === 0) {
      console.log('Meeting not found for user:', { id, userId: req.userId });
      return res.status(404).json({
        error: 'Meeting not found',
        message: 'The requested meeting does not exist or you do not have permission to access it'
      });
    }

    const meeting = meetings[0]; // Get the first (and only) meeting
    console.log('Meeting found successfully:', { id: meeting.id, title: meeting.title });
    
    res.json({
      meeting: meeting
    });

  } catch (error) {
    console.error('Get meeting error:', error);
    res.status(500).json({
      error: 'Failed to get meeting',
      message: error.message
    });
  }
});

/**
 * Create a new meeting
 */
router.post('/', [
  body('title').isString().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString().trim(),
  body('date').isISO8601(),
  body('time').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('duration').isInt({ min: 15, max: 480 }),
  body('location').optional().isObject(),
  body('participants').optional().isArray(),
  body('attachments').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const {
      title,
      description,
      date,
      time,
      duration,
      location,
      participants,
      attachments
    } = req.body;

    // Get user email for Google Calendar integration
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', req.userId)
      .single();

    if (userError || !user) {
      console.error('User not found for meeting creation:', userError);
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found. Please sign in again.'
      });
    }

    // Check for duplicate meetings first (same title, date, time for same user)
    const { data: existingMeetings, error: checkError } = await supabase
      .from('meetings')
      .select('id, title, date, time')
      .eq('user_id', req.userId)
      .eq('title', title)
      .eq('date', date)
      .eq('time', time);

    if (checkError) {
      console.error('Error checking for duplicate meetings:', checkError);
    } else if (existingMeetings && existingMeetings.length > 0) {
      console.log('Duplicate meeting detected:', {
        existingCount: existingMeetings.length,
        title,
        date,
        time
      });
      
      // Return the existing meeting instead of creating a duplicate
      const existingMeeting = existingMeetings[0];
      return res.status(200).json({
        meeting: existingMeeting,
        message: 'Meeting already exists (duplicate prevented)',
        isDuplicate: true
      });
    }

    // Create meeting only if no duplicate found
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .insert({
        user_id: req.userId,
        title,
        description,
        date,
        time,
        duration,
        location: location || null,
        status: 'scheduled'
      })
      .select()
      .single();

    if (meetingError) {
      throw meetingError;
    }

    // Add participants if provided
    if (participants && participants.length > 0) {
      console.log('Processing participants:', participants);
      
      const participantData = participants.map(p => ({
        meeting_id: meeting.id,
        user_id: req.userId, // Add user_id for the table requirement
        name: p.name || '',
        email: p.email || '',
        role: 'participant',
        status: 'invited'
      }));

      console.log('Participant data to insert:', participantData);

      const { error: participantError } = await supabase
        .from('meeting_participants')
        .insert(participantData);

      if (participantError) {
        console.error('Error adding participants:', participantError);
        console.error('Participant data that failed:', participantData);
        // Don't fail the meeting creation if participants fail
      } else {
        console.log('Participants added successfully:', participantData.length);
      }
    }

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      const attachmentData = attachments.map(a => ({
        meeting_id: meeting.id,
        file_id: a.file_id,
        name: a.name,
        type: a.type
      }));

      const { error: attachmentError } = await supabase
        .from('meeting_attachments')
        .insert(attachmentData);

      if (attachmentError) {
        console.error('Error adding attachments:', attachmentError);
      }
    }

    // Wait a moment to ensure participants and attachments are committed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get the complete meeting with participants and attachments
    const { data: completeMeeting, error: fetchError } = await supabase
      .from('meetings')
      .select(`
        *,
        participants:meeting_participants(*),
        attachments:meeting_attachments(*)
      `)
      .eq('id', meeting.id)
      .single();

    console.log('Complete meeting fetched:', {
      id: completeMeeting?.id,
      title: completeMeeting?.title,
      participantCount: completeMeeting?.participants?.length || 0,
      attachmentCount: completeMeeting?.attachments?.length || 0
    });

    if (fetchError) {
      throw fetchError;
    }

    // Try to create Google Calendar event if user has Google tokens
    try {
      console.log('🔍 Checking for Google tokens for user:', req.userId);
      
      const { data: userTokens, error: tokenError } = await supabase
        .from('user_tokens')
        .select('access_token, refresh_token, expires_at')
        .eq('user_id', req.userId)
        .eq('token_type', 'google')
        .single();

      console.log('🔑 Google tokens check result:', {
        hasTokens: !!userTokens,
        hasAccessToken: !!(userTokens?.access_token),
        hasRefreshToken: !!(userTokens?.refresh_token),
        expiresAt: userTokens?.expires_at,
        tokenError: tokenError?.message
      });

      if (tokenError) {
        console.log('❌ No Google tokens found for user:', tokenError.message);
        console.log('💡 User needs to connect Google Calendar in settings');
      } else if (!userTokens || !userTokens.access_token) {
        console.log('❌ Invalid or missing Google access token');
      } else {
        // Check if token is expired
        const now = new Date();
        const expiresAt = new Date(userTokens.expires_at);
        const isExpired = now >= expiresAt;
        
        console.log('⏰ Token expiry check:', {
          now: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          isExpired: isExpired
        });
        
        if (isExpired) {
          console.log('⚠️ Google access token is expired, attempting refresh...');
          
          // Try to refresh the token
          if (userTokens.refresh_token) {
            try {
              const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  client_id: process.env.GOOGLE_CLIENT_ID,
                  client_secret: process.env.GOOGLE_CLIENT_SECRET,
                  refresh_token: userTokens.refresh_token,
                  grant_type: 'refresh_token',
                }),
              });
              
              if (refreshResponse.ok) {
                const refreshData = await refreshResponse.json();
                console.log('✅ Token refreshed successfully');
                
                // Update tokens in database
                await supabase
                  .from('user_tokens')
                  .update({
                    access_token: refreshData.access_token,
                    expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
                  })
                  .eq('user_id', req.userId)
                  .eq('token_type', 'google');
                
                // Use new access token
                userTokens.access_token = refreshData.access_token;
              } else {
                const errorData = await refreshResponse.text();
                console.error('❌ Token refresh failed:', refreshResponse.status, errorData);
                throw new Error(`Token refresh failed: ${errorData}`);
              }
            } catch (refreshError) {
              console.error('❌ Error refreshing token:', refreshError);
              throw new Error(`Token refresh error: ${refreshError.message}`);
            }
          } else {
            throw new Error('No refresh token available - user needs to reconnect Google Calendar');
          }
        }
        
        console.log('✅ Valid Google access token available, creating calendar event for meeting:', meeting.id);
        
        // Prepare meeting data for Google Calendar with proper participant structure
        const meetingForGoogle = {
          ...completeMeeting,
          // Ensure participants are in the correct format for Google Calendar
          participants: completeMeeting.participants || []
        };

        console.log('Meeting data for Google Calendar:', {
          title: meetingForGoogle.title,
          participantCount: meetingForGoogle.participants.length,
          participants: meetingForGoogle.participants,
          location: meetingForGoogle.location
        });
        
        // Create Google Calendar event
        const googleEvent = await createGoogleCalendarEvent({
          accessToken: userTokens.access_token,
          meeting: meetingForGoogle,
          userEmail: user.email
        });
        
        if (googleEvent) {
          // Store Google event ID in calendar_events table
          await supabase
            .from('calendar_events')
            .insert({
              user_id: req.userId,
              google_event_id: googleEvent.id,
              title: completeMeeting.title,
              description: completeMeeting.description,
              start_time: new Date(`${completeMeeting.date}T${completeMeeting.time}`).toISOString(),
              end_time: new Date(new Date(`${completeMeeting.date}T${completeMeeting.time}`).getTime() + completeMeeting.duration * 60000).toISOString(),
              location: completeMeeting.location ? JSON.stringify(completeMeeting.location) : null,
              attendees: participants ? JSON.stringify(participants) : null,
              organizer: JSON.stringify({ email: user.email, name: user.name }),
              status: 'confirmed'
            });
          
          console.log('Google Calendar event created successfully:', googleEvent.id);
        } else {
          console.log('❌ Failed to create Google Calendar event');
        }
      }
    } catch (googleError) {
      console.error('❌ Error with Google Calendar integration:', googleError.message);
      console.log('💡 Meeting saved to database but not synced to Google Calendar');
      // Don't fail the meeting creation if Google Calendar fails
    }

    res.status(201).json({
      meeting: completeMeeting
    });

  } catch (error) {
    console.error('Create meeting error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to create meeting',
        message: error.message
      });
    }
  }
});

/**
 * Update a meeting
 */
router.put('/:id', [
  body('title').optional().isString().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString().trim(),
  body('date').optional().isISO8601(),
  body('time').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('duration').optional().isInt({ min: 15, max: 480 }),
  body('location').optional().isObject(),
  body('status').optional().isIn(['scheduled', 'in_progress', 'completed', 'cancelled'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { id } = req.params;
    const updateData = { ...req.body };

    // Check if meeting exists and belongs to user
    const { data: existingMeetings, error: checkError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.userId)
      .limit(1);

    if (checkError) {
      throw checkError;
    }

    if (!existingMeetings || existingMeetings.length === 0) {
      throw new NotFoundError('Meeting not found');
    }

    // Update meeting
    const { data: meeting, error: updateError } = await supabase
      .from('meetings')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json({
      meeting: meeting
    });

  } catch (error) {
    console.error('Update meeting error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else if (error.name === 'NotFoundError') {
      res.status(404).json({
        error: error.message
      });
    } else {
      res.status(500).json({
        error: 'Failed to update meeting',
        message: error.message
      });
    }
  }
});

/**
 * Delete a meeting
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if meeting exists and belongs to user
    const { data: existingMeetings, error: checkError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.userId)
      .limit(1);

    if (checkError) {
      throw checkError;
    }

    if (!existingMeetings || existingMeetings.length === 0) {
      throw new NotFoundError('Meeting not found');
    }

    // Delete meeting (cascade will handle participants and attachments)
    const { error: deleteError } = await supabase
      .from('meetings')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    res.json({
      message: 'Meeting deleted successfully'
    });

  } catch (error) {
    console.error('Delete meeting error:', error);
    if (error.name === 'NotFoundError') {
      res.status(404).json({
        error: error.message
      });
    } else {
      res.status(500).json({
        error: 'Failed to delete meeting',
        message: error.message
      });
    }
  }
});

/**
 * Get meetings by date range
 */
router.get('/range/:startDate/:endDate', async (req, res) => {
  try {
    const { startDate, endDate } = req.params;

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select(`
        *,
        participants:meeting_participants(*),
        attachments:meeting_attachments(*)
      `)
      .eq('user_id', req.userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('time', { ascending: true });

    if (error) {
      throw error;
    }

    res.json({
      meetings: meetings || []
    });

  } catch (error) {
    console.error('Get meetings by range error:', error);
    res.status(500).json({
      error: 'Failed to get meetings',
      message: error.message
    });
  }
});

module.exports = router;
