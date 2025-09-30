# 🚀 Complete Setup Guide - Get Everything Running Now!

## ✅ **What We're Setting Up:**
1. **Background Notifications** - WhatsApp-style always-on meeting alerts
2. **Floating Widget** - Circular overlay like Android System notification
3. **Database Integration** - Store notification tokens and schedules
4. **App Configuration** - Proper permissions and settings

## 📋 **Step-by-Step Setup**

### **Step 1: Database Setup (Backend)**

Run the database migration to create notification tables:

```sql
-- Execute this in your database (Supabase/PostgreSQL):

-- Create table for storing user push notification tokens
CREATE TABLE IF NOT EXISTS user_push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    push_token TEXT NOT NULL,
    platform VARCHAR(20) DEFAULT 'unknown',
    device_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, device_id)
);

-- Create table for scheduled push notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meeting_id VARCHAR(255) NOT NULL,
    push_token TEXT NOT NULL,
    alert_type VARCHAR(20) NOT NULL,
    trigger_time TIMESTAMP NOT NULL,
    meeting_data JSONB,
    status VARCHAR(20) DEFAULT 'scheduled',
    sent_at TIMESTAMP NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user_id ON scheduled_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_trigger_time ON scheduled_notifications(trigger_time);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status ON scheduled_notifications(status);
```

### **Step 2: App Configuration**

Create or update your `app.json` file:

```json
{
  "expo": {
    "name": "MeetingGuard",
    "slug": "meeting-guard",
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
      "bundleIdentifier": "com.meetingguard.app"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#FFFFFF"
      },
      "package": "com.meetingguard.app",
      "permissions": [
        "android.permission.VIBRATE",
        "android.permission.WAKE_LOCK",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.SYSTEM_ALERT_WINDOW"
      ]
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#ffffff",
          "defaultChannel": "meeting-alerts"
        }
      ],
      "expo-task-manager",
      "expo-background-fetch"
    ],
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#ffffff",
      "androidMode": "default",
      "androidCollapsedTitle": "Meeting Alert"
    }
  }
}
```

### **Step 3: Update Your Main App Component**

Update your main `App.js` file:

```javascript
// Add these imports at the top of App.js
import FloatingWidgetContainer from './src/components/FloatingWidgetContainer';
import EnhancedNotificationManager from './src/services/EnhancedNotificationManager';

// In your main App component, add this useEffect:
useEffect(() => {
  const initializeNotificationSystems = async () => {
    console.log('🚀 Initializing notification systems...');
    
    // Initialize enhanced notifications
    await EnhancedNotificationManager.initialize();
    
    console.log('✅ Notification systems initialized');
  };
  
  initializeNotificationSystems();
}, []);

// Add the FloatingWidgetContainer to your JSX:
return (
  <PaperProvider>
    <ThemeProvider>
      <AuthProvider>
        <View style={styles.container}>
          {/* Your existing navigation and content */}
          <NavigationContainer>
            {/* Your navigation stack */}
          </NavigationContainer>
          
          {/* Add the floating widget container */}
          <FloatingWidgetContainer 
            navigation={navigation}
            onNavigateToMeeting={(meeting) => {
              console.log('Navigate to meeting:', meeting.title);
              // Add your navigation logic here
            }}
          />
        </View>
      </AuthProvider>
    </ThemeProvider>
  </PaperProvider>
);
```

### **Step 4: Add Settings Components**

Update your Settings page to include notification controls:

```javascript
// In your Settings.jsx file, add these imports:
import NotificationSettings from '../components/NotificationSettings';
import FloatingWidgetSettings from '../components/FloatingWidgetSettings';

// Add these components to your settings JSX:
<ScrollView style={styles.container}>
  {/* Your existing settings */}
  
  {/* Add notification settings */}
  <NotificationSettings />
  
  {/* Add floating widget settings */}
  <FloatingWidgetSettings 
    onToggleWidget={(enabled) => {
      console.log('Floating widget', enabled ? 'enabled' : 'disabled');
    }}
  />
</ScrollView>
```

### **Step 5: Update AlertScheduler Integration**

Your `AlertScheduler.jsx` is already updated, but make sure it's being used in your Dashboard:

```javascript
// In your Dashboard.jsx, make sure AlertScheduler is included:
import AlertScheduler from '../components/AlertScheduler';

// In your Dashboard JSX:
<AlertScheduler
  onTriggerAlert={handleTriggerAlert}
  language={language}
  alertsEnabled={true} // Make sure this is true
  ref={alertSchedulerRef}
/>
```

### **Step 6: Backend Server Update**

Make sure your backend server is running with the new notification routes:

```bash
# In your backend directory:
cd backend
npm start
```

The server should show:
```
✅ notificationRoutes imported
✅ All imports successful
```

### **Step 7: Test the Complete System**

1. **Create a Test Meeting:**
   ```javascript
   // Create a meeting 5 minutes in the future for testing
   const testMeeting = {
     title: "Test Meeting",
     date: "2024-01-01", // Today's date
     time: "14:30", // 5 minutes from now
     duration: 30
   };
   ```

2. **Enable Notifications:**
   - Go to Settings → Notification Settings
   - Tap "Initialize Notifications"
   - Grant all permissions

3. **Enable Floating Widget:**
   - Go to Settings → Floating Widget
   - Toggle "Enable Floating Widget"

4. **Test Background Behavior:**
   - Minimize the app
   - You should see the floating circle
   - Wait for notifications to trigger

## 🔧 **Quick Commands to Run Everything:**

```bash
# 1. Install any missing dependencies
npm install

# 2. Start the frontend
npm start

# 3. In another terminal, start the backend
npm run backend

# 4. Test on device/emulator
npm run android
# or
npm run ios
```

## 🎯 **Expected Behavior:**

### **Notifications:**
- ✅ Notifications work even when app is closed
- ✅ Multiple alerts: 1day, 1hour, 15min, 5min, 1min, now
- ✅ Progressive intensity: gentle → urgent
- ✅ Cross-platform reliability

### **Floating Widget:**
- ✅ Appears when app is minimized
- ✅ Shows countdown to next meeting
- ✅ Changes color based on urgency
- ✅ Draggable around screen
- ✅ Tap to open app

## 🚨 **Troubleshooting:**

### **Notifications Not Working?**
1. Check permissions in device settings
2. Verify backend is running
3. Check console for initialization errors
4. Test with a meeting 2-3 minutes in future

### **Floating Widget Not Appearing?**
1. Make sure widget is enabled in settings
2. Verify you have upcoming meetings
3. Check that app is actually minimized
4. Look for console logs

### **Database Errors?**
1. Make sure migration SQL was executed
2. Check Supabase/database connection
3. Verify table permissions

## 🎉 **Success Indicators:**

You'll know everything is working when:
- ✅ Settings show "Notification System: Active"
- ✅ You see "X notifications scheduled" in settings
- ✅ Floating widget appears when app is minimized
- ✅ You receive test notifications
- ✅ Console shows successful initialization logs

## 📱 **Final Result:**

Your app now has **enterprise-grade notification reliability** with:
- **WhatsApp-level** background notifications
- **Android System-style** floating widget
- **Alarm clock** persistence and urgency
- **Professional** user experience

Users will **never miss a meeting again**! 🎯

Ready to test? Let's go! 🚀
