// Test Google Calendar Reconnection Flow
// This script tests the improved Google Calendar reconnection functionality

async function testConnectionStatus() {
  console.log('🔍 Testing Google Calendar connection status...');
  
  try {
    const googleCalendarService = (await import('../api/googleCalendar')).default;
    
    // Test current connection status
    console.log('📊 Checking current connection status...');
    const hasAccess = await googleCalendarService.checkCalendarAccess();
    console.log(`Connection status: ${hasAccess ? 'Connected ✅' : 'Disconnected ❌'}`);
    
    if (hasAccess) {
      console.log('🗓️ Testing calendar access...');
      const calendars = await googleCalendarService.getCalendars();
      console.log(`Found ${calendars.length} calendars`);
      
      if (calendars.length > 0) {
        console.log('📅 Calendars:');
        calendars.forEach((cal, index) => {
          console.log(`  ${index + 1}. ${cal.summary} ${cal.primary ? '(Primary)' : ''}`);
        });
      }
    }
    
    // Test connection manager status
    const connectionManager = googleCalendarService.connectionManager;
    if (connectionManager) {
      const connectionStatus = await connectionManager.getConnectionStatus();
      console.log('🔗 Connection Manager Status:', {
        isConnected: connectionStatus.isConnected,
        status: connectionStatus.status,
        message: connectionStatus.message,
        needsReauth: connectionStatus.needsReauth
      });
    }
    
    return {
      hasAccess,
      calendarCount: hasAccess ? (await googleCalendarService.getCalendars()).length : 0,
      connectionStatus: connectionManager ? await connectionManager.getConnectionStatus() : null
    };
    
  } catch (error) {
    console.error('❌ Error testing connection status:', error);
    return {
      error: error.message,
      hasAccess: false
    };
  }
}

