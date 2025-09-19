// Email Service for Frontend
// Handles sending meeting invitations via the backend API

class EmailService {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
  }

  /**
   * Send meeting invitations to multiple participants
   */
  async sendMeetingInvitations(meetingData, participants) {
    try {
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
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send invitations');
      }

      const result = await response.json();
      console.log('✅ Meeting invitations sent:', result);
      return result;
    } catch (error) {
      console.error('❌ Error sending meeting invitations:', error);
      throw error;
    }
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
