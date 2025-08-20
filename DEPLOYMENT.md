# 🚀 MeetingGuard AI - Deployment Guide

## 📋 Overview

This guide covers deploying MeetingGuard AI to production using Vercel for the backend and EAS Build for mobile apps.

## 🏗️ Architecture

- **Backend**: Node.js/Express API deployed on Vercel
- **Database**: Supabase (PostgreSQL)
- **Mobile Apps**: React Native/Expo with EAS Build
- **Authentication**: Google OAuth + JWT
- **Calendar Integration**: Google Calendar API

## 🛠️ Prerequisites

- [Vercel Account](https://vercel.com)
- [Supabase Account](https://supabase.com)
- [Expo Account](https://expo.dev)
- [Google Cloud Console](https://console.cloud.google.com)
- [Apple Developer Account](https://developer.apple.com)
- [Google Play Console](https://play.google.com/console)

## 🚀 Backend Deployment (Vercel)

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Step 2: Deploy to Vercel
```bash
# Login to Vercel
vercel login

# Deploy to production
npm run deploy:backend
```

### Step 3: Set Environment Variables
In Vercel dashboard, add these environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `JWT_SECRET`

## 🗄️ Database Setup (Supabase)

### Step 1: Create Supabase Project
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create new project
3. Note down your project URL and API keys

### Step 2: Apply Database Schema
```sql
-- Run this in Supabase SQL Editor
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  google_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meetings table
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  location TEXT,
  attendees JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notes table
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view own meetings" ON meetings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own meetings" ON meetings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meetings" ON meetings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own meetings" ON meetings FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own notes" ON notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notes" ON notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notes" ON notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own notes" ON notes FOR DELETE USING (auth.uid() = user_id);
```

## 📱 Mobile App Deployment

### iOS (TestFlight)
```bash
# Build for iOS
npm run deploy:ios

# Submit to TestFlight
eas submit --platform ios
```

### Android (Play Console)
```bash
# Build for Android
npm run deploy:android

# Submit to Play Console
eas submit --platform android
```

## 🔧 Environment Variables

### Backend (.env)
```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=your_jwt_secret
```

### Mobile App (app.config.js)
```javascript
export default {
  expo: {
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://your-vercel-url.vercel.app',
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },
  },
};
```

## 🧪 Testing

### Health Check
```bash
# Test backend health
npm run health-check
```

### API Endpoints
- `GET /api/health` - Health check
- `POST /api/auth/google/callback` - Google OAuth callback
- `POST /api/auth/validate` - JWT validation
- `GET /api/meetings` - List meetings
- `POST /api/meetings` - Create meeting
- `GET /api/calendar/events` - Calendar events

## 📊 Monitoring

### Vercel Analytics
- Built-in analytics in Vercel dashboard
- Function execution metrics
- Error tracking

### Supabase Monitoring
- Database performance metrics
- Query analytics
- Real-time logs

## 🔄 CI/CD

### GitHub Actions (Optional)
```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run deploy:backend
```

## 🚨 Troubleshooting

### Common Issues

1. **Vercel Deployment Fails**
   - Check environment variables
   - Verify Node.js version compatibility
   - Check function size limits

2. **Database Connection Issues**
   - Verify Supabase credentials
   - Check RLS policies
   - Test connection in Supabase dashboard

3. **Mobile Build Fails**
   - Check EAS configuration
   - Verify app.json settings
   - Check for missing dependencies

## 📞 Support

For deployment issues:
1. Check Vercel logs
2. Review Supabase logs
3. Check EAS build logs
4. Contact support with error details

## 🎯 Success Criteria

- [ ] Backend deployed on Vercel
- [ ] Database schema applied to Supabase
- [ ] Environment variables configured
- [ ] Health check endpoint responding
- [ ] iOS app built and submitted to TestFlight
- [ ] Android app built and submitted to Play Console
- [ ] All API endpoints tested
- [ ] Monitoring configured
