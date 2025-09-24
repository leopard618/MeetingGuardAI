// Test Google Calendar Event Creation with Physical Location + Meeting Link
// This script tests the exact scenario from the user's screenshot

import { Meeting } from '../api/entities.js';

async function testPhysicalMeetingWithLink() {
  console.log('🧪 Testing physical meeting with generated meeting link...');
  
  try {
    // Simulate the exact scenario from the screenshot
    const testMeetingData = {
      title: 'A Test Meeting',
      description: 'a testing',
      date: '2025-09-24',
      time: '15:30',
      duration: 30,
      location: {
        type: 'physical', // This is key - physical meeting with generated link
        address: 'Mexico',
        virtualPlatform: 'google-meet',
        virtualLink: 'https://google-meet.com/meeting/51kob2rpu6n' // Generated link
      },
      participants: [
        { name: 'Luca', email: 'lucadev0421@gmail.com' }
      ],
      source: 'Test',
      confidence: 100,
      created_by: 'test@example.com'
    };
    
    console.log('📝 Creating test meeting with data:', {
      title: testMeetingData.title,
      locationType: testMeetingData.location.type,
      physicalLocation: testMeetingData.location.address,
      hasVirtualLink: !!testMeetingData.location.virtualLink,
      virtualLink: testMeetingData.location.virtualLink,
      participantCount: testMeetingData.participants.length,
      participants: testMeetingData.participants
    });
    
    // Create the meeting
    const createdMeeting = await Meeting.create(testMeetingData);
    console.log('✅ Meeting created:', {
      id: createdMeeting.id,
      title: createdMeeting.title
    });
    
    // Wait for backend processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Retrieve the meeting to verify data
    console.log('🔍 Retrieving meeting to verify data...');
    const retrievedMeeting = await Meeting.get(createdMeeting.id);
    
    if (!retrievedMeeting) {
      console.log('❌ ERROR: Could not retrieve the created meeting');
      return { success: false, error: 'Meeting not found after creation' };
    }
    
    console.log('📋 Retrieved meeting data:');
    console.log('   ID:', retrievedMeeting.id);
    console.log('   Title:', retrievedMeeting.title);
    console.log('   Location:', retrievedMeeting.location);
    console.log('   Participants:', retrievedMeeting.participants);
    
    // Analyze the results
    const hasLocation = retrievedMeeting.location && retrievedMeeting.location.address;
    const hasVirtualLink = retrievedMeeting.location && retrievedMeeting.location.virtualLink;
    const hasParticipants = retrievedMeeting.participants && 
      Array.isArray(retrievedMeeting.participants) && 
      retrievedMeeting.participants.length > 0;
    
    console.log('🎯 Analysis Results:');
    console.log(`   ✅ Has physical location: ${hasLocation} (${retrievedMeeting.location?.address || 'None'})`);
    console.log(`   ✅ Has virtual link: ${hasVirtualLink} (${retrievedMeeting.location?.virtualLink || 'None'})`);
    console.log(`   ✅ Has participants: ${hasParticipants} (${retrievedMeeting.participants?.length || 0})`);
    
    if (hasParticipants) {
      console.log('📋 Participant details:');
      retrievedMeeting.participants.forEach((p, index) => {
        console.log(`   ${index + 1}. ${p.name || 'No name'} (${p.email || 'No email'})`);
      });
    }
    
    // Expected Google Calendar behavior
    console.log('\n🗓️ Expected Google Calendar Event:');
    console.log('   Location Field: "Mexico" (physical location only)');
    console.log('   Description: Should include meeting link and participant list');
    console.log('   Attendees: Should include lucadev0421@gmail.com');
    
    return {
      success: true,
      meeting: retrievedMeeting,
      hasLocation,
      hasVirtualLink,
      hasParticipants,
      participantCount: retrievedMeeting.participants?.length || 0,
      expectedGoogleCalendar: {
        locationField: 'Mexico',
        shouldHaveMeetingLinkInDescription: true,
        shouldHaveParticipantInAttendees: true
      }
    };
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  }
}

