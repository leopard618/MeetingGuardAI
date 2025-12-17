import { 
  signInWithCredential, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';

// Complete auth session when app is foregrounded
WebBrowser.maybeCompleteAuthSession();

class FirebaseAuthService {
  constructor() {
    this.auth = auth;
  }

  /**
   * Sign in with Google using Expo AuthSession
   */
  async signInWithGoogle() {
    try {
      console.log('=== FIREBASE: Starting Google Sign-In ===');
      
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
      
      if (!clientId) {
        throw new Error('Google Client ID not configured');
      }

      // Generate code verifier and challenge for PKCE
      const codeVerifier = await this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);
      
      // Store code verifier for later
      await AsyncStorage.setItem('google_code_verifier', codeVerifier);
      
      // Create redirect URI
      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'meetingguardai',
        path: 'auth',
        useProxy: false,
      });
      
      // Build authorization URL
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent([
          'openid',
          'profile',
          'email',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
        ].join(' '))}&` +
        `code_challenge=${encodeURIComponent(codeChallenge)}&` +
        `code_challenge_method=S256&` +
        `access_type=offline&` +
        `prompt=consent`;
      
      // Open auth session
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      
      if (result.type === 'success' && result.url) {
        // Extract authorization code from URL
        const url = new URL(result.url);
        const code = url.searchParams.get('code');
        
        if (!code) {
          throw new Error('No authorization code received');
        }
        
        // Exchange code for tokens
        const tokens = await this.exchangeCodeForTokens(code, codeVerifier, redirectUri);
        
        // Create Firebase credential from ID token
        const credential = GoogleAuthProvider.credential(tokens.id_token);
        
        // Sign in to Firebase with Google credential
        const userCredential = await signInWithCredential(this.auth, credential);
        const user = userCredential.user;
        
        // Store access token for Calendar API
        if (tokens.access_token) {
          await AsyncStorage.setItem('google_calendar_access_token', tokens.access_token);
          if (tokens.refresh_token) {
            await AsyncStorage.setItem('google_refresh_token', tokens.refresh_token);
          }
          console.log('✅ Google Calendar access token stored');
        }
        
        // Get user info
        const userInfo = {
          id: user.uid,
          email: user.email,
          name: user.displayName,
          picture: user.photoURL,
          emailVerified: user.emailVerified,
        };
        
        console.log('=== FIREBASE: Google Sign-In Success ===');
        console.log('User:', userInfo.email);
        
        return {
          success: true,
          user: userInfo,
          accessToken: tokens.access_token,
          firebaseUser: user,
        };
      } else {
        console.log('Google sign-in cancelled or failed:', result.type);
        return {
          success: false,
          error: result.type === 'cancel' ? 'Sign-in cancelled' : 'Sign-in failed',
        };
      }
    } catch (error) {
      console.error('=== FIREBASE: Google Sign-In Error ===');
      console.error('Error:', error);
      return {
        success: false,
        error: error.message || 'Google sign-in failed',
      };
    }
  }

  /**
   * Generate code verifier for PKCE
   */
  async generateCodeVerifier() {
    const array = new Uint8Array(32);
    const randomValues = await Crypto.getRandomBytesAsync(32);
    return Array.from(randomValues)
      .map(b => String.fromCharCode(b))
      .join('')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate code challenge from verifier
   */
  async generateCodeChallenge(verifier) {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64URL }
    );
    return digest;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code, codeVerifier, redirectUri) {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const body = new URLSearchParams({
      client_id: clientId,
      code: code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    
    if (clientSecret) {
      body.append('client_secret', clientSecret);
    }
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  }

  /**
   * Sign in with email and password
   */
  async signInWithEmail(email, password) {
    try {
      console.log('=== FIREBASE: Email Sign-In ===');
      
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      const user = userCredential.user;
      
      const userInfo = {
        id: user.uid,
        email: user.email,
        name: user.displayName,
        picture: user.photoURL,
        emailVerified: user.emailVerified,
      };
      
      console.log('=== FIREBASE: Email Sign-In Success ===');
      console.log('User:', userInfo.email);
      
      return {
        success: true,
        user: userInfo,
        firebaseUser: user,
      };
    } catch (error) {
      console.error('=== FIREBASE: Email Sign-In Error ===');
      console.error('Error:', error);
      
      let errorMessage = 'Sign-in failed';
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/user-disabled') {
        errorMessage = 'This account has been disabled';
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Sign up with email and password
   */
  async signUpWithEmail(email, password, name) {
    try {
      console.log('=== FIREBASE: Email Sign-Up ===');
      
      const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
      const user = userCredential.user;
      
      // Update user profile with name
      if (name) {
        await updateProfile(user, { displayName: name });
      }
      
      const userInfo = {
        id: user.uid,
        email: user.email,
        name: user.displayName || name,
        picture: user.photoURL,
        emailVerified: user.emailVerified,
      };
      
      console.log('=== FIREBASE: Email Sign-Up Success ===');
      console.log('User:', userInfo.email);
      
      return {
        success: true,
        user: userInfo,
        firebaseUser: user,
      };
    } catch (error) {
      console.error('=== FIREBASE: Email Sign-Up Error ===');
      console.error('Error:', error);
      
      let errorMessage = 'Sign-up failed';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'An account with this email already exists';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak';
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Sign out
   */
  async signOut() {
    try {
      console.log('=== FIREBASE: Signing Out ===');
      
      await firebaseSignOut(this.auth);
      
      // Clear stored tokens
      await AsyncStorage.multiRemove([
        'google_calendar_access_token',
        'google_access_token',
        'google_refresh_token',
        'google_token_expiry',
        'user',
        'authToken',
      ]);
      
      console.log('=== FIREBASE: Sign-Out Success ===');
      
      return { success: true };
    } catch (error) {
      console.error('=== FIREBASE: Sign-Out Error ===');
      console.error('Error:', error);
      return {
        success: false,
        error: error.message || 'Sign-out failed',
      };
    }
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    return this.auth.currentUser;
  }

  /**
   * Get Google Calendar access token
   */
  async getGoogleCalendarAccessToken() {
    try {
      // Try to get stored access token
      const storedToken = await AsyncStorage.getItem('google_calendar_access_token');
      if (storedToken) {
        // Check if token is expired (tokens typically expire in 1 hour)
        // For now, return stored token - refresh logic can be added later
        return storedToken;
      }
      
      // If no stored token, user needs to sign in again
      return null;
    } catch (error) {
      console.error('Error getting Google Calendar access token:', error);
      return null;
    }
  }

  /**
   * Refresh Google Calendar access token
   */
  async refreshGoogleCalendarAccessToken() {
    try {
      const refreshToken = await AsyncStorage.getItem('google_refresh_token');
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }
      
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
      
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const body = new URLSearchParams({
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
      
      if (clientSecret) {
        body.append('client_secret', clientSecret);
      }
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      
      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }
      
      const tokens = await response.json();
      
      // Store new access token
      if (tokens.access_token) {
        await AsyncStorage.setItem('google_calendar_access_token', tokens.access_token);
      }
      
      return tokens.access_token;
    } catch (error) {
      console.error('Error refreshing Google Calendar access token:', error);
      return null;
    }
  }

  /**
   * Listen to auth state changes
   */
  onAuthStateChanged(callback) {
    return onAuthStateChanged(this.auth, callback);
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(email) {
    try {
      await sendPasswordResetEmail(this.auth, email);
      return { success: true };
    } catch (error) {
      console.error('Password reset error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send password reset email',
      };
    }
  }
}

export default new FirebaseAuthService();

