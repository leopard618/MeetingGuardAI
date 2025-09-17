import { OPENAI_API_KEY, OPENAI_MODEL } from '@env';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

class OpenAIService {
  constructor() {
    this.apiKey = OPENAI_API_KEY;
    this.model = OPENAI_MODEL || 'gpt-4o-mini';
    this.baseURL = 'https://api.openai.com/v1';
  }

  /**
   * Check network connectivity
   */
  async checkNetworkConnectivity() {
    try {
      const state = await NetInfo.fetch();
      console.log('Network state:', state);
      return state.isConnected && state.isInternetReachable;
    } catch (error) {
      console.error('Network check failed:', error);
      return false;
    }
  }

  /**
   * Simple API key validation
   */
  async validateAPIKey() {
    if (!this.apiKey) {
      console.log('No OpenAI API key found');
      return false;
    }

    if (!this.apiKey.startsWith('sk-')) {
      console.log('Invalid API key format - should start with sk-');
      return false;
    }

    // Check network connectivity first
    const isConnected = await this.checkNetworkConnectivity();
    if (!isConnected) {
      console.log('No network connectivity');
      return false;
    }

    try {
      const response = await fetch(`${this.baseURL}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'MeetingGuard/1.0',
        },
      });
      
      console.log('API validation response status:', response.status);
      return response.ok;
    } catch (error) {
      console.error('API key validation failed:', error);
      return false;
    }
  }

  /**
   * Generate simple chat response
   */
  async generateChatResponse(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Check network connectivity first
    const isConnected = await this.checkNetworkConnectivity();
    if (!isConnected) {
      throw new Error('No network connectivity. Please check your internet connection.');
    }

    try {
      console.log('Making OpenAI request to:', `${this.baseURL}/chat/completions`);
      console.log('Platform:', Platform.OS);
      console.log('API Key length:', this.apiKey.length);
      
      const systemPrompt = `You are an AI assistant for MeetingGuard, a meeting management app. You help users with general questions about the app, meeting management, and productivity.

When users ask about creating meetings, provide a comprehensive explanation of what information is needed:

Required Information:
- Meeting Title: A clear, descriptive name for the meeting
- Date: When the meeting will take place (e.g., "tomorrow", "next Monday", "2024-01-15")
- Time: What time the meeting starts (e.g., "2 PM", "14:30")
- Duration: How long the meeting will last (e.g., "30 minutes", "1 hour")

Optional Information:
- Location: Where the meeting will be held
  - Physical address for in-person meetings
  - Virtual platform (Zoom, Teams, Google Meet) for online meetings
  - "Hybrid" for meetings with both in-person and virtual participants
- Participants: People who will attend (names and email addresses)
- Description: Additional details about the meeting purpose or agenda

Examples:
- "Create a team standup for tomorrow at 9 AM for 30 minutes"
- "Schedule a client meeting on Friday at 2 PM for 1 hour at the office"
- "Set up a virtual project review on Monday at 10 AM for 45 minutes using Zoom"

Be helpful, friendly, and provide specific examples. Always give complete, actionable guidance. Do not use markdown formatting like ** or ### in your responses.`;

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'MeetingGuard/1.0',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.formatMessages(messages)
          ],
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 1000,
        }),
      });

      console.log('OpenAI response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI error response:', errorText);
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('OpenAI response received successfully');
      
      return {
        content: data.choices[0].message.content,
        usage: data.usage,
      };
    } catch (error) {
      console.error('OpenAI API request failed:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        platform: Platform.OS
      });
      
      if (error.message.includes('Network request failed')) {
        throw new Error('Network request failed. Please check your internet connection and try again.');
      }
      
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  /**
   * Generate meeting-specific response
   */
  async generateMeetingResponse(messages, calendarData = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Check network connectivity first
    const isConnected = await this.checkNetworkConnectivity();
    if (!isConnected) {
      throw new Error('No network connectivity. Please check your internet connection.');
    }

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

    try {
      console.log('Making meeting OpenAI request...');
      
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'MeetingGuard/1.0',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.formatMessages(messages)
          ],
          temperature: 0.3,
          max_tokens: 1500,
          response_format: { type: "json_object" },
        }),
      });

      console.log('Meeting OpenAI response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Meeting OpenAI error response:', errorText);
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      console.log('Meeting OpenAI response received successfully');
      console.log('Meeting OpenAI raw content:', content);
      
      try {
        const parsedResponse = JSON.parse(content);
        console.log('Meeting OpenAI parsed response:', parsedResponse);
        console.log('Meeting OpenAI meetingData:', parsedResponse.meetingData);
        
        // Clean up the response to remove any unwanted messages
        if (parsedResponse.message) {
          // Remove any "Time slot is not available" messages that might have been added
          parsedResponse.message = parsedResponse.message.replace(/Time slot is not available\.?\s*/gi, '');
          parsedResponse.message = parsedResponse.message.trim();
        }
        
        if (parsedResponse.meetingData) {
          console.log('Meeting OpenAI date:', parsedResponse.meetingData.date);
          console.log('Meeting OpenAI time:', parsedResponse.meetingData.time);
        }
        
        return parsedResponse;
      } catch (parseError) {
        console.log('Failed to parse JSON response, returning as chat:', parseError);
        // Clean up the content before returning as chat
        let cleanContent = content.replace(/Time slot is not available\.?\s*/gi, '').trim();
        return {
          message: cleanContent,
          action: 'chat',
          meetingData: null,
        };
      }
    } catch (error) {
      console.error('Meeting OpenAI API request failed:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        platform: Platform.OS
      });
      
      if (error.message.includes('Network request failed')) {
        throw new Error('Network request failed. Please check your internet connection and try again.');
      }
      
      throw new Error(`Failed to generate meeting response: ${error.message}`);
    }
  }

  /**
   * Format messages for OpenAI API
   */
  formatMessages(messages) {
    return messages.map(msg => ({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));
  }

  /**
   * Test network connectivity
   */
  async testNetworkConnectivity() {
    try {
      const response = await fetch('https://httpbin.org/get');
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

export default new OpenAIService();