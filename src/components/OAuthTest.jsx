import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import { useAuth } from '../contexts/AuthContext';
import { userStorage } from '../utils/storage';

const OAuthTest = () => {
  const { signIn, isSignedIn, user, isLoading } = useGoogleAuth();
  const { isAuthenticated, user: authUser, signInWithGoogle } = useAuth();

  const handleSignIn = async () => {
    try {
      console.log('=== Starting OAuth Test ===');
      console.log('Current Google Auth State:', { isSignedIn, user, isLoading });
      console.log('Current Auth Context State:', { isAuthenticated, user: authUser });
      
      const result = await signIn();
      console.log('OAuth result:', result);
      
      if (result.success) {
        Alert.alert('Success', `OAuth flow completed successfully!\nUser: ${result.user?.email}\nIs New User: ${result.isNewUser}`);
      } else {
        Alert.alert('Error', `OAuth failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('OAuth test error:', error);
      Alert.alert('Error', `OAuth failed: ${error.message}`);
    }
  };

  const handleAuthContextSignIn = async () => {
    try {
      console.log('=== Starting Auth Context Sign In ===');
      const result = await signInWithGoogle();
      console.log('Auth Context result:', result);
      
      if (result.success) {
        Alert.alert('Success', `Auth Context sign-in successful!\nUser: ${result.user?.email}`);
      } else {
        Alert.alert('Error', `Auth Context sign-in failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Auth Context sign-in error:', error);
      Alert.alert('Error', `Auth Context sign-in failed: ${error.message}`);
    }
  };

  const handleCheckUsers = async () => {
    try {
      const users = await userStorage.getAllUsers();
      const currentUser = await userStorage.getCurrentUser();
      
      Alert.alert('User Management Info', 
        `Total Users: ${users.length}\n` +
        `Current User: ${currentUser ? currentUser.email : 'None'}\n` +
        `Users: ${users.map(u => u.email).join(', ')}`
      );
    } catch (error) {
      Alert.alert('Error', `Failed to check users: ${error.message}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>OAuth Test & Debug</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Google Auth Hook State:</Text>
        <Text style={styles.label}>Loading: {isLoading ? 'Yes' : 'No'}</Text>
        <Text style={styles.label}>Signed In: {isSignedIn ? 'Yes' : 'No'}</Text>
        <Text style={styles.label}>User: {user ? user.email : 'None'}</Text>
        {user && (
          <View style={styles.userInfo}>
            <Text style={styles.userText}>Name: {user.name}</Text>
            <Text style={styles.userText}>ID: {user.id}</Text>
            <Text style={styles.userText}>Google ID: {user.googleId || 'None'}</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Auth Context State:</Text>
        <Text style={styles.label}>Authenticated: {isAuthenticated ? 'Yes' : 'No'}</Text>
        <Text style={styles.label}>User: {authUser ? authUser.email : 'None'}</Text>
        {authUser && (
          <View style={styles.userInfo}>
            <Text style={styles.userText}>Name: {authUser.name}</Text>
            <Text style={styles.userText}>ID: {authUser.id}</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test Buttons:</Text>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={handleSignIn}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            {isLoading ? 'Loading...' : 'Test Google Auth Hook'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.buttonSecondary]} 
          onPress={handleAuthContextSignIn}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            {isLoading ? 'Loading...' : 'Test Auth Context'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.buttonInfo]} 
          onPress={handleCheckUsers}
        >
          <Text style={styles.buttonText}>Check User Management</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.info}>
        <Text style={styles.infoTitle}>Debug Information:</Text>
        <Text style={styles.infoText}>• Check console logs for detailed flow</Text>
        <Text style={styles.infoText}>• Google Auth Hook handles OAuth directly</Text>
        <Text style={styles.infoText}>• Auth Context syncs with Google Auth</Text>
        <Text style={styles.infoText}>• App shows dashboard when isAuthenticated = true</Text>
        <Text style={styles.infoText}>• User management validates sign-in/sign-up</Text>
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
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  section: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  label: {
    fontSize: 14,
    marginBottom: 5,
    color: '#666',
  },
  userInfo: {
    backgroundColor: '#e8f5e8',
    padding: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  userText: {
    fontSize: 12,
    color: '#2e7d32',
    marginBottom: 2,
  },
  button: {
    backgroundColor: '#4285f4',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonSecondary: {
    backgroundColor: '#34a853',
  },
  buttonInfo: {
    backgroundColor: '#f4b400',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  info: {
    backgroundColor: '#fff3cd',
    padding: 15,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#856404',
  },
  infoText: {
    fontSize: 12,
    marginBottom: 4,
    color: '#856404',
  },
});

export default OAuthTest;

