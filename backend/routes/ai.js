const express = require('express');
const { body, validationResult } = require('express-validator');
const { ValidationError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Generate AI chat response
 */
router.post('/chat', [
  body('messages').isArray().notEmpty(),
  body('messages.*.role').isIn(['user', 'assistant', 'system']),
  body('messages.*.content').isString().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { messages, options = {} } = req.body;

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model || 'gpt-3.5-turbo',
        messages: messages,
        max_tokens: options.max_tokens || 1000,
        temperature: options.temperature || 0.7,
        stream: false
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    res.json({
      content: content,
      usage: data.usage,
      model: data.model
    });

  } catch (error) {
    console.error('AI chat error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to generate AI response',
        message: error.message
      });
    }
  }
});

/**
 * Generate meeting-specific AI response
 */
router.post('/meeting', [
  body('messages').isArray().notEmpty(),
  body('messages.*.role').isIn(['user', 'assistant', 'system']),
  body('messages.*.content').isString().notEmpty(),
  body('calendarData').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { messages, calendarData = {} } = req.body;

    // Create system prompt for meeting management
    const systemPrompt = `You are an AI meeting assistant for MeetingGuard. Help users manage their calendar and schedule meetings.

Current calendar context: ${JSON.stringify(calendarData, null, 2)}

**IMPORTANT RULES:**
1. Only respond to the user's specific request - do not add extra information unless asked
2. Do NOT mention "Time slot is not available" unless the user specifically asks about availability
3. Focus on the user's intent and provide relevant, helpful responses
4. If the user asks about meeting details, provide comprehensive information about their meetings
5. If the user wants to create/update/delete meetings, extract the necessary information and respond appropriately
6. For UPDATE and DELETE actions, you MUST include the meetingId from the existing meeting data
7. For DELETE actions, be very careful to confirm the user's intent and include the correct meeting ID

**DELETE REQUEST HANDLING:**
- When users say "delete", "remove", "cancel", or similar words, treat it as a delete action
- Look for the meeting in the calendar context that matches the user's description
- Include the meeting ID as "meetingId" in the response
- Set action to "delete" and requiresConfirmation to true for safety
- Provide a clear message confirming which meeting will be deleted

**Available Meeting Features:**
1. **Video Conferencing**: Support for Zoom, Microsoft Teams, and Google Meet with automatic link generation
2. **Location Management**: 
   - Virtual meetings with video platform integration
   - On-site meetings with Google Maps integration for precise location
   - Hybrid meetings combining both options
3. **File Attachments**: Support for documents, images, videos, audio, and archives
4. **Participant Management**: Add participants with names and email addresses
5. **Meeting Types**: Physical, Virtual, or Hybrid

**Meeting Data Structure:**
{
  "title": "Meeting title",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "duration": "minutes",
  "location": {
    "type": "physical|virtual|hybrid",
    "address": "For physical meetings",
    "coordinates": {"lat": 0, "lng": 0},
    "virtualPlatform": "zoom|teams|google-meet",
    "virtualLink": "Generated meeting link"
  },
  "participants": [
    {"name": "John Doe", "email": "john@example.com"}
  ],
  "attachments": [
    {"id": "file_id", "name": "document.pdf", "type": "documents"}
  ],
  "description": "Meeting description"
}

**Response Guidelines:**
- For meeting creation requests: Extract meeting details and set action to "create"
- For meeting updates: Extract meeting details AND include meetingId from existing meeting, set action to "update" 
- For meeting deletion: Extract meeting details AND include meetingId from existing meeting, set action to "delete"
- For availability checks: Only when explicitly requested, set action to "check"
- For general questions about meetings: Provide helpful information and set action to "chat"
- For meeting details requests: Provide comprehensive information about the user's meetings

**IMPORTANT FOR UPDATES/DELETES:**
When updating or deleting a meeting, you MUST include the meetingId from the existing meeting data in the calendar context. Look for the meeting with the matching title or details and include its "id" field as "meetingId" in your response.

**DELETE EXAMPLES:**
- User: "Delete the ADSF meeting" → Find meeting with title "ADSF" and include its ID
- User: "Remove my meeting tomorrow" → Find meeting scheduled for tomorrow and include its ID
- User: "Cancel the team standup" → Find meeting with "team standup" in title and include its ID

Respond in this JSON format:
{
  "message": "Human-readable response that directly addresses the user's request",
  "action": "create|update|delete|check|chat",
  "meetingData": {
    // Meeting data structure above (only if creating/updating/deleting)
    // For updates/deletes, MUST include "meetingId": "existing_meeting_id"
  },
  "confidence": 0.95,
  "requiresConfirmation": true,
  "suggestions": [
    "Suggested video platform based on participants",
    "Recommended location if on-site",
    "File attachment suggestions"
  ]
}

If just chatting or providing information, set action to "chat" and meetingData to null.`;

    // Prepare messages with system prompt
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: fullMessages,
        max_tokens: 1500,
        temperature: 0.7,
        stream: false
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    // Try to parse JSON response
    try {
      const parsedResponse = JSON.parse(content);
      res.json({
        ...parsedResponse,
        usage: data.usage,
        model: data.model
      });
    } catch (parseError) {
      // If JSON parsing fails, return as chat response
      res.json({
        message: content,
        action: 'chat',
        meetingData: null,
        confidence: 0.8,
        requiresConfirmation: false,
        usage: data.usage,
        model: data.model
      });
    }

  } catch (error) {
    console.error('AI meeting error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({
        error: error.message,
        details: error.details
      });
    } else {
      res.status(500).json({
        error: 'Failed to generate AI response',
        message: error.message
      });
    }
  }
});

/**
 * Validate OpenAI API key
 */
router.get('/validate', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        valid: false,
        error: 'OpenAI API key not configured'
      });
    }

    // Test the API key with a simple request
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    if (!response.ok) {
      return res.status(400).json({
        valid: false,
        error: 'Invalid OpenAI API key'
      });
    }

    res.json({
      valid: true,
      message: 'OpenAI API key is valid'
    });

  } catch (error) {
    console.error('API key validation error:', error);
    res.status(500).json({
      valid: false,
      error: 'Failed to validate API key',
      message: error.message
    });
  }
});

module.exports = router;
