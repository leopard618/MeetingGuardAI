/**
 * Debug script to test meeting creation and Google Calendar integration
 * This will help identify where the location/participant data is getting corrupted
 */

// Mock the meeting data exactly as shown in the user's screenshot
const testMeetingData = {
  title: "Test Meeting G",
  description: "",
  date: "2025-09-25", // Sep 25, 2025
  time: "06:40", // 6:40am
  duration: 30, // 30 minutes
  location: {
    type: "physical", // Physical meeting
    address: "London", // Location: London
    virtualLink: "https://google-meet.com/meeting/jhwa5hshw3", // Generated meeting link
    virtualPlatform: "Google Meet"
  },
  participants: [
    {
      name: "Seven",
      email: "se7en.star.618@gmail.com",
      role: "participant",
      status: "pending"
    }
  ],
  attachments: []
};

console.log("🧪 DEBUGGING MEETING CREATION");
console.log("=" .repeat(50));
console.log("📝 Test Meeting Data:");
console.log(JSON.stringify(testMeetingData, null, 2));
console.log("=" .repeat(50));

console.log("🔍 EXPECTED GOOGLE CALENDAR RESULT:");
console.log("📍 Location field should contain: 'London'");
console.log("👥 Attendees should contain: se7en.star.618@gmail.com");
console.log("📝 Description should contain: Meeting Link: https://google-meet.com/meeting/jhwa5hshw3");
console.log("=" .repeat(50));

// Check current backend logic (from meetings.js)
console.log("🛠️ BACKEND LOGIC ANALYSIS:");

const meeting = testMeetingData;
let locationField = '';
let descriptionParts = [meeting.description || ''];

if (meeting.location) {
  const locationType = meeting.location.type || 'physical';
  const hasPhysicalLocation = meeting.location.address && meeting.location.address.trim();
  const hasVirtualLink = meeting.location.virtualLink && meeting.location.virtualLink.trim();
  
  console.log("📍 Location processing:");
  console.log("  - Type:", locationType);
  console.log("  - Physical address:", meeting.location.address);
  console.log("  - Virtual link:", meeting.location.virtualLink);
  console.log("  - Has physical location:", hasPhysicalLocation);
  console.log("  - Has virtual link:", hasVirtualLink);
  
  // Backend logic from meetings.js lines 72-82
  if (locationType === 'virtual') {
    locationField = `Virtual Meeting (${meeting.location.virtualPlatform || 'Online'})`;
  } else if (locationType === 'hybrid') {
    locationField = hasPhysicalLocation ? meeting.location.address : 'Hybrid Meeting';
  } else {
    // Physical meeting (but might have a generated meeting link)
    locationField = hasPhysicalLocation ? meeting.location.address : 'Physical Meeting';
  }
  
  console.log("📍 Calculated location field:", locationField);
  
  // Add virtual meeting details to description if present
  if (hasVirtualLink) {
    descriptionParts.push(`\n🔗 Meeting Link: ${meeting.location.virtualLink}`);
    
    if (meeting.location.virtualPlatform) {
      descriptionParts.push(`📹 Platform: ${meeting.location.virtualPlatform}`);
    }
    
    // If this is a physical meeting with a generated link, explain it
    if (locationType === 'physical') {
      descriptionParts.push('\n💡 This physical meeting also has a virtual option available');
    }
  }
}

// Process attendees
const attendees = [];
if (meeting.participants && Array.isArray(meeting.participants)) {
  meeting.participants.forEach((p, index) => {
    if (p.email && p.email.trim()) {
      const attendee = {
        email: p.email.trim(),
        displayName: p.name || p.email.trim()
      };
      attendees.push(attendee);
    }
  });
}

// Add participants to description
if (attendees.length > 0) {
  descriptionParts.push('\n👥 Participants:');
  attendees.forEach(attendee => {
    descriptionParts.push(`• ${attendee.displayName} (${attendee.email})`);
  });
}

const finalDescription = descriptionParts.filter(part => part.trim()).join('\n');

console.log("=" .repeat(50));
console.log("✅ BACKEND SHOULD PRODUCE:");
console.log("📍 Location:", locationField);
console.log("👥 Attendees:", JSON.stringify(attendees, null, 2));
console.log("📝 Description:");
console.log(finalDescription);
console.log("=" .repeat(50));

console.log("🚨 ISSUE ANALYSIS:");
console.log("If Google Calendar shows 'LondonMeeting Link: https://google-meet.com/...'");
console.log("Then the issue is likely:");
console.log("1. Frontend Google Calendar service is still being used");
console.log("2. OR the convertToGoogleEvent function is concatenating incorrectly");
console.log("3. OR the meeting data structure is wrong when sent to backend");

console.log("=" .repeat(50));
console.log("🔧 NEXT STEPS:");
console.log("1. Check if frontend Google Calendar service is being called");
console.log("2. Verify meeting data structure in backend logs");
console.log("3. Check if backend createGoogleCalendarEvent is working correctly");
console.log("4. Ensure attendees are being processed properly");
