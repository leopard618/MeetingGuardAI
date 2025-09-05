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
  const [userPlan, setUserPlan] = useState('free');
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
      
      // Fetch user's current plan
      fetchUserPlan(googleAuth.user.id).then(plan => {
        setUserPlan(plan);
        setIsLoading(false);
      });
    } else if (!googleAuth.isLoading) {
      console.log('=== AUTH CONTEXT: NO GOOGLE AUTH, CHECKING STORAGE ===');
      // Only check storage if Google auth is not loading
      checkAuthStatus();
    }
  }, [googleAuth.isSignedIn, googleAuth.user, googleAuth.isLoading]);

  const fetchUserPlan = async (userId) => {
    try {
      console.log('=== AUTH CONTEXT: FETCHING USER PLAN ===');
      
      // Get auth token from storage
      const token = await AsyncStorage.getItem('authToken');
      if (!token) {
        console.log('No auth token found');
        return 'free';
      }

      // Fetch user's subscription plan from backend
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/billing/subscription`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('User plan fetched:', data.subscription);
        return data.subscription?.plan || 'free';
      } else {
        console.log('Failed to fetch user plan, using default');
        return 'free';
      }
    } catch (error) {
      console.error('Error fetching user plan:', error);
      return 'free';
    }
  };

  const checkAuthStatus = async () => {
    try {
      console.log('=== AUTH CONTEXT: CHECKING STORAGE ===');
      
      // Check if user data exists in AsyncStorage
      const userData = await AsyncStorage.getItem('user');
      if (userData) {
        const parsedUser = JSON.parse(userData);
        console.log('User found in storage:', parsedUser);
        setUser(parsedUser);
        setIsAuthenticated(true);
        
        // Fetch user's current plan
        const plan = await fetchUserPlan(parsedUser.id);
        setUserPlan(plan);
      } else {
        console.log('No user found in storage');
        setIsAuthenticated(false);
        setUserPlan('free');
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      setIsAuthenticated(false);
      setUserPlan('free');
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      console.log('=== AUTH CONTEXT: LOGIN ATTEMPT ===');
      setIsLoading(true);
      
      // TODO: Implement actual login logic with your backend
      // For now, return a placeholder response
      console.log('Login not implemented yet - using placeholder');
      
      return { success: false, error: 'Login not implemented yet' };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (name, email, password) => {
    try {
      console.log('=== AUTH CONTEXT: SIGNUP ATTEMPT ===');
      setIsLoading(true);
      
      // TODO: Implement actual signup logic with your backend
      // For now, return a placeholder response
      console.log('Signup not implemented yet - using placeholder');
      
      return { success: false, error: 'Signup not implemented yet' };
    } catch (error) {
      console.error('Signup error:', error);
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      console.log('Logging out user');
      
      // Sign out from Google if signed in
      await googleAuth.signOut();

      // Clear local storage
      await AsyncStorage.removeItem('user');
      
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
        
        // Store user data in AsyncStorage
        await AsyncStorage.setItem('user', JSON.stringify(result.user));
        
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

  // Function to refresh user plan (useful after payment)
  const refreshUserPlan = async () => {
    if (isAuthenticated && user) {
      console.log('=== AUTH CONTEXT: REFRESHING USER PLAN ===');
      const plan = await fetchUserPlan(user.id);
      setUserPlan(plan);
      console.log('User plan refreshed:', plan);
      return plan;
    }
    return 'free';
  };

  const value = {
    isAuthenticated,
    user,
    userPlan,
    isLoading,
    login,
    signup,
    logout,
    signInWithGoogle,
    refreshUserPlan,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 