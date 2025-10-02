# 🔔 Create Test Meeting for Persistent Notification

## ⚠️ **Your Issue:**

The persistent notification isn't showing because:
- **Your meetings are in the PAST** or **time format is wrong**
- The logs show: `📅 Next meeting updated: None`
- Notification only shows when there's a **future meeting**

---

## ✅ **SOLUTION: Create a Future Meeting**

### **Step 1: Press 'r' in Metro Terminal**

Reload the app to get the new debug logs.

### **Step 2: Check Console Logs**

Look for these logs after reloading:
```
📅 Calculating next meeting. Current time: 2025-10-02T03:23:00.000Z
📅 Total meetings: 3
📅 Meeting 1: SDFW at 2025-10-01T15:00:00.000Z - Future: false
📅 Meeting 2: ZZZ at 2025-10-01T15:00:00.000Z - Future: false
📅 No upcoming meetings found
```

**Problem:** All meetings are in the past (yesterday 15:00 = 3:00 PM)

### **Step 3: Create a NEW Meeting**

**Use THESE EXACT VALUES:**

```
Title: "Notification Test"

Date: 2025-10-02 (TODAY)

Time: [5 minutes from now]
```

**How to calculate time:**
- Current time is: **3:23 AM** (from your screenshot)
- Add 5 minutes: **3:28 AM**
- Enter in 24-hour format: **03:28** or **03:28:00**

OR easier:
- Add 1 hour: **4:23 AM** → Enter: **04:23**

**Duration:** 30 minutes

**Location:** Anywhere (optional)

### **Step 4: Save the Meeting**

After creating, you should see in console:
```
📅 Calculating next meeting. Current time: 2025-10-02T03:23:00.000Z
📅 Meeting 1: Notification Test at 2025-10-02T03:28:00.000Z - Future: true
📅 Upcoming meetings found: 1
📅 Next meeting: Notification Test at 2025-10-02T03:28:00.000Z
```

### **Step 5: Minimize the App**

1. **Press Home button** (don't close app!)
2. **Pull down notification shade**
3. **Look for:** 

```
╔════════════════════════════════════╗
║ 🔔 Meeting Guard - Active          ║
║ Next: Notification Test            ║
║ In 5 minutes                       ║
╚════════════════════════════════════╝
```

---

## 🕐 **Quick Time Reference**

**Your current time:** 3:23 AM (Oct 2, 2025)

**Test meeting times to use:**

| Description | Time to Enter | When it triggers |
|-------------|---------------|------------------|
| **5 minutes** | `03:28` or `03:28:00` | Best for testing |
| **10 minutes** | `03:33` or `03:33:00` | Good for testing |
| **30 minutes** | `03:53` or `03:53:00` | Shows longer countdown |
| **1 hour** | `04:23` or `04:23:00` | Shows hour countdown |
| **2 hours** | `05:23` or `05:23:00` | Low priority notification |

**Choose any of these times!**

---

## 📋 **Step-by-Step Guide:**

### **Method 1: Through Dashboard**

1. Open Meeting Guard app
2. Tap **"+ New Meeting"** button
3. Fill in:
   - Title: `Notification Test`
   - Date: `2025-10-02` (use date picker)
   - Time: `03:28` (5 minutes from now)
   - Duration: `30`
4. Tap **"Create Meeting"**
5. Press **Home button**
6. **Pull down notification shade**
7. **See the notification!** ✅

### **Method 2: Quick Create**

1. Go to Dashboard
2. Tap **"Quick Create"** (if available)
3. Set time to **5 minutes from now**
4. Save
5. Minimize app
6. Check notification shade

---

## 🧪 **Debugging Steps:**

### **After Creating Meeting:**

**Console should show:**
```
📅 Calculating next meeting. Current time: 2025-10-02T03:23:45.000Z
📅 Total meetings: 4
📅 Meeting 1: SDFW at 2025-10-01T15:00:00.000Z - Future: false (OLD)
📅 Meeting 2: ZZZ at 2025-10-01T15:00:00.000Z - Future: false (OLD)
📅 Meeting 3: Test at 2025-10-02T02:28:00.000Z - Future: false (WRONG TIME!)
📅 Meeting 4: Notification Test at 2025-10-02T03:28:00.000Z - Future: true ✅
📅 Upcoming meetings found: 1
📅 Next meeting: Notification Test at 2025-10-02T03:28:00.000Z
```

**When You Minimize App:**
```
📱 App state changed: active → background
📱 App went to background - showing persistent notification
📱 Attempting to show persistent notification for meeting: {
  title: "Notification Test",
  date: "2025-10-02",
  time: "03:28:00"
}
📱 Time calculation: 5 minutes until meeting
📱 Showing persistent notification: Next: Notification Test
In 5 minutes
```

---

## ⚠️ **Common Issues:**

### **Issue 1: Wrong Time Zone**

**Problem:** Meeting shows as "2025-10-01T15:00:00.000Z" (yesterday)  
**Solution:** Use today's date (2025-10-02) and current/future time

### **Issue 2: 12-hour vs 24-hour Format**

**Problem:** Entered "3:28 PM" but it saved as "3:28 AM"  
**Solution:** Use 24-hour format:
- 3:28 AM → `03:28`
- 3:28 PM → `15:28`

### **Issue 3: Date is Wrong**

**Problem:** Used yesterday's date  
**Solution:** Always use **today** or **future** date

### **Issue 4: Notification Doesn't Appear**

**Check:**
1. Meeting is in the future ✅
2. App is minimized (not closed) ✅
3. Notification permissions are ON ✅
4. Console shows "Showing persistent notification" ✅

---

## 🎯 **Expected Result:**

After following these steps:

1. ✅ Meeting created with future time
2. ✅ Console shows: "Next meeting: Notification Test"
3. ✅ Minimize app with Home button
4. ✅ Console shows: "Showing persistent notification"
5. ✅ Pull down notification shade
6. ✅ **SEE THE NOTIFICATION LIKE ANDROID SYSTEM!**

```
╔════════════════════════════════════╗
║ 🔔 Meeting Guard - Active          ║
║                                    ║
║ Next: Notification Test            ║
║ ⚠️ In 5 minutes                    ║
║                                    ║
║ [Tap to open]                      ║
╚════════════════════════════════════╝
```

**This is EXACTLY like the "Android System" notification you showed me!**

---

## 🚀 **Quick Test (30 Seconds):**

```bash
1. Reload app (press 'r' in Metro)
2. Create meeting: "Test" at 03:28 (5 min from now)
3. Press Home button
4. Pull down notification shade
5. SEE IT! ✅
```

**Do this NOW and you'll see the persistent notification!** 🎉

