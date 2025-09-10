// API Configuration
// IMPORTANT: Never commit API keys to version control!
// Use environment variables for secure configuration

// Import environment variables from .env file
import { OPENAI_API_KEY, OPENAI_MODEL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REDIRECT_URI_SCHEME } from '@env';

/**
 * Check if API is properly configured
 */
export const isAPIConfigured = () => {
  return {
    openai: {
      hasKey: !!OPENAI_API_KEY,
      keyFormat: OPENAI_API_KEY?.startsWith('sk-'),
      model: OPENAI_MODEL || 'gpt-4o-mini',
    },
    google: {
      hasClientId: !!GOOGLE_CLIENT_ID,
      hasClientSecret: !!GOOGLE_CLIENT_SECRET,
      hasRedirectUri: !!GOOGLE_REDIRECT_URI,
      hasRedirectUriScheme: !!GOOGLE_REDIRECT_URI_SCHEME,
      configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && GOOGLE_REDIRECT_URI_SCHEME),
    }
  };
};

/**
 * Get API configuration status
 */
export const getAPIConfigStatus = () => {
  const config = isAPIConfigured();
  
  return {
    openaiConfigured: config.openai.hasKey && config.openai.keyFormat,
    googleConfigured: config.google.configured,
    missingConfig: {
      openai: !config.openai.hasKey ? 'OpenAI API key missing' : 
              !config.openai.keyFormat ? 'OpenAI API key format invalid' : null,
      google: !config.google.configured ? 'Google OAuth credentials missing' : null,
    }
  };
};

/**
 * Validate API configuration
 */
export const validateAPIConfig = () => {
  const status = getAPIConfigStatus();
  const errors = [];
  
  if (!status.openaiConfigured) {
    errors.push('OpenAI API key not configured or invalid');
  }
  
  if (!status.googleConfigured) {
    errors.push('Google OAuth not configured');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    status
  };
};

export default {
  isAPIConfigured,
  getAPIConfigStatus,
  validateAPIConfig,
};