// Email Service for Meeting Invitations
// Handles sending meeting invitations via email

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter
   */
  initializeTransporter() {
    try {
      // For development, we'll use Gmail SMTP
      // In production, you should use a proper email service like SendGrid, Mailgun, etc.
      this.transporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER || 'your-email@gmail.com',
          pass: process.env.EMAIL_PASS || 'your-app-password' // Use App Password for Gmail
        }
      });

      // Verify transporter configuration
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('Email transporter verification failed:', error);
        } else {
          console.log('✅ Email service is ready to send messages');
        }
      });
    } catch (error) {
      console.error('Failed to initialize email transporter:', error);
    }
  }

  /**
   * Send meeting invitation email
   */
  async sendMeetingInvitation(meetingData, participant) {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      const { title, description, date, time, duration, location, meeting_link } = meetingData;
      
      // Format date and time
      const meetingDate = new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      const meetingTime = new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      // Generate email content
      const subject = `Meeting Invitation: ${title}`;
      const htmlContent = this.generateInvitationEmailHTML(participant, meetingData, meetingDate, meetingTime);
      const textContent = this.generateInvitationEmailText(participant, meetingData, meetingDate, meetingTime);

      const mailOptions = {
        from: `"MeetingGuard AI" <${process.env.EMAIL_USER || 'noreply@meetingguard.ai'}>`,
        to: participant.email,
        subject: subject,
        text: textContent,
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Meeting invitation sent to ${participant.email}:`, result.messageId);
      
      return {
        success: true,
        messageId: result.messageId,
        recipient: participant.email
      };
    } catch (error) {
      console.error(`❌ Failed to send invitation to ${participant.email}:`, error);
      throw error;
    }
  }

  /**
   * Send multiple meeting invitations
   */
  async sendBulkInvitations(meetingData, participants) {
    const results = [];
    const errors = [];

    for (const participant of participants) {
      try {
        const result = await this.sendMeetingInvitation(meetingData, participant);
        results.push(result);
      } catch (error) {
        errors.push({
          participant: participant.email,
          error: error.message
        });
      }
    }

    return {
      success: results.length > 0,
      sent: results.length,
      failed: errors.length,
      results: results,
      errors: errors
    };
  }

  /**
   * Generate HTML email content
   */
  generateInvitationEmailHTML(participant, meetingData, meetingDate, meetingTime) {
    const { title, description, duration, location, meeting_link } = meetingData;
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Meeting Invitation</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .meeting-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .detail-row { margin: 15px 0; }
            .detail-label { font-weight: bold; color: #374151; }
            .detail-value { color: #6b7280; margin-left: 10px; }
            .cta-button { display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
            .logo { font-size: 24px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">📅 MeetingGuard AI</div>
                <h1>You're Invited to a Meeting!</h1>
            </div>
            
            <div class="content">
                <p>Hello ${participant.name || 'there'},</p>
                
                <p>You have been invited to a meeting. Here are the details:</p>
                
                <div class="meeting-details">
                    <div class="detail-row">
                        <span class="detail-label">📋 Meeting:</span>
                        <span class="detail-value">${title}</span>
                    </div>
                    
                    <div class="detail-row">
                        <span class="detail-label">📅 Date:</span>
                        <span class="detail-value">${meetingDate}</span>
                    </div>
                    
                    <div class="detail-row">
                        <span class="detail-label">🕐 Time:</span>
                        <span class="detail-value">${meetingTime}</span>
                    </div>
                    
                    <div class="detail-row">
                        <span class="detail-label">⏱️ Duration:</span>
                        <span class="detail-value">${duration} minutes</span>
                    </div>
                    
                    ${location ? `
                    <div class="detail-row">
                        <span class="detail-label">📍 Location:</span>
                        <span class="detail-value">${location}</span>
                    </div>
                    ` : ''}
                    
                    ${meeting_link ? `
                    <div class="detail-row">
                        <span class="detail-label">🔗 Meeting Link:</span>
                        <span class="detail-value"><a href="${meeting_link}" style="color: #f59e0b;">Join Meeting</a></span>
                    </div>
                    ` : ''}
                    
                    ${description ? `
                    <div class="detail-row">
                        <span class="detail-label">📝 Description:</span>
                        <span class="detail-value">${description}</span>
                    </div>
                    ` : ''}
                </div>
                
                ${meeting_link ? `
                <div style="text-align: center;">
                    <a href="${meeting_link}" class="cta-button">Join Meeting</a>
                </div>
                ` : ''}
                
                <p>Please add this meeting to your calendar and let us know if you have any questions.</p>
                
                <p>Best regards,<br>
                MeetingGuard AI Team</p>
            </div>
            
            <div class="footer">
                <p>This invitation was sent by MeetingGuard AI</p>
                <p>If you believe you received this email in error, please ignore it.</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Generate plain text email content
   */
  generateInvitationEmailText(participant, meetingData, meetingDate, meetingTime) {
    const { title, description, duration, location, meeting_link } = meetingData;
    
    return `
MeetingGuard AI - Meeting Invitation

Hello ${participant.name || 'there'},

You have been invited to a meeting. Here are the details:

Meeting: ${title}
Date: ${meetingDate}
Time: ${meetingTime}
Duration: ${duration} minutes
${location ? `Location: ${location}` : ''}
${meeting_link ? `Meeting Link: ${meeting_link}` : ''}
${description ? `Description: ${description}` : ''}

${meeting_link ? `Join the meeting: ${meeting_link}` : ''}

Please add this meeting to your calendar and let us know if you have any questions.

Best regards,
MeetingGuard AI Team

---
This invitation was sent by MeetingGuard AI
If you believe you received this email in error, please ignore it.
    `;
  }

  /**
   * Test email service
   */
  async testEmailService() {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      const testMailOptions = {
        from: `"MeetingGuard AI" <${process.env.EMAIL_USER || 'noreply@meetingguard.ai'}>`,
        to: process.env.EMAIL_USER || 'test@example.com',
        subject: 'MeetingGuard AI - Email Service Test',
        text: 'This is a test email to verify the email service is working correctly.',
        html: '<h1>Email Service Test</h1><p>This is a test email to verify the email service is working correctly.</p>'
      };

      const result = await this.transporter.sendMail(testMailOptions);
      console.log('✅ Test email sent successfully:', result.messageId);
      
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      console.error('❌ Test email failed:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
