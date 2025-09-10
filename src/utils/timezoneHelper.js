/**
 * Timezone Helper Utilities
 * Helps manage timezone issues between local app, Google Calendar, and PC
 */

/**
 * Get current timezone information
 */
export function getTimezoneInfo() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = now.getTimezoneOffset();
  
  return {
    timezone,
    offset: offset / 60, // Convert to hours
    offsetString: `UTC${offset <= 0 ? '+' : ''}${-offset / 60}`,
    localDate: now.toLocaleDateString(),
    localTime: now.toLocaleTimeString(),
    utcDate: now.toUTCString(),
    isoString: now.toISOString()
  };
}

/**
 * Format date in local timezone (no UTC conversion)
 */
export function formatLocalDate(date) {
  if (!date) return '';
  
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Format time in local timezone
 */
export function formatLocalTime(date) {
  if (!date) return '';
  
  const d = new Date(date);
  return d.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
}

/**
 * Compare dates without timezone conversion
 */
export function compareDates(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  // Compare only date parts (ignore time)
  const d1Date = formatLocalDate(d1);
  const d2Date = formatLocalDate(d2);
  
  return d1Date === d2Date;
}

/**
 * Debug timezone issues
 */
export function debugTimezoneIssue(meetingData) {
  console.log('=== TIMEZONE DEBUG ===');
  console.log('Timezone Info:', getTimezoneInfo());
  console.log('Meeting Data:', meetingData);
  
  if (meetingData.date) {
    const localDate = formatLocalDate(meetingData.date);
    const utcDate = new Date(meetingData.date).toISOString().split('T')[0];
    
    console.log('Local Date:', localDate);
    console.log('UTC Date:', utcDate);
    console.log('Date Difference:', localDate !== utcDate ? 'DIFFERENT!' : 'Same');
  }
  
  console.log('=====================');
}
