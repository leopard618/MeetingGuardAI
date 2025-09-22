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
 * Convert an invalid ID to a proper UUID (deterministic)
 * @param {string} invalidId - Invalid ID to convert
 * @returns {string} A proper UUID
 */
export function fixInvalidUUID(invalidId) {
  if (isValidUUID(invalidId)) {
    return invalidId;
  }
  
  // Create a deterministic UUID based on the invalid ID
  // This ensures the same invalid ID always produces the same UUID
  const hash = simpleHash(invalidId);
  return createDeterministicUUID(hash);
}

/**
 * Simple hash function for deterministic UUID generation
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
