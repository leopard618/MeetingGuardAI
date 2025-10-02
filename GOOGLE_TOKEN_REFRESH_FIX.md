# 🔧 Fix Google Token Refresh Errors

## ❌ **Current Problem:**
```
[TokenManager] Google Client Secret not configured
[TokenScheduler] Automatic token refresh failed
```

These errors occur because **Google Client Secret is missing**, which is required to refresh expired access tokens automatically.

---

## ✅ **Solution: Configure Google Client Secret**

### **Step 1: Get Your Client Secret from Google Cloud Console**

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/apis/credentials
   - Login with your Google account

2. **Find Your OAuth 2.0 Client ID:**
   - Look for: `929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com`
   - Click on it to open details

3. **Copy the Client Secret:**
   - You'll see two fields:
     - **Client ID**: `929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com`
     - **Client secret**: `GOCSPX-xxxxxxxxxxxxxxxxxxxx` (this is what you need!)
   - Click the **copy icon** next to "Client secret"
   - Save it securely!

### **Step 2: Create .env File**

Create a file named `.env` in your project root:

```bash
E:\Workspace\AI\MeetingGuard\workspace\meeting\.env
```

**File contents:**

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=PASTE_YOUR_CLIENT_SECRET_HERE
GOOGLE_REDIRECT_URI=https://meetingguard-backend.onrender.com/oauth/google
GOOGLE_REDIRECT_URI_SCHEME=meetingguard

# Expo Public Variables (accessible in React Native app)
EXPO_PUBLIC_GOOGLE_CLIENT_ID=929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=PASTE_YOUR_CLIENT_SECRET_HERE
EXPO_PUBLIC_BACKEND_URL=http://localhost:3000

# Backend URL
BACKEND_URL=http://localhost:3000
```

**⚠️ IMPORTANT:** Replace `PASTE_YOUR_CLIENT_SECRET_HERE` with your actual client secret!

### **Step 3: Install Required Package**

Your app needs `react-native-dotenv` to read environment variables:

```bash
npm install react-native-dotenv
```

### **Step 4: Configure babel.config.js**

Check if your `babel.config.js` includes the dotenv plugin. It should look like this:

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
      [
        'module:react-native-dotenv',
        {
          envName: 'APP_ENV',
          moduleName: '@env',
          path: '.env',
          safe: false,
          allowUndefined: true,
          verbose: false,
        },
      ],
    ],
  };
};
```

### **Step 5: Restart the App**

```bash
# Clear cache and restart
npx expo start --clear

# Press 'r' in terminal to reload
# OR close and reopen the app
```

---

## 🔐 **Security Notes:**

### ⚠️ **NEVER commit .env to Git!**

Add this to your `.gitignore`:

```gitignore
# Environment variables
.env
.env.local
.env.*.local
```

### 📱 **For Production:**

When building for production, use Expo's secure environment variables:

```bash
# Add secrets to Expo
npx eas secret:create --name GOOGLE_CLIENT_SECRET --value YOUR_SECRET_HERE
```

---

## 🧪 **Verify the Fix Works:**

### **Test 1: Check Environment Variables**

Add this to your `App.js` temporarily:

```javascript
import { GOOGLE_CLIENT_SECRET } from '@env';

console.log('Client Secret configured:', !!GOOGLE_CLIENT_SECRET);
console.log('Client Secret length:', GOOGLE_CLIENT_SECRET?.length || 0);
```

**Expected output:**
```
Client Secret configured: true
Client Secret length: 35
```

### **Test 2: Check Token Refresh**

After restarting the app, check the console logs:

**Before fix (ERROR):**
```
❌ [TokenManager] Google Client Secret not configured
❌ [TokenScheduler] Automatic token refresh failed
```

**After fix (SUCCESS):**
```
✅ [TokenManager] Token refreshed successfully
✅ [TokenScheduler] Token is valid for 59 more minutes
```

### **Test 3: Wait for Automatic Refresh**

1. **Sign in** with Google
2. **Wait 30-45 minutes** (or close and reopen the app)
3. **Check logs** - you should see:

```
🔄 [TokenScheduler] Checking token status...
🔄 [TokenScheduler] Token expires in 15 minutes, refreshing now...
🔄 [TokenManager] Refreshing access token...
✅ [TokenManager] Token refresh successful
✅ [TokenScheduler] New token expires at: 2025-10-02T01:47:33.000Z
```

---

## 🚨 **Troubleshooting:**

### **Problem: "Module @env not found"**

**Solution:**
```bash
# Install the package
npm install react-native-dotenv

# Clear cache
npx expo start --clear
```

### **Problem: "Client Secret still undefined"**

**Solution:**
1. Check `.env` file exists in project root
2. Verify no typos in variable names
3. Restart Metro bundler completely
4. Check `babel.config.js` has the dotenv plugin

### **Problem: "Invalid client secret"**

**Solution:**
1. Go back to Google Cloud Console
2. Generate a NEW client secret
3. Update `.env` file
4. Restart the app

---

## 📋 **What This Fixes:**

✅ **Automatic token refresh** - Tokens refresh before expiry  
✅ **No more disconnections** - Google Calendar stays connected  
✅ **Silent refresh** - Happens in background without user action  
✅ **No "sign in again" prompts** - App stays authenticated  

---

## 🎯 **How Token Refresh Works (After Fix):**

```
1. User signs in with Google
   ↓
2. App stores access_token (valid for 1 hour)
   ↓
3. After 30 minutes, scheduler checks token
   ↓
4. If expiring soon, uses refresh_token + client_secret
   ↓
5. Gets new access_token from Google
   ↓
6. Stores new token, updates expiry
   ↓
7. Repeats every 30 minutes
```

**Result:** Google Calendar stays connected indefinitely! ✅

---

## 📝 **Quick Start (TL;DR):**

```bash
# 1. Get client secret from https://console.cloud.google.com/apis/credentials

# 2. Create .env file with:
echo 'GOOGLE_CLIENT_SECRET=YOUR_SECRET_HERE
EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=YOUR_SECRET_HERE' > .env

# 3. Install package
npm install react-native-dotenv

# 4. Restart app
npx expo start --clear
```

Done! Token refresh should now work! 🎉

