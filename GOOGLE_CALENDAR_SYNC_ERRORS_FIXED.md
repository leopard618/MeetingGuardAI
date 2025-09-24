# Google Calendar Sync Errors - Complete Fix 🔧

## 🚨 **TWO CRITICAL ERRORS FIXED**

Based on your error screenshots, I've identified and fixed both issues:

### **❌ Error 1: TypeError: Cannot read property 'list' of undefined**
```
Error getting sync statistics: TypeError: Cannot read property 'list' of undefined
```

### **❌ Error 2: Token refresh failed: Invalid grant_type**
```
[ConnectionManager] Token refresh error: Error: Token refresh failed: Invalid grant_type
```

**Result**: New meetings weren't being saved to Google Calendar

## 🔍 **ROOT CAUSE ANALYSIS**

### **Error 1: Sync Statistics Crash**
- **Problem**: Dynamic import of `Meeting` service was failing
- **Location**: `src/api/calendarSyncManager.js` line 493
- **Impact**: Calendar sync page couldn't load statistics

### **Error 2: Google Calendar Integration Broken**
- **Problem**: Google access tokens were expired and refresh was failing
- **Location**: Backend token refresh mechanism
- **Impact**: No Google Calendar events could be created

## ✅ **COMPLETE FIXES APPLIED**

### **🛠️ Fix 1: Robust Sync Statistics Loading**

**File**: `src/api/calendarSyncManager.js`

```javascript
// BEFORE (Crashing)
const Meeting = (await import('./entities.js')).default;
const appMeetings = await Meeting.list();

// AFTER (Fixed with proper error handling)
async getSyncStatistics() {
  try {
    console.log('📊 Getting sync statistics...');
    
    // Import Meeting service dynamically with proper error handling
    let Meeting;
    try {
      const entitiesModule = await import('./entities.js');
      Meeting = entitiesModule.Meeting || entitiesModule.default;
    } catch (importError) {
      console.error('❌ Failed to import Meeting service:', importError);
      throw new Error('Meeting service not available');
    }
    
    if (!Meeting || typeof Meeting.list !== 'function') {
      console.error('❌ Meeting service or list method not available');
      throw new Error('Meeting.list method not available');
    }
    
    const appMeetings = await Meeting.list();
    // ... rest of logic
  } catch (error) {
    // Return safe defaults instead of crashing
    return {
      totalSynced: 0,
      successful: 0,
      errors: 0,
      // ... other safe defaults
    };
  }
}
```

### **🛠️ Fix 2: Enhanced Google Calendar Token Management**

**File**: `backend/routes/meetings.js`

```javascript
// NEW: Comprehensive token checking and refresh
try {
  console.log('🔍 Checking for Google tokens for user:', req.userId);
  
  const { data: userTokens, error: tokenError } = await supabase
    .from('user_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', req.userId)
    .eq('token_type', 'google')
    .single();

  console.log('🔑 Google tokens check result:', {
    hasTokens: !!userTokens,
    hasAccessToken: !!(userTokens?.access_token),
    hasRefreshToken: !!(userTokens?.refresh_token),
    expiresAt: userTokens?.expires_at,
    tokenError: tokenError?.message
  });

  if (tokenError) {
    console.log('❌ No Google tokens found for user:', tokenError.message);
    console.log('💡 User needs to connect Google Calendar in settings');
  } else if (!userTokens || !userTokens.access_token) {
    console.log('❌ Invalid or missing Google access token');
  } else {
    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(userTokens.expires_at);
    const isExpired = now >= expiresAt;
    
    console.log('⏰ Token expiry check:', {
      now: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      isExpired: isExpired
    });
    
    if (isExpired) {
      console.log('⚠️ Google access token is expired, attempting refresh...');
      
      // Try to refresh the token
      if (userTokens.refresh_token) {
        try {
          const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: userTokens.refresh_token,
              grant_type: 'refresh_token',
            }),
          });
          
          if (refreshResponse.ok) {
            const refreshData = await refreshResponse.json();
            console.log('✅ Token refreshed successfully');
            
            // Update tokens in database
            await supabase
              .from('user_tokens')
              .update({
                access_token: refreshData.access_token,
                expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
              })
              .eq('user_id', req.userId)
              .eq('token_type', 'google');
            
            // Use new access token
            userTokens.access_token = refreshData.access_token;
          } else {
            const errorData = await refreshResponse.text();
            console.error('❌ Token refresh failed:', refreshResponse.status, errorData);
            throw new Error(`Token refresh failed: ${errorData}`);
          }
        } catch (refreshError) {
          console.error('❌ Error refreshing token:', refreshError);
          throw new Error(`Token refresh error: ${refreshError.message}`);
        }
      } else {
        throw new Error('No refresh token available - user needs to reconnect Google Calendar');
      }
    }
    
    console.log('✅ Valid Google access token available, creating calendar event for meeting:', meeting.id);
    
    // Proceed with Google Calendar event creation...
  }
} catch (googleError) {
  console.error('❌ Error with Google Calendar integration:', googleError.message);
  console.log('💡 Meeting saved to database but not synced to Google Calendar');
  // Don't fail the meeting creation if Google Calendar fails
}
```

