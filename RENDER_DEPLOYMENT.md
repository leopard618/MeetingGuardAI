# 🚀 MeetingGuard AI - Render Deployment Guide

## 📋 Overview

This guide covers deploying MeetingGuard AI backend to Render.com, a modern cloud platform that's perfect for Node.js applications.

## 🏗️ Architecture

- **Backend**: Node.js/Express API deployed on Render
- **Database**: Supabase (PostgreSQL)
- **Mobile Apps**: React Native/Expo with EAS Build
- **Authentication**: Google OAuth + JWT
- **Calendar Integration**: Google Calendar API

## 🛠️ Prerequisites

- [Render Account](https://render.com)
- [GitHub Account](https://github.com)
- [Supabase Account](https://supabase.com)
- [Expo Account](https://expo.dev)

## 🚀 Deploy to Render

### Step 1: Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with your GitHub account
3. Connect your GitHub repository

### Step 2: Deploy from GitHub
1. **Click "New +"** in your Render dashboard
2. **Select "Web Service"**
3. **Connect your GitHub repository**: `leopard618/MeetingGuardAI`
4. **Configure the service**:
   - **Name**: `meetingguard-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node api/index.js`
   - **Plan**: Free (or Pro if you need more resources)

### Step 3: Environment Variables
Add these environment variables in Render dashboard:

```env
NODE_ENV=production
PORT=10000
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=your_jwt_secret
```

### Step 4: Deploy
1. Click **"Create Web Service"**
2. Render will automatically:
   - Clone your repository
   - Install dependencies
   - Build your application
   - Deploy to a live URL

## 📊 Your Render URL

After deployment, you'll get a URL like:
```
https://meetingguard-backend-xxxxx.onrender.com
```

## 🧪 Testing Your Deployment

### Health Check
```bash
curl https://your-render-url.onrender.com/api/health
```

### Root Endpoint
```bash
curl https://your-render-url.onrender.com/
```

### API Endpoints
- `GET /api/health` - Health check
- `POST /api/auth/google/callback` - Google OAuth callback
- `POST /api/auth/validate` - JWT validation
- `GET /api/meetings` - List meetings
- `POST /api/meetings` - Create meeting
- `GET /api/calendar/events` - Calendar events

## 🔧 Configuration Files

### render.yaml (Auto-deployment)
```yaml
services:
  - type: web
    name: meetingguard-backend
    env: node
    buildCommand: npm install
    startCommand: node api/index.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
```

### package.json Scripts
```json
{
  "scripts": {
    "start": "node api/index.js",
    "dev": "nodemon api/index.js",
    "deploy:render": "echo 'Deploy to Render via GitHub integration'"
  }
}
```

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

## 📱 Mobile App Configuration

### Update Environment Variables
In your mobile app, update the API URL:

```javascript
// app.config.js or .env
EXPO_PUBLIC_API_URL=https://your-render-url.onrender.com
```

## 🔄 Auto-Deployment

Render automatically deploys when you push to your main branch:
1. Push changes to GitHub
2. Render detects the changes
3. Automatically rebuilds and deploys
4. Your app is updated in minutes

## 📊 Monitoring

### Render Dashboard
- **Logs**: Real-time application logs
- **Metrics**: CPU, memory, and response time
- **Deployments**: Build and deployment history
- **Environment Variables**: Secure configuration management

### Health Monitoring
```bash
# Test your deployment
curl https://your-render-url.onrender.com/api/health
```

## 🚨 Troubleshooting

### Common Issues

1. **Build Fails**
   - Check build logs in Render dashboard
   - Verify all dependencies are in package.json
   - Ensure Node.js version compatibility

2. **Environment Variables**
   - Verify all required variables are set
   - Check for typos in variable names
   - Ensure sensitive data is properly configured

3. **Application Crashes**
   - Check application logs
   - Verify database connection
   - Test locally with same environment

4. **Slow Response Times**
   - Free tier has cold starts
   - Consider upgrading to Pro plan
   - Optimize your application code

## 🎯 Success Criteria

- [ ] Backend deployed on Render
- [ ] Health check endpoint responding
- [ ] Environment variables configured
- [ ] Database schema applied to Supabase
- [ ] All API endpoints tested
- [ ] Mobile app configured with new URL
- [ ] Auto-deployment working

## 📞 Support

For deployment issues:
1. Check Render logs
2. Review build output
3. Verify environment variables
4. Test locally first
5. Contact Render support if needed

## 🎉 Benefits of Render

✅ **Easy Deployment** - GitHub integration  
✅ **Auto-scaling** - Handles traffic spikes  
✅ **SSL/HTTPS** - Automatic certificates  
✅ **Global CDN** - Fast worldwide access  
✅ **Free Tier** - Perfect for development  
✅ **Real-time Logs** - Easy debugging  
✅ **Environment Variables** - Secure configuration  

---

**🎉 Congratulations! Your MeetingGuard AI backend is now deployed on Render!**
