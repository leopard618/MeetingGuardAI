// Environment variables with fallback
let OPENAI_API_KEY, OPENAI_MODEL;

try {
  const env = require('@env');
  OPENAI_API_KEY = env.OPENAI_API_KEY;
  OPENAI_MODEL = env.OPENAI_MODEL;
} catch (error) {
  // Fallback to process.env for Node.js testing
  OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

class OpenAIService {
  constructor() {
    this.apiKey = OPENAI_API_KEY;
    this.model = OPENAI_MODEL || 'gpt-4o-mini';
    this.baseURL = 'https://api.openai.com/v1';
  }

  /**
   * Generate AI response for chat
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} AI response
   */
  async generateChatResponse(messages, options = {}) {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: this.formatMessages(messages),
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 1000,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        usage: data.usage,
        finishReason: data.choices[0].finish_reason,
      };
    } catch (error) {
      console.error('OpenAI API Error:', error);
      throw new Error(`Failed to generate AI response: ${error.message}`);
    }
  }

  /**
   * Generate meeting-specific response with structured data
   * @param {Array} messages - Chat messages
   * @param {Object} calendarData - Current calendar data
   * @returns {Promise<Object>} Structured meeting response
   */
  async generateMeetingResponse(messages, calendarData = {}) {
    const systemPrompt = this.getMeetingSystemPrompt(calendarData);
    
    const enhancedMessages = [
      { role: 'system', content: systemPrompt },
      ...this.formatMessages(messages)
    ];

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: enhancedMessages,
          temperature: 0.3, // Lower temperature for more consistent meeting responses
          max_tokens: 1500,
          response_format: { type: "json_object" }, // Force JSON response
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      try {
        const parsedResponse = JSON.parse(content);
        return {
          ...parsedResponse,
          usage: data.usage,
          finishReason: data.choices[0].finish_reason,
        };
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        return {
          message: content,
          action: 'chat',
          meetingData: null,
          usage: data.usage,
        };
      }
    } catch (error) {
      console.error('OpenAI Meeting API Error:', error);
      throw new Error(`Failed to generate meeting response: ${error.message}`);
    }
  }

  /**
   * Get system prompt for meeting management
   * @param {Object} calendarData - Current calendar data
   * @returns {string} System prompt
   */
  getMeetingSystemPrompt(calendarData) {
    return `You are an AI meeting assistant that helps users manage their calendar and schedule meetings. 

Your capabilities include:
- Creating new meetings with title, date, time, duration, location, and participants
- Updating existing meetings
- Deleting meetings
- Checking calendar availability
- Providing meeting suggestions
- General conversation about meetings and scheduling

Current calendar context:
${JSON.stringify(calendarData, null, 2)}

Respond in the following JSON format:
{
  "message": "Human-readable response to the user",
  "action": "create|update|delete|check|suggest|chat",
  "meetingData": {
    "title": "Meeting title",
    "date": "YYYY-MM-DD",
    "time": "HH:MM",
    "duration": "minutes",
    "location": "meeting location",
    "participants": ["email1@example.com", "email2@example.com"],
    "description": "meeting description",
    "meetingId": "existing meeting ID for updates/deletes"
  },
  "confidence": 0.95,
  "requiresConfirmation": true/false
}

If the user is just chatting and doesn't need meeting management, set action to "chat" and meetingData to null.

Be helpful, professional, and always ask for confirmation before making changes to the calendar.`;
  }

  /**
   * Format messages for OpenAI API
   * @param {Array} messages - Array of message objects
   * @returns {Array} Formatted messages
   */
  formatMessages(messages) {
    return messages.map(msg => ({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));
  }

  /**
   * Extract meeting information from text
   * @param {string} text - User input text
   * @returns {Promise<Object>} Extracted meeting data
   */
  async extractMeetingData(text) {
    const systemPrompt = `Extract meeting information from the following text. Return only a JSON object with the following structure:
{
  "title": "extracted or suggested title",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM or null", 
  "duration": "minutes or null",
  "location": "location or null",
  "participants": ["emails or names"],
  "description": "description or null"
}

If information is not provided, use null. For dates, convert relative dates (tomorrow, next week) to actual dates.`;

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to extract meeting data:', error);
      return null;
    }
  }

  /**
   * Check if the API key is valid
   * @returns {Promise<boolean>} Whether the API key is valid
   */
  async validateAPIKey() {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch (error) {
      console.error('API key validation failed:', error);
      return false;
    }
  }
}

export default new OpenAIService();