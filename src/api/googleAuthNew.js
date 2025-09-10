import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { GOOGLE_OAUTH_CONFIG } from '../config/googleAuth';
import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';

// Configure WebBrowser for auth session
WebBrowser.maybeCompleteAuthSession();

class GoogleAuthServiceNew {
  constructor() {
    // Use custom scheme redirect URI for all environments (no more Expo proxy)
    this.redirectUri = AuthSession.makeRedirectUri({
      scheme: 'meetingguardai',
      path: 'auth',
      useProxy: false,
    });
    
    console.log('Environment:', Constants.appOwnership === 'expo' ? 'Expo Go (Development)' : Constants.appOwnership === 'guest' ? 'Dev Client (Development)' : 'Standalone (Production)');
    console.log('Redirect URI:', this.redirectUri);
  }

  // Start Google OAuth flow
  async signInWithGoogle() {
    try {
      console.log('Starting Google sign-in with expo-auth-session...');
      
      // Check if we already have valid tokens
      const existingTokens = await this.getStoredTokens();
      if (existingTokens && existingTokens.access_token) {
        const isValid = await this.validateToken();
        if (isValid) {
          const user = await this.getCurrentUser();
          return {
            success: true,
            user: user,
            tokens: existingTokens
          };
        }
      }

      console.log('Opening Google OAuth session...');
      console.log('Redirect URI:', this.redirectUri);

      // Create auth request manually
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', GOOGLE_OAUTH_CONFIG.CLIENT_ID);
      authUrl.searchParams.append('redirect_uri', this.redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', GOOGLE_OAUTH_CONFIG.SCOPES.join(' '));
      authUrl.searchParams.append('access_type', 'offline');
      authUrl.searchParams.append('prompt', 'consent');

      // Open auth session using WebBrowser
      const result = await WebBrowser.openAuthSessionAsync(
        authUrl.toString(),
        this.redirectUri
      );

      console.log('OAuth result:', result);

      if (result.type === 'success' && result.url) {
        console.log('OAuth successful, handling response...');
        return await this.handleAuthResponse(result.url);
      } else {
        console.log('OAuth result:', result);
        throw new Error('Authentication was cancelled or failed');
      }
    } catch (error) {
      console.error('Google sign-in error:', error);
      throw error;
    }
  }

  // Handle the OAuth response
  async handleAuthResponse(url) {
    try {
      // Extract authorization code from URL
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      
      if (!code) {
        throw new Error('No authorization code received');
      }

      console.log('Authorization code received, exchanging for tokens...');

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code);
      
      if (!tokens.access_token) {
        throw new Error('No access token received');
      }

      console.log('Access token received, getting user info...');

      // Get user info
      const userInfo = await this.getUserInfo(tokens.access_token);

      console.log('User info received:', userInfo.email);

      // Store tokens securely
      await this.storeTokens(tokens);

      // Store user info
      await AsyncStorage.setItem('google_user_info', JSON.stringify(userInfo));

      console.log('Google authentication successful with expo-auth-session');

      return {
        success: true,
        user: userInfo,
        tokens: tokens
      };
    } catch (error) {
      console.error('Error handling auth response:', error);
      throw error;
    }
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(code) {
    try {
      // For Android OAuth clients, we don't need the client secret
      const bodyParams = {
        client_id: GOOGLE_OAUTH_CONFIG.CLIENT_ID,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      };

      // Only add client_secret if it exists (for web clients)
      if (GOOGLE_OAUTH_CONFIG.CLIENT_SECRET) {
        bodyParams.client_secret = GOOGLE_OAUTH_CONFIG.CLIENT_SECRET;
      }
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(bodyParams),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange failed:', response.status, errorText);
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
      }

      const tokens = await response.json();
      return tokens;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw error;
    }
  }

