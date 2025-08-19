import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { Card, Title, Paragraph, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import GoogleCalendarService from '../api/googleCalendar';
import { useGoogleAuth } from '../hooks/useGoogleAuth';

export default function GoogleCalendarTest() {
  const googleAuth = useGoogleAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [testResults, setTestResults] = useState({});
  const [calendarInfo, setCalendarInfo] = useState(null);

  const testGoogleAuth = async () => {
    setIsLoading(true);
    try {
      console.log('Testing Google Auth...');
      
      // Test if user is signed in
      const isSignedIn = googleAuth.isSignedIn;
      
      if (!isSignedIn) {
        setTestResults(prev => ({
          ...prev,
          auth: { success: false, message: 'User not signed in. Please sign in with Google first.' }
        }));
        return;
      }

      // Get current user
      const user = googleAuth.user;
      
      setTestResults(prev => ({
        ...prev,
        auth: { 
          success: true, 
          message: `Signed in as: ${user.email}`,
          user: user
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        auth: { success: false, message: `Auth test failed: ${error.message}` }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const testGoogleCalendar = async () => {
    setIsLoading(true);
    try {
      console.log('Testing Google Calendar...');
      
      // Test calendar initialization
      const isInitialized = await GoogleCalendarService.initialize();
      
      if (!isInitialized) {
        setTestResults(prev => ({
          ...prev,
          calendar: { success: false, message: 'Google Calendar not initialized. Check authentication and permissions.' }
        }));
        return;
      }

      // Get calendar info
      const info = await GoogleCalendarService.getCalendarInfo();
      setCalendarInfo(info);
      
      // Test getting calendars
      const calendars = await GoogleCalendarService.getCalendars();
      
      setTestResults(prev => ({
        ...prev,
        calendar: { 
          success: true, 
          message: `Google Calendar working! Found ${calendars.length} calendars.`,
          info: info,
          calendars: calendars
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        calendar: { success: false, message: `Calendar test failed: ${error.message}` }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const testCreateEvent = async () => {
    setIsLoading(true);
    try {
      console.log('Testing event creation...');
      
      const testEvent = {
        title: 'Test Meeting',
        description: 'This is a test meeting',
        startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
        location: 'Test Location',
        attendees: [],
        reminders: {
          popup: 10,
          email: 1440
        }
      };

      const createdEvent = await GoogleCalendarService.createEvent(testEvent);
      
      setTestResults(prev => ({
        ...prev,
        createEvent: { 
          success: true, 
          message: 'Event created successfully!',
          event: createdEvent
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        createEvent: { success: false, message: `Event creation failed: ${error.message}` }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const runAllTests = async () => {
    setIsLoading(true);
    setTestResults({});
    
    await testGoogleAuth();
    await testGoogleCalendar();
    await testCreateEvent();
    
    setIsLoading(false);
  };

  const getStatusIcon = (isSuccess) => {
    return (
      <MaterialIcons 
        name={isSuccess ? 'check-circle' : 'error'} 
        size={24} 
        color={isSuccess ? '#4CAF50' : '#F44336'} 
      />
    );
  };

  const getStatusColor = (isSuccess) => {
    return isSuccess ? '#4CAF50' : '#F44336';
  };

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Title>Google Calendar Integration Test</Title>
          <Paragraph>Test your Google Calendar integration step by step</Paragraph>
        </Card.Content>
      </Card>

      {/* Test Buttons */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>Run Tests</Title>
          <View style={styles.buttonContainer}>
            <Button 
              mode="contained" 
              onPress={testGoogleAuth}
              disabled={isLoading}
              style={styles.button}
            >
              Test Google Auth
            </Button>
            <Button 
              mode="contained" 
              onPress={testGoogleCalendar}
              disabled={isLoading}
              style={styles.button}
            >
              Test Calendar Access
            </Button>
            <Button 
              mode="contained" 
              onPress={testCreateEvent}
              disabled={isLoading}
              style={styles.button}
            >
              Test Create Event
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
                    {key === 'auth' ? 'Google Authentication' : 
                     key === 'calendar' ? 'Calendar Access' : 
                     'Event Creation'}
                  </Text>
                </View>
                <Text style={[
                  styles.resultMessage, 
                  { color: getStatusColor(result.success) }
                ]}>
                  {result.message}
                </Text>
                {result.user && (
                  <Text style={styles.resultDetails}>User: {result.user.email}</Text>
                )}
                {result.info && (
                  <Text style={styles.resultDetails}>
                    Calendars: {result.info.totalCalendars}, 
                    Authenticated: {result.info.isAuthenticated ? 'Yes' : 'No'}
                  </Text>
                )}
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Calendar Info */}
      {calendarInfo && (
        <Card style={styles.card}>
          <Card.Content>
            <Title>Calendar Information</Title>
            <Text style={styles.infoText}>Total Calendars: {calendarInfo.totalCalendars}</Text>
            <Text style={styles.infoText}>Authenticated: {calendarInfo.isAuthenticated ? 'Yes' : 'No'}</Text>
            <Text style={styles.infoText}>Initialized: {calendarInfo.isInitialized ? 'Yes' : 'No'}</Text>
            <Text style={styles.infoText}>Service: {calendarInfo.serviceName}</Text>
            {calendarInfo.primaryCalendar && (
              <Text style={styles.infoText}>Primary: {calendarInfo.primaryCalendar.summary}</Text>
            )}
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
            <Text style={styles.instruction}>• Google Cloud Project with Calendar API enabled</Text>
            <Text style={styles.instruction}>• OAuth 2.0 credentials configured</Text>
            <Text style={styles.instruction}>• Calendar scopes added to OAuth</Text>
            <Text style={styles.instruction}>• User signed in with Google</Text>
            <Text style={styles.instruction}>• Calendar permissions granted</Text>
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
  resultDetails: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  infoText: {
    fontSize: 14,
    marginVertical: 2,
    color: '#333',
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