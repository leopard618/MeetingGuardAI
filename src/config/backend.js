// Backend API Configuration
// Connect frontend to the deployed backend

import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@env';

// Production backend URL
export const BACKEND_CONFIG = {
  // Base URL for the deployed backend
  BASE_URL: 'https://meetingguard-backend.onrender.com',
  
  // API endpoints
  ENDPOINTS: {
    // Authentication
    AUTH: {
      PROFILE: '/api/auth/profile',
      REFRESH: '/api/auth/refresh',
      LOGOUT: '/api/auth/logout',
    },
    
    // OAuth
    OAUTH: {
      GOOGLE: '/oauth/google',
      CALLBACK: '/oauth',
    },
    
    // Meetings
    MEETINGS: {
      LIST: '/api/meetings',
      CREATE: '/api/meetings',
      GET: (id) => `/api/meetings/${id}`,
      UPDATE: (id) => `/api/meetings/${id}`,
      DELETE: (id) => `/api/meetings/${id}`,
      PARTICIPANTS: (id) => `/api/meetings/${id}/participants`,
      ATTACHMENTS: (id) => `/api/meetings/${id}/attachments`,
    },
    
    // Calendar
    CALENDAR: {
      EVENTS: '/api/calendar/events',
      SYNC: '/api/calendar/sync',
      CREATE_EVENT: '/api/calendar/events',
      UPDATE_EVENT: (id) => `/api/calendar/events/${id}`,
      DELETE_EVENT: (id) => `/api/calendar/events/${id}`,
    },
    
    // AI
    AI: {
      CHAT: '/api/ai/chat',
      MEETING_ANALYSIS: (id) => `/api/ai/meetings/${id}/analyze`,
    },
    
    // Files
    FILES: {
      LIST: '/api/files',
      UPLOAD: '/api/files/upload',
      GET: (id) => `/api/files/${id}`,
      DELETE: (id) => `/api/files/${id}`,
    },
    
    // Users
    USERS: {
      PREFERENCES: '/api/users/preferences',
      STATS: '/api/users/stats',
      DELETE_ACCOUNT: '/api/users/account',
    },
    
    // Billing
    BILLING: {
      PLANS: '/api/billing/plans',
      SUBSCRIPTION: '/api/billing/subscription',
      CREATE_CHECKOUT: '/api/billing/create-checkout-session',
      CREATE_PORTAL: '/api/billing/create-portal-session',
      WEBHOOK: '/api/billing/webhook',
    },
    
    // Admin
    ADMIN: {
      METRICS: '/api/admin/metrics',
      USERS: '/api/admin/users',
      USER_DETAILS: (id) => `/api/admin/users/${id}`,
      TOGGLE_USER: (id) => `/api/admin/users/${id}/toggle-enabled`,
      UPDATE_PLAN: (id) => `/api/admin/users/${id}/update-plan`,
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
    const response = await fetch(getApiUrl('/health'));
    return response.ok;
  } catch (error) {
    console.error('Backend health check failed:', error);
    return false;
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