  // Get user info from Google
  async getUserInfo(accessToken) {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get user info: ${response.status}`);
      }

      const userInfo = await response.json();
      return {
        id: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        given_name: userInfo.given_name,
        family_name: userInfo.family_name,
      };
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  }

  // Store tokens in AsyncStorage
  async storeTokens(tokens) {
    try {
      console.log('Storing tokens...');
      console.log('Access token exists:', !!tokens.access_token);
      console.log('Refresh token exists:', !!tokens.refresh_token);

      await AsyncStorage.setItem('google_access_token', tokens.access_token);
      if (tokens.refresh_token) {
        await AsyncStorage.setItem('google_refresh_token', tokens.refresh_token);
      }
      await AsyncStorage.setItem('google_token_expiry', (Date.now() + tokens.expires_in * 1000).toString());

      console.log('Tokens stored successfully');
    } catch (error) {
      console.error('Error storing tokens:', error);
    }
  }

  // Get stored tokens
  async getStoredTokens() {
    try {
      const accessToken = await AsyncStorage.getItem('google_access_token');
      const refreshToken = await AsyncStorage.getItem('google_refresh_token');
      const expiryTime = await AsyncStorage.getItem('google_token_expiry');

      if (!accessToken) {
        return null;
      }

      // Check if token is expired
      if (expiryTime && Date.now() > parseInt(expiryTime)) {
        console.log('Token expired, attempting refresh...');
        if (refreshToken) {
          return await this.refreshAccessToken(refreshToken);
        } else {
          console.log('No refresh token available');
          return null;
        }
      }

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiryTime ? (parseInt(expiryTime) - Date.now()) / 1000 : 3600,
      };
    } catch (error) {
      console.error('Error getting stored tokens:', error);
      return null;
    }
  }

  // Check if user is signed in
  async isSignedIn() {
    try {
      const tokens = await this.getStoredTokens();
      if (!tokens || !tokens.access_token) {
        return false;
      }

      // Validate token with Google
      return await this.validateToken();
    } catch (error) {
      console.error('Error checking sign-in status:', error);
      return false;
    }
  }

  // Refresh access token
  async refreshAccessToken(refreshToken) {
    try {
      console.log('Refreshing access token...');

      // For Web OAuth clients, we need the client secret
      if (!GOOGLE_OAUTH_CONFIG.CLIENT_SECRET) {
        throw new Error('Client secret is required for Web OAuth clients. Please add it to your configuration.');
      }

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: GOOGLE_OAUTH_CONFIG.CLIENT_ID,
          client_secret: GOOGLE_OAUTH_CONFIG.CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token refresh failed:', response.status, errorText);
        throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
      }

      const tokens = await response.json();
      await this.storeTokens(tokens);
      return tokens;
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  }

  // Sign out
  async signOut() {
    try {
      console.log('Signing out...');
      await this.clearAuthData();
      console.log('Sign out successful');
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  // Get current user
  async getCurrentUser() {
    try {
      const userInfoString = await AsyncStorage.getItem('google_user_info');
      if (!userInfoString) {
        return null;
      }

      const userInfo = JSON.parse(userInfoString);
      
      // Validate that we have valid tokens
      const tokens = await this.getStoredTokens();
      if (!tokens || !tokens.access_token) {
        console.log('No valid tokens, user not authenticated');
        return null;
      }

      return userInfo;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  }

  // Validate token with Google
  async validateToken() {
    try {
      const tokens = await this.getStoredTokens();
      if (!tokens || !tokens.access_token) {
        return false;
      }

      const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Error validating token:', error);
      return false;
    }
  }

  // Clear all auth data
  async clearAuthData() {
    try {
      await AsyncStorage.multiRemove([
        'google_access_token',
        'google_refresh_token',
        'google_token_expiry',
        'google_user_info',
        'google_code_verifier',
      ]);
      console.log('Auth data cleared');
    } catch (error) {
      console.error('Error clearing auth data:', error);
    }
  }
}

export default new GoogleAuthServiceNew();
