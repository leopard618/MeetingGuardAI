# Environment Variables Template

## Frontend (.env file)

Copy this template and fill in your actual values:

```env
# Backend Configuration
BACKEND_URL=https://meetingguard-backend.onrender.com

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=https://meetingguard-backend.onrender.com/oauth/google
GOOGLE_REDIRECT_URI_SCHEME=your_app_scheme_here

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini

# App Configuration
EXPO_PUBLIC_APP_NAME=MeetingGuard
EXPO_PUBLIC_APP_VERSION=1.0.0
```

## How to get these values:

### Google OAuth Credentials:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "APIs & Services" → "Credentials"
3. Create or edit OAuth 2.0 Client ID
4. Copy Client ID and Client Secret

### OpenAI API Key:
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Navigate to "API Keys"
3. Create a new API key
4. Copy the key (starts with "sk-")

### App Scheme:
- This is your app's custom URL scheme for deep linking
- Example: `meetingguard://` or `com.yourapp.meetingguard://`
- Used for OAuth redirects in mobile apps

## Important Notes:

1. **Never commit your .env file to version control**
2. **Keep your API keys secure**
3. **The backend URL is already configured and deployed**
4. **Google OAuth redirect URI must match exactly what's in Google Cloud Console**

## Testing Checklist:

- [ ] Supabase database schema deployed
- [ ] Google OAuth redirect URI configured
- [ ] Frontend environment variables set
- [ ] Backend health check passes
- [ ] OAuth flow works end-to-end
