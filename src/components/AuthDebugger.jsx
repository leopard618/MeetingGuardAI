// Auth Debugger Component
// Helps debug authentication issues

import React, { useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet, ScrollView } from 'react-native';
import { debugAuthState, clearAllAuthData } from '../utils/authDebug.js';

const AuthDebugger = () => {
  const [authState, setAuthState] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const checkAuthState = async () => {
    setIsLoading(true);
    try {
      const state = await debugAuthState();
      setAuthState(state);
    } catch (error) {
      console.error('Error checking auth state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearAuth = async () => {
    setIsLoading(true);
    try {
      await clearAllAuthData();
      await checkAuthState();
      alert('All authentication data cleared!');
    } catch (error) {
      console.error('Error clearing auth:', error);
      alert('Error clearing auth data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuthState();
  }, []);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Authentication Debugger</Text>
      
      <Button 
        title={isLoading ? "Checking..." : "Refresh Auth State"} 
        onPress={checkAuthState}
        disabled={isLoading}
      />
      
      <Button 
        title="Clear All Auth Data" 
        onPress={clearAuth}
        disabled={isLoading}
        color="red"
      />
      
      {authState && (
        <View style={styles.stateContainer}>
          <Text style={styles.stateTitle}>Current Auth State:</Text>
          <Text style={styles.stateText}>
            User: {authState.hasUser ? '✅ Present' : '❌ Missing'}
          </Text>
          <Text style={styles.stateText}>
            Auth Token: {authState.hasAuthToken ? '✅ Present' : '❌ Missing'}
          </Text>
          <Text style={styles.stateText}>
            Refresh Token: {authState.hasRefreshToken ? '✅ Present' : '❌ Missing'}
          </Text>
          <Text style={styles.stateText}>
            Google Tokens: {authState.hasGoogleTokens ? '✅ Present' : '❌ Missing'}
          </Text>
        </View>
      )}
      
      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>Instructions:</Text>
        <Text style={styles.instructionsText}>
          1. Check the auth state above
        </Text>
        <Text style={styles.instructionsText}>
          2. If all are missing, you need to sign in
        </Text>
        <Text style={styles.instructionsText}>
          3. If some are present but app still fails, try clearing all auth data
        </Text>
        <Text style={styles.instructionsText}>
          4. Then sign in again
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  stateContainer: {
    backgroundColor: 'white',
    padding: 15,
    marginVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  stateText: {
    fontSize: 16,
    marginVertical: 2,
  },
  instructions: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    marginVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196f3',
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#1976d2',
  },
  instructionsText: {
    fontSize: 14,
    marginVertical: 2,
    color: '#1976d2',
  },
});

export default AuthDebugger;
