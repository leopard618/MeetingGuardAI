# ⚡ Quick Start: Fix Google Token Errors (60 Seconds)

## 🎯 **Your Current Problem:**

```
❌ Google Calendar disconnects after ~1 hour
❌ "Token refresh failed" errors
❌ Have to sign in again repeatedly
```

---

## ✅ **The Fix (3 Simple Steps):**

### **Step 1: Get Your Secret (30 seconds)**

1. **Open this URL:** https://console.cloud.google.com/apis/credentials

2. **Find this client:**
   ```
   929271330787-chktjtd81grj1sb4nae2b11tevocmfh9.apps.googleusercontent.com
   ```

3. **Click on it** → You'll see:
   - **Client ID**: `929271330787...` (you already have this)
   - **Client secret**: `GOCSPX-xxxxxxxxxxxx` ← **COPY THIS!** 📋

---

### **Step 2: Run Setup Script (20 seconds)**

In your terminal, run:

```bash
node setup-google-secret.js
```

When prompted:
- **Paste your Client Secret** (the `GOCSPX-xxx` value you copied)
- Press **Enter**
- That's it! ✅

The script will:
- ✅ Create `.env` file automatically
- ✅ Add all required variables
- ✅ Show you next steps

---

### **Step 3: Restart App (10 seconds)**

```bash
npx expo start --clear
```

Then:
- Press `r` to reload
- Or close and reopen the app

---

## ✅ **Verify It Works:**

**Check your console logs:**

### Before Fix ❌
```
[TokenManager] Client secret available: false
[TokenManager] Google Client Secret not configured
```

### After Fix ✅
```
[TokenManager] Client secret available: true
[TokenManager] Token refreshed successfully
```

---

## 🎉 **Done!**

Your Google Calendar will now:
- ✅ Stay connected indefinitely
- ✅ Auto-refresh tokens every hour
- ✅ Never ask you to sign in again
- ✅ Sync meetings continuously

---

## 🆘 **If Something Goes Wrong:**

### Can't find the setup script?
```bash
# Make sure you're in the project directory
cd E:\Workspace\AI\MeetingGuard\workspace\meeting

# Then run
node setup-google-secret.js
```

### Script not working?
**Manual method:**

1. Create file: `.env` in project root
2. Add this line (replace with your actual secret):
   ```
   EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=GOCSPX-your_actual_secret_here
   ```
3. Save file
4. Run: `npx expo start --clear`

### Still having issues?
See: `FIX_GOOGLE_TOKEN_ERRORS.md` for detailed troubleshooting

---

## 🔐 **Security Reminder:**

- ✅ `.env` is in `.gitignore` (don't commit it!)
- ✅ Keep your Client Secret private
- ✅ Don't share it publicly

---

**Total time: ~60 seconds** ⏱️  
**Difficulty: Easy** ⭐  
**Impact: Huge** 🚀  

**Let's fix those errors!** 💪

