import AsyncStorage from '@react-native-async-storage/async-storage';

// Environment variables for communication APIs
let WHATSAPP_API_KEY, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN;
let EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_USERNAME, EMAIL_PASSWORD;
let SMS_API_KEY, SMS_SENDER_ID;
let SLACK_BOT_TOKEN, SLACK_WEBHOOK_URL;

try {
  const env = require('@env');
  WHATSAPP_API_KEY = env.WHATSAPP_API_KEY;
  WHATSAPP_PHONE_NUMBER_ID = env.WHATSAPP_PHONE_NUMBER_ID;
  WHATSAPP_ACCESS_TOKEN = env.WHATSAPP_ACCESS_TOKEN;
  EMAIL_SMTP_HOST = env.EMAIL_SMTP_HOST;
  EMAIL_SMTP_PORT = env.EMAIL_SMTP_PORT;
  EMAIL_USERNAME = env.EMAIL_USERNAME;
  EMAIL_PASSWORD = env.EMAIL_PASSWORD;
  SMS_API_KEY = env.SMS_API_KEY;
  SMS_SENDER_ID = env.SMS_SENDER_ID;
  SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  SLACK_WEBHOOK_URL = env.SLACK_WEBHOOK_URL;
} catch (error) {
  WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY;
  WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  EMAIL_SMTP_HOST = process.env.EMAIL_SMTP_HOST;
  EMAIL_SMTP_PORT = process.env.EMAIL_SMTP_PORT;
  EMAIL_USERNAME = process.env.EMAIL_USERNAME;
  EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
  SMS_API_KEY = process.env.SMS_API_KEY;
  SMS_SENDER_ID = process.env.SMS_SENDER_ID;
  SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
}

class CommunicationService {
  constructor() {
    this.channels = {
      whatsapp: new WhatsAppService(),
      email: new EmailService(),
      sms: new SMSService(),
      slack: new SlackService(),
    };
    this.notificationPreferences = {};
  }

  /**
   * Initialize communication service
   * @returns {Promise<boolean>} Whether initialization was successful
   */
  async initialize() {
    try {
      // Initialize all channels
      const initPromises = Object.values(this.channels).map(channel => channel.initialize());
      await Promise.all(initPromises);
      
      // Load notification preferences
      await this.loadNotificationPreferences();
      
      return true;
    } catch (error) {
      console.error('Communication service initialization failed:', error);
      return false;
    }
  }

  /**
   * Send notification through specified channels
   * @param {Array} channels - Array of channel names
   * @param {Object} notification - Notification data
   * @returns {Promise<Object>} Send results
   */
  async sendNotification(channels, notification) {
    try {
      const results = {};
      
      for (const channelName of channels) {
        const channel = this.channels[channelName];
        if (channel && channel.isConfigured()) {
          try {
            results[channelName] = await channel.send(notification);
          } catch (error) {
            results[channelName] = { success: false, error: error.message };
          }
        } else {
          results[channelName] = { success: false, error: 'Channel not configured' };
        }
      }
      
      return results;
    } catch (error) {
      console.error('Failed to send notification:', error);
      throw error;
    }
  }

  /**
   * Send meeting invitation
   * @param {Object} meetingData - Meeting data
   * @param {Array} channels - Channels to send through
   * @returns {Promise<Object>} Send results
   */
  async sendMeetingInvitation(meetingData, channels = ['email']) {
    const notification = {
      type: 'meeting_invitation',
      subject: `Meeting Invitation: ${meetingData.title}`,
      message: this.formatMeetingInvitation(meetingData),
      recipients: meetingData.participants || [],
      meetingData,
    };

    return this.sendNotification(channels, notification);
  }

  /**
   * Send meeting reminder
   * @param {Object} meetingData - Meeting data
   * @param {Array} channels - Channels to send through
   * @returns {Promise<Object>} Send results
   */
  async sendMeetingReminder(meetingData, channels = ['whatsapp', 'email']) {
    const notification = {
      type: 'meeting_reminder',
      subject: `Meeting Reminder: ${meetingData.title}`,
      message: this.formatMeetingReminder(meetingData),
      recipients: meetingData.participants || [],
      meetingData,
    };

    return this.sendNotification(channels, notification);
  }

  /**
   * Send meeting update
   * @param {Object} meetingData - Meeting data
   * @param {Array} channels - Channels to send through
   * @returns {Promise<Object>} Send results
   */
  async sendMeetingUpdate(meetingData, channels = ['email', 'slack']) {
    const notification = {
      type: 'meeting_update',
      subject: `Meeting Updated: ${meetingData.title}`,
      message: this.formatMeetingUpdate(meetingData),
      recipients: meetingData.participants || [],
      meetingData,
    };

    return this.sendNotification(channels, notification);
  }

