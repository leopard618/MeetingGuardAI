// Test Meeting Creation Fix
// This script tests that only one meeting is created when using participants and location

import { Meeting } from '../api/entities.js';

async function testMeetingCreationFix() {
  console.log('🧪 Testing meeting creation fix...');
  
  try {
    // Get current meeting count
    const meetingsBefore = await Meeting.list();
    const countBefore = meetingsBefore.length;
    console.log(`📊 Meetings before test: ${countBefore}`);
    
    // Create test meeting with both participants and location
    const testMeetingData = {
      title: 'TEST: Duplication Fix Meeting',
      description: 'Testing that only one meeting is created',
      date: '2024-01-01',
      time: '14:00',
      duration: 60,
      location: {
        type: 'physical',
        address: '123 Test Street, Test City',
        virtualPlatform: 'zoom',
        virtualLink: 'https://zoom.us/test'
      },
      participants: [
        { name: 'Test User 1', email: 'test1@example.com' },
        { name: 'Test User 2', email: 'test2@example.com' }
      ],
      preparation_tips: 'Test preparation tips',
      source: 'Test',
      confidence: 100,
      created_by: 'test@example.com'
    };
    
    console.log('🔧 Creating test meeting with data:', {
      title: testMeetingData.title,
      participantCount: testMeetingData.participants.length,
      hasLocation: !!testMeetingData.location
    });
    
    // Create the meeting
    const createdMeeting = await Meeting.create(testMeetingData);
    console.log('✅ Meeting created:', {
      id: createdMeeting.id,
      title: createdMeeting.title,
      source: createdMeeting.source
    });
    
    // Wait a moment for any async operations
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check final meeting count
    const meetingsAfter = await Meeting.list();
    const countAfter = meetingsAfter.length;
    console.log(`📊 Meetings after test: ${countAfter}`);
    
    // Analyze results
    const newMeetingsCount = countAfter - countBefore;
    console.log(`🎯 New meetings created: ${newMeetingsCount}`);
    
    if (newMeetingsCount === 1) {
      console.log('✅ SUCCESS: Only one meeting was created!');
      console.log('🎉 Duplication bug has been fixed!');
      
      // Check that the meeting has both participants and location
      const newMeetings = meetingsAfter.filter(m => 
        m.title === 'TEST: Duplication Fix Meeting'
      );
      
      if (newMeetings.length === 1) {
        const meeting = newMeetings[0];
        const hasParticipants = meeting.participants && meeting.participants.length > 0;
        const hasLocation = meeting.location && (meeting.location.address || meeting.location.type);
        
        console.log('📋 Meeting data verification:');
        console.log(`   - Has participants: ${hasParticipants} (${meeting.participants?.length || 0})`);
        console.log(`   - Has location: ${hasLocation}`);
        console.log(`   - Location type: ${meeting.location?.type || 'none'}`);
        console.log(`   - Location address: ${meeting.location?.address || 'none'}`);
        
        if (hasParticipants && hasLocation) {
          console.log('✅ PERFECT: Single meeting contains both participants and location!');
        } else {
          console.log('⚠️ WARNING: Meeting is missing some data');
        }
      }
      
    } else if (newMeetingsCount === 0) {
      console.log('❌ ERROR: No meeting was created');
    } else {
      console.log(`❌ ERROR: ${newMeetingsCount} meetings were created (should be 1)`);
      console.log('🔍 Checking for duplicates...');
      
      const duplicates = meetingsAfter.filter(m => 
        m.title === 'TEST: Duplication Fix Meeting'
      );
      
      console.log(`🔍 Found ${duplicates.length} meetings with test title:`);
      duplicates.forEach((meeting, index) => {
        console.log(`   ${index + 1}. ID: ${meeting.id}`);
        console.log(`      - Participants: ${meeting.participants?.length || 0}`);
        console.log(`      - Location: ${meeting.location?.address || 'none'}`);
        console.log(`      - Source: ${meeting.source || 'unknown'}`);
      });
    }
    
    return {
      success: newMeetingsCount === 1,
      meetingsCreated: newMeetingsCount,
      details: { countBefore, countAfter, createdMeeting }
    };
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  }
}

// Make function available globally
if (typeof window !== 'undefined') {
  window.testMeetingCreationFix = testMeetingCreationFix;
  console.log('💡 Run window.testMeetingCreationFix() to test the duplication fix');
}

export default testMeetingCreationFix;
