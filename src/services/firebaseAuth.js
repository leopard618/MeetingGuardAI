import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MovedToServerError } from '../utils/movedToServer';

class FirebaseAuthService {
  constructor() {
    this.auth = auth;
  }

  /**
   * Sign in with Google.
   *
   * Temporarily unavailable. The previous browser/PKCE flow needed the Google OAuth client
   * secret inside the app to exchange the code, and a secret in the bundle is public.
   * Sign-in will be rebuilt with @react-native-google-signin/google-signin (native OAuth
   * clients, no secret) + signInWithCredential(GoogleAuthProvider.credential(idToken)).
   */
  async signInWithGoogle() {
    const error = new MovedToServerError('google-sign-in');
    console.warn('[auth] Google sign-in is disabled until it is rebuilt with native Google Sign-In.');
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  /**
   * Exchanging an authorization code requires the client secret, so it can only run on the
   * server (Firebase Cloud Function, later stage).
   */
  async exchangeCodeForTokens(_code, _codeVerifier, _redirectUri) {
    throw new MovedToServerError('google-sign-in');
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
   * Refresh Google Calendar access token.
   *
   * Refreshing with a refresh token requires the OAuth client secret, which must not ship in
   * the app. Until the refresh runs in a Cloud Function (or the native Google Sign-In SDK
   * provides fresh tokens) this returns null and callers treat the calendar as disconnected.
   */
  async refreshGoogleCalendarAccessToken() {
    const error = new MovedToServerError('google-token-refresh');
    console.warn('[auth] Google token refresh unavailable:', error.message);
    return null;
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

