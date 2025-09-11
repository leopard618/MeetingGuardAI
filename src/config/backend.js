// Backend API Configuration
// Connect frontend to the deployed backend

import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@env';

// API Version
const API_VERSION = 'v1';

// Production backend URL
export const BACKEND_CONFIG = {
  // Base URL for the deployed backend
  BASE_URL: 'https://meetingguard-backend.onrender.com',
  
  // API version
  API_VERSION: API_VERSION,
  
  // API endpoints (versioned)
  ENDPOINTS: {
    // Authentication (versioned)
    AUTH: {
      PROFILE: `/api/${API_VERSION}/auth/profile`,
      REFRESH: `/api/${API_VERSION}/auth/refresh`,
      LOGOUT: `/api/${API_VERSION}/auth/logout`,
    },
    
    // OAuth (no versioning needed)
    OAUTH: {
      GOOGLE: '/oauth/google',
      CALLBACK: '/oauth',
    },
    
    // Meetings (versioned)
    MEETINGS: {
      LIST: `/api/${API_VERSION}/meetings`,
      CREATE: `/api/${API_VERSION}/meetings`,
      GET: (id) => `/api/${API_VERSION}/meetings/${id}`,
      UPDATE: (id) => `/api/${API_VERSION}/meetings/${id}`,
      DELETE: (id) => `/api/${API_VERSION}/meetings/${id}`,
      PARTICIPANTS: (id) => `/api/${API_VERSION}/meetings/${id}/participants`,
      ATTACHMENTS: (id) => `/api/${API_VERSION}/meetings/${id}/attachments`,
    },
    
    // Calendar (versioned)
    CALENDAR: {
      EVENTS: `/api/${API_VERSION}/calendar/events`,
      SYNC: `/api/${API_VERSION}/calendar/sync`,
      CREATE_EVENT: `/api/${API_VERSION}/calendar/events`,
      UPDATE_EVENT: (id) => `/api/${API_VERSION}/calendar/events/${id}`,
      DELETE_EVENT: (id) => `/api/${API_VERSION}/calendar/events/${id}`,
    },
    
    // AI (versioned)
    AI: {
      CHAT: `/api/${API_VERSION}/ai/chat`,
      MEETING_ANALYSIS: (id) => `/api/${API_VERSION}/ai/meetings/${id}/analyze`,
    },
    
    // Files (versioned)
    FILES: {
      LIST: `/api/${API_VERSION}/files`,
      UPLOAD: `/api/${API_VERSION}/files/upload`,
      GET: (id) => `/api/${API_VERSION}/files/${id}`,
      DELETE: (id) => `/api/${API_VERSION}/files/${id}`,
    },
    
    // Users (versioned)
    USERS: {
      PREFERENCES: `/api/${API_VERSION}/users/preferences`,
      STATS: `/api/${API_VERSION}/users/stats`,
      DELETE_ACCOUNT: `/api/${API_VERSION}/users/account`,
    },
    
    // Billing (versioned)
    BILLING: {
      PLANS: `/api/${API_VERSION}/billing/plans`,
      SUBSCRIPTION: `/api/${API_VERSION}/billing/subscription`,
      CREATE_CHECKOUT: `/api/${API_VERSION}/billing/create-checkout-session`,
      CREATE_PORTAL: `/api/${API_VERSION}/billing/create-portal-session`,
      WEBHOOK: `/api/${API_VERSION}/billing/webhook`,
    },
    
    // Admin (versioned)
    ADMIN: {
      METRICS: `/api/${API_VERSION}/admin/metrics`,
      USERS: `/api/${API_VERSION}/admin/users`,
      USER_DETAILS: (id) => `/api/${API_VERSION}/admin/users/${id}`,
      TOGGLE_USER: (id) => `/api/${API_VERSION}/admin/users/${id}/toggle-enabled`,
      UPDATE_PLAN: (id) => `/api/${API_VERSION}/admin/users/${id}/update-plan`,
    },
  },
  
  // Google OAuth configuration for backend
  GOOGLE_OAUTH: {
    CLIENT_ID: GOOGLE_CLIENT_ID,
    CLIENT_SECRET: GOOGLE_CLIENT_SECRET,
    REDIRECT_URI: 'https://meetingguard-backend.onrender.com/oauth/google',
    SCOPES: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
  },
  
  // Request configuration
  REQUEST_CONFIG: {
    TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
  },
};

/**
 * Get full URL for an endpoint
 */
export const getApiUrl = (endpoint) => {
  return `${BACKEND_CONFIG.BASE_URL}${endpoint}`;
};

/**
 * Create headers for authenticated requests
 */
export const createAuthHeaders = (token) => {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
};

/**
 * Check if backend is accessible
 */
export const checkBackendHealth = async () => {
  try {
    const response = await fetch(getApiUrl('/api/health'));
    const data = await response.json();
    return {
      ok: response.ok,
      data: data
    };
  } catch (error) {
    console.error('Backend health check failed:', error);
    return {
      ok: false,
      error: error.message
    };
  }
};

/**
 * Get backend configuration status
 */
export const getBackendConfigStatus = () => {
  return {
    baseUrl: BACKEND_CONFIG.BASE_URL,
    googleOAuth: {
      hasClientId: !!BACKEND_CONFIG.GOOGLE_OAUTH.CLIENT_ID,
      hasClientSecret: !!BACKEND_CONFIG.GOOGLE_OAUTH.CLIENT_SECRET,
      redirectUri: BACKEND_CONFIG.GOOGLE_OAUTH.REDIRECT_URI,
    },
    endpoints: Object.keys(BACKEND_CONFIG.ENDPOINTS),
  };
};

export default BACKEND_CONFIG;