async function testDifferentLocationScenarios() {
  console.log('🔧 Testing different location scenarios...');
  
  const scenarios = [
    {
      name: 'Physical Only',
      data: {
        title: 'Physical Only Meeting',
        location: {
          type: 'physical',
          address: 'Conference Room A'
        },
        participants: [{ name: 'Test User', email: 'test@example.com' }]
      },
      expected: {
        locationField: 'Conference Room A',
        descriptionShouldInclude: ['Test User']
      }
    },
    {
      name: 'Virtual Only',
      data: {
        title: 'Virtual Only Meeting',
        location: {
          type: 'virtual',
          virtualPlatform: 'zoom',
          virtualLink: 'https://zoom.us/j/123456789'
        },
        participants: [{ name: 'Test User', email: 'test@example.com' }]
      },
      expected: {
        locationField: 'Virtual Meeting (zoom)',
        descriptionShouldInclude: ['Meeting Link', 'Test User']
      }
    },
    {
      name: 'Physical + Generated Link (User Scenario)',
      data: {
        title: 'Physical with Generated Link',
        location: {
          type: 'physical',
          address: 'Mexico',
          virtualPlatform: 'google-meet',
          virtualLink: 'https://google-meet.com/meeting/test123'
        },
        participants: [{ name: 'Luca', email: 'lucadev0421@gmail.com' }]
      },
      expected: {
        locationField: 'Mexico',
        descriptionShouldInclude: ['Meeting Link', 'virtual option', 'Luca']
      }
    },
    {
      name: 'Hybrid Meeting',
      data: {
        title: 'Hybrid Meeting',
        location: {
          type: 'hybrid',
          address: 'Office Building',
          virtualPlatform: 'teams',
          virtualLink: 'https://teams.microsoft.com/l/meetup-join/test'
        },
        participants: [{ name: 'Test User', email: 'test@example.com' }]
      },
      expected: {
        locationField: 'Office Building',
        descriptionShouldInclude: ['Meeting Link', 'Physical Location', 'hybrid meeting', 'Test User']
      }
    }
  ];
  
  const results = [];
  
  for (const scenario of scenarios) {
    console.log(`\n🧪 Testing: ${scenario.name}`);
    
    try {
      const meetingData = {
        ...scenario.data,
        description: `Testing ${scenario.name}`,
        date: '2024-02-01',
        time: '14:00',
        duration: 30,
        source: 'LocationTest'
      };
      
      console.log('📝 Creating meeting:', meetingData.title);
      const meeting = await Meeting.create(meetingData);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const retrieved = await Meeting.get(meeting.id);
      
      results.push({
        scenario: scenario.name,
        success: true,
        meeting: retrieved,
        expected: scenario.expected
      });
      
      console.log(`✅ ${scenario.name} completed`);
      
    } catch (error) {
      console.error(`❌ ${scenario.name} failed:`, error);
      results.push({
        scenario: scenario.name,
        success: false,
        error: error.message
      });
    }
  }
  
  // Summary
  console.log('\n📊 SCENARIO TEST RESULTS:');
  console.log('========================');
  
  results.forEach(result => {
    console.log(`${result.success ? '✅' : '❌'} ${result.scenario}`);
    if (result.success && result.meeting) {
      console.log(`   Location: ${result.meeting.location?.address || 'None'}`);
      console.log(`   Virtual Link: ${result.meeting.location?.virtualLink ? 'Present' : 'None'}`);
      console.log(`   Participants: ${result.meeting.participants?.length || 0}`);
    } else if (!result.success) {
      console.log(`   Error: ${result.error}`);
    }
  });
  
  return results;
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.testPhysicalMeetingWithLink = testPhysicalMeetingWithLink;
  window.testDifferentLocationScenarios = testDifferentLocationScenarios;
  
  console.log('🛠️ Google Calendar event creation test functions available:');
  console.log('   🧪 window.testPhysicalMeetingWithLink() - Test exact user scenario');
  console.log('   🔧 window.testDifferentLocationScenarios() - Test all location types');
}

export { testPhysicalMeetingWithLink, testDifferentLocationScenarios };
