import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { supabaseMeetingService } from '../api/supabaseMeetingService';

const RateLimitTest = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState([]);

  const testRateLimiting = async () => {
    setIsLoading(true);
    setResults([]);
    
    try {
      // Test multiple rapid requests to trigger rate limiting
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          supabaseMeetingService.list()
            .then(data => ({ success: true, index: i, dataLength: data.length }))
            .catch(error => ({ success: false, index: i, error: error.message }))
        );
      }
      
      const results = await Promise.all(promises);
      setResults(results);
      
      // Check if any requests were rate limited
      const rateLimited = results.some(r => r.error && r.error.includes('429'));
      if (rateLimited) {
        Alert.alert('Rate Limiting Detected', 'Some requests were rate limited, but the app handled it gracefully.');
      } else {
        Alert.alert('Success', 'All requests completed without rate limiting issues.');
      }
    } catch (error) {
      Alert.alert('Error', `Test failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const resetRateLimitState = async () => {
    try {
      await supabaseMeetingService.resetRateLimitState();
      Alert.alert('Success', 'Rate limit state has been reset.');
    } catch (error) {
      Alert.alert('Error', `Failed to reset rate limit state: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rate Limiting Test</Text>
      
      <TouchableOpacity 
        style={[styles.button, isLoading && styles.buttonDisabled]} 
        onPress={testRateLimiting}
        disabled={isLoading}
      >
        <Text style={styles.buttonText}>
          {isLoading ? 'Testing...' : 'Test Rate Limiting'}
        </Text>
      </TouchableOpacity>
      
      <TouchableOpacity 
        style={styles.button} 
        onPress={resetRateLimitState}
      >
        <Text style={styles.buttonText}>Reset Rate Limit State</Text>
      </TouchableOpacity>
      
      {results.length > 0 && (
        <View style={styles.results}>
          <Text style={styles.resultsTitle}>Test Results:</Text>
          {results.map((result, index) => (
            <Text key={index} style={styles.resultText}>
              Request {result.index}: {result.success ? 
                `Success (${result.dataLength} meetings)` : 
                `Failed: ${result.error}`
              }
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  results: {
    marginTop: 20,
    padding: 10,
    backgroundColor: 'white',
    borderRadius: 8,
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 12,
    marginBottom: 5,
    color: '#333',
  },
});

export default RateLimitTest;