  /**
   * Send meeting cancellation
   * @param {Object} meetingData - Meeting data
   * @param {Array} channels - Channels to send through
   * @returns {Promise<Object>} Send results
   */
  async sendMeetingCancellation(meetingData, channels = ['whatsapp', 'email', 'sms']) {
    const notification = {
      type: 'meeting_cancellation',
      subject: `Meeting Cancelled: ${meetingData.title}`,
      message: this.formatMeetingCancellation(meetingData),
      recipients: meetingData.participants || [],
      meetingData,
    };

    return this.sendNotification(channels, notification);
  }

  /**
   * Format meeting invitation message
   * @param {Object} meetingData - Meeting data
   * @returns {string} Formatted message
   */
  formatMeetingInvitation(meetingData) {
    const { title, date, time, duration, location, description, joinUrl } = meetingData;
    const startTime = new Date(`${date}T${time}:00`);
    
    let message = `📅 Meeting Invitation\n\n`;
    message += `**${title}**\n\n`;
    message += `📅 Date: ${startTime.toLocaleDateString()}\n`;
    message += `🕐 Time: ${startTime.toLocaleTimeString()}\n`;
    message += `⏱️ Duration: ${duration} minutes\n`;
    
    if (location) {
      message += `📍 Location: ${location}\n`;
    }
    
    if (joinUrl) {
      message += `🔗 Join: ${joinUrl}\n`;
    }
    
    if (description) {
      message += `\n📝 Description:\n${description}\n`;
    }
    
    message += `\nPlease confirm your attendance.`;
    
    return message;
  }

  /**
   * Format meeting reminder message
   * @param {Object} meetingData - Meeting data
   * @returns {string} Formatted message
   */
  formatMeetingReminder(meetingData) {
    const { title, date, time, location, joinUrl } = meetingData;
    const startTime = new Date(`${date}T${time}:00`);
    
    let message = `⏰ Meeting Reminder\n\n`;
    message += `**${title}**\n\n`;
    message += `📅 Date: ${startTime.toLocaleDateString()}\n`;
    message += `🕐 Time: ${startTime.toLocaleTimeString()}\n`;
    
    if (location) {
      message += `📍 Location: ${location}\n`;
    }
    
    if (joinUrl) {
      message += `🔗 Join: ${joinUrl}\n`;
    }
    
    message += `\nSee you there!`;
    
    return message;
  }

  /**
   * Format meeting update message
   * @param {Object} meetingData - Meeting data
   * @returns {string} Formatted message
   */
  formatMeetingUpdate(meetingData) {
    const { title, date, time, location, joinUrl } = meetingData;
    const startTime = new Date(`${date}T${time}:00`);
    
    let message = `🔄 Meeting Updated\n\n`;
    message += `**${title}**\n\n`;
    message += `📅 New Date: ${startTime.toLocaleDateString()}\n`;
    message += `🕐 New Time: ${startTime.toLocaleTimeString()}\n`;
    
    if (location) {
      message += `📍 Location: ${location}\n`;
    }
    
    if (joinUrl) {
      message += `🔗 Join: ${joinUrl}\n`;
    }
    
    message += `\nPlease update your calendar.`;
    
    return message;
  }

  /**
   * Format meeting cancellation message
   * @param {Object} meetingData - Meeting data
   * @returns {string} Formatted message
   */
  formatMeetingCancellation(meetingData) {
    const { title, date, time } = meetingData;
    const startTime = new Date(`${date}T${time}:00`);
    
    let message = `❌ Meeting Cancelled\n\n`;
    message += `**${title}**\n\n`;
    message += `📅 Date: ${startTime.toLocaleDateString()}\n`;
    message += `🕐 Time: ${startTime.toLocaleTimeString()}\n\n`;
    message += `This meeting has been cancelled. We'll reschedule soon.`;
    
    return message;
  }

  /**
   * Set notification preferences
   * @param {Object} preferences - Notification preferences
   */
  async setNotificationPreferences(preferences) {
    this.notificationPreferences = { ...this.notificationPreferences, ...preferences };
    await this.saveNotificationPreferences();
  }

  /**
   * Get notification preferences
   * @returns {Object} Notification preferences
   */
  getNotificationPreferences() {
    return this.notificationPreferences;
  }

  /**
   * Save notification preferences
   */
  async saveNotificationPreferences() {
    try {
      await AsyncStorage.setItem('notification_preferences', JSON.stringify(this.notificationPreferences));
    } catch (error) {
      console.error('Failed to save notification preferences:', error);
    }
  }

  /**
   * Load notification preferences
   */
  async loadNotificationPreferences() {
    try {
      const preferences = await AsyncStorage.getItem('notification_preferences');
      if (preferences) {
        this.notificationPreferences = JSON.parse(preferences);
      }
    } catch (error) {
      console.error('Failed to load notification preferences:', error);
    }
  }

  /**
   * Get available channels
   * @returns {Array} Array of available channels
   */
  getAvailableChannels() {
    return Object.keys(this.channels).map(name => ({
      name,
      displayName: this.channels[name].displayName,
      isConfigured: this.channels[name].isConfigured(),
    }));
  }

  /**
   * Get service status
   * @returns {Promise<Object>} Service status
   */
  async getStatus() {
    const status = {};
    
    for (const [name, channel] of Object.entries(this.channels)) {
      status[name] = {
        isConfigured: channel.isConfigured(),
        displayName: channel.displayName,
      };
    }

    return status;
  }
}

