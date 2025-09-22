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
      
      // Save user to backend/Supabase first
      saveUserToBackend(googleAuth.user).then((result) => {
        console.log('✅ User saved to backend successfully:', result);
        // Set default plan to free for now
        setUserPlan('free');
        setIsLoading(false);
      }).catch(error => {
        console.error('❌ Error saving user to backend:', error);
        console.error('❌ Error details:', error.message);
        // Set default plan to free even if save fails
        setUserPlan('free');
        setIsLoading(false);
        // Show user-friendly error message
        alert(`Failed to save user data: ${error.message}. Please try signing in again.`);
      });
    } else if (!googleAuth.isLoading) {
      console.log('=== AUTH CONTEXT: NO GOOGLE AUTH, CHECKING STORAGE ===');
      // Only check storage if Google auth is not loading
      checkAuthStatus();
    }
  }, [googleAuth.isSignedIn, googleAuth.user, googleAuth.isLoading]);

  const saveUserToBackend = async (userInfo) => {
    try {
      console.log('=== AUTH CONTEXT: SAVING USER TO BACKEND ===');
      console.log('User info:', userInfo);
      console.log('Backend URL:', process.env.BACKEND_URL);
      
      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }

      // Call the backend to save/update user
      const response = await fetch(`${backendUrl}/api/auth/google/save-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          google_id: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture,
          given_name: userInfo.given_name,
          family_name: userInfo.family_name
        })
      });

      console.log('Save user response status:', response.status);
      console.log('Save user response ok:', response.ok);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ User saved to backend successfully:', data);
        
        // Store the JWT token for future authenticated requests
        if (data.jwtToken) {
          await AsyncStorage.setItem('authToken', data.jwtToken);
          console.log('✅ JWT token stored for authenticated requests');
        } else {
          console.warn('⚠️ No JWT token received from backend');
        }
        
        // Store the user data in AsyncStorage
        if (data.user) {
          await AsyncStorage.setItem('user', JSON.stringify(data.user));
          console.log('✅ User data stored in AsyncStorage');
        }
        
        return data;
      } else {
        const errorText = await response.text();
        console.error('❌ Error saving user to backend:', errorText);
        console.error('❌ Response status:', response.status);
        console.error('❌ Response headers:', response.headers);
        throw new Error(`Failed to save user: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('❌ Error in saveUserToBackend:', error);
      throw error;
    }
  };

  const fetchUserPlan = async (userId) => {
    try {
      console.log('=== AUTH CONTEXT: FETCHING USER PLAN ===');
      console.log('User ID:', userId);
      console.log('Backend URL:', process.env.BACKEND_URL);
      
      // Get auth token from storage
      const token = await AsyncStorage.getItem('authToken');
      const userEmail = user?.email;
      
      if (!token && !userEmail) {
        console.log('No auth token or user email found, returning free plan');
        return 'free';
      }

      // Try authenticated endpoint first if token exists
      if (token) {
        console.log('Auth token found, calling authenticated endpoint...');
        
        try {
          const response = await fetch(`${process.env.BACKEND_URL}/api/billing/subscription`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          console.log('Authenticated response status:', response.status);
          console.log('Authenticated response ok:', response.ok);

          if (response.ok) {
            const data = await response.json();
            console.log('Authenticated response data:', data);
            console.log('Subscription data:', data.subscription);
            console.log('Plan from subscription:', data.subscription?.plan);
            
            const plan = data.subscription?.plan || 'free';
            console.log('Final plan returned from authenticated endpoint:', plan);
            return plan;
          } else {
            console.log('Authenticated endpoint failed, trying public endpoint...');
          }
        } catch (authError) {
          console.log('Authenticated endpoint error:', authError);
          console.log('Trying public endpoint...');
        }
      }

      // Fallback to public endpoint using user email
      if (userEmail) {
        console.log('Using public endpoint with email:', userEmail);
        
        try {
          const response = await fetch(`${process.env.BACKEND_URL}/api/billing/user-plan/${encodeURIComponent(userEmail)}`, {
            headers: {
              'Content-Type': 'application/json'
            }
          });

          console.log('Public response status:', response.status);
          console.log('Public response ok:', response.ok);

          if (response.ok) {
            const data = await response.json();
            console.log('Public response data:', data);
            console.log('Subscription data:', data.subscription);
            console.log('Plan from subscription:', data.subscription?.plan);
            
            const plan = data.subscription?.plan || 'free';
            console.log('Final plan returned from public endpoint:', plan);
            return plan;
          } else {
            const errorText = await response.text();
            console.log('Public endpoint error response:', errorText);
          }
        } catch (publicError) {
          console.error('Public endpoint error:', publicError);
        }
      }

      console.log('All endpoints failed, using default free plan');
      return 'free';
      
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
        
        // Initialize Google Calendar service if user is authenticated
        try {
          console.log('🔄 Initializing Google Calendar service for authenticated user...');
          const googleCalendarService = (await import('../api/googleCalendar')).default;
          const initialized = await googleCalendarService.initialize();
          if (initialized) {
            console.log('✅ Google Calendar service initialized for authenticated user');
          } else {
            console.log('⚠️ Google Calendar service initialization failed for authenticated user');
          }
        } catch (calendarError) {
          console.warn('⚠️ Failed to initialize Google Calendar service:', calendarError.message);
          // Don't fail the auth check if calendar init fails
        }
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
      console.log('=== AUTH CONTEXT: MANUAL LOGIN ATTEMPT ===');
      console.log('Email:', email);
      setIsLoading(true);
      
      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }

      // Call the backend login endpoint
      const response = await fetch(`${backendUrl}/api/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          email: email,
          password: password
        })
      });

      console.log('Login response status:', response.status);
      console.log('Login response ok:', response.ok);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Manual login successful:', data);
        
        // Store user data in AsyncStorage
        await AsyncStorage.setItem('user', JSON.stringify(data.user));
        
        // Store the JWT token for future authenticated requests
        if (data.jwtToken) {
          await AsyncStorage.setItem('authToken', data.jwtToken);
          console.log('✅ JWT token stored for authenticated requests');
        }
        
        // Update auth state
        setUser(data.user);
        setIsAuthenticated(true);
        setUserPlan(data.user.plan || 'free');
        
        return { success: true, user: data.user };
      } else {
        const errorData = await response.json();
        console.error('❌ Manual login failed:', errorData);
        return { success: false, error: errorData.error || 'Login failed' };
      }
    } catch (error) {
      console.error('❌ Manual login error:', error);
      return { success: false, error: error.message || 'Network error' };
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (name, email, password) => {
    try {
      console.log('=== AUTH CONTEXT: MANUAL SIGNUP ATTEMPT ===');
      console.log('Name:', name);
      console.log('Email:', email);
      setIsLoading(true);
      
      const backendUrl = process.env.BACKEND_URL;
      if (!backendUrl) {
        throw new Error('Backend URL not configured');
      }

      // Call the backend signup endpoint
      const response = await fetch(`${backendUrl}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          name: name,
          email: email,
          password: password
        })
      });

      console.log('Signup response status:', response.status);
      console.log('Signup response ok:', response.ok);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Manual signup successful:', data);
        
        // Store user data in AsyncStorage
        await AsyncStorage.setItem('user', JSON.stringify(data.user));
        
        // Store the JWT token for future authenticated requests
        if (data.jwtToken) {
          await AsyncStorage.setItem('authToken', data.jwtToken);
          console.log('✅ JWT token stored for authenticated requests');
        }
        
        // Update auth state
        setUser(data.user);
        setIsAuthenticated(true);
        setUserPlan(data.user.plan || 'free');
        
        return { success: true, user: data.user };
      } else {
        const errorData = await response.json();
        console.error('❌ Manual signup failed:', errorData);
        return { success: false, error: errorData.error || 'Signup failed' };
      }
    } catch (error) {
      console.error('❌ Manual signup error:', error);
      return { success: false, error: error.message || 'Network error' };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      console.log('Logging out user');
      setIsLoading(true); // Set loading state during logout
      
      // Sign out from Google if signed in
      await googleAuth.signOut();

      // Clear local storage
      await AsyncStorage.removeItem('user');
      await AsyncStorage.removeItem('authToken');
      
      // Clear Google Calendar tokens
      try {
        const googleCalendarService = (await import('../api/googleCalendar')).default;
        await googleCalendarService.clearTokens();
        console.log('Google Calendar tokens cleared');
      } catch (calendarError) {
        console.warn('Failed to clear Google Calendar tokens:', calendarError);
      }
      
      setUser(null);
      setIsAuthenticated(false);
      setUserPlan('free');
      console.log('Logout successful');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false); // Clear loading state
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
        
        // Sync Google tokens with backend if available
        if (result.tokens) {
          console.log('🔄 AuthContext: Syncing Google tokens with backend...');
          console.log('🔄 AuthContext: Tokens received:', {
            hasAccessToken: !!result.tokens.access_token,
            hasRefreshToken: !!result.tokens.refresh_token,
            expiresIn: result.tokens.expires_in
          });
          try {
            const googleCalendarService = (await import('../api/googleCalendar')).default;
            await googleCalendarService.storeTokens(result.tokens);
            
            // Initialize the Google Calendar service after storing tokens
            console.log('🔄 AuthContext: Initializing Google Calendar service...');
            const initialized = await googleCalendarService.initialize();
            if (initialized) {
              console.log('✅ AuthContext: Google Calendar service initialized successfully');
            } else {
              console.log('⚠️ AuthContext: Google Calendar service initialization failed');
            }
            
            console.log('✅ AuthContext: Google tokens synced with backend');
          } catch (syncError) {
            console.error('⚠️ AuthContext: Failed to sync Google tokens:', syncError);
            // Don't fail the sign-in if token sync fails
            // The tokens are already stored locally by useGoogleAuth
          }
        } else {
          console.log('⚠️ AuthContext: No tokens returned from Google sign-in');
          console.log('⚠️ AuthContext: Result object:', result);
        }
        
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
  const refreshUserPlan = async (delay = 0) => {
    if (isAuthenticated && user) {
      console.log('=== AUTH CONTEXT: REFRESHING USER PLAN ===');
      console.log('Current user:', user.email);
      console.log('Current plan before refresh:', userPlan);
      console.log('Delay before refresh:', delay, 'ms');
      
      try {
        // Add delay if specified (useful for payment scenarios)
        if (delay > 0) {
          console.log('⏳ Waiting', delay, 'ms before refreshing plan...');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const plan = await fetchUserPlan(user.id);
        console.log('New plan fetched:', plan);
        
        // Only update if the plan actually changed
        if (plan !== userPlan) {
          console.log('✅ Plan changed from', userPlan, 'to', plan);
          setUserPlan(plan);
        } else {
          console.log('ℹ️ Plan unchanged:', plan);
        }
        
        return plan;
      } catch (error) {
        console.error('❌ Error refreshing user plan:', error);
        return userPlan; // Return current plan on error
      }
    } else {
      console.log('⚠️ Cannot refresh plan - user not authenticated or no user data');
      return 'free';
    }
  };

  // Function to force refresh user plan with longer delay (for payment scenarios)
  const forceRefreshUserPlan = async () => {
    console.log('=== AUTH CONTEXT: FORCE REFRESHING USER PLAN (PAYMENT SCENARIO) ===');
    return await refreshUserPlan(2000); // 2 second delay for payment webhooks
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
    forceRefreshUserPlan,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 