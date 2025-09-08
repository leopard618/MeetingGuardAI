# 🚀 MeetingGuard AI - App Store Deployment Guide

This guide will walk you through deploying your MeetingGuard AI app to both Google Play Store and Apple App Store.

## 📋 Pre-Deployment Checklist

### ✅ Code & Configuration
- [ ] All features working correctly
- [ ] No console errors or warnings
- [ ] App tested on both iOS and Android
- [ ] Environment variables configured for production
- [ ] Backend deployed and accessible
- [ ] Google OAuth credentials configured for production
- [ ] Stripe payment integration tested

### ✅ Assets & Metadata
- [ ] App icons (all required sizes)
- [ ] Screenshots for both platforms
- [ ] App description and keywords
- [ ] Privacy policy URL
- [ ] Terms of service URL
- [ ] Support contact information

## 🤖 Google Play Store Deployment

### Step 1: Prepare Android Build

1. **Update app.json for production:**
```json
{
  "expo": {
    "name": "MeetingGuard AI",
    "slug": "meetingguard-ai",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
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
      "bundleIdentifier": "com.meetingguardai.app"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "com.meetingguardai.app",
      "versionCode": 1
    },
    "web": {
      "favicon": "./assets/favicon.png"
    }
  }
}
```

2. **Configure EAS Build:**
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
npx eas-cli login

