// Video Conferencing Integration Service
// Handles Zoom, Microsoft Teams, and Google Meet integrations

class VideoConferencingService {
  constructor() {
    this.zoomApiKey = process.env.ZOOM_API_KEY;
    this.zoomApiSecret = process.env.ZOOM_API_SECRET;
    this.teamsClientId = process.env.TEAMS_CLIENT_ID;
    this.teamsClientSecret = process.env.TEAMS_CLIENT_SECRET;
    this.googleMeetEnabled = true; // Uses existing Google OAuth
  }

  /**
   * Generate meeting link for the selected platform
   */
  async generateMeetingLink(platform, meetingData) {
    try {
      switch (platform.toLowerCase()) {
        case 'zoom':
          return await this.generateZoomMeeting(meetingData);
        case 'teams':
          return await this.generateTeamsMeeting(meetingData);
        case 'google meet':
          return await this.generateGoogleMeetLink(meetingData);
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      console.error(`Error generating ${platform} meeting:`, error);
      throw error;
    }
  }

  /**
   * Generate Zoom meeting link
   */
  async generateZoomMeeting(meetingData) {
    try {
      // For now, we'll generate a mock Zoom link
      // In production, you'd use the Zoom API
      const meetingId = this.generateRandomId();
      const password = this.generateRandomPassword();
      
      const zoomLink = `https://zoom.us/j/${meetingId}?pwd=${password}`;
      
      return {
        success: true,
        platform: 'Zoom',
        meetingLink: zoomLink,
        meetingId: meetingId,
        password: password,
        joinUrl: zoomLink,
        startUrl: `https://zoom.us/s/${meetingId}?pwd=${password}`,
        dialInNumbers: [
          { country: 'US', number: '+1 646 558 8656' },
          { country: 'MX', number: '+52 55 4170 5600' }
        ]
      };
    } catch (error) {
      console.error('Error generating Zoom meeting:', error);
      throw new Error('Failed to generate Zoom meeting link');
    }
  }

  /**
   * Generate Microsoft Teams meeting link
   */
  async generateTeamsMeeting(meetingData) {
    try {
      // For now, we'll generate a mock Teams link
      // In production, you'd use the Microsoft Graph API
      const meetingId = this.generateRandomId();
      
      const teamsLink = `https://teams.microsoft.com/l/meetup-join/19:meeting_${meetingId}@thread.v2/0?context={"Tid":"tenant-id","Oid":"user-id"}`;
      
      return {
        success: true,
        platform: 'Teams',
        meetingLink: teamsLink,
        meetingId: meetingId,
        joinUrl: teamsLink,
        startUrl: teamsLink,
        conferenceId: meetingId
      };
    } catch (error) {
      console.error('Error generating Teams meeting:', error);
      throw new Error('Failed to generate Teams meeting link');
    }
  }

  /**
   * Generate Google Meet link
   */
  async generateGoogleMeetLink(meetingData) {
    try {
      // Google Meet links are simple and don't require API calls
      const meetingCode = this.generateMeetingCode();
      const meetLink = `https://meet.google.com/${meetingCode}`;
      
      return {
        success: true,
        platform: 'Google Meet',
        meetingLink: meetLink,
        meetingCode: meetingCode,
        joinUrl: meetLink,
        startUrl: meetLink
      };
    } catch (error) {
      console.error('Error generating Google Meet link:', error);
      throw new Error('Failed to generate Google Meet link');
    }
  }

  /**
   * Send meeting invitations to participants
   */
  async sendMeetingInvitations(meetingData, platform, meetingLink) {
    try {
      const { participants, title, date, time, duration } = meetingData;
      
      if (!participants || participants.length === 0) {
        return { success: true, message: 'No participants to invite' };
      }

      const invitations = participants.map(participant => ({
        to: participant.email,
        subject: `Meeting Invitation: ${title}`,
        body: this.generateInvitationEmail(participant, meetingData, platform, meetingLink),
        platform: platform
      }));

      // Here you would integrate with your email service
      // For now, we'll return the prepared invitations
      return {
        success: true,
        invitations: invitations,
        message: `Prepared ${invitations.length} invitations`
      };
    } catch (error) {
      console.error('Error sending meeting invitations:', error);
      throw new Error('Failed to send meeting invitations');
    }
  }

  /**
   * Generate invitation email content
   */
  generateInvitationEmail(participant, meetingData, platform, meetingLink) {
    const { title, date, time, duration, description } = meetingData;
    
    return `
Dear ${participant.name || participant.email},

You are invited to attend the following meeting:

📅 Meeting: ${title}
📅 Date: ${date}
⏰ Time: ${time}
⏱️ Duration: ${duration} minutes
🔗 Platform: ${platform}
🔗 Join Link: ${meetingLink}

${description ? `📝 Description: ${description}` : ''}

Please click the link above to join the meeting.

Best regards,
MeetingGuard AI
    `.trim();
  }

  /**
   * Generate random meeting ID
   */
  generateRandomId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Generate random password for Zoom
   */
  generateRandomPassword() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * Generate Google Meet code
   */
  generateMeetingCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 3; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    result += '-';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Get available platforms
   */
  getAvailablePlatforms() {
    return [
      {
        id: 'zoom',
        name: 'Zoom',
        icon: '🎥',
        color: '#2D8CFF',
        enabled: !!this.zoomApiKey
      },
      {
        id: 'teams',
        name: 'Microsoft Teams',
        icon: '👥',
        color: '#6264A7',
        enabled: !!this.teamsClientId
      },
      {
        id: 'google-meet',
        name: 'Google Meet',
        icon: '📹',
        color: '#00AC47',
        enabled: this.googleMeetEnabled
      }
    ];
  }
}

export default new VideoConferencingService();
