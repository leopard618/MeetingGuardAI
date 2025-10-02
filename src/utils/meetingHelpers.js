/**
 * Meeting Helper Utilities
 * Safe handling of meeting data to prevent React rendering errors
 */

/**
 * Safely extract location string from meeting location object
 * @param {Object|string} location - The location data (can be string or object)
 * @returns {string} - A safe string representation of the location
 */
export const getLocationString = (location) => {
  if (!location) return '';
  
  // If it's already a string, return it
  if (typeof location === 'string') return location;
  
  // If it's an object, extract the appropriate field
  if (typeof location === 'object') {
    // For virtual meetings
    if (location.type === 'virtual') {
      const platform = location.virtualPlatform || location.virtual_platform || 'Online';
      return `Virtual Meeting (${platform})`;
    }
    
    // For hybrid meetings
    if (location.type === 'hybrid') {
      const platform = location.virtualPlatform || location.virtual_platform || 'Online';
      const address = location.address || '';
      if (address) {
        return `${address} + Virtual (${platform})`;
      }
      return `Hybrid Meeting (${platform})`;
    }
    
    // For physical meetings
    if (location.address) {
      return typeof location.address === 'string' 
        ? location.address 
        : JSON.stringify(location.address);
    }
    
    // Fallback - try common location fields
    if (location.name) return location.name;
    if (location.location) return getLocationString(location.location);
    
    // Last resort - convert to string safely
    return 'Location specified';
  }
  
  // Fallback for any other type
  return String(location);
};

/**
 * Safely extract meeting link
 * @param {Object} meeting - The meeting object
 * @returns {string|null} - The meeting link or null
 */
export const getMeetingLink = (meeting) => {
  if (!meeting) return null;
  
  // Check direct link property
  if (meeting.link && typeof meeting.link === 'string') {
    return meeting.link;
  }
  
  // Check location object
  if (meeting.location && typeof meeting.location === 'object') {
    if (meeting.location.virtualLink) return meeting.location.virtualLink;
    if (meeting.location.virtual_link) return meeting.location.virtual_link;
    if (meeting.location.link) return meeting.location.link;
  }
  
  return null;
};

/**
 * Safely extract virtual platform name
 * @param {Object} meeting - The meeting object
 * @returns {string} - The platform name or 'Online'
 */
export const getVirtualPlatform = (meeting) => {
  if (!meeting) return 'Online';
  
  // Check location object
  if (meeting.location && typeof meeting.location === 'object') {
    if (meeting.location.virtualPlatform) return meeting.location.virtualPlatform;
    if (meeting.location.virtual_platform) return meeting.location.virtual_platform;
    if (meeting.location.platform) return meeting.location.platform;
  }
  
  // Check direct property
  if (meeting.virtualPlatform) return meeting.virtualPlatform;
  if (meeting.virtual_platform) return meeting.virtual_platform;
  
  return 'Online';
};

/**
 * Safely stringify any value for display
 * Prevents "Objects are not valid as React child" errors
 * @param {any} value - The value to stringify
 * @returns {string} - Safe string representation
 */
export const safeStringify = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    // Check for common displayable properties
    if (value.name) return value.name;
    if (value.title) return value.title;
    if (value.label) return value.label;
    // Last resort
    return JSON.stringify(value);
  }
  return String(value);
};

/**
 * Format meeting time safely
 * @param {string|Date} time - The time to format
 * @returns {string} - Formatted time string
 */
export const formatMeetingTime = (time) => {
  if (!time) return '';
  
  try {
    if (typeof time === 'string') {
      // If it's already formatted (like "14:30"), return it
      if (/^\d{1,2}:\d{2}/.test(time)) return time;
      
      // Try to parse as date
      const date = new Date(time);
      if (!isNaN(date.getTime())) {
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: true 
        });
      }
    }
    
    if (time instanceof Date) {
      return time.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    }
    
    return String(time);
  } catch (error) {
    console.error('Error formatting meeting time:', error);
    return '';
  }
};

/**
 * Format meeting date safely
 * @param {string|Date} date - The date to format
 * @returns {string} - Formatted date string
 */
export const formatMeetingDate = (date) => {
  if (!date) return '';
  
  try {
    if (typeof date === 'string') {
      // If it's already formatted (like "2025-10-01"), check if valid
      const parsedDate = new Date(date);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      }
    }
    
    if (date instanceof Date) {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
    
    return String(date);
  } catch (error) {
    console.error('Error formatting meeting date:', error);
    return '';
  }
};

export default {
  getLocationString,
  getMeetingLink,
  getVirtualPlatform,
  safeStringify,
  formatMeetingTime,
  formatMeetingDate,
};

