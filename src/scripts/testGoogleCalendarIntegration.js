// Test Google Calendar Integration with Participants and Locations
// This script tests that Google Calendar events are created with proper participants and location handling

import { Meeting } from '../api/entities.js';

async function testGoogleCalendarIntegration() {
  console.log('🗓️ Testing Google Calendar integration...');
  
  const testCases = [
    {
      name: 'Virtual Meeting with Participants',
      data: {
        title: 'TEST: Virtual Meeting',
        description: 'Testing virtual meeting with participants',
        date: '2024-01-25',
        time: '14:00',
        duration: 60,
        location: {
          type: 'virtual',
          virtualPlatform: 'zoom',
          virtualLink: 'https://zoom.us/j/123456789'
        },
        participants: [
          { name: 'Alice Johnson', email: 'alice@example.com' },
          { name: 'Bob Smith', email: 'bob@example.com' }
        ],
        source: 'GoogleCalendarTest'
      }
    },
    {
      name: 'Physical Meeting with Participants',
      data: {
        title: 'TEST: Physical Meeting',
        description: 'Testing physical meeting with participants',
        date: '2024-01-26',
        time: '10:30',
        duration: 45,
        location: {
          type: 'physical',
          address: '123 Main Street, Conference Room A'
        },
        participants: [
          { name: 'Charlie Brown', email: 'charlie@example.com' },
          { name: 'Diana Prince', email: 'diana@example.com' },
          { name: 'Eve Wilson', email: 'eve@example.com' }
        ],
        source: 'GoogleCalendarTest'
      }
    },
    {
      name: 'Hybrid Meeting with Participants',
      data: {
        title: 'TEST: Hybrid Meeting',
        description: 'Testing hybrid meeting with both physical and virtual options',
        date: '2024-01-27',
        time: '16:15',
        duration: 90,
        location: {
          type: 'hybrid',
          address: '456 Business Blvd, Room 202',
          virtualPlatform: 'teams',
          virtualLink: 'https://teams.microsoft.com/l/meetup-join/test'
        },
        participants: [
          { name: 'Frank Miller', email: 'frank@example.com' },
          { name: 'Grace Lee', email: 'grace@example.com' }
        ],
        source: 'GoogleCalendarTest'
      }
    }
  ];
  
  const results = [];
  
  for (const testCase of testCases) {
    console.log(`\n🧪 Testing: ${testCase.name}`);
    
    try {
      console.log('📝 Creating meeting:', {
        title: testCase.data.title,
        locationType: testCase.data.location.type,
        participantCount: testCase.data.participants.length,
        hasVirtualLink: !!testCase.data.location.virtualLink,
        hasPhysicalAddress: !!testCase.data.location.address
      });
      
      const createdMeeting = await Meeting.create(testCase.data);
      
      console.log('✅ Meeting created:', {
        id: createdMeeting.id,
        title: createdMeeting.title
      });
      
      // Wait for Google Calendar processing
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Retrieve the meeting to check if it has proper data
      const retrievedMeeting = await Meeting.get(createdMeeting.id);
      
      const analysis = {
        name: testCase.name,
        success: true,
        meetingId: createdMeeting.id,
        hasParticipants: retrievedMeeting.participants && retrievedMeeting.participants.length > 0,
        participantCount: retrievedMeeting.participants?.length || 0,
        hasLocation: !!retrievedMeeting.location,
        locationType: retrievedMeeting.location?.type,
        hasVirtualLink: !!retrievedMeeting.location?.virtualLink,
        hasPhysicalAddress: !!retrievedMeeting.location?.address,
        participants: retrievedMeeting.participants?.map(p => ({ name: p.name, email: p.email })) || []
      };
      
      console.log('📊 Analysis:', analysis);
      results.push(analysis);
      
    } catch (error) {
      console.error(`❌ Test failed for ${testCase.name}:`, error);
      results.push({
        name: testCase.name,
        success: false,
        error: error.message
      });
    }
  }
  
  // Summary
  console.log('\n📋 TEST SUMMARY:');
  console.log('================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log('\n✅ SUCCESSFUL TESTS:');
    successful.forEach(result => {
      console.log(`   📅 ${result.name}`);
      console.log(`      - Participants: ${result.participantCount} (${result.hasParticipants ? 'Present' : 'Missing'})`);
      console.log(`      - Location Type: ${result.locationType || 'None'}`);
      console.log(`      - Virtual Link: ${result.hasVirtualLink ? 'Present' : 'Not applicable'}`);
      console.log(`      - Physical Address: ${result.hasPhysicalAddress ? 'Present' : 'Not applicable'}`);
      if (result.participants.length > 0) {
        console.log(`      - Participant Details:`);
        result.participants.forEach(p => {
          console.log(`        • ${p.name} (${p.email})`);
        });
      }
    });
  }
  
  if (failed.length > 0) {
    console.log('\n❌ FAILED TESTS:');
    failed.forEach(result => {
      console.log(`   📅 ${result.name}: ${result.error}`);
    });
  }
  
  // Recommendations
  console.log('\n💡 WHAT TO CHECK IN GOOGLE CALENDAR:');
  console.log('1. Open Google Calendar');
  console.log('2. Look for test meetings created just now');
  console.log('3. Check each meeting for:');
  console.log('   - Proper participant list (attendees)');
  console.log('   - Correct location field');
  console.log('   - Meeting links in description (for virtual/hybrid)');
  console.log('   - Physical address in location field (for physical/hybrid)');
  
  return {
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    results: results
  };
}

// Quick test for single meeting type
async function quickLocationTest(locationType = 'virtual') {
  console.log(`⚡ Quick test for ${locationType} meeting...`);
  
  try {
    const testData = {
      title: `Quick ${locationType.toUpperCase()} Test`,
      description: `Quick test for ${locationType} meeting`,
      date: '2024-01-30',
      time: '11:00',
      duration: 30,
      location: {
        type: locationType,
        ...(locationType === 'virtual' || locationType === 'hybrid' ? {
          virtualPlatform: 'zoom',
          virtualLink: 'https://zoom.us/j/quicktest123'
        } : {}),
        ...(locationType === 'physical' || locationType === 'hybrid' ? {
          address: 'Quick Test Office, Room 123'
        } : {})
      },
      participants: [
        { name: 'Test User', email: 'test@example.com' }
      ],
      source: 'QuickTest'
    };
    
    const meeting = await Meeting.create(testData);
    console.log('✅ Quick test meeting created:', meeting.id);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const retrieved = await Meeting.get(meeting.id);
    console.log('📊 Quick test results:', {
      locationType: retrieved.location?.type,
      hasParticipants: retrieved.participants?.length > 0,
      hasVirtualLink: !!retrieved.location?.virtualLink,
      hasPhysicalAddress: !!retrieved.location?.address
    });
    
    return retrieved;
    
  } catch (error) {
    console.error('❌ Quick test failed:', error);
    return { error: error.message };
  }
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.testGoogleCalendarIntegration = testGoogleCalendarIntegration;
  window.quickLocationTest = quickLocationTest;
  
  console.log('🛠️ Google Calendar test functions available:');
  console.log('   🗓️ window.testGoogleCalendarIntegration() - Full test suite');
  console.log('   ⚡ window.quickLocationTest("virtual") - Quick virtual test');
  console.log('   ⚡ window.quickLocationTest("physical") - Quick physical test');
  console.log('   ⚡ window.quickLocationTest("hybrid") - Quick hybrid test');
}

export { testGoogleCalendarIntegration, quickLocationTest };
