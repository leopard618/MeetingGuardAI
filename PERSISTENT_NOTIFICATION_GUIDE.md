# 🔔 Persistent Notification Implementation Guide

## 📸 **What You Want (From Your Image)**

Your screenshot shows an **Android System notification** that:
- ✅ Stays in notification tray permanently
- ✅ Shows 2 active notifications (persistent)
- ✅ Cannot be swiped away
- ✅ Always visible when you pull down notification shade

**This is called a "Foreground Service Notification"**

---

## 🎯 **What We'll Build: Meeting Guard Persistent Notification**

```
╔═══════════════════════════════════════╗
║ 🔔 Meeting Guard - Active             ║
║                                       ║
║ Next Meeting: SDFW                    ║
║ Time: 2:28 AM (in 5 hours 30 min)   ║
║                                       ║
║ [Open App]  [View Details]           ║
╚═══════════════════════════════════════╝
```

**Features:**
- ✅ Always visible (cannot dismiss)
- ✅ Shows countdown to next meeting
- ✅ Updates every minute
- ✅ Tap to open app
- ✅ Action buttons (Open App, View Details)
- ✅ Works when app is in background

---

## 🔧 **How It Will Work**

### **Scenario 1: App Minimized (Home Button)**
```
User presses Home → 
  ↓
App goes to background → 
  ↓
Persistent notification appears → 
  ↓
Shows: "Next: SDFW in 25 minutes" → 
  ↓
Updates countdown every minute → 
  ↓
User taps notification → 
  ↓
App opens
```

### **Scenario 2: App Running (Using Other Apps)**
```
User switches to Chrome/Facebook → 
  ↓
Meeting Guard stays in background → 
  ↓
Notification stays visible → 
  ↓
Updates countdown → 
  ↓
Alerts fire at scheduled times
```

### **Scenario 3: App Force-Closed**
```
User force-closes app → 
  ↓
Background service stops → 
  ↓
Notification disappears → 
  ↓
BUT: Scheduled notifications still work (OS handles them)
```

---

## 📋 **Implementation Plan**

### **Step 1: Create Persistent Notification Service**

File: `src/services/PersistentNotificationService.js`

```javascript
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

class PersistentNotificationService {
  async showPersistentNotification(nextMeeting) {
    // Create ongoing notification
    await Notifications.setNotificationChannelAsync('persistent', {
      name: 'Meeting Guard - Active',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null, // Silent
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // Show notification
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔔 Meeting Guard - Active',
        body: `Next: ${nextMeeting.title} at ${nextMeeting.time}`,
        data: { 
          type: 'persistent',
          meetingId: nextMeeting.id 
        },
        sticky: true, // Cannot dismiss
        priority: 'high',
        autoDismiss: false,
      },
      trigger: null, // Show immediately
    });

    return notificationId;
  }

  async updatePersistentNotification(nextMeeting, countdown) {
    // Update notification text with countdown
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔔 Meeting Guard - Active',
        body: `Next: ${nextMeeting.title} in ${countdown}`,
        sticky: true,
        autoDismiss: false,
      },
      trigger: null,
    });
  }

  async hidePersistentNotification() {
    await Notifications.dismissAllNotificationsAsync();
  }
}

export default new PersistentNotificationService();
```

### **Step 2: Monitor App State**

```javascript
// In App.js or main component
import { AppState } from 'react-native';
import PersistentNotificationService from './services/PersistentNotificationService';

useEffect(() => {
  const subscription = AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      // App went to background - show persistent notification
      const nextMeeting = getNextMeeting();
      if (nextMeeting) {
        PersistentNotificationService.showPersistentNotification(nextMeeting);
      }
    } else if (nextAppState === 'active') {
      // App came to foreground - hide persistent notification
      PersistentNotificationService.hidePersistentNotification();
    }
  });

  return () => subscription.remove();
}, []);
```

### **Step 3: Update Countdown Every Minute**

```javascript
// Update notification countdown
setInterval(() => {
  if (AppState.currentState !== 'active') {
    const nextMeeting = getNextMeeting();
    if (nextMeeting) {
      const countdown = calculateCountdown(nextMeeting.time);
      PersistentNotificationService.updatePersistentNotification(
        nextMeeting, 
        countdown
      );
    }
  }
}, 60000); // Every minute
```

---

## 🎨 **Notification Styles**

### **Style 1: Basic (Default)**
```
🔔 Meeting Guard - Active
Next: SDFW at 2:28 AM
```

### **Style 2: With Countdown**
```
🔔 Meeting Guard - Active
Next: SDFW in 5 hours 30 minutes
```

### **Style 3: Urgent (< 15 min)**
```
⚠️ Meeting Guard - URGENT
SDFW starts in 5 minutes!
```

### **Style 4: Multiple Meetings**
```
🔔 Meeting Guard - Active
2 meetings today: Next at 2:28 AM
```

---

## 📱 **Notification Actions (Buttons)**

