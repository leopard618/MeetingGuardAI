# 🚀 MeetingGuard AI - Deployment Checklist

## 📋 Pre-Deployment Checklist

### ✅ Code & Features
- [ ] All meeting creation features working
- [ ] Google OAuth working correctly
- [ ] Manual login/register working
- [ ] Google Calendar sync working
- [ ] Alert system functioning
- [ ] Payment integration tested
- [ ] No console errors or warnings
- [ ] App tested on both iOS and Android devices

### ✅ Backend & Infrastructure
- [ ] Backend deployed to production (Render/Heroku/AWS)
- [ ] Production database configured (Supabase)
- [ ] Environment variables set for production
- [ ] Google OAuth credentials configured for production URLs
- [ ] Stripe webhooks configured for production
- [ ] Backend health check endpoint working

### ✅ App Configuration
- [ ] app.json configured for production
- [ ] Bundle identifiers set correctly
- [ ] App icons and splash screens ready
- [ ] Permissions configured properly
- [ ] EAS project configured

## 🤖 Google Play Store

### Step 1: Build Android App
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
npx eas-cli login

# Build for production
npx eas-cli build --platform android --profile production
```

### Step 2: Google Play Console
- [ ] Create Google Play Console account ($25 fee)
- [ ] Create new app in console
- [ ] Upload AAB file from EAS build
- [ ] Complete store listing:
  - [ ] App description
  - [ ] Screenshots (phone and tablet)
  - [ ] Feature graphic (1024x500px)
  - [ ] App icon (512x512px)
  - [ ] Content rating
  - [ ] Data safety information
  - [ ] Privacy policy URL
  - [ ] Support contact information

### Step 3: Required Information
**App Name:** MeetingGuard AI
**Package Name:** com.meetingguard.ai
**Category:** Productivity
**Content Rating:** Everyone

## 🍎 Apple App Store

### Step 1: Apple Developer Account
- [ ] Enroll in Apple Developer Program ($99/year)
- [ ] Create App ID: com.meetingguard.ai
- [ ] Configure certificates and provisioning profiles

### Step 2: Build iOS App
```bash
# Build for production
npx eas-cli build --platform ios --profile production
```

### Step 3: App Store Connect
- [ ] Create app in App Store Connect
- [ ] Upload build using Transporter or Xcode
- [ ] Complete app information:
  - [ ] App description
  - [ ] Keywords
  - [ ] Screenshots (all required sizes)
  - [ ] App icon (1024x1024px)
  - [ ] Privacy policy URL
  - [ ] Support URL
  - [ ] Marketing URL (optional)

### Step 4: App Review Information
- [ ] Contact information
- [ ] Demo account (if needed)
- [ ] Review notes
- [ ] Export compliance information

## 🔧 Production Environment Setup

### Backend Environment Variables
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

### Frontend Configuration
Update app.json extra section:
```json
"extra": {
  "BACKEND_URL": "https://your-production-backend.com",
  "GOOGLE_CLIENT_ID": "your_production_google_client_id",
  "STRIPE_PUBLISHABLE_KEY": "your_production_stripe_publishable_key"
}
```

## 📱 Required Assets

### App Icons
- [ ] Android: 512x512px (adaptive icon)
- [ ] iOS: 1024x1024px
- [ ] Web: 192x192px, 512x512px

### Screenshots
- [ ] Android Phone: 2:1 ratio
- [ ] Android Tablet: 16:10 ratio
- [ ] iOS iPhone 6.7": 1290x2796px
- [ ] iOS iPhone 6.5": 1242x2688px
- [ ] iOS iPhone 5.5": 1242x2208px
- [ ] iOS iPad Pro: 2048x2732px

### Feature Graphic (Android)
- [ ] 1024x500px

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

## 📋 Final Pre-Submission Checklist

### App Functionality
- [ ] Meeting creation works
- [ ] Google sign-in works
- [ ] Manual login/register works
- [ ] Calendar sync works
- [ ] Alerts work
- [ ] Payment flow works
- [ ] All navigation works
- [ ] No crashes or errors

### Store Requirements
- [ ] Privacy policy published and accessible
- [ ] Terms of service published and accessible
- [ ] Support contact information provided
- [ ] App description finalized
- [ ] Keywords selected
- [ ] Screenshots taken and uploaded
- [ ] App icons ready
- [ ] Content rating completed

### Legal & Compliance
- [ ] Privacy policy covers all data collection
- [ ] Terms of service are clear
- [ ] App complies with platform guidelines
- [ ] All required permissions justified
- [ ] Data safety information accurate

## 🎯 Launch Strategy

### Pre-Launch
- [ ] Beta testing completed
- [ ] User feedback incorporated
- [ ] Marketing materials prepared
- [ ] Social media accounts ready
- [ ] Website updated

### Launch Day
- [ ] Monitor app review status
- [ ] Respond to any review feedback
- [ ] Announce launch on social media
- [ ] Send launch email to beta testers
- [ ] Monitor analytics and crash reports

### Post-Launch
- [ ] Respond to user reviews
- [ ] Monitor app performance
- [ ] Plan first update
- [ ] Gather user feedback
- [ ] Optimize app store listing

## 🆘 Support Resources

- [Expo Documentation](https://docs.expo.dev/)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [Apple App Store Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policy](https://support.google.com/googleplay/android-developer/answer/9859348)

## 📞 Quick Commands Reference

```bash
# Check EAS status
npx eas-cli whoami

# List builds
npx eas-cli build:list

# View build logs
npx eas-cli build:view [BUILD_ID]

# Submit to stores
npx eas-cli submit --platform android
npx eas-cli submit --platform ios

# Update app version
# Update version in app.json, then rebuild
```

Good luck with your deployment! 🚀
