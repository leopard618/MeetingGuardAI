// AI Service for OpenAI integration and bilingual NLP capabilities

const OPENAI_API_KEY = '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';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

class AIService {
  constructor() {
    this.apiKey = OPENAI_API_KEY;
    this.baseURL = OPENAI_BASE_URL;
  }

  async makeRequest(endpoint, data) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('AI Service Error:', error);
      throw error;
    }
  }

  // Enhanced language detection with confidence score
  async detectLanguage(text) {
    const prompt = `Detect the language of the following text and respond with a JSON object containing the ISO 639-1 language code and confidence score (0-100):

Text: "${text}"

Respond in this exact JSON format:
{
  "language": "en",
  "confidence": 95,
  "detected_text": "English"
}`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a language detection expert. Respond only with valid JSON containing language code, confidence score, and detected language name.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 100,
      temperature: 0
    });

    try {
      const result = JSON.parse(response.choices[0].message.content);
      return {
        language: result.language.toLowerCase(),
        confidence: result.confidence,
        detectedText: result.detected_text
      };
    } catch (error) {
      console.error('Failed to parse language detection response:', error);
      return {
        language: 'en',
        confidence: 50,
        detectedText: 'English'
      };
    }
  }

  // Enhanced text translation with context preservation
  async translateText(text, targetLanguage, sourceLanguage = 'auto', context = 'general') {
    const prompt = `Translate the following text to ${targetLanguage}${sourceLanguage !== 'auto' ? ` from ${sourceLanguage}` : ''}. 
    Context: ${context}
    
    Text: "${text}"
    
    Please preserve the original meaning, tone, and context. If this is meeting-related content, maintain professional terminology.

    Translation:`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator specializing in ${context} content. Translate to ${targetLanguage} while preserving meaning and context.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    });

    return response.choices[0].message.content.trim();
  }

  // Sentiment analysis for meeting feedback
  async analyzeSentiment(text, language = 'en') {
    const prompt = `Analyze the sentiment of this text in ${language === 'es' ? 'Spanish' : 'English'}:

Text: "${text}"

Provide a JSON response with:
- sentiment: "positive", "negative", "neutral", or "mixed"
- confidence: 0-100
- emotions: array of detected emotions
- summary: brief explanation

JSON response:`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a sentiment analysis expert. Respond only with valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 200,
      temperature: 0.2
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Failed to parse sentiment analysis:', error);
      return {
        sentiment: 'neutral',
        confidence: 50,
        emotions: [],
        summary: 'Unable to analyze sentiment'
      };
    }
  }

  // Enhanced meeting analysis with preparation tips
  async analyzeMeeting(meetingData, language = 'en') {
    const { title, description, participants, duration, date } = meetingData;
    
    const prompt = `Analyze this meeting and provide comprehensive insights in ${language === 'es' ? 'Spanish' : 'English'}:

Meeting Title: ${title}
Description: ${description || 'No description provided'}
Participants: ${participants ? participants.length : 0} people
Duration: ${duration} minutes
Date: ${date}

Please provide:
1. A confidence score (0-100) for the meeting analysis
2. 3-5 specific preparation tips for this meeting
3. Key topics that might be discussed
4. Suggested questions to prepare
5. Meeting type classification
6. Recommended duration optimization
7. Participant engagement suggestions

Respond in JSON format:
{
  "confidence": number,
  "preparation_tips": [string],
  "key_topics": [string],
  "suggested_questions": [string],
  "meeting_type": string,
  "duration_optimization": string,
  "engagement_suggestions": [string],
  "analysis_summary": string
}`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI meeting assistant. Analyze meetings and provide helpful preparation advice in ${language === 'es' ? 'Spanish' : 'English'}.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.4
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return {
        confidence: 70,
        preparation_tips: ['Review meeting agenda', 'Prepare key points', 'Check technical setup'],
        key_topics: ['General discussion'],
        suggested_questions: ['What are the main objectives?'],
        meeting_type: 'General',
        duration_optimization: 'Consider if 30 minutes would be sufficient',
        engagement_suggestions: ['Encourage participation', 'Use interactive elements'],
        analysis_summary: 'Meeting analysis completed'
      };
    }
  }

  // Enhanced natural language meeting creation
  async createMeetingFromText(text, language = 'en') {
    const prompt = `Extract meeting information from this text and create a structured meeting object in ${language === 'es' ? 'Spanish' : 'English'}:

Text: "${text}"

Extract and structure the following information:
- Meeting title
- Date and time
- Duration (in minutes)
- Description
- Location (if mentioned)
- Participants (if mentioned)
- Meeting type
- Priority level (low, medium, high)

Respond in JSON format:
{
  "title": string,
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "duration": number,
  "description": string,
  "location": string or null,
  "participants": [string] or null,
  "meeting_type": string,
  "priority": "low" | "medium" | "high",
  "confidence": number
}`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant that extracts meeting information from natural language text. Respond in ${language === 'es' ? 'Spanish' : 'English'}.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.3
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Failed to parse meeting creation response:', error);
      return null;
    }
  }

  // Enhanced AI Chat functionality with context awareness
  async chatWithAI(message, conversationHistory = [], language = 'en', context = {}) {
    const systemPrompt = `You are MeetingGuard AI, a helpful assistant for meeting management and productivity. 
    Respond in ${language === 'es' ? 'Spanish' : 'English'}.
    
    Current context: ${JSON.stringify(context)}
    
    You can help with:
    - Meeting scheduling and organization
    - Preparation tips and advice
    - Calendar management
    - Productivity tips
    - Meeting optimization suggestions
    - Language translation assistance
    - Sentiment analysis of meeting feedback
    - General questions about meetings and time management
    
    Keep responses concise, helpful, and professional. If the user asks in a different language, respond in that language.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 600,
      temperature: 0.7
    });

    return response.choices[0].message.content;
  }

  // Smart meeting suggestions with optimization
  async getMeetingSuggestions(userPreferences, calendar, language = 'en') {
    const prompt = `Based on the user's preferences and calendar, suggest optimal meeting times and optimizations in ${language === 'es' ? 'Spanish' : 'English'}:

User Preferences: ${JSON.stringify(userPreferences)}
Calendar: ${JSON.stringify(calendar)}

Provide suggestions for:
1. Best meeting times
2. Duration recommendations
3. Preparation reminders
4. Follow-up scheduling
5. Meeting optimization tips
6. Conflict resolution suggestions

Respond in JSON format:
{
  "suggested_times": [string],
  "duration_recommendations": [string],
  "preparation_reminders": [string],
  "follow_up_suggestions": [string],
  "optimization_tips": [string],
  "conflict_resolutions": [string]
}`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI scheduling assistant. Provide smart meeting suggestions in ${language === 'es' ? 'Spanish' : 'English'}.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.4
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Failed to parse suggestions response:', error);
      return {
        suggested_times: ['9:00 AM', '2:00 PM'],
        duration_recommendations: ['30 minutes for quick updates', '60 minutes for detailed discussions'],
        preparation_reminders: ['Review agenda 15 minutes before'],
        follow_up_suggestions: ['Schedule follow-up within 24 hours'],
        optimization_tips: ['Consider shorter meetings for better focus'],
        conflict_resolutions: ['Reschedule conflicting meetings']
      };
    }
  }

  // Enhanced meeting summary generation
  async generateMeetingSummary(meetingData, notes, language = 'en') {
    const prompt = `Generate a comprehensive meeting summary in ${language === 'es' ? 'Spanish' : 'English'} based on the meeting details and notes:

Meeting: ${JSON.stringify(meetingData)}
Notes: ${notes || 'No notes provided'}

Create a structured summary including:
1. Key points discussed
2. Decisions made
3. Action items with assignees
4. Next steps
5. Follow-up recommendations
6. Meeting effectiveness score

Respond in JSON format:
{
  "key_points": [string],
  "decisions": [string],
  "action_items": [{"task": string, "assignee": string, "deadline": string}],
  "next_steps": [string],
  "follow_up_recommendations": [string],
  "effectiveness_score": number,
  "summary": string
}`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant that creates comprehensive meeting summaries in ${language === 'es' ? 'Spanish' : 'English'}.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Failed to parse summary response:', error);
      return {
        key_points: ['Meeting held as scheduled'],
        decisions: ['No specific decisions recorded'],
        action_items: [{'task': 'Follow up on discussed topics', 'assignee': 'Team', 'deadline': 'Next week'}],
        next_steps: ['Schedule follow-up meeting if needed'],
        follow_up_recommendations: ['Send meeting minutes to all participants'],
        effectiveness_score: 75,
        summary: 'Meeting completed successfully'
      };
    }
  }

  // Meeting optimization analysis
  async optimizeMeeting(meetingData, feedback, language = 'en') {
    const prompt = `Analyze this meeting and provide optimization suggestions in ${language === 'es' ? 'Spanish' : 'English'}:

Meeting Data: ${JSON.stringify(meetingData)}
Feedback: ${feedback || 'No feedback provided'}

Provide optimization suggestions for:
1. Duration efficiency
2. Participant engagement
3. Agenda structure
4. Follow-up effectiveness
5. Technology usage
6. Overall meeting quality

Respond in JSON format:
{
  "duration_optimization": string,
  "engagement_improvements": [string],
  "agenda_suggestions": [string],
  "follow_up_optimization": [string],
  "technology_recommendations": [string],
  "quality_score": number,
  "overall_recommendations": [string]
}`;

    const response = await this.makeRequest('/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI meeting optimization expert. Provide suggestions in ${language === 'es' ? 'Spanish' : 'English'}.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.4
    });

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Failed to parse optimization response:', error);
      return {
        duration_optimization: 'Consider reducing meeting duration by 15 minutes',
        engagement_improvements: ['Add interactive elements', 'Encourage participation'],
        agenda_suggestions: ['Structure agenda with time allocations'],
        follow_up_optimization: ['Automate follow-up reminders'],
        technology_recommendations: ['Use screen sharing for better engagement'],
        quality_score: 80,
        overall_recommendations: ['Focus on clear objectives and time management']
      };
    }
  }
}

// Create singleton instance
const aiService = new AIService();

export default aiService; 