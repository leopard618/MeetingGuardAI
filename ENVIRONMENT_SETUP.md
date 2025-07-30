# Environment Setup Guide - Milestone 3 Integrations

This document outlines all the required environment variables and API configurations for the comprehensive integration system implemented in Milestone 3.

## Overview

The MeetingGuard application now supports:
- **Multiple Calendar Integrations**: Google Calendar, Microsoft Outlook, Apple Calendar, CalDAV
- **Video Conference Providers**: Zoom, Microsoft Teams, Google Meet
- **Communication Channels**: WhatsApp Business API, Email, SMS, Slack

## Environment Variables

Create a `.env` file in your project root with the following variables:

### 1. Google Calendar Integration
```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://meetingguard.com/auth/google/callback
```

### 2. Microsoft Graph API (Outlook/Office 365)
```env
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_TENANT_ID=your_tenant_id
```

### 3. Video Conference Providers

#### Zoom API
```env
ZOOM_CLIENT_ID=your_zoom_client_id
ZOOM_CLIENT_SECRET=your_zoom_client_secret
ZOOM_API_KEY=your_zoom_api_key
ZOOM_API_SECRET=your_zoom_api_secret
```

#### Microsoft Teams
```env
TEAMS_CLIENT_ID=your_teams_client_id
TEAMS_CLIENT_SECRET=your_teams_client_secret
```

#### Google Meet (uses same credentials as Google Calendar)
```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 4. Communication Channels

#### WhatsApp Business API
```env
WHATSAPP_API_KEY=your_whatsapp_api_key
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token
```

#### Email (SMTP)
```env
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_USERNAME=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
```

#### SMS Service
```env
SMS_API_KEY=your_sms_api_key
SMS_SENDER_ID=MeetingGuard
```

#### Slack Integration
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/webhook/url
```

## API Setup Instructions

### 1. Google Calendar & Meet Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Calendar API and Google Meet API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs
6. Download the credentials and add to your `.env` file

### 2. Microsoft Graph API Setup

1. Go to [Azure Portal](https://portal.azure.com/)
2. Register a new application
3. Add API permissions for:
   - Calendars.ReadWrite
   - OnlineMeetings.ReadWrite
4. Create a client secret
5. Note your Tenant ID
6. Add the credentials to your `.env` file

### 3. Zoom API Setup

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/)
2. Create a Server-to-Server OAuth app
3. Add scopes for meetings
4. Generate credentials
5. Add to your `.env` file

### 4. WhatsApp Business API Setup

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create a WhatsApp Business app
3. Set up phone number
4. Generate access token
5. Add credentials to `.env` file

### 5. Email Setup (Gmail Example)

1. Enable 2-factor authentication on your Gmail account
2. Generate an App Password
3. Use SMTP settings:
   - Host: smtp.gmail.com
   - Port: 587
   - Security: STARTTLS

### 6. SMS Service Setup

Choose an SMS provider (Twilio, AWS SNS, etc.):
1. Sign up for the service
2. Get API credentials
3. Add to `.env` file

### 7. Slack Setup

1. Go to [Slack API](https://api.slack.com/)
2. Create a new app
3. Add bot token scopes
4. Create incoming webhook
5. Add credentials to `.env` file

## CalDAV Configuration

For CalDAV integration, you'll need to configure the service programmatically:

```javascript
// Example CalDAV configuration
const caldavConfig = {
  serverUrl: 'https://your-caldav-server.com',
  username: 'your_username',
  password: 'your_password',
  calendarUrl: 'https://your-caldav-server.com/calendars/username/default/'
};

// Initialize CalDAV service
await meetingManager.calendars.caldav.initialize(caldavConfig);
```

## Testing Configuration

### 1. Test Calendar Integrations
```javascript
// Test Google Calendar
const googleStatus = await meetingManager.calendars.google.isAuthenticated();

// Test Microsoft Calendar
const microsoftStatus = await meetingManager.calendars.microsoft.isAuthenticated();

// Test Apple Calendar
const appleStatus = await meetingManager.calendars.apple.isAuthenticated();
```

### 2. Test Video Conference Providers
```javascript
// Test Zoom
const zoomStatus = await meetingManager.videoConference.providers.zoom.isAuthenticated();

// Test Teams
const teamsStatus = await meetingManager.videoConference.providers.teams.isAuthenticated();

// Test Google Meet
const meetStatus = await meetingManager.videoConference.providers.meet.isAuthenticated();
```

### 3. Test Communication Channels
```javascript
// Test WhatsApp
const whatsappStatus = meetingManager.communication.channels.whatsapp.isConfigured();

// Test Email
const emailStatus = meetingManager.communication.channels.email.isConfigured();

// Test SMS
const smsStatus = meetingManager.communication.channels.sms.isConfigured();

// Test Slack
const slackStatus = meetingManager.communication.channels.slack.isConfigured();
```

## Security Considerations

1. **Never commit `.env` files** to version control
2. **Use environment-specific configurations** for development, staging, and production
3. **Rotate API keys regularly**
4. **Use least-privilege access** for all API permissions
5. **Monitor API usage** and set up alerts for unusual activity
6. **Encrypt sensitive data** in transit and at rest

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Check API credentials
   - Verify redirect URIs
   - Ensure proper scopes are granted

2. **Calendar Sync Issues**
   - Check calendar permissions
   - Verify timezone settings
   - Ensure calendar is accessible

3. **Video Conference Issues**
   - Verify API quotas
   - Check meeting settings
   - Ensure proper authentication

4. **Communication Issues**
   - Check API rate limits
   - Verify phone numbers/emails
   - Test with simple messages first

### Debug Mode

Enable debug logging by setting:
```env
DEBUG=true
NODE_ENV=development
```

## Production Deployment

1. **Use secure environment variables** in your deployment platform
2. **Set up monitoring** for all integrations
3. **Implement retry logic** for failed API calls
4. **Set up webhook endpoints** for real-time updates
5. **Configure backup services** for critical integrations

## Support

For issues with specific APIs:
- [Google Calendar API](https://developers.google.com/calendar)
- [Microsoft Graph API](https://docs.microsoft.com/en-us/graph/)
- [Zoom API](https://marketplace.zoom.us/docs/api-reference)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- [Slack API](https://api.slack.com/)

## Next Steps

After setting up the environment variables:

1. **Test each integration** individually
2. **Configure notification preferences**
3. **Set up monitoring and alerts**
4. **Train users** on the new features
5. **Monitor usage** and optimize performance 