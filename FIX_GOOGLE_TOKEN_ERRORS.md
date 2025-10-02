# 🔧 URGENT: Fix Google Token Refresh Errors

## 🚨 **Current Errors You're Seeing:**

```
❌ [TokenScheduler] Automatic token refresh failed: Google Client Secret not configured
❌ [TokenManager] Token refresh error: Error: Google Client Secret not configured
```

**Why this happens:**
- Google access tokens expire after 1 hour
- To refresh them automatically, you need a **Client Secret**
- Your `.env` file is missing this secret

---

## ✅ **QUICK FIX (2 Minutes):**

### **Option 1: Automated Setup Script**

Run this command and follow the prompts:

```bash
node setup-google-secret.js
```

The script will:
1. Ask for your Client Secret
2. Create the `.env` file automatically
3. Show you next steps

### **Option 2: Manual Setup**

#### **Step 1: Get Client Secret**

1. Open: https://console.cloud.google.com/apis/credentials
2. Find OAuth client: `929271330787...apps.googleusercontent.com`
3. Click on it
4. Copy the **"Client secret"** (looks like `GOCSPX-xxxxxxxxxx`)

#### **Step 2: Create .env File**

Create a file named `.env` in your project root:

```
E:\Workspace\AI\MeetingGuard\workspace\meeting\.env
```

Paste this content (replace `YOUR_SECRET_HERE` with your actual secret):

```env
# Google OAuth Client Secret
EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=YOUR_SECRET_HERE

# Other required vars
EXPO_PUBLIC_GOOGLE_CLIENT_ID=929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_SECRET_HERE
GOOGLE_CLIENT_ID=929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com
GOOGLE_REDIRECT_URI=https://meetingguard-backend.onrender.com/oauth/google
EXPO_PUBLIC_BACKEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:3000
```

#### **Step 3: Restart the App**

```bash
# Clear cache and restart
npx expo start --clear
```

Then press `r` in the terminal or reload the app.

---

## 🧪 **Verify It Works:**

### **Before Fix:**
```
❌ [TokenManager] Client secret available: false
❌ [TokenManager] Google Client Secret not configured
```

### **After Fix:**
```
✅ [TokenManager] Client secret available: true
✅ [TokenManager] Token refreshed successfully
✅ [TokenScheduler] Token is valid for 59 more minutes
```

---

## 🎯 **What This Fixes:**

| Problem | Solution |
|---------|----------|
| Google Calendar disconnects after 1 hour | ✅ Auto-refresh keeps it connected |
| "Sign in again" prompts | ✅ Silent background refresh |
| Token expired errors | ✅ Proactive renewal before expiry |
| Meeting sync stops working | ✅ Continuous sync with Google Calendar |

---

## 📱 **Test the Fix:**

1. **Sign in with Google** (if not already signed in)
2. **Wait 1-2 minutes** and check console logs
3. **Look for:** `✅ [TokenScheduler] Token is valid for X more minutes`
4. **Use the app normally** - Calendar should stay connected

---

## 🔒 **Security:**

### ⚠️ **IMPORTANT: Keep .env Private!**

**DO:**
- ✅ Add `.env` to `.gitignore`
- ✅ Keep Client Secret confidential
- ✅ Use environment variables

**DON'T:**
- ❌ Commit `.env` to Git
- ❌ Share Client Secret publicly
- ❌ Hard-code secrets in source files

Check `.gitignore` includes:
```gitignore
.env
.env.*
```

---

## 🆘 **Troubleshooting:**

### **Problem: "Module @env not found"**

This means `react-native-dotenv` isn't installed properly.

**Fix:**
```bash
# Reinstall the package
npm install react-native-dotenv

# Clear cache
npx expo start --clear
```

### **Problem: "Client secret still not available"**

**Fix:**
1. Check `.env` file exists in project root (not in `src/` or elsewhere)
2. Verify variable name is exactly: `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET`
3. No spaces around `=` sign
4. Restart Metro bundler completely (Ctrl+C, then `npx expo start --clear`)

### **Problem: "Invalid client secret"**

**Fix:**
1. Go back to Google Cloud Console
2. **Generate a NEW Client Secret** (you can have multiple)
3. Copy the new one
4. Update `.env` file
5. Restart app

### **Problem: Still getting errors after setup**

**Debug steps:**

Add this to your `App.js` temporarily:
```javascript
import { EXPO_PUBLIC_GOOGLE_CLIENT_SECRET } from '@env';

console.log('=== ENVIRONMENT CHECK ===');
console.log('Client Secret configured:', !!EXPO_PUBLIC_GOOGLE_CLIENT_SECRET);
console.log('Client Secret length:', EXPO_PUBLIC_GOOGLE_CLIENT_SECRET?.length || 0);
console.log('Client Secret preview:', EXPO_PUBLIC_GOOGLE_CLIENT_SECRET?.substring(0, 10) + '...');
```

**Expected output:**
```
Client Secret configured: true
Client Secret length: 35
Client Secret preview: GOCSPX-xx...
```

If you see `configured: false`, the `.env` file isn't being read correctly.

---

## 📖 **How Token Refresh Works:**

```
┌─────────────────────────────────────────────┐
│ User signs in with Google                   │
│ ↓                                            │
│ Receives access_token (expires in 1 hour)   │
│ Receives refresh_token (never expires)      │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ Token Scheduler checks every 30 minutes     │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ When token expires in < 15 minutes:         │
│ 1. Uses refresh_token + client_secret       │
│ 2. Requests new access_token from Google    │
│ 3. Stores new token                         │
│ 4. Updates expiry time                      │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ Result: Google Calendar stays connected!    │
└─────────────────────────────────────────────┘
```

**Without Client Secret:** ❌ Can't refresh → Disconnects after 1 hour  
**With Client Secret:** ✅ Auto-refresh → Stays connected forever

---

## 🎉 **Success Checklist:**

- [ ] Got Client Secret from Google Cloud Console
- [ ] Created `.env` file in project root
- [ ] Added `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET` variable
- [ ] Restarted app with `npx expo start --clear`
- [ ] Checked console logs show "Client secret available: true"
- [ ] Signed in with Google successfully
- [ ] Google Calendar connected
- [ ] No more token refresh errors

---

## 📞 **Need More Help?**

See these files for detailed information:
- `GOOGLE_TOKEN_REFRESH_FIX.md` - Comprehensive guide
- `setup-google-secret.js` - Automated setup script

Run the setup script:
```bash
node setup-google-secret.js
```

---

**🚀 Once this is fixed, your Google Calendar will stay connected indefinitely!**

