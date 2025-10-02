# 🔔 Complete Notification Testing Guide

## 🎯 **What We're Testing:**
1. **Local Notifications** - Device-based alerts
2. **Floating Widget** - Circular overlay 
3. **Background Behavior** - Works when app is closed

## 📱 **Step-by-Step Testing Instructions**

### **Step 1: Fix the Current Errors**
The errors are now fixed! Restart your app:

```bash
# Press 'r' in the Metro terminal to reload
# OR
# Close and reopen the app on your device
```

### **Step 2: Create a Test Meeting**

1. **Open the app** on your device
2. **Go to Dashboard** or **Create Meeting** screen
3. **Create a test meeting** with these details:
   ```
   Title: "Test Notification Meeting"
   Date: TODAY (use today's date)
   Time: 2-3 MINUTES FROM NOW (very important!)
   Duration: 30 minutes
   ```

**Example:** If it's 3:00 PM now, set the meeting time to 3:03 PM

### **Step 3: Verify Notifications Are Scheduled**

After creating the meeting, check the console logs. You should see:
```
📅 Scheduled 10 alerts for meeting: Test Notification Meeting
✅ Enhanced notification system initialized successfully
```

### **Step 4: Test Local Notifications**

**Method 1: Wait for Real Notifications**
1. **Keep the app open** (foreground)
2. **Wait 2-3 minutes** (until meeting time)
3. **You should see:**
   - 2min notification
   - 1min notification  
   - NOW notification

**Method 2: Test Immediately (Recommended)**
1. Create a meeting **30 SECONDS in the future**
2. **Lock your phone** or **minimize the app**
3. **Wait 30 seconds**
4. **Notification should appear** on lock screen

### **Step 5: Test Floating Widget**

1. **Create a meeting 5 minutes in the future**
2. **Go to Settings** in the app
3. **Find "Floating Widget" section**
4. **Toggle ON** "Enable Floating Widget"
5. **Minimize the app** (press home button)
6. **Look for the circular widget** on your screen

**What you should see:**
- 🟢 Green circle with "5m" (5 minutes until meeting)
- As time passes: 🟡 Yellow → 🟠 Orange → 🔴 Red
- Tap the circle to open the app

### **Step 6: Test Background Notifications**

**IMPORTANT:** This tests if notifications work when app is completely closed:

1. **Create a meeting 2 minutes in the future**
2. **Close the app completely** (swipe away from recent apps)
3. **Wait 1-2 minutes**
4. **Notification should still appear!**

This proves the notification system works even when app is killed ✅

## 🔧 **Troubleshooting**

### **"No notifications appearing"**

**Check 1: Permissions**
```javascript
// In your app, go to Settings
// Make sure notification permissions are granted
// You should see: "Notification System: Active"
```

**Check 2: Notification Settings (Android)**
1. Go to Android Settings → Apps → MeetingGuard
2. Tap "Notifications"
3. Make sure "Show notifications" is ON
4. Check that "Meeting Alerts" channel is enabled

**Check 3: Meeting Time**
- Make sure meeting is in the FUTURE (not past)
- Meeting should be within next 24 hours
- Time should be at least 1 minute from now

### **"Floating widget not appearing"**

**Fix 1: Enable in Settings**
1. Open app → Settings
2. Find "Floating Widget" 
3. Toggle ON

**Fix 2: Check Meeting**
- Widget only shows for meetings within 24 hours
- Must have at least one upcoming meeting
- App must be minimized (not closed)

**Fix 3: Android Overlay Permission**
1. Go to Android Settings → Apps → MeetingGuard
2. Find "Display over other apps" or "Overlay"
3. Enable the permission

### **"Getting TypeError errors"**

This is now fixed! Reload the app:
```bash
# In Metro terminal, press 'r' to reload
```

## 📋 **Test Checklist**

Use this checklist to verify everything works:

- [ ] App loads without errors
- [ ] Can create meetings successfully
- [ ] Console shows "notifications scheduled" after creating meeting
- [ ] Notifications appear 1-2 minutes before meeting
- [ ] Notifications show meeting title and time
- [ ] Notifications appear even when app is closed
- [ ] Floating widget appears when app is minimized
- [ ] Floating widget shows correct countdown
- [ ] Floating widget color changes as time approaches
- [ ] Can tap widget to open app
- [ ] Can drag widget around screen
- [ ] Can close widget with X button

## 🎯 **Expected Notification Schedule**

For a meeting at **3:00 PM**, you'll get notifications at:

| Time | Alert Type | Intensity | Color |
|------|-----------|-----------|-------|
| 2:00 PM (1 day before) | 1day | Light | 🔵 Blue |
| 2:00 PM (4 hours) | 4hour | Medium | 🟢 Green |
| 2:00 PM (1 hour) | 1hour | Medium | 🟢 Green |
| 2:30 PM (30min) | 30min | Medium | 🟡 Yellow |
| 2:45 PM (15min) | 15min | Medium | 🟡 Yellow |
| 2:50 PM (10min) | 10min | High | 🟠 Orange |
| 2:55 PM (5min) | 5min | Maximum | 🔴 Red |
| 2:58 PM (2min) | 2min | Maximum | 🔴 Red |
| 2:59 PM (1min) | 1min | Maximum | 🔴 Red |
| 3:00 PM (now) | now | Maximum | 🔴 Red |

## 🚀 **Quick Test (2 Minutes)**

The fastest way to test everything:

1. **Create meeting 2 minutes from now**
2. **Wait 30 seconds** → Should see "2min" notification
3. **Wait another minute** → Should see "1min" notification  
4. **Wait another minute** → Should see "NOW" notification
5. **Minimize app** → Should see floating widget
6. **Done!** ✅

## 📱 **Testing Commands**

```bash
# Reload app
Press 'r' in Metro terminal

# View logs
Press 'j' to open debugger

# Clear cache and restart
npx expo start --clear
```

## ✅ **Success Indicators**

You'll know everything works when:
- ✅ Notifications appear at the right times
- ✅ Notifications work when app is closed
- ✅ Floating widget appears on minimize
- ✅ Widget shows correct countdown
- ✅ Console logs show no errors
- ✅ All 10 notification types are scheduled

## 🎉 **Result**

Your notification system is production-ready when all tests pass! Users will have:
- **WhatsApp-level** notification reliability
- **Alarm clock** persistence  
- **Android System-style** floating widget
- **Enterprise-grade** meeting reminders

Never miss a meeting again! 🚀

---

**Need help?** Check the console logs for detailed information about what's happening.