async function testReconnection() {
  console.log('🔄 Testing Google Calendar reconnection...');
  
  try {
    const googleCalendarService = (await import('../api/googleCalendar')).default;
    
    // Test the reconnection flow
    console.log('🚀 Starting reconnection process...');
    const reconnectResult = await googleCalendarService.reconnect();
    
    if (reconnectResult.success) {
      console.log('✅ Reconnection successful!');
      console.log('Message:', reconnectResult.message);
      
      if (reconnectResult.needsRestart) {
        console.log('⚠️ Service needs restart to complete setup');
      }
      
      // Test the connection after reconnection
      console.log('🧪 Testing connection after reconnection...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const testResult = await testConnectionStatus();
      console.log('📊 Post-reconnection test results:', testResult);
      
      return {
        reconnectionSuccess: true,
        message: reconnectResult.message,
        needsRestart: reconnectResult.needsRestart,
        postTestResult: testResult
      };
      
    } else {
      console.error('❌ Reconnection failed:', reconnectResult.error);
      return {
        reconnectionSuccess: false,
        error: reconnectResult.error
      };
    }
    
  } catch (error) {
    console.error('❌ Error during reconnection test:', error);
    return {
      reconnectionSuccess: false,
      error: error.message
    };
  }
}

async function simulateTokenExpiration() {
  console.log('🕐 Simulating token expiration...');
  
  try {
    const googleCalendarService = (await import('../api/googleCalendar')).default;
    
    // Clear tokens to simulate expiration
    console.log('🗑️ Clearing tokens to simulate expiration...');
    await googleCalendarService.clearTokens();
    
    // Test connection status (should be disconnected)
    console.log('📊 Testing connection after token clearing...');
    const statusAfterClear = await testConnectionStatus();
    console.log('Status after clearing tokens:', statusAfterClear);
    
    // Try to initialize (should fail)
    console.log('🔄 Trying to initialize with cleared tokens...');
    const initResult = await googleCalendarService.initialize();
    console.log(`Initialization result: ${initResult ? 'Success ✅' : 'Failed ❌'}`);
    
    return {
      tokensCleared: true,
      connectionAfterClear: statusAfterClear,
      initializationAfterClear: initResult
    };
    
  } catch (error) {
    console.error('❌ Error simulating token expiration:', error);
    return {
      error: error.message
    };
  }
}

async function fullReconnectionWorkflow() {
  console.log('🔧 Running full reconnection workflow test...');
  console.log('=====================================');
  
  try {
    // Step 1: Check current status
    console.log('\n📊 STEP 1: Checking current connection status');
    const initialStatus = await testConnectionStatus();
    console.log('Initial status:', initialStatus);
    
    // Step 2: Simulate token expiration
    console.log('\n🕐 STEP 2: Simulating token expiration');
    const expirationResult = await simulateTokenExpiration();
    console.log('Expiration simulation result:', expirationResult);
    
    // Step 3: Test reconnection
    console.log('\n🔄 STEP 3: Testing reconnection flow');
    const reconnectionResult = await testReconnection();
    console.log('Reconnection result:', reconnectionResult);
    
    // Step 4: Final status check
    console.log('\n✅ STEP 4: Final connection status check');
    const finalStatus = await testConnectionStatus();
    console.log('Final status:', finalStatus);
    
    // Summary
    console.log('\n📋 WORKFLOW SUMMARY:');
    console.log('====================');
    console.log(`Initial connection: ${initialStatus.hasAccess ? 'Connected' : 'Disconnected'}`);
    console.log(`After expiration: ${expirationResult.connectionAfterClear?.hasAccess ? 'Connected' : 'Disconnected'}`);
    console.log(`Reconnection: ${reconnectionResult.reconnectionSuccess ? 'Success' : 'Failed'}`);
    console.log(`Final connection: ${finalStatus.hasAccess ? 'Connected' : 'Disconnected'}`);
    
    if (reconnectionResult.reconnectionSuccess && finalStatus.hasAccess) {
      console.log('🎉 FULL WORKFLOW SUCCESSFUL! Reconnection works properly.');
    } else {
      console.log('❌ WORKFLOW ISSUES DETECTED. Check the logs above for details.');
    }
    
    return {
      success: reconnectionResult.reconnectionSuccess && finalStatus.hasAccess,
      initialStatus,
      expirationResult,
      reconnectionResult,
      finalStatus
    };
    
  } catch (error) {
    console.error('❌ Error in full workflow test:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Test the Settings UI reconnection flow
async function testSettingsReconnection() {
  console.log('⚙️ Testing Settings page reconnection flow...');
  
  try {
    // Import the CalendarSyncSettings component's logic
    const googleCalendarService = (await import('../api/googleCalendar')).default;
    
    // Clear tokens first
    await googleCalendarService.clearTokens();
    console.log('🗑️ Tokens cleared');
    
    // Simulate the Settings page reconnection logic
    console.log('🔄 Simulating Settings page reconnection...');
    
    const reconnectResult = await googleCalendarService.reconnect();
    
    if (reconnectResult.success) {
      console.log('✅ Settings reconnection successful');
      
      if (reconnectResult.needsRestart) {
        console.log('⚠️ Settings indicates app restart needed');
        return {
          success: true,
          needsRestart: true,
          message: 'Google Calendar connection established, but the service needs a restart.'
        };
      } else {
        console.log('✅ Settings reconnection complete');
        
        // Test the connection
        const hasAccess = await googleCalendarService.checkCalendarAccess();
        return {
          success: true,
          connectionWorking: hasAccess,
          message: 'Google Calendar has been reconnected successfully.'
        };
      }
    } else {
      console.error('❌ Settings reconnection failed:', reconnectResult.error);
      return {
        success: false,
        error: reconnectResult.error
      };
    }
    
  } catch (error) {
    console.error('❌ Error testing Settings reconnection:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.testConnectionStatus = testConnectionStatus;
  window.testReconnection = testReconnection;
  window.simulateTokenExpiration = simulateTokenExpiration;
  window.fullReconnectionWorkflow = fullReconnectionWorkflow;
  window.testSettingsReconnection = testSettingsReconnection;
  
  console.log('🛠️ Google Calendar reconnection test functions available:');
  console.log('   📊 window.testConnectionStatus() - Check current connection');
  console.log('   🔄 window.testReconnection() - Test reconnection flow');
  console.log('   🕐 window.simulateTokenExpiration() - Simulate expired tokens');
  console.log('   🔧 window.fullReconnectionWorkflow() - Full workflow test');
  console.log('   ⚙️ window.testSettingsReconnection() - Test Settings page flow');
}

export { 
  testConnectionStatus, 
  testReconnection, 
  simulateTokenExpiration, 
  fullReconnectionWorkflow,
  testSettingsReconnection 
};
