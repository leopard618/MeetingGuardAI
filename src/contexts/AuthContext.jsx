import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGoogleAuth } from '../hooks/useGoogleAuth';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Use the Google Auth hook
  const googleAuth = useGoogleAuth();

  // Sync with Google authentication state
  useEffect(() => {
    console.log('=== AUTH CONTEXT: SYNCING WITH GOOGLE AUTH ===');
    console.log('Google auth state:', {
      isSignedIn: googleAuth.isSignedIn,
      user: googleAuth.user,
      isLoading: googleAuth.isLoading
    });

    if (googleAuth.isSignedIn && googleAuth.user) {
      console.log('=== AUTH CONTEXT: GOOGLE USER AUTHENTICATED ===');
      console.log('User email:', googleAuth.user.email);
      console.log('User name:', googleAuth.user.name);
      setUser(googleAuth.user);
      setIsAuthenticated(true);
      setIsLoading(false);
    } else if (!googleAuth.isLoading) {
      console.log('=== AUTH CONTEXT: NO GOOGLE AUTH, CHECKING STORAGE ===');
      // Only check storage if Google auth is not loading
      checkAuthStatus();
    }
  }, [googleAuth.isSignedIn, googleAuth.user, googleAuth.isLoading]);

  const checkAuthStatus = async () => {
    try {
      console.log('=== AUTH CONTEXT: CHECKING STORAGE ===');
      
      // Fallback to regular authentication
      const token = await AsyncStorage.getItem('authToken');
      const userData = await AsyncStorage.getItem('userData');
      
      console.log('Storage check:', { token: !!token, userData: !!userData });
      
      if (token && userData) {
        const parsedUser = JSON.parse(userData);
        console.log('User found in storage:', parsedUser.email);
        setUser(parsedUser);
        setIsAuthenticated(true);
      } else {
        console.log('No user found in storage');
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // For demo purposes, create a mock user
      const mockUser = {
        id: '1',
        email: email,
        name: email.split('@')[0], // Use email prefix as name
        createdAt: new Date().toISOString(),
      };
      
      const mockToken = 'mock-jwt-token-' + Date.now();
      
      // Store in AsyncStorage
      await AsyncStorage.setItem('authToken', mockToken);
      await AsyncStorage.setItem('userData', JSON.stringify(mockUser));
      
      setUser(mockUser);
      setIsAuthenticated(true);
      
      return { success: true, user: mockUser };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  };

  const signup = async (name, email, password) => {
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // For demo purposes, create a mock user
      const mockUser = {
        id: '1',
        email: email,
        name: name,
        createdAt: new Date().toISOString(),
      };
      
      const mockToken = 'mock-jwt-token-' + Date.now();
      
      // Store in AsyncStorage
      await AsyncStorage.setItem('authToken', mockToken);
      await AsyncStorage.setItem('userData', JSON.stringify(mockUser));
      
      setUser(mockUser);
      setIsAuthenticated(true);
      
      return { success: true, user: mockUser };
    } catch (error) {
      console.error('Signup error:', error);
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    try {
      console.log('Logging out user');
      
      // Sign out from Google if signed in
      await googleAuth.signOut();
      
      // Clear AsyncStorage
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('userData');
      
      setUser(null);
      setIsAuthenticated(false);
      console.log('Logout successful');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const signInWithGoogle = async () => {
    try {
      console.log('=== AUTH CONTEXT: STARTING GOOGLE SIGN IN ===');
      setIsLoading(true);
      
      const result = await googleAuth.signIn();
      console.log('Google sign-in result:', result);
      
      if (result.success) {
        console.log('=== AUTH CONTEXT: GOOGLE SIGN IN SUCCESS ===');
        console.log('User from result:', result.user);
        
        // The useEffect will handle the state update automatically
        // since it's watching googleAuth.isSignedIn and googleAuth.user
        return { success: true, user: result.user };
      } else {
        console.log('Google sign-in failed');
        return { success: false, error: 'Google sign-in failed' };
      }
    } catch (error) {
      console.error('=== AUTH CONTEXT: GOOGLE SIGN IN ERROR ===');
      console.error('Error:', error);
      return { success: false, error: error.message || 'Google sign-in failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const value = {
    isAuthenticated,
    user,
    isLoading,
    login,
    signup,
    logout,
    signInWithGoogle,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 