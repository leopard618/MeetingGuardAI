// Auth Test Component
// Helps debug the authentication flow

import React, { useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet, ScrollView, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debugAuthState, clearAllAuthData } from '../utils/authDebug.js';

const AuthTest = () => {
  const [authState, setAuthState] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [backendUrl, setBackendUrl] = useState('');

  const checkAuthState = async () => {
    setIsLoading(true);
    try {
      const state = await debugAuthState();
      setAuthState(state);
      
      // Also check backend URL
      const url = process.env.BACKEND_URL;
      setBackendUrl(url || 'Not configured');
    } catch (error) {
      console.error('Error checking auth state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const testBackendConnection = async () => {
    try {
      setIsLoading(true);
      const url = process.env.BACKEND_URL;
      if (!url) {
        Alert.alert('Error', 'Backend URL not configured');
        return;
      }

      const response = await fetch(`${url}/health`);
      if (response.ok) {
        Alert.alert('Success', 'Backend is reachable');
      } else {
        Alert.alert('Error', `Backend returned status: ${response.status}`);
      }
    } catch (error) {
      Alert.alert('Error', `Backend connection failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const testUserSave = async () => {
    try {
      setIsLoading(true);
      const url = process.env.BACKEND_URL;
      if (!url) {
        Alert.alert('Error', 'Backend URL not configured');
        return;
      }

      const testUser = {
        google_id: 'test123',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://example.com/pic.jpg',
        given_name: 'Test',
        family_name: 'User'
      };

      const response = await fetch(`${url}/api/auth/google/save-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(testUser)
      });

      if (response.ok) {
        const data = await response.json();
        Alert.alert('Success', `User saved: ${JSON.stringify(data, null, 2)}`);
      } else {
        const errorText = await response.text();
        Alert.alert('Error', `Save failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      Alert.alert('Error', `Test failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const clearAuth = async () => {
    try {
      setIsLoading(true);
      await clearAllAuthData();
      await checkAuthState();
      Alert.alert('Success', 'All authentication data cleared!');
    } catch (error) {
      Alert.alert('Error', `Failed to clear auth: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuthState();
  }, []);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Authentication Test</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backend Configuration</Text>
        <Text style={styles.infoText}>Backend URL: {backendUrl}</Text>
        <Button 
          title="Test Backend Connection" 
          onPress={testBackendConnection}
          disabled={isLoading}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authentication State</Text>
        <Button 
          title={isLoading ? "Checking..." : "Refresh Auth State"} 
          onPress={checkAuthState}
          disabled={isLoading}
        />
        
        {authState && (
          <View style={styles.stateContainer}>
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
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backend Tests</Text>
        <Button 
          title="Test User Save to Backend" 
          onPress={testUserSave}
          disabled={isLoading}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reset</Text>
        <Button 
          title="Clear All Auth Data" 
          onPress={clearAuth}
          disabled={isLoading}
          color="red"
        />
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
  section: {
    backgroundColor: 'white',
    padding: 15,
    marginVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    marginBottom: 10,
    color: '#666',
  },
  stateContainer: {
    backgroundColor: '#f8f9fa',
    padding: 10,
    marginTop: 10,
    borderRadius: 5,
  },
  stateText: {
    fontSize: 14,
    marginVertical: 2,
  },
});

export default AuthTest;