# Configure EAS
npx eas-cli build:configure
```

3. **Create eas.json:**
```json
{
  "cli": {
    "version": ">= 3.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "android": {
        "buildType": "aab"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### Step 2: Build Android App

```bash
# Build for production
npx eas-cli build --platform android --profile production

# Or build for both platforms
npx eas-cli build --platform all --profile production
```

### Step 3: Google Play Console Setup

1. **Create Google Play Console Account:**
   - Go to [Google Play Console](https://play.google.com/console)
   - Pay the $25 one-time registration fee
   - Complete developer profile

2. **Create New App:**
   - Click "Create app"
   - Fill in app details:
     - App name: "MeetingGuard AI"
     - Default language: English
     - App or game: App
     - Free or paid: Free (or Paid if you want to charge)

3. **Upload AAB File:**
   - Go to "Release" → "Production"
   - Click "Create new release"
   - Upload the `.aab` file from EAS build
   - Add release notes

4. **Complete Store Listing:**
   - App details
   - Graphics (screenshots, icon, feature graphic)
   - Content rating
   - Target audience
   - Data safety
   - App access

### Step 4: Required Information

**App Description:**
```
MeetingGuard AI - Your Intelligent Meeting Assistant

Transform your meetings with AI-powered insights, smart scheduling, and seamless calendar integration. MeetingGuard AI helps you prepare better, stay organized, and make every meeting count.

Key Features:
• AI-powered meeting preparation
• Smart calendar synchronization
• Automated meeting reminders
• Document and note management
• Google Calendar integration
• Cross-platform compatibility

Perfect for professionals, teams, and anyone who wants to maximize their meeting productivity.
```

**Keywords:** meeting, AI, calendar, productivity, scheduling, assistant, organization

## 🍎 Apple App Store Deployment

### Step 1: Apple Developer Account

1. **Enroll in Apple Developer Program:**
   - Go to [Apple Developer](https://developer.apple.com)
   - Pay $99/year fee
   - Complete enrollment process

2. **Create App ID:**
   - Go to Certificates, Identifiers & Profiles
   - Create new App ID: `com.meetingguardai.app`
   - Enable required capabilities

### Step 2: Build iOS App

```bash
# Build iOS app
npx eas-cli build --platform ios --profile production
```

### Step 3: App Store Connect Setup

1. **Create App in App Store Connect:**
   - Go to [App Store Connect](https://appstoreconnect.apple.com)
   - Click "My Apps" → "+"
   - Choose "New App"
   - Fill in app information

2. **App Information:**
   - Name: "MeetingGuard AI"
   - Bundle ID: `com.meetingguardai.app`
   - SKU: `meetingguard-ai-ios`
   - User Access: Full Access

3. **Upload Build:**
   - Use Transporter app or Xcode
   - Upload the `.ipa` file from EAS build
   - Wait for processing

### Step 4: App Store Listing

**App Description:**
```
MeetingGuard AI - Your Intelligent Meeting Assistant

Transform your meetings with AI-powered insights, smart scheduling, and seamless calendar integration. MeetingGuard AI helps you prepare better, stay organized, and make every meeting count.

Key Features:
• AI-powered meeting preparation
• Smart calendar synchronization  
• Automated meeting reminders
• Document and note management
• Google Calendar integration
• Cross-platform compatibility

Perfect for professionals, teams, and anyone who wants to maximize their meeting productivity.
```

**Keywords:** meeting, AI, calendar, productivity, scheduling, assistant, organization

## 🔧 Environment Configuration

### Production Environment Variables

**Backend (.env):**
```env
NODE_ENV=production
PORT=3000
SUPABASE_URL=your_production_supabase_url
SUPABASE_ANON_KEY=your_production_supabase_anon_key
GOOGLE_CLIENT_ID=your_production_google_client_id
GOOGLE_CLIENT_SECRET=your_production_google_client_secret
GOOGLE_REDIRECT_URI=your_production_redirect_uri
STRIPE_SECRET_KEY=your_production_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_production_webhook_secret
OPENAI_API_KEY=your_openai_api_key
```

**Frontend (app.json):**
```json
{
  "expo": {
    "extra": {
      "BACKEND_URL": "https://your-production-backend.com",
      "GOOGLE_CLIENT_ID": "your_production_google_client_id",
      "STRIPE_PUBLISHABLE_KEY": "your_production_stripe_publishable_key"
    }
  }
}
```

## 📱 Required Assets

### App Icons
- **Android:** 512x512px (adaptive icon)
- **iOS:** 1024x1024px
- **Web:** 192x192px, 512x512px

### Screenshots
- **Android:** Phone (2:1 ratio), Tablet (16:10 ratio)
- **iOS:** iPhone 6.7", iPhone 6.5", iPhone 5.5", iPad Pro

### Feature Graphic
- **Android:** 1024x500px

## 🚀 Deployment Commands

### Build Commands
```bash
# Build for Android
npx eas-cli build --platform android --profile production

# Build for iOS  
npx eas-cli build --platform ios --profile production

# Build for both platforms
npx eas-cli build --platform all --profile production
```

### Submit Commands
```bash
# Submit to Google Play Store
npx eas-cli submit --platform android

# Submit to Apple App Store
npx eas-cli submit --platform ios
```

## 📋 Final Checklist

### Before Submission
- [ ] App tested thoroughly on both platforms
- [ ] All features working in production environment
- [ ] Backend deployed and accessible
- [ ] Payment integration tested
- [ ] Google OAuth working with production URLs
- [ ] App icons and screenshots ready
- [ ] Privacy policy and terms of service published
- [ ] App description and keywords finalized

### After Submission
- [ ] Monitor app review status
- [ ] Respond to any review feedback
- [ ] Prepare for app launch
- [ ] Set up analytics and crash reporting
- [ ] Plan marketing and promotion

## 🆘 Troubleshooting

### Common Issues
1. **Build Failures:** Check EAS build logs
2. **App Store Rejection:** Review Apple's guidelines
3. **Google Play Rejection:** Check policy compliance
4. **OAuth Issues:** Verify redirect URIs
5. **Payment Issues:** Test with Stripe test mode first

### Support Resources
- [Expo Documentation](https://docs.expo.dev/)
- [Apple App Store Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policy](https://support.google.com/googleplay/android-developer/answer/9859348)

## 🎉 Launch Day

1. **Monitor Reviews:** Check both app stores for user feedback
2. **Analytics:** Set up app analytics to track usage
3. **Marketing:** Promote your app launch
4. **Support:** Be ready to respond to user questions
5. **Updates:** Plan for future updates and improvements

Good luck with your app launch! 🚀