```javascript
{
  content: {
    title: '🔔 Meeting Guard',
    body: 'Next: SDFW in 25 minutes',
  },
  actions: [
    {
      identifier: 'open',
      buttonTitle: 'Open App',
      isDestructive: false,
    },
    {
      identifier: 'details',
      buttonTitle: 'View Details',
      isDestructive: false,
    },
    {
      identifier: 'snooze',
      buttonTitle: 'Snooze',
      isDestructive: false,
    },
  ],
}
```

**User Experience:**
- Tap notification → Opens app
- Tap "Open App" → Opens app to dashboard
- Tap "View Details" → Opens meeting details
- Tap "Snooze" → Snoozes reminder

---

## ⚙️ **Configuration in app.json**

```json
{
  "expo": {
    "android": {
      "permissions": [
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.WAKE_LOCK",
        "android.permission.POST_NOTIFICATIONS"
      ]
    },
    "notification": {
      "androidMode": "default",
      "androidCollapsedTitle": "Meeting Guard Active",
      "iosDisplayInForeground": true
    }
  }
}
```

---

## 🚦 **Notification Priority Levels**

| Priority | When to Use | Behavior |
|----------|-------------|----------|
| **MAX** | Meeting NOW | Heads-up, sound, vibrate |
| **HIGH** | < 5 minutes | Persistent, sound |
| **DEFAULT** | < 1 hour | Persistent, no sound |
| **LOW** | > 1 hour | Silent, persistent |
| **MIN** | Background | Minimized |

---

## 🔄 **Update Logic**

```javascript
function getNotificationPriority(minutesUntilMeeting) {
  if (minutesUntilMeeting <= 0) return 'max';      // NOW
  if (minutesUntilMeeting <= 5) return 'high';     // 5 min
  if (minutesUntilMeeting <= 60) return 'default'; // 1 hour
  return 'low';                                     // > 1 hour
}

function getNotificationText(meeting, minutesUntil) {
  if (minutesUntil <= 0) return `🔴 ${meeting.title} is NOW!`;
  if (minutesUntil < 60) return `⚠️ ${meeting.title} in ${minutesUntil} minutes`;
  
  const hours = Math.floor(minutesUntil / 60);
  const mins = minutesUntil % 60;
  return `🔔 ${meeting.title} in ${hours}h ${mins}m`;
}
```

---

## 🧪 **Testing Steps**

### **Test 1: Basic Display**
1. Create a meeting 1 hour from now
2. Press Home button (minimize app)
3. Pull down notification shade
4. ✅ Should see: "Meeting Guard - Active"

### **Test 2: Countdown Update**
1. Wait 1 minute
2. Pull down notification shade
3. ✅ Countdown should update

### **Test 3: Tap to Open**
1. Tap the notification
2. ✅ App should open to dashboard

### **Test 4: Multiple Meetings**
1. Create 3 meetings today
2. Minimize app
3. ✅ Shows next/earliest meeting

### **Test 5: No Meetings**
1. No upcoming meetings
2. Minimize app
3. ✅ No persistent notification

---

## 🎯 **Expected Behavior**

### **When App is Active (Using the app):**
- ❌ No persistent notification
- ✅ In-app alerts work
- ✅ Normal UI

### **When App is Background (Minimized):**
- ✅ Persistent notification shows
- ✅ Updates every minute
- ✅ Shows next meeting
- ✅ Cannot dismiss

### **When App is Force-Closed:**
- ❌ Persistent notification disappears
- ✅ Scheduled notifications still work
- ⚠️ Background tasks stop

---

## 🚀 **Implementation Status**

Current files to create/modify:

1. ✅ `src/services/PersistentNotificationService.js` - New service
2. ✅ `src/hooks/usePersistentNotification.js` - React hook
3. ✅ `App.js` - Integrate AppState monitoring
4. ✅ `app.json` - Add permissions

---

## 🔨 **Quick Implementation**

**I can implement this for you right now!**

The implementation will:
1. ✅ Show persistent notification when app is minimized
2. ✅ Update countdown every minute
3. ✅ Display next meeting details
4. ✅ Tap to open app
5. ✅ Auto-hide when app is active
6. ✅ Priority changes based on urgency

**Shall I proceed with the implementation?** 

Just say **"yes, implement persistent notification"** and I'll add this feature! 🚀

---

## 📊 **Comparison**

| Feature | Current | With Persistent Notification |
|---------|---------|------------------------------|
| Visible when minimized | ❌ No | ✅ Yes |
| Shows countdown | ❌ No | ✅ Yes |
| Always in notification tray | ❌ No | ✅ Yes |
| Cannot dismiss | ❌ No | ✅ Yes |
| Updates automatically | ❌ No | ✅ Yes (every minute) |
| Tap to open | ❌ No | ✅ Yes |
| Like WhatsApp/Telegram | ❌ No | ✅ Yes |
| Like your image | ❌ No | ✅ Yes |

---

**Ready to implement! Let me know and I'll add this feature to your app!** 🎉

