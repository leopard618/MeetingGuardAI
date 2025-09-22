// Authentication utilities
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Clear all authentication data and redirect to login
 */
export const clearAuthAndRedirect = async () => {
  try {
    console.log('AuthUtils: Clearing authentication data...');
    
    // Clear all auth-related storage
    await AsyncStorage.multiRemove([
      'user',
      'authToken', 
      'refresh_token',
      'user_data',
      'google_access_token',
      'google_refresh_token',
      'google_token_expiry'
    ]);
    
    console.log('AuthUtils: All authentication data cleared');
    
    // You can add navigation logic here if needed
    // For now, the app will detect the missing auth state and redirect to login
    
  } catch (error) {
    console.error('AuthUtils: Error clearing authentication data:', error);
  }
};

/**
 * Check if user is properly authenticated
 */
export const isUserAuthenticated = async () => {
  try {
    const user = await AsyncStorage.getItem('user');
    const token = await AsyncStorage.getItem('authToken');
    
    return !!(user && token);
  } catch (error) {
    console.error('AuthUtils: Error checking authentication:', error);
    return false;
  }
};

/**
 * Handle authentication errors consistently
 */
export const handleAuthError = async (error) => {
  console.log('AuthUtils: Handling authentication error:', error.message);
  
  if (error.message.includes('User not found') || 
      error.message.includes('account deactivated') ||
      error.message.includes('Authentication failed')) {
    
    console.log('AuthUtils: User authentication invalid, clearing auth state');
    await clearAuthAndRedirect();
    return true; // Indicates auth was cleared
  }
  
  return false; // Auth error not handled
};
