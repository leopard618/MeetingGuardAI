const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { ValidationError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Get user preferences
 */
router.get('/preferences', async (req, res) => {
  try {
    const { data: preferences, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json({
      preferences: preferences || {}
    });

  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({
      error: 'Failed to get preferences',
      message: error.message
    });
  }
});

/**
 * Update user preferences
 */
router.put('/preferences', [
  body('theme').optional().isIn(['light', 'dark', 'auto']),
  body('notifications').optional().isBoolean(),
  body('calendarSync').optional().isBoolean(),
  body('defaultMeetingDuration').optional().isInt({ min: 15, max: 480 }),
  body('timezone').optional().isString(),
  body('language').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const updateData = { ...req.body };

    // Check if preferences exist
    const { data: existingPreferences, error: checkError } = await supabase
      .from('user_preferences')
      .select('id')
      .eq('user_id', req.userId)
      .single();

    let preferences;
    if (checkError && checkError.code === 'PGRST116') {
      // Create new preferences
      const { data: newPreferences, error: createError } = await supabase
        .from('user_preferences')
        .insert({
          user_id: req.userId,
          ...updateData
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }
      preferences = newPreferences;
    } else {
      // Update existing preferences
      const { data: updatedPreferences, error: updateError } = await supabase
        .from('user_preferences')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', req.userId)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }
      preferences = updatedPreferences;
    }

    res.json({
      preferences: preferences
    });

  } catch (error) {
    console.error('Update preferences error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to update preferences',
        message: error.message
      });
    }
  }
});

/**
 * Get user statistics
 */
router.get('/stats', async (req, res) => {
  try {
    // Get meetings count
    const { count: meetingsCount, error: meetingsError } = await supabase
      .from('meetings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    // Get calendar events count
    const { count: eventsCount, error: eventsError } = await supabase
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    // Get files count
    const { count: filesCount, error: filesError } = await supabase
      .from('files')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    if (meetingsError || eventsError || filesError) {
      throw new Error('Failed to fetch statistics');
    }

    res.json({
      stats: {
        meetings: meetingsCount || 0,
        calendarEvents: eventsCount || 0,
        files: filesCount || 0
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'Failed to get statistics',
      message: error.message
    });
  }
});

/**
 * Delete user account
 */
router.delete('/account', async (req, res) => {
  try {
    // Delete user's data (cascade will handle related records)
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', req.userId);

    if (error) {
      throw error;
    }

    res.json({
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      error: 'Failed to delete account',
      message: error.message
    });
  }
});

module.exports = router;
