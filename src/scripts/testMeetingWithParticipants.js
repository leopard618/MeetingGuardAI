// Test Meeting Creation with Participants and Location
// This script tests that meetings are created with both participants and meeting links

import { Meeting } from '../api/entities.js';

async function testMeetingWithParticipants() {
  console.log('🧪 Testing meeting creation with participants and location...');
  
  try {
    // Create test meeting with both participants and location
    const testMeetingData = {
      title: 'TEST: Participants & Location Meeting',
      description: 'Testing meeting with both participants and meeting link',
      date: '2024-01-15',
      time: '15:30',
      duration: 45,
      location: {
        type: 'virtual',
        address: 'Virtual Meeting Room',
        virtualPlatform: 'zoom',
        virtualLink: 'https://zoom.us/j/123456789'
      },
      participants: [
        { name: 'John Doe', email: 'john.doe@example.com' },
        { name: 'Jane Smith', email: 'jane.smith@example.com' },
        { name: 'Bob Wilson', email: 'bob.wilson@example.com' }
      ],
      preparation_tips: 'Please review the agenda before the meeting',
      source: 'Test',
      confidence: 100,
      created_by: 'test@example.com'
    };
    
    console.log('🔧 Creating test meeting with:', {
      title: testMeetingData.title,
      participantCount: testMeetingData.participants.length,
      hasLocation: !!testMeetingData.location,
      hasVirtualLink: !!testMeetingData.location.virtualLink,
      participants: testMeetingData.participants.map(p => `${p.name} (${p.email})`)
    });
    
    // Create the meeting
    const createdMeeting = await Meeting.create(testMeetingData);
    console.log('✅ Meeting created:', {
      id: createdMeeting.id,
      title: createdMeeting.title,
      source: createdMeeting.source
    });
    
    // Wait a moment for backend processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Retrieve the meeting to verify participants and location are included
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
    const hasLocation = retrievedMeeting.location && (
      retrievedMeeting.location.virtualLink || 
      retrievedMeeting.location.address ||
      retrievedMeeting.location.type
    );
    
    const hasParticipants = retrievedMeeting.participants && 
      Array.isArray(retrievedMeeting.participants) && 
      retrievedMeeting.participants.length > 0;
    
    const hasVirtualLink = retrievedMeeting.location && retrievedMeeting.location.virtualLink;
    
    console.log('🎯 Analysis Results:');
    console.log(`   ✅ Has location data: ${hasLocation}`);
    console.log(`   ✅ Has participants: ${hasParticipants} (${retrievedMeeting.participants?.length || 0})`);
    console.log(`   ✅ Has virtual link: ${hasVirtualLink}`);
    
    if (hasLocation && hasParticipants && hasVirtualLink) {
      console.log('🎉 SUCCESS: Meeting has both participants and location with virtual link!');
      
      // Show participant details
      if (retrievedMeeting.participants) {
        console.log('📋 Participant details:');
        retrievedMeeting.participants.forEach((p, index) => {
          console.log(`   ${index + 1}. ${p.name || 'No name'} (${p.email || 'No email'})`);
        });
      }
      
      // Show location details
      if (retrievedMeeting.location) {
        console.log('📍 Location details:');
        console.log(`   Type: ${retrievedMeeting.location.type || 'Not specified'}`);
        console.log(`   Platform: ${retrievedMeeting.location.virtualPlatform || 'Not specified'}`);
        console.log(`   Link: ${retrievedMeeting.location.virtualLink || 'Not specified'}`);
      }
      
      return {
        success: true,
        meeting: retrievedMeeting,
        hasLocation,
        hasParticipants,
        hasVirtualLink,
        participantCount: retrievedMeeting.participants?.length || 0
      };
      
    } else {
      console.log('❌ ISSUE DETECTED:');
      if (!hasLocation) console.log('   - Missing location data');
      if (!hasParticipants) console.log('   - Missing participants');
      if (!hasVirtualLink) console.log('   - Missing virtual link');
      
      return {
        success: false,
        meeting: retrievedMeeting,
        hasLocation,
        hasParticipants,
        hasVirtualLink,
        issues: {
          missingLocation: !hasLocation,
          missingParticipants: !hasParticipants,
          missingVirtualLink: !hasVirtualLink
        }
      };
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  }
}

// Quick test for specific issues
async function quickParticipantTest() {
  console.log('⚡ Quick participant test...');
  
  try {
    const testData = {
      title: 'Quick Test Meeting',
      description: 'Quick test',
      date: '2024-01-20',
      time: '10:00',
      duration: 30,
      location: {
        type: 'virtual',
        virtualPlatform: 'zoom',
        virtualLink: 'https://zoom.us/j/quicktest'
      },
      participants: [
        { name: 'Test User', email: 'test@example.com' }
      ],
      source: 'QuickTest',
      confidence: 100
    };
    
    console.log('📝 Creating quick test meeting...');
    const meeting = await Meeting.create(testData);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const retrieved = await Meeting.get(meeting.id);
    
    console.log('📊 Quick test results:');
    console.log(`   Participants: ${retrieved.participants?.length || 0}`);
    console.log(`   Virtual Link: ${retrieved.location?.virtualLink ? 'Present' : 'Missing'}`);
    
    return {
      participantCount: retrieved.participants?.length || 0,
      hasVirtualLink: !!retrieved.location?.virtualLink
    };
    
  } catch (error) {
    console.error('❌ Quick test failed:', error);
    return { error: error.message };
  }
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.testMeetingWithParticipants = testMeetingWithParticipants;
  window.quickParticipantTest = quickParticipantTest;
  
  console.log('🛠️ Meeting test functions available:');
  console.log('   🧪 window.testMeetingWithParticipants() - Full test');
  console.log('   ⚡ window.quickParticipantTest() - Quick test');
}

export { testMeetingWithParticipants, quickParticipantTest };
