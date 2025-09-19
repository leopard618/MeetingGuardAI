// Email Service for Frontend
// Handles sending meeting invitations via the backend API

class EmailService {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  /**
   * Send meeting invitations to multiple participants
   */
  async sendMeetingInvitations(meetingData, participants) {
    try {
      // Validate inputs
      this.validateMeetingData(meetingData);
      participants.forEach(p => this.validateParticipant(p));

      // In development, use mock service if backend is not available
      if (this.isDevelopment && !this.baseURL.includes('localhost')) {
        return this.mockSendInvitations(meetingData, participants);
      }

      const response = await fetch(`${this.baseURL}/api/v1/email/send-invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          meetingData: {
            title: meetingData.title,
            description: meetingData.description,
            date: meetingData.date,
            time: meetingData.time,
            duration: meetingData.duration,
            location: meetingData.location,
            meeting_link: meetingData.meeting_link
          },
          participants: participants.map(p => ({
            name: p.name,
            email: p.email
          }))
        })
      });

      if (!response.ok) {
        let errorMessage = 'Failed to send invitations';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (parseError) {
          // If we can't parse the error response, use the status text
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('✅ Meeting invitations sent:', result);
      return result;
    } catch (error) {
      console.error('❌ Error sending meeting invitations:', error);
      
      // In development, fall back to mock service
      if (this.isDevelopment) {
        console.log('🔄 Falling back to mock email service for development');
        return this.mockSendInvitations(meetingData, participants);
      }
      
      // Provide more specific error messages
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to email service. Please check your internet connection.');
      } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        throw new Error('Authentication error: Please log in again.');
      } else if (error.message.includes('500')) {
        throw new Error('Server error: Email service is temporarily unavailable.');
      } else {
        throw new Error(`Email service error: ${error.message}`);
      }
    }
  }

  /**
   * Mock email service for development
   */
  async mockSendInvitations(meetingData, participants) {
    console.log('📧 Mock: Sending email invitations...');
    console.log('Meeting:', meetingData.title);
    console.log('Participants:', participants.map(p => p.email));
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      sent: participants.length,
      failed: 0,
      message: `Mock: ${participants.length} invitations prepared for sending`,
      results: participants.map(p => ({
        success: true,
        recipient: p.email,
        messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      })),
      errors: []
    };
  }

  /**
   * Send meeting invitation to a single participant
   */
  async sendMeetingInvitation(meetingData, participant) {
    try {
      const response = await fetch(`${this.baseURL}/api/v1/email/send-invitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          meetingData: {
            title: meetingData.title,
            description: meetingData.description,
            date: meetingData.date,
            time: meetingData.time,
            duration: meetingData.duration,
            location: meetingData.location,
            meeting_link: meetingData.meeting_link
          },
          participant: {
            name: participant.name,
            email: participant.email
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send invitation');
      }

      const result = await response.json();
      console.log('✅ Meeting invitation sent:', result);
      return result;
    } catch (error) {
      console.error('❌ Error sending meeting invitation:', error);
      throw error;
    }
  }

  /**
   * Test email service
   */
  async testEmailService() {
    try {
      const response = await fetch(`${this.baseURL}/api/v1/email/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Email service test failed');
      }

      const result = await response.json();
      console.log('✅ Email service test successful:', result);
      return result;
    } catch (error) {
      console.error('❌ Email service test failed:', error);
      throw error;
    }
  }

  /**
   * Get email service status
   */
  async getEmailServiceStatus() {
    try {
      const response = await fetch(`${this.baseURL}/api/v1/email/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to get email service status');
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('❌ Error getting email service status:', error);
      throw error;
    }
  }

  /**
   * Get authentication token from storage
   */
  getAuthToken() {
    // Try to get token from AsyncStorage or localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('authToken') || localStorage.getItem('token');
    }
    
    // For React Native, you might need to use AsyncStorage
    // This is a simplified version - you might need to adjust based on your auth implementation
    return null;
  }

  /**
   * Validate email address
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate participant data
   */
  validateParticipant(participant) {
    if (!participant.name || !participant.name.trim()) {
      throw new Error('Participant name is required');
    }
    
    if (!participant.email || !participant.email.trim()) {
      throw new Error('Participant email is required');
    }
    
    if (!this.validateEmail(participant.email)) {
      throw new Error('Invalid email address format');
    }
    
    return true;
  }

  /**
   * Validate meeting data
   */
  validateMeetingData(meetingData) {
    if (!meetingData.title || !meetingData.title.trim()) {
      throw new Error('Meeting title is required');
    }
    
    if (!meetingData.date) {
      throw new Error('Meeting date is required');
    }
    
    if (!meetingData.time) {
      throw new Error('Meeting time is required');
    }
    
    if (!meetingData.duration || meetingData.duration <= 0) {
      throw new Error('Meeting duration must be greater than 0');
    }
    
    return true;
  }
}

export default new EmailService();
