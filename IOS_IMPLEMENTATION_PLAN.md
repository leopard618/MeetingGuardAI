# 🍎 iOS App Store Implementation Plan

## 🚨 **CRITICAL BLOCKER: In-App Purchases**

Your app **WILL BE REJECTED** if you submit with the current Stripe implementation. Apple requires ALL subscriptions to go through their In-App Purchase system.

## 📋 **Implementation Steps**

### **Phase 1: Apple Developer Setup (Week 1)**

1. **Enroll in Apple Developer Program**
   - Cost: $99/year
   - Time: 1-2 days for approval
   - Required for App Store submission

2. **Create App Store Connect Listing**
   - App ID: `com.meetingguard.ai`
   - Bundle ID: `com.meetingguard.ai`
   - App Name: "MeetingGuard AI"

3. **Configure Certificates**
   - Distribution Certificate
   - Provisioning Profile
   - Push Notification Certificate (if needed)

### **Phase 2: In-App Purchase Implementation (Week 2-3)**

#### **Required Changes:**

1. **Install StoreKit Dependencies**
```bash
npm install expo-in-app-purchases
# or
npx expo install expo-in-app-purchases
```

2. **Create Subscription Products in App Store Connect**
   - Pro Monthly: $9.99/month (adjusted for Apple's 30% cut)
   - Pro Yearly: $7.99/month (billed annually)
   - Premium Monthly: $19.99/month
   - Premium Yearly: $14.99/month (billed annually)

3. **Update Billing Service**
```javascript
// src/api/billingService.js - NEW IMPLEMENTATION
import * as InAppPurchases from 'expo-in-app-purchases';

class AppleBillingService {
  async initialize() {
    await InAppPurchases.connectAsync();
  }

  async getProducts() {
    const products = await InAppPurchases.getProductsAsync([
      'com.meetingguard.ai.pro.monthly',
      'com.meetingguard.ai.pro.yearly',
      'com.meetingguard.ai.premium.monthly',
      'com.meetingguard.ai.premium.yearly'
    ]);
    return products;
  }

  async purchaseSubscription(productId) {
    const result = await InAppPurchases.purchaseItemAsync(productId);
    return result;
  }

  async restorePurchases() {
    const result = await InAppPurchases.restorePurchasesAsync();
    return result;
  }
}
```

4. **Update Pricing Page**
```javascript
// src/pages/Pricing.jsx - UPDATE
const handleSubscribe = async (planId) => {
  try {
    const productId = `com.meetingguard.ai.${planId}`;
    const result = await billingService.purchaseSubscription(productId);
    
    if (result.responseCode === InAppPurchases.IAPResponseCode.OK) {
      // Handle successful purchase
      await updateUserSubscription(result);
    }
  } catch (error) {
    console.error('Purchase failed:', error);
  }
};
```

### **Phase 3: App Store Assets (Week 4)**

1. **Screenshots Required:**
   - iPhone 6.7": 1290x2796px
   - iPhone 6.5": 1242x2688px
   - iPhone 5.5": 1242x2208px
   - iPad Pro: 2048x2732px

2. **App Icon:**
   - Size: 1024x1024px
   - Format: PNG (no transparency)
   - Current: ✅ Ready

3. **App Preview Video (Optional):**
   - Duration: 15-30 seconds
   - Show key features

### **Phase 4: Privacy and Compliance (Week 5)**

1. **Privacy Policy URL**
   - Host on your website
   - Must be accessible web URL
   - Current: ✅ Implemented in app

2. **App Store Privacy Labels**
   - Data Collection: Yes
   - Data Types: Contact Info, Usage Data
   - Data Usage: App Functionality, Analytics
   - Data Sharing: No

### **Phase 5: Testing and Submission (Week 6)**

1. **TestFlight Testing**
   - Internal testing
   - External testing (optional)
   - Beta feedback collection

2. **Final Build and Submit**
```bash
# Build for iOS
npx eas build --platform ios --profile production

# Submit to App Store
npx eas submit --platform ios
```

## 🔧 **Required Code Changes**

### **1. Update app.config.js**
```javascript
ios: {
  supportsTablet: true,
  bundleIdentifier: "com.meetingguard.ai",
  buildNumber: "1",
  infoPlist: {
    "NSCalendarsUsageDescription": "This app needs access to your calendar to create and manage meetings.",
    "NSContactsUsageDescription": "This app needs access to your contacts to add meeting participants.",
    "NSMicrophoneUsageDescription": "This app needs access to your microphone for voice notes and meeting recordings.",
    "ITSAppUsesNonExemptEncryption": false
  }
}
```

### **2. Update eas.json**
```json
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "your-app-store-connect-app-id",
        "appleTeamId": "your-apple-team-id"
      }
    }
  }
}
```

### **3. Remove Stripe Dependencies**
```bash
# Remove these from package.json
npm uninstall stripe
```

### **4. Add StoreKit Dependencies**
```bash
npx expo install expo-in-app-purchases
```

## 💰 **Pricing Strategy**

### **Current Stripe Prices:**
- Pro Monthly: $7.99
- Pro Yearly: $5.99/month
- Premium Monthly: $14.99
- Premium Yearly: $11.24/month

### **New Apple Prices (with 30% commission):**
- Pro Monthly: $9.99 (was $7.99)
- Pro Yearly: $7.99/month (was $5.99)
- Premium Monthly: $19.99 (was $14.99)
- Premium Yearly: $14.99/month (was $11.24)

## ⚠️ **Critical Warnings**

1. **Apple's 30% Commission**: You'll lose 30% of subscription revenue to Apple
2. **No External Payment Links**: Any links to external payment systems will cause rejection
3. **Subscription Management**: Users must manage subscriptions through Apple's system
4. **Review Process**: Apple reviews can take 1-7 days
5. **Guidelines Compliance**: Must follow all App Store Review Guidelines

## 📅 **Timeline**

- **Week 1**: Apple Developer setup
- **Week 2-3**: In-App Purchase implementation
- **Week 4**: Assets and metadata
- **Week 5**: Privacy and compliance
- **Week 6**: Testing and submission

**Total Time**: 6 weeks
**Total Cost**: $99 (Apple Developer Program) + development time

## 🚨 **Immediate Action Required**

1. **STOP** using Stripe for iOS subscriptions
2. **START** Apple Developer Program enrollment
3. **IMPLEMENT** StoreKit 2 for subscriptions
4. **PREPARE** all required assets

**Without these changes, your app will be rejected immediately.**
