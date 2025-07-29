# AI Meeting Agent Setup Guide

This guide will help you set up the AI Meeting Agent with OpenAI GPT-4o-mini and Google Calendar integration.

## Prerequisites

- Node.js (v16 or higher)
- Expo CLI
- OpenAI API key
- Google Cloud Project with Calendar API enabled

## 1. Environment Configuration

### Create Environment File

Copy the example environment file and configure your API keys:

```bash
cp env.example .env
```

### Configure Environment Variables

Edit the `.env` file with your actual API keys:

```env
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini

# Google Calendar Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=your_redirect_uri_here

# App Configuration
APP_ENV=development
API_BASE_URL=https://api.openai.com/v1
```

## 2. OpenAI Setup

### Get OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key and add it to your `.env` file

### Verify OpenAI Access

The app will automatically validate your OpenAI API key on startup. Make sure you have sufficient credits for API usage.

## 3. Google Calendar Setup

### Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Calendar API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

### Configure OAuth 2.0

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Configure the OAuth consent screen:
   - User Type: External (or Internal if using Google Workspace)
   - App name: "Meeting Guard AI"
   - User support email: Your email
   - Developer contact information: Your email
   - Scopes: Add `https://www.googleapis.com/auth/calendar` and `https://www.googleapis.com/auth/calendar.events`

4. Create OAuth 2.0 Client ID:
   - Application type: Web application
   - Name: "Meeting Guard AI Web Client"
   - Authorized redirect URIs: Add your redirect URI (e.g., `https://your-app.com/auth/callback`)

5. Copy the Client ID and Client Secret to your `.env` file

### Configure Redirect URI

For development with Expo, you can use:
- `https://auth.expo.io/@your-expo-username/your-app-slug`

For production, use your actual domain:
- `https://yourdomain.com/auth/callback`

## 4. Install Dependencies

Install the required dependencies:

```bash
npm install
```

### Additional Dependencies

The following dependencies are already included in package.json:
- `expo-auth-session`: For Google OAuth authentication
- `expo-calendar`: For calendar access
- `react-native-dotenv`: For environment variables
- `date-fns`: For date manipulation

## 5. Babel Configuration

Make sure your `babel.config.js` includes the dotenv plugin:

```javascript
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module:react-native-dotenv', {
        moduleName: '@env',
        path: '.env',
        blacklist: null,
        whitelist: null,
        safe: false,
        allowUndefined: true,
      }],
    ],
  };
};
```

## 6. App Configuration

### Update app.json

Add the necessary permissions and schemes to your `app.json`:

```json
{
  "expo": {
    "name": "Meeting Guard AI",
    "slug": "meeting-guard-ai",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "assetBundlePatterns": [
      "**/*"
    ],
    "ios": {
      "supportsTablet": true,
      "infoPlist": {
        "NSCalendarsUsageDescription": "This app needs access to your calendar to create and manage meetings."
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#FFFFFF"
      },
      "permissions": [
        "READ_CALENDAR",
        "WRITE_CALENDAR"
      ]
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "scheme": "meetingguardai",
    "plugins": [
      "expo-calendar"
    ]
  }
}
```

## 7. Testing the Setup

### Start the Development Server

```bash
npm start
```

### Test Features

1. **OpenAI Integration**: Send a message in the AI chat to test OpenAI connectivity
2. **Google Calendar Authentication**: Click the "Authenticate" button to test Google OAuth
3. **Meeting Creation**: Try creating a meeting through the AI chat

## 8. Troubleshooting

### Common Issues

#### OpenAI API Errors
- **Error**: "Invalid API key"
  - **Solution**: Verify your API key in the `.env` file
- **Error**: "Insufficient credits"
  - **Solution**: Add credits to your OpenAI account

#### Google Calendar Authentication Issues
- **Error**: "Invalid redirect URI"
  - **Solution**: Verify the redirect URI in Google Cloud Console matches your app
- **Error**: "Calendar permission denied"
  - **Solution**: Make sure calendar permissions are enabled in app.json

#### Environment Variables Not Loading
- **Error**: "Cannot read property of undefined"
  - **Solution**: Restart the development server after changing `.env`
- **Error**: "Module not found: @env"
  - **Solution**: Check babel configuration and restart server

### Debug Mode

Enable debug logging by adding to your `.env`:

```env
DEBUG=true
```

## 9. Production Deployment

### Environment Variables

For production, use secure environment variable management:

- **Expo**: Use Expo's environment variable system
- **Vercel/Netlify**: Use their environment variable settings
- **Self-hosted**: Use proper secret management

### Security Considerations

1. **Never commit `.env` files** to version control
2. **Use environment-specific configurations**
3. **Implement proper error handling**
4. **Add rate limiting for API calls**
5. **Use HTTPS in production**

## 10. API Usage and Costs

### OpenAI Costs

- GPT-4o-mini: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- Typical meeting creation: ~500-1000 tokens
- Estimated cost per meeting: $0.001-0.002

### Google Calendar API

- Free tier: 1,000,000 queries per day
- Typical usage: Well within free limits

## 11. Features Overview

### AI Capabilities
- ✅ Natural language meeting creation
- ✅ Meeting updates and modifications
- ✅ Meeting deletion
- ✅ Availability checking
- ✅ Smart scheduling suggestions
- ✅ Multi-language support (English/Spanish)

### Calendar Integration
- ✅ Google Calendar CRUD operations
- ✅ Real-time availability checking
- ✅ Conflict detection
- ✅ Participant management
- ✅ Meeting reminders

### User Experience
- ✅ Intuitive chat interface
- ✅ Meeting confirmation modals
- ✅ Real-time status indicators
- ✅ Error handling and feedback
- ✅ Responsive design

## 12. Support

For issues and questions:
1. Check the troubleshooting section above
2. Review the console logs for detailed error messages
3. Verify all environment variables are correctly set
4. Ensure all dependencies are properly installed

## 13. Next Steps

After successful setup, consider:
- Adding more calendar providers (Outlook, Apple Calendar)
- Implementing meeting templates
- Adding recurring meeting support
- Integrating with video conferencing platforms
- Adding meeting analytics and insights