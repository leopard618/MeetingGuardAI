// Authentication Debug Utility
// Helps debug authentication issues

import AsyncStorage from '@react-native-async-storage/async-storage';

export const debugAuthState = async () => {
  try {
    console.log('=== AUTH DEBUG START ===');
    
    // Check user data
    const user = await AsyncStorage.getItem('user');
    console.log('User data:', user ? 'Present' : 'Missing');
    if (user) {
      const userObj = JSON.parse(user);
      console.log('User email:', userObj.email);
      console.log('User name:', userObj.name);
    }
    
    // Check auth token
    const authToken = await AsyncStorage.getItem('authToken');
    console.log('Auth token:', authToken ? 'Present' : 'Missing');
    if (authToken) {
      console.log('Token length:', authToken.length);
      console.log('Token start:', authToken.substring(0, 20) + '...');
    }
    
    // Check refresh token
    const refreshToken = await AsyncStorage.getItem('refreshToken');
    console.log('Refresh token:', refreshToken ? 'Present' : 'Missing');
    
    // Check Google tokens
    const googleAccessToken = await AsyncStorage.getItem('google_access_token');
    const googleRefreshToken = await AsyncStorage.getItem('google_refresh_token');
    console.log('Google access token:', googleAccessToken ? 'Present' : 'Missing');
    console.log('Google refresh token:', googleRefreshToken ? 'Present' : 'Missing');
    
    console.log('=== AUTH DEBUG END ===');
    
    return {
      hasUser: !!user,
      hasAuthToken: !!authToken,
      hasRefreshToken: !!refreshToken,
      hasGoogleTokens: !!(googleAccessToken || googleRefreshToken)
    };
  } catch (error) {
    console.error('Auth debug error:', error);
    return null;
  }
};

export const clearAllAuthData = async () => {
  try {
    console.log('Clearing all authentication data...');
    
    await AsyncStorage.multiRemove([
      'user',
      'authToken', 
      'refreshToken',
      'google_access_token',
      'google_refresh_token',
      'google_token_expiry'
    ]);
    
    console.log('All authentication data cleared');
    return true;
  } catch (error) {
    console.error('Error clearing auth data:', error);
    return false;
  }
};
