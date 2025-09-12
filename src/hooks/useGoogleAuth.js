import React, { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import { GOOGLE_OAUTH_CONFIG } from '../config/googleAuth.js';
import { userStorage } from '../utils/storage.js';
import { GOOGLE_REDIRECT_URI } from '@env';

// Ensure auth sessions complete when app is foregrounded again
WebBrowser.maybeCompleteAuthSession();

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

  // Use environment variable for redirect URI with fallback
  const oauthRedirectUri = GOOGLE_REDIRECT_URI || 'https://meetingguard-backend.onrender.com/oauth/google';

  console.log('OAuth Configuration:');
  console.log('- oauthRedirectUri:', oauthRedirectUri);

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

  const signIn = async () => {
    try {
      console.log('=== STARTING GOOGLE AUTH SIGN IN ===');
      console.log('Current state:', { isSignedIn, user, isLoading });
      setIsLoading(true);
      
      console.log('=== Starting Manual Google OAuth ===');
      console.log('Using redirect URI:', oauthRedirectUri);
      
      // Manual OAuth URL construction
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_OAUTH_CONFIG.CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(oauthRedirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(GOOGLE_OAUTH_CONFIG.SCOPES.join(' '))}&` +
        `access_type=offline&` +
        `prompt=consent`;

      console.log('Auth URL:', authUrl);

      // Use WebBrowser to open the OAuth URL
      const result = await WebBrowser.openBrowserAsync(authUrl);

      console.log('=== WebBrowser Result ===');
      console.log('Result type:', result.type);
      console.log('Result URL:', result.url);
      console.log('Result error:', result.error);

      // For openBrowserAsync, we need to check if the user completed the flow
      if (result.type === 'cancel') {
        console.log('OAuth cancelled by user');
        throw new Error('Authentication was cancelled by user');
      }

      // Since openBrowserAsync doesn't return the redirect URL directly,
      // we need to poll our redirect server to check if authentication completed
      console.log('=== Polling for Authentication Completion ===');
      
      // Define the check auth URL for polling - use the endpoint that doesn't require sessionId
      const checkAuthUrl = `${oauthRedirectUri.replace('/oauth/google', '')}/oauth/google-check`;
      
      // Test the polling endpoint first
      try {
        console.log('=== TESTING POLLING ENDPOINT ===');
        console.log('Testing URL:', checkAuthUrl);

        const testResponse = await fetch(checkAuthUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        console.log('Test polling response status:', testResponse.status);
        const testData = await testResponse.json();
        console.log('Test polling response data:', testData);
      } catch (error) {
        console.log('Test polling error:', error.message);
      }
      
      let attempts = 0;
      const maxAttempts = 60; // 60 seconds (increased timeout)
      
      while (attempts < maxAttempts) {
        attempts++;
        console.log(`Polling attempt ${attempts}/${maxAttempts}`);
        
        try {
          // Check if our redirect server has processed the authentication
          const checkResponse = await fetch(checkAuthUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          console.log(`Polling response status: ${checkResponse.status}`);
          console.log(`Polling URL: ${checkAuthUrl}`);
          
          if (checkResponse.ok) {
            const authData = await checkResponse.json();
            console.log('Polling response data:', authData);
            console.log('Auth data success:', authData.success);
            console.log('Auth data user:', authData.user ? 'Present' : 'Missing');
            
            if (authData.success && authData.user) {
              console.log('=== AUTHENTICATION COMPLETED ===');

              // Add user to local storage using the new user management system
              const userResult = await userStorage.addGoogleUser(authData.user);
              
              if (userResult.success) {
                console.log('User added to local storage:', userResult.user.email);
                console.log('Is new user:', userResult.isNewUser);
                
                // Store the authentication data
                await AsyncStorage.setItem('google_user_info', JSON.stringify(authData.user));
                
                // CRITICAL FIX: Store tokens from backend response
                if (authData.accessToken || authData.refreshToken) {
                  console.log('🔄 MAIN FLOW: Backend provided tokens, storing them locally...');
                  console.log('🔄 MAIN FLOW: Access token from backend:', !!authData.accessToken);
                  console.log('🔄 MAIN FLOW: Refresh token from backend:', !!authData.refreshToken);
                  
                  // Store tokens in the format expected by the app
                  await storeTokens(authData.accessToken, authData.refreshToken);
                  
                  console.log('✅ MAIN FLOW: Tokens stored successfully');
                } else {
                  console.log('⚠️ MAIN FLOW: No tokens in backend response');
                }
                
                // Set as current user
                await userStorage.setCurrentUser(userResult.user);
                
                // Update state
                setUser(userResult.user);
                setIsSignedIn(true);
                
                console.log('=== AUTHENTICATION COMPLETE ===');
                console.log('User state updated:', { user: userResult.user, isSignedIn: true });
                
                // Get tokens for return
                const tokens = await getStoredTokens();
                if (!tokens) {
                  console.log('⚠️ No tokens found in storage, creating empty token object');
                  const emptyTokens = { access_token: null, refresh_token: null, expires_in: 0 };
                  return { success: true, user: userResult.user, isNewUser: userResult.isNewUser, tokens: emptyTokens };
                }
                console.log('=== AUTHENTICATION COMPLETE WITH TOKENS ===');
                return { success: true, user: userResult.user, isNewUser: userResult.isNewUser, tokens };
              } else {
                throw new Error(`Failed to add user to storage: ${userResult.error}`);
              }
            } else {
              console.log('No authentication data yet, continuing to poll...');
            }
          } else {
            console.log(`Polling failed with status: ${checkResponse.status}`);
          }
        } catch (error) {
          console.log('Polling error:', error.message);
        }
        
        // Wait 500ms before next attempt (faster polling)
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      console.log('Authentication timeout - no completion detected');
      
      // Fallback: Check one more time for authentication data
      console.log('=== FALLBACK: FINAL CHECK ===');
      try {
        const finalCheckResponse = await fetch(checkAuthUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        console.log('Final check response status:', finalCheckResponse.status);
        
        if (finalCheckResponse.ok) {
          const finalAuthData = await finalCheckResponse.json();
          console.log('Final check response data:', finalAuthData);
          
          if (finalAuthData.success && finalAuthData.user) {
            console.log('=== FALLBACK: AUTHENTICATION FOUND ===');
            console.log('User:', finalAuthData.user);
            
            // Add user to local storage using the new user management system
            const userResult = await userStorage.addGoogleUser(finalAuthData.user);
            
            if (userResult.success) {
              console.log('User added to local storage:', userResult.user.email);
              
              // Store the authentication data
              await AsyncStorage.setItem('google_user_info', JSON.stringify(finalAuthData.user));
              
              // Set as current user
              await userStorage.setCurrentUser(userResult.user);
              
              // Update state
              setUser(userResult.user);
              setIsSignedIn(true);
              
              // CRITICAL FIX: Handle tokens from backend response
              let tokens = null;
              if (finalAuthData.accessToken || finalAuthData.refreshToken) {
                console.log('🔄 Backend provided tokens, storing them locally...');
                console.log('🔄 Access token from backend:', !!finalAuthData.accessToken);
                console.log('🔄 Refresh token from backend:', !!finalAuthData.refreshToken);
                
                // Store tokens in the format expected by the app
                await storeTokens(finalAuthData.accessToken, finalAuthData.refreshToken);
                
                // Create tokens object in the expected format
                tokens = {
                  access_token: finalAuthData.accessToken,
                  refresh_token: finalAuthData.refreshToken,
                  expires_in: 3600 // Default 1 hour
                };
              } else if (finalAuthData.tokens) {
                console.log('🔄 Backend provided tokens in nested format, storing them locally...');
                await storeTokens(finalAuthData.tokens.access_token, finalAuthData.tokens.refresh_token);
                tokens = finalAuthData.tokens;
              } else {
                console.log('⚠️ No tokens from backend, checking local storage...');
                tokens = await getStoredTokens();
                if (!tokens) {
                  console.log('❌ No tokens available - Google Calendar will not work');
                  // Create a mock token object to prevent errors
                  tokens = { access_token: null, refresh_token: null, expires_in: 0 };
                }
              }
              
              console.log('=== FALLBACK: AUTHENTICATION COMPLETE ===');
              return { success: true, user: userResult.user, isNewUser: userResult.isNewUser, tokens };
            }
          }
        }
      } catch (error) {
        console.log('Final check error:', error.message);
      }
      
      throw new Error('Authentication timeout - please try again');
    } catch (error) {
      console.error('=== SIGN IN ERROR ===');
      console.error('Error details:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      throw error;
    }
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
