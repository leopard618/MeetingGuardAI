const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { supabase } = require('../config/database');

// Store push notification token for a user
router.post('/register-token', authenticateToken, async (req, res) => {
  try {
    const { pushToken, platform, deviceId } = req.body;
    const userId = req.user.id;

    if (!pushToken) {
      return res.status(400).json({ error: 'Push token is required' });
    }

    // Store or update the push token in the database
    const { data, error } = await supabase
      .from('user_push_tokens')
      .upsert({
        user_id: userId,
        push_token: pushToken,
        platform: platform || 'unknown',
        device_id: deviceId,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,device_id'
      });

    if (error) {
      console.error('Error storing push token:', error);
      return res.status(500).json({ error: 'Failed to store push token' });
    }

    console.log(`✅ Stored push token for user ${userId} on ${platform}`);
    res.json({ success: true, message: 'Push token registered successfully' });
  } catch (error) {
    console.error('Error in register-token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Schedule push notifications for a meeting
router.post('/schedule-meeting', authenticateToken, async (req, res) => {
  try {
    const { meeting, pushToken } = req.body;
    const userId = req.user.id;

    if (!meeting || !pushToken) {
      return res.status(400).json({ error: 'Meeting and push token are required' });
    }

    // Store scheduled notification in database for server-side processing
    const meetingTime = new Date(meeting.startTime || `${meeting.date}T${meeting.time}`);
    
    // Define alert schedule
    const alertSchedule = [
      { type: '1day', offset: 24 * 60 * 60 * 1000 },
      { type: '1hour', offset: 60 * 60 * 1000 },
      { type: '15min', offset: 15 * 60 * 1000 },
      { type: '5min', offset: 5 * 60 * 1000 },
      { type: '1min', offset: 1 * 60 * 1000 },
      { type: 'now', offset: 0 },
    ];

    const scheduledNotifications = [];

    for (const alert of alertSchedule) {
      const triggerTime = new Date(meetingTime.getTime() - alert.offset);
      
      if (triggerTime > new Date()) {
        scheduledNotifications.push({
          user_id: userId,
          meeting_id: meeting.id,
          push_token: pushToken,
          alert_type: alert.type,
          trigger_time: triggerTime.toISOString(),
          meeting_data: JSON.stringify(meeting),
          status: 'scheduled',
          created_at: new Date().toISOString(),
        });
      }
    }

    if (scheduledNotifications.length > 0) {
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .insert(scheduledNotifications);

      if (error) {
        console.error('Error scheduling notifications:', error);
        return res.status(500).json({ error: 'Failed to schedule notifications' });
      }

      console.log(`✅ Scheduled ${scheduledNotifications.length} notifications for meeting: ${meeting.title}`);
    }

    res.json({ 
      success: true, 
      scheduled: scheduledNotifications.length,
      message: `Scheduled ${scheduledNotifications.length} notifications` 
    });
  } catch (error) {
    console.error('Error in schedule-meeting:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel push notifications for a meeting
router.post('/cancel-meeting', authenticateToken, async (req, res) => {
  try {
    const { meetingId } = req.body;
    const userId = req.user.id;

    if (!meetingId) {
      return res.status(400).json({ error: 'Meeting ID is required' });
    }

    // Mark notifications as cancelled
    const { data, error } = await supabase
      .from('scheduled_notifications')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('meeting_id', meetingId)
      .eq('status', 'scheduled');

    if (error) {
      console.error('Error cancelling notifications:', error);
      return res.status(500).json({ error: 'Failed to cancel notifications' });
    }

    console.log(`✅ Cancelled notifications for meeting: ${meetingId}`);
    res.json({ success: true, message: 'Notifications cancelled successfully' });
  } catch (error) {
    console.error('Error in cancel-meeting:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get notification status for user
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's push tokens
    const { data: tokens, error: tokensError } = await supabase
      .from('user_push_tokens')
      .select('*')
      .eq('user_id', userId);

    if (tokensError) {
      console.error('Error fetching push tokens:', tokensError);
    }

    // Get scheduled notifications count
    const { data: notifications, error: notificationsError } = await supabase
      .from('scheduled_notifications')
      .select('id, alert_type, trigger_time, meeting_data')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('trigger_time', new Date().toISOString())
      .order('trigger_time', { ascending: true })
      .limit(20);

    if (notificationsError) {
      console.error('Error fetching notifications:', notificationsError);
    }

    res.json({
      success: true,
      pushTokens: tokens || [],
      scheduledNotifications: notifications || [],
      scheduledCount: notifications?.length || 0,
    });
  } catch (error) {
    console.error('Error in notification status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
