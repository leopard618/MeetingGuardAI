# 🚀 MeetingGuard AI - Milestone 5 Deployment Guide

## 📋 Overview

This guide covers the production deployment of MeetingGuard AI for **Milestone 5 - Technical Deployment Readiness**. The deployment includes:

- ✅ **Backend Infrastructure**: Deno Deploy + Supabase
- ✅ **SSL/HTTPS**: Automatic SSL certificates
- ✅ **Environment Management**: Secure environment variables
- ✅ **Monitoring**: Health checks + error tracking
- ✅ **Backups**: Automated Supabase backups
- ✅ **Test Builds**: iOS TestFlight + Android Play Console

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Native  │    │   Deno Deploy   │    │    Supabase     │
│   Mobile App    │◄──►│   Backend API   │◄──►│   PostgreSQL    │
│                 │    │                 │    │   Database      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   iOS/Android   │    │   Health Checks │    │   Auto Backups  │
│   Test Builds   │    │   + Monitoring  │    │   + RLS         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔧 Phase 1: Backend Infrastructure Setup

### 1.1 Supabase Database Setup

#### Step 1: Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note down your project URL and API keys

#### Step 2: Run Database Schema
```bash
# Connect to your Supabase project
# Go to SQL Editor and run the schema
# Copy and paste the contents of: supabase/schema.sql
```

#### Step 3: Configure Backups
1. Go to Settings → Database
2. Enable Point-in-Time Recovery
3. Set up automated daily backups

### 1.2 Deno Deploy Backend

#### Step 1: Install Deno CLI
```bash
# macOS/Linux
curl -fsSL https://deno.land/x/install/install.sh | sh

# Windows
iwr https://deno.land/x/install/install.ps1 -useb | iex
```

#### Step 2: Deploy to Deno Deploy
```bash
# Navigate to backend directory
cd deno

# Deploy to Deno Deploy
deno deploy --app=meetingguard-backend .
```

#### Step 3: Configure Environment Variables
In Deno Deploy dashboard:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long
CORS_ORIGIN=https://your-app-domain.com
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
DENO_ENV=production
```

## 🔐 Phase 2: Environment & Security

### 2.1 Frontend Environment Variables

Create `.env.production` in your project root:
```bash
# API Configuration
EXPO_PUBLIC_API_URL=https://your-deno-deploy-url.deno.dev
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# AI Services
EXPO_PUBLIC_OPENAI_API_KEY=your_openai_api_key

# Google Services
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Video Conferencing
EXPO_PUBLIC_ZOOM_API_KEY=your_zoom_api_key
EXPO_PUBLIC_TEAMS_CLIENT_ID=your_teams_client_id

# Error Tracking
EXPO_PUBLIC_SENTRY_DSN=your_sentry_dsn_url
```

### 2.2 SSL & Security Configuration

#### Deno Deploy (Automatic)
- ✅ SSL certificates are automatically provisioned
- ✅ HTTPS is enabled by default
- ✅ CORS is configured for your domain

#### Supabase (Automatic)
- ✅ SSL certificates are automatically provisioned
- ✅ Row Level Security (RLS) is enabled
- ✅ API keys are secure

## 📊 Phase 3: Monitoring & Health Checks

### 3.1 Health Check Endpoints

Test your backend health:
```bash
# Basic health check
curl https://your-deno-deploy-url.deno.dev/health

# Database health
curl https://your-deno-deploy-url.deno.dev/health/db

# Authentication health
curl https://your-deno-deploy-url.deno.dev/health/auth

# Calendar health
curl https://your-deno-deploy-url.deno.dev/health/calendar

# Comprehensive health check
curl https://your-deno-deploy-url.deno.dev/health/all
```

### 3.2 Sentry Error Tracking

#### Step 1: Create Sentry Project
1. Go to [sentry.io](https://sentry.io)
2. Create a new project for React Native
3. Get your DSN

#### Step 2: Configure Sentry
```bash
# Add to your environment variables
EXPO_PUBLIC_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
```

## 📱 Phase 4: Test Builds

### 4.1 iOS TestFlight Build

#### Step 1: Configure EAS Build
```bash
# Install EAS CLI
npm install -g @expo/eas-cli

# Login to Expo
eas login

# Configure build
eas build:configure
```

#### Step 2: Build for TestFlight
```bash
# Build iOS app
eas build --platform ios --profile preview

