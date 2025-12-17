import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../config/firebase';
import firebaseAuthService from '../services/firebaseAuth';
import { onAuthStateChanged } from 'firebase/auth';

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

  // Listen to Firebase auth state changes
  useEffect(() => {
    console.log('=== AUTH CONTEXT: Setting up Firebase Auth Listener ===');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('=== AUTH CONTEXT: Firebase Auth State Changed ===');
      console.log('Firebase user:', firebaseUser ? firebaseUser.email : 'null');
      
      if (firebaseUser) {
        // User is signed in
        const userInfo = {
          id: firebaseUser.uid,
          email: firebaseUser.email,
          name: firebaseUser.displayName,
          picture: firebaseUser.photoURL,
          emailVerified: firebaseUser.emailVerified,
        };
        
        console.log('=== AUTH CONTEXT: USER AUTHENTICATED ===');
        console.log('User email:', userInfo.email);
        console.log('User name:', userInfo.name);
        
        setUser(userInfo);
        setIsAuthenticated(true);
        
        // Store user data
        await AsyncStorage.setItem('user', JSON.stringify(userInfo));
        
        // Save user to backend/Supabase
        try {
          await saveUserToBackend(userInfo);
          console.log('✅ User saved to backend successfully');
        } catch (error) {
          console.error('❌ Error saving user to backend:', error);
          // Don't fail auth if backend save fails
        }
        
        // Initialize Google Calendar connection if user signed in with Google
        if (firebaseUser.providerData.some(provider => provider.providerId === 'google.com')) {
          try {
            console.log('🔄 AuthContext: Attempting to initialize Google Calendar...');
            const googleCalendarService = (await import('../api/googleCalendar')).default;
            const initialized = await googleCalendarService.initialize();
            
            if (initialized) {
              console.log('✅ AuthContext: Google Calendar initialized successfully');
              await AsyncStorage.setItem('google_calendar_connected', 'true');
              await AsyncStorage.setItem('google_calendar_connected_at', new Date().toISOString());
            } else {
              console.log('⚠️ AuthContext: Google Calendar initialization failed');
            }
          } catch (calendarError) {
            console.log('⚠️ AuthContext: Error initializing Google Calendar:', calendarError.message);
          }
        }
        
        // Fetch user plan
        const plan = await fetchUserPlan(userInfo.id);
        setUserPlan(plan);
        setIsLoading(false);
      } else {
        // User is signed out
        console.log('=== AUTH CONTEXT: USER SIGNED OUT ===');
        setUser(null);
        setIsAuthenticated(false);
        setUserPlan('free');
        setIsLoading(false);
        
        // Clear stored data
        await AsyncStorage.removeItem('user');
        await AsyncStorage.removeItem('authToken');
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, []);

  // Check initial auth status from storage
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      console.log('=== AUTH CONTEXT: CHECKING STORAGE ===');
      
      // Check if user data exists in storage
      const userData = await AsyncStorage.getItem('user');
      if (userData) {
        const parsedUser = JSON.parse(userData);
        console.log('User found in storage:', parsedUser.email);
        setUser(parsedUser);
        setIsAuthenticated(true);
        
        // Fetch user plan
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

  const saveUserToBackend = async (userInfo) => {
    try {
      console.log('=== AUTH CONTEXT: SAVING USER TO BACKEND ===');
      console.log('User info:', userInfo);
      
      // Save user to Firestore instead of backend
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error('No Firebase user found');
      }
      
      // Import Firestore service
      const firestoreService = (await import('../services/firestoreService')).default;
      
      // Save user to Firestore
      const savedUser = await firestoreService.saveUser({
        firebase_uid: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        email_verified: userInfo.emailVerified,
        plan: 'free',
        subscription_status: 'inactive',
        createdAt: new Date().toISOString(),
      });
      
      console.log('✅ User saved to Firestore successfully:', savedUser);
      
      return savedUser;
    } catch (error) {
      console.error('❌ Error in saveUserToBackend:', error);
      throw error;
    }
  };

  const fetchUserPlan = async (userId) => {
    try {
      console.log('=== AUTH CONTEXT: FETCHING USER PLAN ===');
      console.log('User ID:', userId);
      
      // Fetch user from Firestore
      const firestoreService = (await import('../services/firestoreService')).default;
      const user = await firestoreService.getUser(userId);
      
      if (user && user.plan) {
        console.log('Plan fetched from Firestore:', user.plan);
        return user.plan;
      }

      return 'free';
    } catch (error) {
      console.error('Error fetching user plan:', error);
      return 'free';
    }
  };

  const logout = async () => {
    try {
      console.log('=== AUTH CONTEXT: LOGGING OUT ===');
      setIsLoading(true);
      
      // Sign out from Firebase
      await firebaseAuthService.signOut();
      
      // Clear local storage
      await AsyncStorage.multiRemove([
        'user',
        'authToken',
        'google_calendar_access_token',
        'google_refresh_token',
      ]);
      
      setUser(null);
      setIsAuthenticated(false);
      setUserPlan('free');
      
      console.log('=== AUTH CONTEXT: LOGOUT SUCCESS ===');
    } catch (error) {
      console.error('=== AUTH CONTEXT: LOGOUT ERROR ===');
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    try {
      console.log('=== AUTH CONTEXT: STARTING GOOGLE SIGN IN ===');
      setIsLoading(true);
      
      const result = await firebaseAuthService.signInWithGoogle();
      
      if (result.success) {
        console.log('=== AUTH CONTEXT: GOOGLE SIGN IN SUCCESS ===');
        // Auth state change listener will handle the rest
        return { success: true, user: result.user };
      } else {
        console.log('=== AUTH CONTEXT: GOOGLE SIGN IN FAILED ===');
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('=== AUTH CONTEXT: GOOGLE SIGN IN ERROR ===');
      console.error('Error:', error);
      return { success: false, error: error.message || 'Google sign-in failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithEmail = async (email, password) => {
    try {
      console.log('=== AUTH CONTEXT: STARTING EMAIL SIGN IN ===');
      setIsLoading(true);
      
      const result = await firebaseAuthService.signInWithEmail(email, password);
      
      if (result.success) {
        console.log('=== AUTH CONTEXT: EMAIL SIGN IN SUCCESS ===');
        // Auth state change listener will handle the rest
        return { success: true, user: result.user };
      } else {
        console.log('=== AUTH CONTEXT: EMAIL SIGN IN FAILED ===');
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('=== AUTH CONTEXT: EMAIL SIGN IN ERROR ===');
      console.error('Error:', error);
      return { success: false, error: error.message || 'Email sign-in failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const signUpWithEmail = async (email, password, name) => {
    try {
      console.log('=== AUTH CONTEXT: STARTING EMAIL SIGN UP ===');
      setIsLoading(true);
      
      const result = await firebaseAuthService.signUpWithEmail(email, password, name);
      
      if (result.success) {
        console.log('=== AUTH CONTEXT: EMAIL SIGN UP SUCCESS ===');
        // Auth state change listener will handle the rest
        return { success: true, user: result.user };
      } else {
        console.log('=== AUTH CONTEXT: EMAIL SIGN UP FAILED ===');
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('=== AUTH CONTEXT: EMAIL SIGN UP ERROR ===');
      console.error('Error:', error);
      return { success: false, error: error.message || 'Email sign-up failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUserPlan = async (delay = 0) => {
    if (isAuthenticated && user) {
      console.log('=== AUTH CONTEXT: REFRESHING USER PLAN ===');
      
      try {
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const plan = await fetchUserPlan(user.id);
        
        if (plan !== userPlan) {
          console.log('✅ Plan changed from', userPlan, 'to', plan);
          setUserPlan(plan);
        }
        
        return plan;
      } catch (error) {
        console.error('❌ Error refreshing user plan:', error);
        return userPlan;
      }
    } else {
      return 'free';
    }
  };

  const forceRefreshUserPlan = async () => {
    return await refreshUserPlan(2000);
  };

  const value = {
    isAuthenticated,
    user,
    userPlan,
    isLoading,
    logout,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    refreshUserPlan,
    forceRefreshUserPlan,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
