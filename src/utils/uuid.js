// UUID Generation Utility
// Provides proper UUID v4 generation for the app

/**
 * Generate a proper UUID v4
 * @returns {string} A valid UUID v4 string
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate a local ID for temporary objects
 * @param {string} prefix - Prefix for the ID (e.g., 'local', 'temp')
 * @returns {string} A local ID with proper UUID format
 */
export function generateLocalId(prefix = 'local') {
  return `${prefix}_${generateUUID()}`;
}

/**
 * Validate if a string is a proper UUID
 * @param {string} uuid - String to validate
 * @returns {boolean} True if valid UUID format
 */
export function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Convert an invalid ID to a proper UUID
 * @param {string} invalidId - Invalid ID to convert
 * @returns {string} A proper UUID
 */
export function fixInvalidUUID(invalidId) {
  if (isValidUUID(invalidId)) {
    return invalidId;
  }
  
  // If it's a local ID, generate a new proper UUID
  if (invalidId.startsWith('local_')) {
    return generateLocalId('local');
  }
  
  // For any other invalid format, generate a new UUID
  return generateUUID();
}
