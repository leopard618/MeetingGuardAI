

export function createPageUrl(pageName: string) {
    return '/' + pageName.toLowerCase().replace(/ /g, '-');
}

/**
 * Safely convert any value to a string for rendering
 * This prevents React errors when objects are rendered directly
 */
export function safeStringify(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  if (typeof value === 'string') {
    return value;
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '[Object]';
    }
  }
  
  return String(value);
}

/**
 * Safely get a nested property from an object
 */
export function safeGet(obj: any, path: string, defaultValue: any = ''): any {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return defaultValue;
    }
  }
  
  return current;
}

/**
 * Validate and fix meeting data to ensure all required fields are present
 */
export function validateMeetingData(meetingData: any, userMessage?: string): any {
  if (!meetingData || typeof meetingData !== 'object') {
    console.error('validateMeetingData: Invalid meeting data:', meetingData);
    return null;
  }
  
  console.log('validateMeetingData: Validating meeting data:', meetingData);
  
  // Create a copy to avoid modifying the original
  const validatedData = { ...meetingData };
  
  // Ensure title is present
  if (!validatedData.title || validatedData.title.trim() === '') {
    console.error('validateMeetingData: Title is missing!');
    return null;
  }
  
  // Ensure date and time are present
  if (!validatedData.date || validatedData.date.trim() === '') {
    console.error('validateMeetingData: Date is missing!');
    return null;
  }
  
  if (!validatedData.time || validatedData.time.trim() === '') {
    console.error('validateMeetingData: Time is missing!');
    return null;
  }
  
  // Set default duration if missing
  if (!validatedData.duration) {
    validatedData.duration = 60;
    console.log('validateMeetingData: Set default duration to 60 minutes');
  }
  
  // Set default source if missing
  if (!validatedData.source) {
    validatedData.source = 'local';
    console.log('validateMeetingData: Set default source to local');
  }
  
  console.log('validateMeetingData: Validated data:', validatedData);
  return validatedData;
}

/**
 * Make meeting data safe for rendering by ensuring objects are properly handled
 */
export function makeMeetingDataSafe(meetingData: any, userMessage?: string): any {
  if (!meetingData || typeof meetingData !== 'object') {
    return meetingData;
  }
  
  console.log('makeMeetingDataSafe: Input meeting data:', meetingData);
  console.log('makeMeetingDataSafe: Date before normalization:', meetingData.date);
  console.log('makeMeetingDataSafe: Time before normalization:', meetingData.time);
  
  // For delete operations, if we only have meetingId, don't warn about missing fields
  const isDeleteOperation = meetingData.meetingId && (!meetingData.title || !meetingData.date);
  
  // Check if date/time are missing or empty and try to infer them
  let inferredDate = meetingData.date;
  let inferredTime = meetingData.time;
  
  if (!inferredDate || inferredDate === '') {
    console.log('makeMeetingDataSafe: Date is empty, trying to infer from user message');
    if (userMessage) {
      const extracted = extractDateTimeFromMessage(userMessage);
      if (extracted.date) {
        inferredDate = extracted.date;
        console.log('makeMeetingDataSafe: Inferred date from user message:', inferredDate);
      }
    }
  }
  
  if (!inferredTime || inferredTime === '') {
    console.log('makeMeetingDataSafe: Time is empty, trying to infer from user message');
    if (userMessage) {
      const extracted = extractDateTimeFromMessage(userMessage);
      if (extracted.time) {
        inferredTime = extracted.time;
        console.log('makeMeetingDataSafe: Inferred time from user message:', inferredTime);
      }
    }
  }
  
  const safeData = {
    ...meetingData,
    date: normalizeDate(inferredDate),
    time: normalizeTime(inferredTime),
    location: typeof meetingData.location === 'object' 
      ? { ...meetingData.location } 
      : meetingData.location,
      participants: Array.isArray(meetingData.participants)
    ? meetingData.participants.map((p: any) => 
        typeof p === 'object' ? { ...p } : p
      )
    : meetingData.participants
  };
  
  console.log('makeMeetingDataSafe: Date after normalization:', safeData.date);
  console.log('makeMeetingDataSafe: Time after normalization:', safeData.time);
  
  // Only show warnings if this is not a delete operation with only meetingId
  if (!isDeleteOperation) {
    // Validate that we have valid date and time
    if (!safeData.date || safeData.date === '') {
      console.error('makeMeetingDataSafe: WARNING - Date is still empty after normalization!');
    }
    
    if (!safeData.time || safeData.time === '') {
      console.error('makeMeetingDataSafe: WARNING - Time is still empty after normalization!');
    }
  } else {
    console.log('makeMeetingDataSafe: Delete operation detected with only meetingId, skipping field validation warnings');
  }
  
  return safeData;
}

/**
 * Normalize date format to ensure consistency
 */
