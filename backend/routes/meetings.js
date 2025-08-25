const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Get all meetings for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select(`
        *,
        participants:meeting_participants(*),
        attachments:meeting_attachments(*)
      `)
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

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

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select(`
        *,
        participants:meeting_participants(*),
        attachments:meeting_attachments(*)
      `)
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundError('Meeting not found');
      }
      throw error;
    }

    res.json({
      meeting: meeting
    });

  } catch (error) {
    console.error('Get meeting error:', error);
    if (error.name === 'NotFoundError') {
      res.status(404).json({
        error: error.message
      });
    } else {
      res.status(500).json({
        error: 'Failed to get meeting',
        message: error.message
      });
    }
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

    // Create meeting
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
      const participantData = participants.map(p => ({
        meeting_id: meeting.id,
        name: p.name,
        email: p.email
      }));

      const { error: participantError } = await supabase
        .from('meeting_participants')
        .insert(participantData);

      if (participantError) {
        console.error('Error adding participants:', participantError);
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

    if (fetchError) {
      throw fetchError;
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
    const { data: existingMeeting, error: checkError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        throw new NotFoundError('Meeting not found');
      }
      throw checkError;
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
    const { data: existingMeeting, error: checkError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        throw new NotFoundError('Meeting not found');
      }
      throw checkError;
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
