# MeetingGuard Backend

Production-ready backend server for the MeetingGuard mobile application, built with Node.js, Express, and Supabase.

## Features

- 🔐 **Secure Authentication** - Google OAuth with JWT tokens
- 📅 **Calendar Integration** - Google Calendar sync
- 🤖 **AI Integration** - OpenAI GPT for meeting management
- 📁 **File Management** - Secure file uploads with Supabase Storage
- 🛡️ **Security** - Rate limiting, CORS, Helmet, input validation
- 📊 **Database** - PostgreSQL with Supabase (Row Level Security)
- 🚀 **Production Ready** - SSL/HTTPS, environment variables, logging

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase)
- **Authentication**: JWT + Google OAuth
- **File Storage**: Supabase Storage
- **AI**: OpenAI GPT-3.5/4
- **Security**: Helmet, CORS, Rate Limiting
- **Deployment**: Render.com

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Supabase account and project
- Google Cloud Console project with OAuth credentials
- OpenAI API key

### Local Development

1. **Clone and install dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your actual values
   ```

3. **Set up Supabase database**
   - Create a new Supabase project
   - Run the SQL schema from `supabase-schema.sql`
   - Get your project URL and service role key

4. **Configure Google OAuth**
   - Create OAuth 2.0 credentials in Google Cloud Console
   - Add redirect URI: `http://localhost:3000/auth`
   - Update `.env` with client ID and secret

5. **Start the server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3000`

## API Endpoints

### Authentication
- `GET /auth` - OAuth redirect handler
- `GET /api/auth/google/callback` - Google OAuth callback
- `POST /api/auth/google/refresh` - Refresh Google tokens
- `GET /api/auth/profile` - Get user profile
- `PUT /api/auth/profile` - Update user profile
- `POST /api/auth/logout` - Logout user

### Meetings
- `GET /api/meetings` - Get all meetings
- `GET /api/meetings/:id` - Get specific meeting
- `POST /api/meetings` - Create meeting
- `PUT /api/meetings/:id` - Update meeting
- `DELETE /api/meetings/:id` - Delete meeting
- `GET /api/meetings/range/:startDate/:endDate` - Get meetings by date range

### Calendar
- `GET /api/calendar/events` - Get Google Calendar events
- `POST /api/calendar/events` - Create calendar event
- `PUT /api/calendar/events/:eventId` - Update calendar event
- `DELETE /api/calendar/events/:eventId` - Delete calendar event
- `POST /api/calendar/sync` - Sync calendar with local meetings

### AI
- `POST /api/ai/chat` - Generate AI chat response
- `POST /api/ai/meeting` - Generate meeting-specific AI response
- `GET /api/ai/validate` - Validate OpenAI API key

### Files
- `POST /api/files/upload` - Upload file
- `GET /api/files` - Get user's files
- `DELETE /api/files/:fileId` - Delete file

### Users
- `GET /api/users/preferences` - Get user preferences
- `PUT /api/users/preferences` - Update user preferences
- `GET /api/users/stats` - Get user statistics
- `DELETE /api/users/account` - Delete user account

### Health Check
- `GET /health` - Server health status

## Environment Variables

```env
# Server Configuration
NODE_ENV=production
PORT=3000

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/auth

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key

# File Upload Configuration
MAX_FILE_SIZE=10485760
ALLOWED_FILE_TYPES=image/jpeg,image/png,image/gif,application/pdf,...

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS Configuration
ALLOWED_ORIGINS=https://meetingguard.app,https://www.meetingguard.app,...
```

## Deployment

### Render.com Deployment

1. **Create a new Web Service**
   - Connect your GitHub repository
   - Set build command: `npm install`
   - Set start command: `npm start`
   - Choose Node.js environment

2. **Configure Environment Variables**
   - Add all variables from your `.env` file
   - Set `NODE_ENV=production`
   - Update `GOOGLE_REDIRECT_URI` to your Render domain

3. **Deploy**
   - Render will automatically deploy on push to main branch
   - Your app will be available at `https://your-app-name.onrender.com`

### Supabase Setup

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create new project
   - Note your project URL and service role key

2. **Run Database Schema**
   - Go to SQL Editor in Supabase dashboard
   - Copy and paste the contents of `supabase-schema.sql`
   - Execute the script

3. **Configure Storage**
   - The schema creates a `meeting-files` bucket automatically
   - Storage policies are set up for secure file access

### Google OAuth Setup

1. **Create Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create new project or select existing
   - Enable Google+ API and Google Calendar API

2. **Create OAuth Credentials**
   - Go to APIs & Services > Credentials
   - Create OAuth 2.0 Client ID
   - Add authorized redirect URIs:
     - Development: `http://localhost:3000/auth`
     - Production: `https://your-domain.com/auth`

3. **Update Environment Variables**
   - Add your client ID and secret to environment variables

## Security Features

- **JWT Authentication** - Secure token-based authentication
- **Rate Limiting** - Prevent abuse with request limits
- **CORS Protection** - Configured for specific origins
- **Input Validation** - All inputs validated with express-validator
- **SQL Injection Protection** - Using parameterized queries
- **Row Level Security** - Database-level access control
- **Helmet** - Security headers
- **Environment Variables** - Secure configuration management

## Database Schema

The database includes the following tables:

- `users` - User profiles and authentication
- `user_tokens` - OAuth tokens storage
- `user_preferences` - User settings and preferences
- `meetings` - Meeting data
- `meeting_participants` - Meeting attendees
- `meeting_attachments` - Files attached to meetings
- `files` - File metadata
- `calendar_events` - Google Calendar sync

All tables have Row Level Security (RLS) enabled for data protection.

## File Upload

Files are stored in Supabase Storage with the following features:

- **Secure Access** - Files are protected by RLS policies
- **Type Validation** - Only allowed file types accepted
- **Size Limits** - Configurable file size limits
- **Public URLs** - Files accessible via public URLs
- **Automatic Cleanup** - Files deleted when meetings are deleted

## Monitoring and Logging

- **Morgan** - HTTP request logging
- **Error Handling** - Centralized error handling with detailed responses
- **Health Checks** - `/health` endpoint for monitoring
- **Graceful Shutdown** - Proper cleanup on server shutdown

## Development

### Scripts

```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm test           # Run tests
npm run build      # Build for production
```

### Testing

```bash
npm test           # Run all tests
npm run test:watch # Run tests in watch mode
```

## Troubleshooting

### Common Issues

1. **CORS Errors**
   - Check `ALLOWED_ORIGINS` in environment variables
   - Ensure your domain is included

2. **Google OAuth Errors**
   - Verify redirect URI matches exactly
   - Check client ID and secret
   - Ensure APIs are enabled in Google Cloud Console

3. **Database Connection Issues**
   - Verify Supabase URL and service role key
   - Check if database schema is properly set up

4. **File Upload Issues**
   - Check Supabase Storage bucket exists
   - Verify storage policies are set up
   - Check file size and type limits

### Logs

Check Render.com logs for detailed error information:
- Go to your Render dashboard
- Select your service
- Click on "Logs" tab

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details
