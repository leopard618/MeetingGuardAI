// Meeting Data Sanitizer
// Fixes common data format issues in meeting data

/**
 * Sanitize meeting data to ensure proper format
 * @param {Object} meeting - Raw meeting data
 * @returns {Object} Sanitized meeting data
 */
export function sanitizeMeetingData(meeting) {
  if (!meeting || typeof meeting !== 'object') {
    return null;
  }

  const sanitized = { ...meeting };

  // Fix date format
  if (sanitized.date) {
    sanitized.date = sanitizeDate(sanitized.date);
  }

  // Fix time format
  if (sanitized.time) {
    sanitized.time = sanitizeTime(sanitized.time);
  }

  // Fix ID format
  if (sanitized.id) {
    sanitized.id = sanitizeId(sanitized.id);
  }

  // Ensure required fields
  if (!sanitized.title) {
    sanitized.title = 'Untitled Meeting';
  }

  if (!sanitized.date) {
    sanitized.date = new Date().toISOString().split('T')[0]; // Today's date
  }

  if (!sanitized.time) {
    sanitized.time = '09:00'; // Default time
  }

  return sanitized;
}

/**
 * Sanitize date field
 * @param {string|Date} date - Date to sanitize
 * @returns {string} Sanitized date in YYYY-MM-DD format
 */
function sanitizeDate(date) {
  if (!date) return null;

  try {
    // If it's already a Date object
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }

    // If it's a string
    if (typeof date === 'string') {
      // Handle various date formats
      if (date.includes('T')) {
        // ISO format
        return new Date(date).toISOString().split('T')[0];
      } else if (date.includes('-')) {
        // YYYY-MM-DD format
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split('T')[0];
        }
      } else if (date.includes('/')) {
        // MM/DD/YYYY format
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split('T')[0];
        }
      }
    }

    // Try to parse as date
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    console.warn('Invalid date format:', date);
    return new Date().toISOString().split('T')[0]; // Default to today
  } catch (error) {
    console.error('Error sanitizing date:', date, error);
    return new Date().toISOString().split('T')[0]; // Default to today
  }
}

/**
 * Sanitize time field
 * @param {string} time - Time to sanitize
 * @returns {string} Sanitized time in HH:MM format
 */
function sanitizeTime(time) {
  if (!time) return '09:00';

  try {
    // Handle various time formats
    if (typeof time === 'string') {
      // Remove any extra characters
      const cleanTime = time.replace(/[^\d:]/g, '');
      
      // Handle HH:MM:SS format
      if (cleanTime.includes(':') && cleanTime.split(':').length === 3) {
        const [hours, minutes] = cleanTime.split(':');
        return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
      }
      
      // Handle HH:MM format
      if (cleanTime.includes(':') && cleanTime.split(':').length === 2) {
        const [hours, minutes] = cleanTime.split(':');
        return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
      }
      
      // Handle HHMM format
      if (cleanTime.length === 4 && !cleanTime.includes(':')) {
        const hours = cleanTime.substring(0, 2);
        const minutes = cleanTime.substring(2, 4);
        return `${hours}:${minutes}`;
      }
    }

    console.warn('Invalid time format:', time);
    return '09:00'; // Default time
  } catch (error) {
    console.error('Error sanitizing time:', time, error);
    return '09:00'; // Default time
  }
}

/**
 * Sanitize ID field
 * @param {string} id - ID to sanitize
 * @returns {string} Sanitized ID
 */
function sanitizeId(id) {
  if (!id) return null;

  // If it's already a valid UUID, return as is
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) {
    return id;
  }

  // If it's an invalid format, generate a deterministic UUID
  const hash = simpleHash(id);
  return createDeterministicUUID(hash);
}

/**
 * Simple hash function for deterministic ID generation
 * @param {string} str - String to hash
 * @returns {number} Hash value
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Create a deterministic UUID from a hash
 * @param {number} hash - Hash value
 * @returns {string} Deterministic UUID
 */
function createDeterministicUUID(hash) {
  // Convert hash to hex and pad to ensure we have enough characters
  const hex = hash.toString(16).padStart(8, '0');
  
  // Create a deterministic UUID v4-like format
  const uuid = [
    hex.substring(0, 8),
    hex.substring(0, 4),
    '4' + hex.substring(1, 4), // Version 4
    '8' + hex.substring(1, 4), // Variant
    hex.substring(0, 12)
  ].join('-');
  
  return uuid;
}

/**
 * Sanitize an array of meetings
 * @param {Array} meetings - Array of meeting data
 * @returns {Array} Array of sanitized meeting data
 */
export function sanitizeMeetingsArray(meetings) {
  if (!Array.isArray(meetings)) {
    return [];
  }

  return meetings
    .map(meeting => sanitizeMeetingData(meeting))
    .filter(meeting => meeting !== null);
}