// WhatsApp Business API Service
class WhatsAppService {
  constructor() {
    this.apiKey = WHATSAPP_API_KEY;
    this.phoneNumberId = WHATSAPP_PHONE_NUMBER_ID;
    this.accessToken = WHATSAPP_ACCESS_TOKEN;
    this.baseUrl = 'https://graph.facebook.com/v18.0';
    this.displayName = 'WhatsApp';
  }

  async initialize() {
    return this.isConfigured();
  }

  async send(notification) {
    try {
      if (!this.isConfigured()) {
        throw new Error('WhatsApp not configured');
      }

      const { recipients, message } = notification;
      const results = [];

      for (const recipient of recipients) {
        const phoneNumber = this.formatPhoneNumber(recipient);
        
        const payload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'text',
          text: {
            body: message,
          },
        };

        const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`WhatsApp API error: ${response.status}`);
        }

        const result = await response.json();
        results.push({
          recipient,
          success: true,
          messageId: result.messages?.[0]?.id,
        });
      }

      return { success: true, results };
    } catch (error) {
      console.error('Failed to send WhatsApp message:', error);
      throw error;
    }
  }

  formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters and ensure proper format
    const cleaned = phoneNumber.replace(/\D/g, '');
    return cleaned.startsWith('1') ? cleaned : `1${cleaned}`;
  }

  isConfigured() {
    return !!(this.apiKey && this.phoneNumberId && this.accessToken);
  }
}

// Email Service
class EmailService {
  constructor() {
    this.smtpHost = EMAIL_SMTP_HOST;
    this.smtpPort = EMAIL_SMTP_PORT;
    this.username = EMAIL_USERNAME;
    this.password = EMAIL_PASSWORD;
    this.displayName = 'Email';
  }

  async initialize() {
    return this.isConfigured();
  }

  async send(notification) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Email not configured');
      }

      const { recipients, subject, message } = notification;
      const results = [];

      for (const recipient of recipients) {
        // In a real implementation, you would use a proper SMTP library
        // For now, we'll simulate email sending
        console.log(`Sending email to ${recipient}:`, { subject, message });
        
        results.push({
          recipient,
          success: true,
          messageId: `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });
      }

      return { success: true, results };
    } catch (error) {
      console.error('Failed to send email:', error);
      throw error;
    }
  }

  isConfigured() {
    return !!(this.smtpHost && this.smtpPort && this.username && this.password);
  }
}

// SMS Service
class SMSService {
  constructor() {
    this.apiKey = SMS_API_KEY;
    this.senderId = SMS_SENDER_ID;
    this.displayName = 'SMS';
  }

  async initialize() {
    return this.isConfigured();
  }

  async send(notification) {
    try {
      if (!this.isConfigured()) {
        throw new Error('SMS not configured');
      }

      const { recipients, message } = notification;
      const results = [];

      for (const recipient of recipients) {
        const phoneNumber = this.formatPhoneNumber(recipient);
        
        // In a real implementation, you would use an SMS API service
        // For now, we'll simulate SMS sending
        console.log(`Sending SMS to ${phoneNumber}:`, { message });
        
        results.push({
          recipient,
          success: true,
          messageId: `sms-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });
      }

      return { success: true, results };
    } catch (error) {
      console.error('Failed to send SMS:', error);
      throw error;
    }
  }

  formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    return phoneNumber.replace(/\D/g, '');
  }

  isConfigured() {
    return !!(this.apiKey && this.senderId);
  }
}

// Slack Service
class SlackService {
  constructor() {
    this.botToken = SLACK_BOT_TOKEN;
    this.webhookUrl = SLACK_WEBHOOK_URL;
    this.displayName = 'Slack';
  }

  async initialize() {
    return this.isConfigured();
  }

  async send(notification) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Slack not configured');
      }

      const { message, meetingData } = notification;
      
      // Create Slack message payload
      const payload = {
        text: message,
        blocks: this.createSlackBlocks(notification),
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

      return { success: true, messageId: `slack-${Date.now()}` };
    } catch (error) {
      console.error('Failed to send Slack message:', error);
      throw error;
    }
  }

  createSlackBlocks(notification) {
    const { type, meetingData } = notification;
    
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: this.getNotificationTitle(type),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: notification.message,
        },
      },
    ];

    if (meetingData?.joinUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Join Meeting',
            },
            url: meetingData.joinUrl,
            style: 'primary',
          },
        ],
      });
    }

    return blocks;
  }

  getNotificationTitle(type) {
    const titles = {
      meeting_invitation: '📅 Meeting Invitation',
      meeting_reminder: '⏰ Meeting Reminder',
      meeting_update: '🔄 Meeting Updated',
      meeting_cancellation: '❌ Meeting Cancelled',
    };
    
    return titles[type] || 'Meeting Notification';
  }

  isConfigured() {
    return !!(this.botToken || this.webhookUrl);
  }
}

export default new CommunicationService(); 