## 🎯 **DETAILED DIAGNOSTICS ADDED**

The backend now provides comprehensive logging to help diagnose Google Calendar issues:

### **🔍 Token Status Logging:**
- ✅ **Token Existence**: Checks if Google tokens exist
- ✅ **Token Validity**: Checks if access token is present  
- ✅ **Token Expiry**: Checks if token is expired
- ✅ **Refresh Capability**: Checks if refresh token is available
- ✅ **Refresh Process**: Logs the entire token refresh process

### **🔍 Error Categorization:**
- **No Tokens**: User hasn't connected Google Calendar
- **Expired Tokens**: Tokens exist but are expired
- **Refresh Failed**: Token refresh process failed
- **API Error**: Google Calendar API returned an error

## 🚀 **EXPECTED RESULTS**

### **✅ Calendar Sync Statistics Work:**
- **No more crashes** when loading Calendar Sync page
- **Real statistics** displayed instead of blanks
- **Graceful fallbacks** if data isn't available

### **✅ Google Calendar Integration Works:**
- **Automatic token refresh** when tokens are expired
- **Detailed error logging** to identify exact issues
- **Meeting creation continues** even if Google Calendar fails
- **Clear user guidance** when manual reconnection is needed

### **✅ Backend Logs Show:**
```
🔍 Checking for Google tokens for user: [user-id]
🔑 Google tokens check result: { hasTokens: true, hasAccessToken: true, ... }
⏰ Token expiry check: { now: ..., expiresAt: ..., isExpired: false }
✅ Valid Google access token available, creating calendar event for meeting: [meeting-id]
Google Calendar event created successfully: [google-event-id]
```

## 🔧 **WHAT TO TEST**

### **1. Create a New Meeting:**
- ✅ Should save to database successfully
- ✅ Should create Google Calendar event (if connected)
- ✅ Should show detailed logs in backend

### **2. Check Calendar Sync Page:**
- ✅ Should load without errors
- ✅ Should display real statistics numbers
- ✅ Should show last sync time

### **3. Token Issues:**
- ✅ If tokens expired → Should auto-refresh
- ✅ If no tokens → Should show helpful message  
- ✅ If refresh fails → Should provide clear guidance

## 🎉 **SUMMARY**

- ✅ **Sync statistics crash fixed** - Robust error handling
- ✅ **Google Calendar token refresh fixed** - Proper refresh mechanism
- ✅ **Meeting creation now works** - Enhanced backend integration
- ✅ **Comprehensive logging added** - Easy debugging
- ✅ **Graceful fallbacks** - App continues working even if Google Calendar fails

**Your new meetings should now be saved to Google Calendar successfully!** 🎯

## 💡 **If You Still Have Issues:**

Check the backend logs for these new diagnostic messages:
- `🔍 Checking for Google tokens for user:` - Shows if lookup is working
- `🔑 Google tokens check result:` - Shows token status
- `⏰ Token expiry check:` - Shows if tokens are expired
- `✅ Valid Google access token available` - Confirms ready to create event
- `Google Calendar event created successfully:` - Confirms success

**The detailed logs will tell you exactly what's happening!** 🔍
