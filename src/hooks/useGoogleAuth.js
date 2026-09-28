import React, { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { userStorage } from '../utils/storage.js';
import { MovedToServerError } from '../utils/movedToServer';
import googleCalendarConnectionManager from '../api/googleCalendarConnectionManager.js';

export const useGoogleAuth = () => {
  const [user, setUser] = useState(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Detect environment using Constants.appOwnership
  const appOwnership = Constants.appOwnership;
  const isExpoGo = appOwnership === 'expo';
  const isDevClient = appOwnership === 'guest';
  const isStandalone = appOwnership === 'standalone';
  
  // Fallback detection if Constants.appOwnership is null
  const isExpoGoFallback = __DEV__ && !isStandalone && !isDevClient;
  const finalIsExpoGo = isExpoGo || isExpoGoFallback;

  console.log('Environment detection:');
  console.log('- Constants.appOwnership:', appOwnership);
  console.log('- isExpoGo:', isExpoGo);
  console.log('- isDevClient:', isDevClient);
  console.log('- isStandalone:', isStandalone);
  console.log('- isExpoGoFallback:', isExpoGoFallback);
  console.log('- finalIsExpoGo:', finalIsExpoGo);

  // Check initial auth state
  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      setIsLoading(true);
      console.log('=== CHECKING AUTH STATE ===');
      
      // Check for current user in the new user management system
      const currentUser = await userStorage.getCurrentUser();
      
      if (currentUser) {
        console.log('Found current user:', currentUser.email);
        setUser(currentUser);
        setIsSignedIn(true);
        console.log('Auth state restored from current user');
        return;
      }
      
      // Fallback: check for stored Google user info
      const storedUserInfo = await AsyncStorage.getItem('google_user_info');
      const storedToken = await AsyncStorage.getItem('google_access_token');
      
      console.log('Stored user info:', storedUserInfo ? 'Present' : 'Missing');
      console.log('Stored access token:', storedToken ? 'Present' : 'Missing');
      
      if (storedUserInfo && storedToken) {
        const userInfo = JSON.parse(storedUserInfo);
        console.log('Found stored user session');
        
        // Add to user management system if not already there
        const userResult = await userStorage.addGoogleUser(userInfo);
        if (userResult.success) {
          await userStorage.setCurrentUser(userResult.user);
          setUser(userResult.user);
          setIsSignedIn(true);
          console.log('Auth state restored from stored session');
        }
      } else {
        console.log('No stored user session found');
      }
      
      console.log('Auth state check complete');
    } catch (error) {
      console.error('Error checking auth state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthSuccess = async (authentication) => {
    try {
      setIsLoading(true);
      console.log('=== HANDLING AUTHENTICATION SUCCESS ===');
      console.log('Authentication object:', authentication);
      
      const { accessToken, refreshToken, idToken, expiresIn } = authentication;
      console.log('Access Token:', accessToken);
      console.log('Refresh Token:', refreshToken);
      console.log('ID Token:', idToken);
      console.log('Expires In:', expiresIn);

      if (accessToken) {
        console.log('Access token received, getting user info...');
        
        // Get user info
        const userInfo = await getUserInfo(accessToken);
        console.log('=== USER AUTHENTICATION SUCCESS ===');
        console.log('User email:', userInfo.email);
        console.log('User name:', userInfo.name);
        console.log('User ID:', userInfo.id);
        console.log('User picture:', userInfo.picture);
        console.log('Full user info:', userInfo);
        
        // Store tokens
        await storeTokens(accessToken, refreshToken);
        await AsyncStorage.setItem('google_user_info', JSON.stringify(userInfo));

        // Update state
        setUser(userInfo);
        setIsSignedIn(true);

        console.log('=== AUTHENTICATION COMPLETE ===');
        console.log('User state updated:', { user: userInfo, isSignedIn: true });
        console.log('Tokens stored in AsyncStorage');
        console.log('Google authentication successful');
      } else {
        console.error('No access token in authentication object');
        throw new Error('Failed to get access token from authentication object');
      }
    } catch (error) {
      console.error('Error handling auth success:', error);
      throw error;
    } finally {
      setIsLoading(false);
      console.log('Auth success handling complete');
    }
  };

  const getUserInfo = async (accessToken) => {
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
  };

  const storeTokens = async (accessToken, refreshToken) => {
    try {
      console.log('🔄 useGoogleAuth: Storing tokens...');
      console.log('🔄 useGoogleAuth: Access token:', !!accessToken, accessToken ? accessToken.substring(0, 20) + '...' : 'null');
      console.log('🔄 useGoogleAuth: Refresh token:', !!refreshToken, refreshToken ? refreshToken.substring(0, 20) + '...' : 'null');
      
      if (accessToken) {
        await AsyncStorage.setItem('google_access_token', accessToken);
        console.log('✅ useGoogleAuth: Access token stored successfully');
      } else {
        console.log('❌ useGoogleAuth: No access token to store');
      }
      
      if (refreshToken) {
        await AsyncStorage.setItem('google_refresh_token', refreshToken);
        console.log('✅ useGoogleAuth: Refresh token stored successfully');
      } else {
        console.log('⚠️ useGoogleAuth: No refresh token to store');
      }
      
      const expiryTime = Date.now() + 3600 * 1000;
      await AsyncStorage.setItem('google_token_expiry', expiryTime.toString());
      console.log('✅ useGoogleAuth: Token expiry stored:', new Date(expiryTime).toISOString());
      
      // Verify tokens were stored
      const storedAccessToken = await AsyncStorage.getItem('google_access_token');
      const storedRefreshToken = await AsyncStorage.getItem('google_refresh_token');
      const storedExpiry = await AsyncStorage.getItem('google_token_expiry');
      
      console.log('🔍 useGoogleAuth: Verification - Access token stored:', !!storedAccessToken);
      console.log('🔍 useGoogleAuth: Verification - Refresh token stored:', !!storedRefreshToken);
      console.log('🔍 useGoogleAuth: Verification - Expiry stored:', !!storedExpiry);
      
    } catch (error) {
      console.error('❌ useGoogleAuth: Error storing tokens:', error);
      throw error;
    }
  };

  // The previous flow opened Google in a browser and then polled the retired Render backend
  // (/oauth/google-check) for the tokens. That backend is gone (and the endpoint handed out
  // tokens to any caller), so the flow is disabled until sign-in is rebuilt with
  // @react-native-google-signin/google-signin + Firebase signInWithCredential.
  const signIn = async () => {
    throw new MovedToServerError('google-sign-in');
  };

  const getStoredTokens = async () => {
    try {
      console.log('🔍 useGoogleAuth: Getting stored tokens...');
      
      const accessToken = await AsyncStorage.getItem('google_access_token');
      const refreshToken = await AsyncStorage.getItem('google_refresh_token');
      const expiryTime = await AsyncStorage.getItem('google_token_expiry');

      console.log('🔍 useGoogleAuth: Retrieved access token:', !!accessToken);
      console.log('🔍 useGoogleAuth: Retrieved refresh token:', !!refreshToken);
      console.log('🔍 useGoogleAuth: Retrieved expiry time:', !!expiryTime);

      if (!accessToken) {
        console.log('❌ useGoogleAuth: No access token found in storage');
        return null;
      }

      const tokens = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiryTime ? (parseInt(expiryTime) - Date.now()) / 1000 : 3600,
      };
      
      console.log('✅ useGoogleAuth: Tokens retrieved successfully');
      return tokens;
    } catch (error) {
      console.error('❌ useGoogleAuth: Error getting stored tokens:', error);
      return null;
    }
  };

  const signOut = async () => {
    try {
      // Clear Google OAuth tokens
      await AsyncStorage.removeItem('google_access_token');
      await AsyncStorage.removeItem('google_refresh_token');
      await AsyncStorage.removeItem('google_token_expiry');
      await AsyncStorage.removeItem('google_user_info');
      
      // Clear current user
      await userStorage.clearCurrentUser();
      
      setUser(null);
      setIsSignedIn(false);
      
      console.log('Signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return {
    user,
    isSignedIn,
    isLoading,
    signIn,
    signOut,
  };
};
