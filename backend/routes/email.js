// Email Routes
// Handles meeting invitation emails

const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const { body, validationResult } = require('express-validator');

/**
 * Send meeting invitations
 * POST /api/email/send-invitations
 */
router.post('/send-invitations', [
  body('meetingData').isObject().withMessage('Meeting data is required'),
  body('meetingData.title').notEmpty().withMessage('Meeting title is required'),
  body('meetingData.date').isISO8601().withMessage('Valid meeting date is required'),
  body('meetingData.time').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid meeting time is required'),
  body('participants').isArray({ min: 1 }).withMessage('At least one participant is required'),
  body('participants.*.email').isEmail().withMessage('Valid participant email is required'),
  body('participants.*.name').notEmpty().withMessage('Participant name is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { meetingData, participants } = req.body;

    console.log(`📧 Sending meeting invitations for: ${meetingData.title}`);
    console.log(`👥 Participants: ${participants.length}`);

    // Send bulk invitations
    const result = await emailService.sendBulkInvitations(meetingData, participants);

    if (result.success) {
      console.log(`✅ Successfully sent ${result.sent} invitations`);
      if (result.failed > 0) {
        console.log(`⚠️ Failed to send ${result.failed} invitations`);
      }
    } else {
      console.log(`❌ Failed to send any invitations`);
    }

    res.json({
      success: result.success,
      message: `Sent ${result.sent} invitations successfully${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
      sent: result.sent,
      failed: result.failed,
      results: result.results,
      errors: result.errors
    });

  } catch (error) {
    console.error('❌ Error sending meeting invitations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send meeting invitations',
      message: error.message
    });
  }
});

/**
 * Send single meeting invitation
 * POST /api/email/send-invitation
 */
router.post('/send-invitation', [
  body('meetingData').isObject().withMessage('Meeting data is required'),
  body('meetingData.title').notEmpty().withMessage('Meeting title is required'),
  body('meetingData.date').isISO8601().withMessage('Valid meeting date is required'),
  body('meetingData.time').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid meeting time is required'),
  body('participant.email').isEmail().withMessage('Valid participant email is required'),
  body('participant.name').notEmpty().withMessage('Participant name is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { meetingData, participant } = req.body;

    console.log(`📧 Sending meeting invitation to: ${participant.email}`);

    // Send single invitation
    const result = await emailService.sendMeetingInvitation(meetingData, participant);

    console.log(`✅ Successfully sent invitation to ${participant.email}`);

    res.json({
      success: true,
      message: `Invitation sent to ${participant.email}`,
      messageId: result.messageId,
      recipient: result.recipient
    });

  } catch (error) {
    console.error(`❌ Error sending invitation to ${req.body.participant?.email}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to send meeting invitation',
      message: error.message
    });
  }
});

/**
 * Test email service
 * POST /api/email/test
 */
router.post('/test', async (req, res) => {
  try {
    console.log('🧪 Testing email service...');

    const result = await emailService.testEmailService();

    console.log('✅ Email service test successful');

    res.json({
      success: true,
      message: 'Email service is working correctly',
      messageId: result.messageId
    });

  } catch (error) {
    console.error('❌ Email service test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Email service test failed',
      message: error.message
    });
  }
});

/**
 * Get email service status
 * GET /api/email/status
 */
router.get('/status', (req, res) => {
  try {
    const isInitialized = emailService.transporter !== null;
    
    res.json({
      success: true,
      initialized: isInitialized,
      message: isInitialized ? 'Email service is ready' : 'Email service not initialized'
    });

  } catch (error) {
    console.error('❌ Error checking email service status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check email service status',
      message: error.message
    });
  }
});

module.exports = router;
