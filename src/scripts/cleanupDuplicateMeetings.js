// Cleanup Duplicate Meetings Script
// This script removes duplicate meetings from the database and app

import { Meeting } from '../api/entities.js';

async function cleanupDuplicateMeetings() {
  console.log('🧹 Starting duplicate meetings cleanup...');
  
  try {
    // Get all meetings
    const allMeetings = await Meeting.list();
    console.log(`📊 Total meetings found: ${allMeetings.length}`);
    
    if (allMeetings.length === 0) {
      console.log('✅ No meetings found to clean up');
      return { success: true, removed: 0, kept: 0 };
    }
    
    // Group meetings by title, date, and time
    const meetingGroups = {};
    
    allMeetings.forEach(meeting => {
      const key = `${meeting.title}|${meeting.date}|${meeting.time}`;
      if (!meetingGroups[key]) {
        meetingGroups[key] = [];
      }
      meetingGroups[key].push(meeting);
    });
    
    console.log(`🔍 Found ${Object.keys(meetingGroups).length} unique meeting groups`);
    
    let duplicatesRemoved = 0;
    let meetingsKept = 0;
    
    // Process each group
    for (const [groupKey, meetings] of Object.entries(meetingGroups)) {
      if (meetings.length > 1) {
        console.log(`🔍 Found ${meetings.length} duplicates for: ${groupKey}`);
        
        // Sort by creation date (keep the oldest/first one)
        meetings.sort((a, b) => {
          const dateA = new Date(a.created_at || a.created_date || 0);
          const dateB = new Date(b.created_at || b.created_date || 0);
          return dateA - dateB;
        });
        
        // Keep the first one, remove the rest
        const keepMeeting = meetings[0];
        const removeMeetings = meetings.slice(1);
        
        console.log(`✅ Keeping meeting: ${keepMeeting.id} (${keepMeeting.title})`);
        meetingsKept++;
        
        // Remove duplicates
        for (const duplicate of removeMeetings) {
          try {
            await Meeting.delete(duplicate.id);
            console.log(`🗑️ Removed duplicate: ${duplicate.id}`);
            duplicatesRemoved++;
          } catch (error) {
            console.error(`❌ Failed to remove duplicate ${duplicate.id}:`, error);
          }
        }
      } else {
        // No duplicates for this group
        meetingsKept++;
      }
    }
    
    console.log(`✅ Cleanup completed!`);
    console.log(`   📈 Meetings kept: ${meetingsKept}`);
    console.log(`   🗑️ Duplicates removed: ${duplicatesRemoved}`);
    
    return {
      success: true,
      removed: duplicatesRemoved,
      kept: meetingsKept,
      totalGroups: Object.keys(meetingGroups).length
    };
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    return { success: false, error: error.message };
  }
}

// Advanced cleanup - removes ALL meetings with same title and datetime
async function aggressiveCleanup(titlePattern = null) {
  console.log('🚨 Starting AGGRESSIVE duplicate cleanup...');
  
  try {
    const allMeetings = await Meeting.list();
    console.log(`📊 Total meetings: ${allMeetings.length}`);
    
    let targetMeetings = allMeetings;
    
    // Filter by title pattern if provided
    if (titlePattern) {
      targetMeetings = allMeetings.filter(m => 
        m.title && m.title.includes(titlePattern)
      );
      console.log(`🎯 Targeting meetings with title containing "${titlePattern}": ${targetMeetings.length}`);
    }
    
    // Group by exact match (title + date + time)
    const exactGroups = {};
    
    targetMeetings.forEach(meeting => {
      const exactKey = `${meeting.title}|${meeting.date}|${meeting.time}`;
      if (!exactGroups[exactKey]) {
        exactGroups[exactKey] = [];
      }
      exactGroups[exactKey].push(meeting);
    });
    
    let removed = 0;
    
    // Remove all but one from each exact group
    for (const [groupKey, meetings] of Object.entries(exactGroups)) {
      if (meetings.length > 1) {
        console.log(`🔥 Removing ${meetings.length - 1} exact duplicates for: ${groupKey.split('|')[0]}`);
        
        // Keep only the first one, remove all others
        const keepMeeting = meetings[0];
        const removeMeetings = meetings.slice(1);
        
        for (const duplicate of removeMeetings) {
          try {
            await Meeting.delete(duplicate.id);
            console.log(`🗑️ Removed: ${duplicate.id}`);
            removed++;
          } catch (error) {
            console.error(`❌ Failed to remove ${duplicate.id}:`, error);
          }
        }
      }
    }
    
    console.log(`🚨 AGGRESSIVE cleanup completed: ${removed} meetings removed`);
    
    return { success: true, removed, kept: targetMeetings.length - removed };
    
  } catch (error) {
    console.error('❌ Aggressive cleanup failed:', error);
    return { success: false, error: error.message };
  }
}

// Quick cleanup for "First Meeting" specifically
async function cleanupFirstMeetings() {
  console.log('🎯 Cleaning up "First Meeting" duplicates...');
  
  try {
    const allMeetings = await Meeting.list();
    const firstMeetings = allMeetings.filter(m => 
      m.title && m.title.toLowerCase().includes('first meeting')
    );
    
    console.log(`🔍 Found ${firstMeetings.length} "First Meeting" entries`);
    
    if (firstMeetings.length <= 1) {
      console.log('✅ No duplicates to clean up');
      return { success: true, removed: 0, kept: firstMeetings.length };
    }
    
    // Keep the first one, remove all others
    const keepMeeting = firstMeetings[0];
    const removeMeetings = firstMeetings.slice(1);
    
    console.log(`✅ Keeping: ${keepMeeting.id} (${keepMeeting.title})`);
    
    let removed = 0;
    for (const duplicate of removeMeetings) {
      try {
        await Meeting.delete(duplicate.id);
        console.log(`🗑️ Removed: ${duplicate.id}`);
        removed++;
      } catch (error) {
        console.error(`❌ Failed to remove ${duplicate.id}:`, error);
      }
    }
    
    console.log(`🎯 "First Meeting" cleanup completed: ${removed} duplicates removed`);
    
    return { success: true, removed, kept: 1 };
    
  } catch (error) {
    console.error('❌ First Meeting cleanup failed:', error);
    return { success: false, error: error.message };
  }
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.cleanupDuplicateMeetings = cleanupDuplicateMeetings;
  window.aggressiveCleanup = aggressiveCleanup;
  window.cleanupFirstMeetings = cleanupFirstMeetings;
  
  console.log('🛠️ Duplicate cleanup functions available:');
  console.log('   🧹 window.cleanupDuplicateMeetings() - Smart cleanup keeping oldest');
  console.log('   🎯 window.cleanupFirstMeetings() - Clean up "First Meeting" duplicates');
  console.log('   🚨 window.aggressiveCleanup("pattern") - Remove all matches');
}

export { cleanupDuplicateMeetings, aggressiveCleanup, cleanupFirstMeetings };