export function normalizeDate(date: any): string {
  if (!date) {
    console.log('normalizeDate: Empty date input');
    return '';
  }
  
  console.log('normalizeDate: Input date:', date, 'Type:', typeof date);
  
  try {
    // If it's already a string in YYYY-MM-DD format, return as is
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.log('normalizeDate: Already in YYYY-MM-DD format');
      return date;
    }
    
    // If it's a Date object, convert to YYYY-MM-DD using local timezone
    if (date instanceof Date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const result = `${year}-${month}-${day}`;
      console.log('normalizeDate: Converted Date object to local date:', result);
      return result;
    }
    
    // Try to parse as Date and convert using local timezone
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      const year = parsedDate.getFullYear();
      const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
      const day = String(parsedDate.getDate()).padStart(2, '0');
      const result = `${year}-${month}-${day}`;
      console.log('normalizeDate: Parsed date string to local date:', result);
      return result;
    }
    
    // If it's a string with different format, try to parse
    if (typeof date === 'string') {
      // Handle MM/DD/YYYY format
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
        const [month, day, year] = date.split('/');
        const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        console.log('normalizeDate: Converted MM/DD/YYYY to:', result);
        return result;
      }
      
      // Handle DD/MM/YYYY format
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
        const [day, month, year] = date.split('/');
        const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        console.log('normalizeDate: Converted DD/MM/YYYY to:', result);
        return result;
      }
      
      // Handle relative dates like "tomorrow", "next Monday", etc.
      if (date.toLowerCase().includes('tomorrow')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        const result = `${year}-${month}-${day}`;
        console.log('normalizeDate: Converted "tomorrow" to local date:', result);
        return result;
      }
      
      if (date.toLowerCase().includes('today')) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const result = `${year}-${month}-${day}`;
        console.log('normalizeDate: Converted "today" to local date:', result);
        return result;
      }
      
      // Handle "next week" patterns
      if (date.toLowerCase().includes('next week')) {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        const year = nextWeek.getFullYear();
        const month = String(nextWeek.getMonth() + 1).padStart(2, '0');
        const day = String(nextWeek.getDate()).padStart(2, '0');
        const result = `${year}-${month}-${day}`;
        console.log('normalizeDate: Converted "next week" to local date:', result);
        return result;
      }
    }
    
    console.log('normalizeDate: Could not normalize date:', date);
    return date;
  } catch (error) {
    console.error('normalizeDate: Error normalizing date:', error);
    return date;
  }
}

/**
 * Extract date and time from user message
 */
export function extractDateTimeFromMessage(message: string): { date: string, time: string } {
  const result = { date: '', time: '' };
  
  if (!message) return result;
  
  const messageLower = message.toLowerCase();
  
  // Extract date patterns using local timezone
  if (messageLower.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    result.date = `${year}-${month}-${day}`;
  } else if (messageLower.includes('today')) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    result.date = `${year}-${month}-${day}`;
  } else if (messageLower.includes('next week')) {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const year = nextWeek.getFullYear();
    const month = String(nextWeek.getMonth() + 1).padStart(2, '0');
    const day = String(nextWeek.getDate()).padStart(2, '0');
    result.date = `${year}-${month}-${day}`;
  }
  
  // Extract time patterns
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
    /(\d{1,2})\s*(am|pm)/i,
    /(\d{1,2}):(\d{2})/i
  ];
  
  for (const pattern of timePatterns) {
    const match = message.match(pattern);
    if (match) {
      let hours = parseInt(match[1]);
      let minutes = match[2] ? parseInt(match[2]) : 0;
      const ampm = match[3] ? match[3].toLowerCase() : null;
      
      if (ampm === 'pm' && hours !== 12) {
        hours += 12;
      } else if (ampm === 'am' && hours === 12) {
        hours = 0;
      }
      
      result.time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      break;
    }
  }
  
  console.log('extractDateTimeFromMessage: Extracted from message:', result);
  return result;
}

/**
 * Normalize time format to ensure consistency
 */
export function normalizeTime(time: any): string {
  if (!time) {
    console.log('normalizeTime: Empty time input');
    return '';
  }
  
  console.log('normalizeTime: Input time:', time, 'Type:', typeof time);
  
  try {
    // If it's already a string in HH:MM format, return as is
    if (typeof time === 'string' && /^\d{1,2}:\d{2}$/.test(time)) {
      const [hours, minutes] = time.split(':');
      const result = `${hours.padStart(2, '0')}:${minutes}`;
      console.log('normalizeTime: Already in HH:MM format:', result);
      return result;
    }
    
    // If it's a Date object, extract time
    if (time instanceof Date) {
      const result = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
      console.log('normalizeTime: Extracted time from Date object:', result);
      return result;
    }
    
    // Handle AM/PM format
    if (typeof time === 'string') {
      const timeLower = time.toLowerCase().trim();
      
      // Handle "2 PM", "2:30 PM", "14:30" formats
      if (timeLower.includes('pm') || timeLower.includes('am')) {
        let timeStr = timeLower.replace(/\s*(am|pm)\s*/i, '');
        let [hoursStr, minutesStr = '00'] = timeStr.split(':');
        
        let hours = parseInt(hoursStr);
        if (timeLower.includes('pm') && hours !== 12) {
          hours += 12;
        } else if (timeLower.includes('am') && hours === 12) {
          hours = 0;
        }
        
        const result = `${hours.toString().padStart(2, '0')}:${minutesStr.padStart(2, '0')}`;
        console.log('normalizeTime: Converted AM/PM format to:', result);
        return result;
      }
      
      // Try to parse as Date and extract time
      const parsedTime = new Date(`2000-01-01T${time}`);
      if (!isNaN(parsedTime.getTime())) {
        const result = `${parsedTime.getHours().toString().padStart(2, '0')}:${parsedTime.getMinutes().toString().padStart(2, '0')}`;
        console.log('normalizeTime: Parsed time string to:', result);
        return result;
      }
    }
    
    console.log('normalizeTime: Could not normalize time:', time);
    return time;
  } catch (error) {
    console.error('normalizeTime: Error normalizing time:', error);
    return time;
  }
}