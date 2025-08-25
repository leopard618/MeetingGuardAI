import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { GOOGLE_OAUTH_CONFIG } from '@/config/googleAuth';
import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';

// Configure WebBrowser for auth session
WebBrowser.maybeCompleteAuthSession();

class GoogleAuthService {
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

  // Generate PKCE challenge for secure OAuth flow
  async generatePKCEChallenge() {
    // Generate a random string for code verifier
    const generateRandomString = (length) => {
      const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
      let text = '';
      for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
      }
      return text;
    };

    const codeVerifier = generateRandomString(128);
    
    try {
      // Create code challenge using SHA256 with BASE64 encoding
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        codeVerifier,
        { encoding: Crypto.CryptoEncoding.BASE64 }
      );
      
      // Convert BASE64 to BASE64URL (replace + with -, / with _, remove =)
      const codeChallenge = hash
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
        
      return { codeVerifier, codeChallenge };
    } catch (error) {
      console.error('Crypto error, using fallback:', error);
      // Fallback: use the code verifier as the challenge (less secure but functional)
      return { codeVerifier, codeChallenge: codeVerifier };
    }
  }

  // Start Google OAuth flow
  async signInWithGoogle() {
    try {
      console.log('Starting Google sign-in...');
      
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
      
      // Start new OAuth flow
      const { codeVerifier, codeChallenge } = await this.generatePKCEChallenge();

      // Store code verifier for later use
      await AsyncStorage.setItem('google_code_verifier', codeVerifier);

      // Create auth request
      const authUrl = new URL(GOOGLE_OAUTH_CONFIG.AUTH_ENDPOINT);
      authUrl.searchParams.append('client_id', GOOGLE_OAUTH_CONFIG.CLIENT_ID);
      authUrl.searchParams.append('redirect_uri', this.redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', GOOGLE_OAUTH_CONFIG.SCOPES.join(' '));
      authUrl.searchParams.append('code_challenge', codeChallenge);
      authUrl.searchParams.append('code_challenge_method', 'S256');
      authUrl.searchParams.append('access_type', 'offline');
      authUrl.searchParams.append('prompt', 'consent');

      console.log('Opening Google OAuth session...');
      console.log('Auth URL:', authUrl.toString());
      console.log('Redirect URI-------------------------:', this.redirectUri);

      // Open auth session using WebBrowser
      const result = await WebBrowser.openAuthSessionAsync(
        authUrl.toString(),
        this.redirectUri
      );

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
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      
      if (!code) {
        throw new Error('No authorization code received');
      }

      console.log('Authorization code received, exchanging for tokens...');

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code);
      
      console.log('Getting user info...');
      
      // Get user info
      const userInfo = await this.getUserInfo(tokens.access_token);
      
      console.log('User info received:', userInfo.email);
      
      // Store tokens securely
      await this.storeTokens(tokens);
      
      // Store user info
      await AsyncStorage.setItem('google_user_info', JSON.stringify(userInfo));
      
      console.log('Google authentication successful with real OAuth');
      
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

  // Exchange authorization code for access tokens
  async exchangeCodeForTokens(code) {
    const codeVerifier = await AsyncStorage.getItem('google_code_verifier');
    
    console.log('Exchanging code for tokens...');
    console.log('Client ID:', GOOGLE_OAUTH_CONFIG.CLIENT_ID);
    console.log('Client Secret exists:', !!GOOGLE_OAUTH_CONFIG.CLIENT_SECRET);
    console.log('Redirect URI:', this.redirectUri);
    
    const bodyParams = {
      client_id: GOOGLE_OAUTH_CONFIG.CLIENT_ID,
      code: code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
    };

    // Only add client_secret if it exists (for web clients)
    if (GOOGLE_OAUTH_CONFIG.CLIENT_SECRET) {
      bodyParams.client_secret = GOOGLE_OAUTH_CONFIG.CLIENT_SECRET;
    }
    
    const response = await fetch(GOOGLE_OAUTH_CONFIG.TOKEN_ENDPOINT, {
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
    console.log('Token exchange successful, tokens received');
    return tokens;
  }

  // Get user information from Google
  async getUserInfo(accessToken) {
    const response = await fetch(GOOGLE_OAUTH_CONFIG.USER_INFO_ENDPOINT, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.statusText}`);
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
  }

  // Store tokens securely
  async storeTokens(tokens) {
    try {
      console.log('Storing tokens...');
      console.log('Access token exists:', !!tokens.access_token);
      console.log('Refresh token exists:', !!tokens.refresh_token);
      console.log('Expires in:', tokens.expires_in);
      
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
      const expiry = await AsyncStorage.getItem('google_token_expiry');
      
      if (!accessToken) return null;
      
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: parseInt(expiry || '0'),
      };
    } catch (error) {
      console.error('Error getting stored tokens:', error);
      return null;
    }
  }

  // Check if user is signed in
  async isSignedIn() {
    const tokens = await this.getStoredTokens();
    if (!tokens) return false;
    
    // Check if token is expired
    if (Date.now() > tokens.expires_at) {
      // Try to refresh token
      try {
        await this.refreshAccessToken(tokens.refresh_token);
        return true;
      } catch (error) {
        await this.signOut();
        return false;
      }
    }
    
    return true;
  }

  // Refresh access token
  async refreshAccessToken(refreshToken) {
    const bodyParams = {
      client_id: GOOGLE_OAUTH_CONFIG.CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    };

    // Only add client_secret if it exists (for web clients)
    if (GOOGLE_OAUTH_CONFIG.CLIENT_SECRET) {
      bodyParams.client_secret = GOOGLE_OAUTH_CONFIG.CLIENT_SECRET;
    }

    const response = await fetch(GOOGLE_OAUTH_CONFIG.TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(bodyParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token refresh failed:', response.status, errorText);
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const tokens = await response.json();
    await this.storeTokens(tokens);
    return tokens;
  }

  // Sign out
  async signOut() {
    try {
      await AsyncStorage.removeItem('google_access_token');
      await AsyncStorage.removeItem('google_refresh_token');
      await AsyncStorage.removeItem('google_token_expiry');
      await AsyncStorage.removeItem('google_code_verifier');
      await AsyncStorage.removeItem('google_user_info');
      console.log('Google sign-out completed');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  // Get current user info
  async getCurrentUser() {
    try {
      const tokens = await this.getStoredTokens();
      if (!tokens) {
        console.log('No stored tokens found');
        return null;
      }
      
      // Check if token is expired and refresh if needed
      if (Date.now() > tokens.expires_at) {
        console.log('Token expired, attempting refresh...');
        if (tokens.refresh_token) {
          try {
            await this.refreshAccessToken(tokens.refresh_token);
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            await this.signOut();
            return null;
          }
        } else {
          console.log('No refresh token available, signing out');
          await this.signOut();
          return null;
        }
      }
      
      // Get fresh tokens after potential refresh
      const freshTokens = await this.getStoredTokens();
      if (!freshTokens) {
        return null;
      }
      
      // Try to get user info from storage first, then from API
      try {
        const storedUserInfo = await AsyncStorage.getItem('google_user_info');
        if (storedUserInfo) {
          return JSON.parse(storedUserInfo);
        }
      } catch (error) {
        console.log('No stored user info, fetching from API...');
      }
      
      const userInfo = await this.getUserInfo(freshTokens.access_token);
      // Store user info for future use
      await AsyncStorage.setItem('google_user_info', JSON.stringify(userInfo));
      return userInfo;
    } catch (error) {
      console.error('Error getting current user:', error);
      // If we can't get user info, the token might be invalid
      if (error.message.includes('401') || error.message.includes('403')) {
        console.log('Token appears to be invalid, signing out');
        await this.signOut();
      }
      return null;
    }
  }

  /**
   * Validate if the current access token is still valid
   * @returns {Promise<boolean>} Whether the token is valid
   */
  async validateToken() {
    try {
      const tokens = await this.getStoredTokens();
      if (!tokens) {
        return false;
      }

      // Check if token is expired
      if (Date.now() > tokens.expires_at) {
        if (tokens.refresh_token) {
          try {
            await this.refreshAccessToken(tokens.refresh_token);
            return true;
          } catch (error) {
            console.error('Token refresh failed during validation:', error);
            return false;
          }
        } else {
          return false;
        }
      }

      // Test the token by making a simple API call
      try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
          },
        });
        
        return response.ok;
      } catch (error) {
        console.error('Token validation API call failed:', error);
        return false;
      }
    } catch (error) {
      console.error('Error validating token:', error);
      return false;
    }
  }

  /**
   * Clear all stored authentication data
   */
  async clearAuthData() {
    try {
      await AsyncStorage.removeItem('google_access_token');
      await AsyncStorage.removeItem('google_refresh_token');
      await AsyncStorage.removeItem('google_token_expiry');
      await AsyncStorage.removeItem('google_code_verifier');
      await AsyncStorage.removeItem('google_user_info');
      console.log('All Google auth data cleared');
    } catch (error) {
      console.error('Error clearing auth data:', error);
    }
  }
}

export default new GoogleAuthService(); 