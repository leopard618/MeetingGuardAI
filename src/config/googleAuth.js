import { 
  GOOGLE_CLIENT_ID, 
  GOOGLE_CLIENT_SECRET, 
  GOOGLE_REDIRECT_URI, 
  GOOGLE_REDIRECT_URI_SCHEME 
} from '@env';

export const GOOGLE_OAUTH_CONFIG = {
  CLIENT_ID: GOOGLE_CLIENT_ID , // Fallback for development
  CLIENT_SECRET: GOOGLE_CLIENT_SECRET, // Fallback for development
  REDIRECT_URI_SCHEME: GOOGLE_REDIRECT_URI_SCHEME ,
  
  // OAuth scopes
  SCOPES: [
    'openid',
    'profile',
    'email',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ],
  
  // OAuth endpoints
  AUTH_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  USER_INFO_ENDPOINT: 'https://www.googleapis.com/oauth2/v2/userinfo',
};

export default GOOGLE_OAUTH_CONFIG; 