# Submit to TestFlight
eas submit --platform ios
```

### 4.2 Android Play Console Build

#### Step 1: Build Android APK
```bash
# Build Android app
eas build --platform android --profile preview
```

#### Step 2: Upload to Play Console
1. Go to [Google Play Console](https://play.google.com/console)
2. Create internal testing track
3. Upload your APK/AAB file

## ✅ Phase 5: QA Validation

### 5.1 Calendar Sync Testing

#### Google Calendar
- ✅ Already implemented and working
- Test with production Google OAuth credentials

#### Outlook Calendar (Future)
- 🔄 To be implemented in next milestone
- Requires Microsoft Graph API integration

#### Apple Calendar (Future)
- 🔄 To be implemented in next milestone
- Requires CalendarKit integration

### 5.2 Alert System Testing

#### Maximum Intensity Alerts
```bash
# Test full-screen takeover
# Verify audio, vibration, and voice synthesis
```

#### Medium Intensity Alerts
```bash
# Test persistent banner
# Verify standard audio and vibration
```

#### Light Intensity Alerts
```bash
# Test toast notifications
# Verify brief sound and auto-dismiss
```

### 5.3 Language Flow Testing

#### English Flow
- ✅ All UI elements in English
- ✅ Voice synthesis in English
- ✅ Date/time formatting

#### Spanish Flow
- ✅ All UI elements in Spanish
- ✅ Voice synthesis in Spanish
- ✅ Date/time formatting

## 🚀 Deployment Commands

### Quick Deployment Script
```bash
#!/bin/bash
# deploy.sh

echo "🚀 Starting MeetingGuard AI Deployment..."

# 1. Deploy backend
echo "📡 Deploying backend to Deno Deploy..."
cd deno
deno deploy --app=meetingguard-backend .

# 2. Build iOS
echo "📱 Building iOS app..."
cd ..
eas build --platform ios --profile preview

# 3. Build Android
echo "🤖 Building Android app..."
eas build --platform android --profile preview

echo "✅ Deployment complete!"
```

### Health Check Script
```bash
#!/bin/bash
# health-check.sh

API_URL="https://your-deno-deploy-url.deno.dev"

echo "🏥 Running health checks..."

# Basic health
curl -s "$API_URL/health" | jq '.'

# Database health
curl -s "$API_URL/health/db" | jq '.'

# Auth health
curl -s "$API_URL/health/auth" | jq '.'

# Calendar health
curl -s "$API_URL/health/calendar" | jq '.'

echo "✅ Health checks complete!"
```

## 🔄 Rollback Procedures

### Backend Rollback
```bash
# Deno Deploy automatically handles rollbacks
# Go to Deno Deploy dashboard → Deployments
# Click "Revert" on previous deployment
```

### Database Rollback
```bash
# Supabase Point-in-Time Recovery
# Go to Supabase dashboard → Database → Backups
# Select restore point and restore
```

### App Rollback
```bash
# iOS: TestFlight → Builds → Remove from testing
# Android: Play Console → Internal testing → Deactivate
```

## 📋 Pre-Deployment Checklist

- [ ] Supabase project created and schema applied
- [ ] Deno Deploy backend deployed and tested
- [ ] Environment variables configured
- [ ] Health checks passing
- [ ] Sentry error tracking configured
- [ ] iOS TestFlight build uploaded
- [ ] Android Play Console build uploaded
- [ ] Calendar sync tested (Google)
- [ ] Alert system tested (max/medium/light)
- [ ] Language flows tested (EN/ES)
- [ ] SSL certificates verified
- [ ] Backups enabled and tested

## 🎯 Success Criteria

✅ **App works end-to-end on both platforms**
- iOS app installs and runs on TestFlight
- Android app installs and runs on Play Console
- All features functional with production backend

✅ **Stable infrastructure**
- Health checks passing
- Error tracking operational
- SSL/HTTPS working
- Backups automated

✅ **Test builds available**
- iOS build in TestFlight internal testing
- Android build in Play Console internal testing
- Both builds installable and functional

## 📞 Support & Troubleshooting

### Common Issues

#### Backend Deployment Issues
```bash
# Check Deno Deploy logs
deno deploy logs --project=meetingguard-backend

# Verify environment variables
deno deploy env --project=meetingguard-backend
```

#### Database Connection Issues
```bash
# Test Supabase connection
curl -X GET "https://your-project.supabase.co/rest/v1/meetings" \
  -H "apikey: your_anon_key" \
  -H "Authorization: Bearer your_anon_key"
```

#### Build Issues
```bash
# Clear EAS build cache
eas build:clean

# Check build logs
eas build:list
```

### Contact Information
- **Backend Issues**: Check Deno Deploy dashboard
- **Database Issues**: Check Supabase dashboard
- **Build Issues**: Check EAS build logs
- **App Issues**: Check Sentry error tracking

---

**🎉 Congratulations! Your MeetingGuard AI app is now production-ready and deployed!**
