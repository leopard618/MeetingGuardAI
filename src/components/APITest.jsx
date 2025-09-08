import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { Card, Title, Paragraph, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import MeetingManager from '../api/meetingManager.js';
import OpenAIService from '../api/openai.js';
import GoogleCalendarService from '../api/googleCalendar.js';

export default function APITest() {
  const [isLoading, setIsLoading] = useState(false);
  const [testResults, setTestResults] = useState({});
  const [status, setStatus] = useState({});

  useEffect(() => {
    runStatusCheck();
  }, []);

  const runStatusCheck = async () => {
    try {
      const meetingStatus = await MeetingManager.getStatus();
      setStatus(meetingStatus);
    } catch (error) {
      console.error('Status check failed:', error);
    }
  };

  const testOpenAI = async () => {
    setIsLoading(true);
    try {
      // Test API key validation
      const isValid = await OpenAIService.validateAPIKey();
      
      if (!isValid) {
        setTestResults(prev => ({
          ...prev,
          openai: { success: false, message: 'API key is invalid or not configured' }
        }));
        return;
      }

      // Test simple chat response
      const response = await OpenAIService.generateChatResponse([
        { type: 'user', content: 'Hello, can you help me with meetings?' }
      ]);

      setTestResults(prev => ({
        ...prev,
        openai: { 
          success: true, 
          message: 'OpenAI is working! Response received.',
          response: response.content.substring(0, 100) + '...'
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        openai: { success: false, message: `OpenAI test failed: ${error.message}` }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const testGoogleCalendar = async () => {
    setIsLoading(true);
    try {
      // Test calendar initialization
      const isInitialized = await GoogleCalendarService.initialize();
      
      if (!isInitialized) {
        setTestResults(prev => ({
          ...prev,
          calendar: { success: false, message: 'Google Calendar not initialized. Please sign in with Google.' }
        }));
        return;
      }

      // Test getting calendar info
      const calendarInfo = await GoogleCalendarService.getCalendarInfo();
      
      setTestResults(prev => ({
        ...prev,
        calendar: { 
          success: true, 
          message: `Google Calendar is working! Found ${calendarInfo.totalCalendars} calendars.`,
          info: calendarInfo
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        calendar: { success: false, message: `Google Calendar test failed: ${error.message}` }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const testMeetingManager = async () => {
    setIsLoading(true);
    try {
      // Test meeting manager initialization
      const isInitialized = await MeetingManager.initialize();
      
      if (!isInitialized) {
        setTestResults(prev => ({
          ...prev,
          meetingManager: { success: false, message: 'Meeting Manager failed to initialize' }
        }));
        return;
      }

      // Test processing a simple message
      const response = await MeetingManager.processMessage(
        [],
        'Hello, can you help me schedule a meeting?'
      );

      setTestResults(prev => ({
        ...prev,
        meetingManager: { 
          success: true, 
          message: 'Meeting Manager is working! AI processed the message.',
          response: response.message
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        meetingManager: { success: false, message: `Meeting Manager test failed: ${error.message}` }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const runAllTests = async () => {
    setIsLoading(true);
    setTestResults({});
    
    await testOpenAI();
    await testGoogleCalendar();
    await testMeetingManager();
    
    setIsLoading(false);
  };

  const getStatusIcon = (isConnected) => {
    return (
      <MaterialIcons 
        name={isConnected ? 'check-circle' : 'error'} 
        size={24} 
        color={isConnected ? '#4CAF50' : '#F44336'} 
      />
    );
  };

  const getStatusColor = (isConnected) => {
    return isConnected ? '#4CAF50' : '#F44336';
  };

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Title>API Configuration Test</Title>
          <Paragraph>Test your OpenAI and Google Calendar integration</Paragraph>
        </Card.Content>
      </Card>

      {/* Status Overview */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>Current Status</Title>
          <View style={styles.statusRow}>
            {getStatusIcon(status.openaiConnected)}
            <Text style={[styles.statusText, { color: getStatusColor(status.openaiConnected) }]}>
              OpenAI: {status.openaiConnected ? 'Connected' : 'Not Connected'}
            </Text>
          </View>
          <View style={styles.statusRow}>
            {getStatusIcon(status.calendarConnected)}
            <Text style={[styles.statusText, { color: getStatusColor(status.calendarConnected) }]}>
              Google Calendar: {status.calendarConnected ? 'Connected' : 'Not Connected'}
            </Text>
          </View>
        </Card.Content>
      </Card>

      {/* Test Buttons */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>Run Tests</Title>
          <View style={styles.buttonContainer}>
            <Button 
              mode="contained" 
              onPress={testOpenAI}
              disabled={isLoading}
              style={styles.button}
            >
              Test OpenAI
            </Button>
            <Button 
              mode="contained" 
              onPress={testGoogleCalendar}
              disabled={isLoading}
              style={styles.button}
            >
              Test Google Calendar
            </Button>
            <Button 
              mode="contained" 
              onPress={testMeetingManager}
              disabled={isLoading}
              style={styles.button}
            >
              Test Meeting Manager
            </Button>
            <Button 
              mode="outlined" 
              onPress={runAllTests}
              disabled={isLoading}
              style={styles.button}
            >
              Run All Tests
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* Loading Indicator */}
      {isLoading && (
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" />
              <Text style={styles.loadingText}>Running tests...</Text>
            </View>
          </Card.Content>
        </Card>
      )}

      {/* Test Results */}
      {Object.keys(testResults).length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Title>Test Results</Title>
            {Object.entries(testResults).map(([key, result]) => (
              <View key={key} style={styles.resultContainer}>
                <View style={styles.resultHeader}>
                  {getStatusIcon(result.success)}
                  <Text style={styles.resultTitle}>
                    {key === 'openai' ? 'OpenAI' : 
                     key === 'calendar' ? 'Google Calendar' : 
                     'Meeting Manager'}
                  </Text>
                </View>
                <Text style={[
                  styles.resultMessage, 
                  { color: result.success ? '#4CAF50' : '#F44336' }
                ]}>
                  {result.message}
                </Text>
                {result.response && (
                  <Text style={styles.resultResponse}>{result.response}</Text>
                )}
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Setup Instructions */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>Setup Instructions</Title>
          <Paragraph>
            If tests are failing, make sure you have:
          </Paragraph>
          <View style={styles.instructionList}>
            <Text style={styles.instruction}>• OpenAI API key in .env file</Text>
            <Text style={styles.instruction}>• Google OAuth configured</Text>
            <Text style={styles.instruction}>• Internet connection working</Text>
            <Text style={styles.instruction}>• Proper environment variables set</Text>
          </View>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  card: {
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  statusText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '500',
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    marginVertical: 4,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 16,
  },
  resultContainer: {
    marginVertical: 8,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  resultTitle: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  resultMessage: {
    fontSize: 14,
    marginBottom: 4,
  },
  resultResponse: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  instructionList: {
    marginTop: 8,
  },
  instruction: {
    fontSize: 14,
    marginVertical: 2,
    color: '#666',
  },
}); 