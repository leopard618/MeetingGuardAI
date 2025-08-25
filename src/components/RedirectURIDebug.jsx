import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';

export default function RedirectURIDebug() {
  const isExpoGo = Constants.appOwnership === 'expo';
  const isDevClient = Constants.appOwnership === 'guest';
  const isStandalone = Constants.appOwnership === 'standalone';
  
  // Use custom scheme redirect URI for all environments (no more Expo proxy)
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'meetingguardai',
    path: 'auth',
    useProxy: false,
  });

  const environment = isExpoGo 
    ? 'Expo Go (Development)' 
    : isDevClient 
    ? 'Dev Client (Development)' 
    : 'Standalone (Production)';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔍 Redirect URI Debug</Text>
      <Text style={styles.label}>Environment:</Text>
      <Text style={styles.value}>{environment}</Text>
      
      <Text style={styles.label}>Redirect URI:</Text>
      <Text style={styles.uri}>{redirectUri}</Text>
      
      <Text style={styles.label}>Expo Username:</Text>
      <Text style={styles.value}>leopard618</Text>
      
      <Text style={styles.label}>App Slug:</Text>
      <Text style={styles.value}>meeting-guard-ai</Text>
      
      <Text style={styles.label}>Package Name:</Text>
      <Text style={styles.value}>com.meetingguard.ai</Text>
      
      <Text style={styles.note}>
        ⚠️ IMPORTANT: Use Android OAuth Client (not Web client)
      </Text>
      <Text style={styles.expectedUri}>
        {redirectUri}
      </Text>
      
      <Text style={styles.warning}>
        🚨 Remove https://auth.expo.io/@leopard618/meeting-guard-ai from Google Cloud Console
      </Text>
      
      <Text style={styles.info}>
        📱 Android OAuth clients don't need redirect URIs in Google Cloud Console
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f5f5f5',
    margin: 16,
    borderRadius: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 8,
    color: '#333',
  },
  value: {
    fontSize: 14,
    marginBottom: 8,
    color: '#666',
    fontFamily: 'monospace',
  },
  uri: {
    fontSize: 12,
    marginBottom: 8,
    color: '#0066cc',
    fontFamily: 'monospace',
    backgroundColor: '#e6f3ff',
    padding: 8,
    borderRadius: 4,
  },
  note: {
    fontSize: 12,
    marginTop: 16,
    color: '#d32f2f',
    fontWeight: 'bold',
  },
  expectedUri: {
    fontSize: 12,
    color: '#2e7d32',
    fontFamily: 'monospace',
    backgroundColor: '#e8f5e8',
    padding: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  warning: {
    fontSize: 12,
    marginTop: 16,
    color: '#fbc02d',
    fontWeight: 'bold',
  },
  info: {
    fontSize: 12,
    marginTop: 16,
    color: '#0288d1',
    fontWeight: 'bold',
  },
});
