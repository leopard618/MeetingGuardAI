import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import {
  Button,
  Card,
  Title,
  Paragraph,
} from 'react-native-paper';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import googleCalendarService from '../api/googleCalendar.js';
import calendarSyncManager from '../api/calendarSyncManager.js';

export default function GoogleCalendarTest({ navigation }) {
  const { isDarkMode } = useTheme();
  const { user, isAuthenticated } = useAuth();
  
  const [calendarInfo, setCalendarInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [testResults, setTestResults] = useState([]);

  const styles = getStyles(isDarkMode);

  useEffect(() => {
    testGoogleCalendar();
  }, []);

  const testGoogleCalendar = async () => {
    setIsLoading(true);
    const results = [];

    try {
      // Test 1: Check authentication
      results.push({ test: 'Authentication Check', status: 'running' });
      console.log('=== TEST 1: AUTHENTICATION CHECK ===');
      console.log('User authenticated:', isAuthenticated);
      console.log('User:', user);
      
      if (isAuthenticated && user) {
        results[results.length - 1] = { test: 'Authentication Check', status: 'passed', details: `User: ${user.email}` };
      } else {
        results[results.length - 1] = { test: 'Authentication Check', status: 'failed', details: 'No authenticated user found' };
      }

      // Test 2: Check Google Calendar service initialization
      results.push({ test: 'Calendar Service Init', status: 'running' });
      console.log('=== TEST 2: CALENDAR SERVICE INIT ===');
      
      const initResult = await googleCalendarService.initialize();
      console.log('Calendar service init result:', initResult);
      
      if (initResult) {
        results[results.length - 1] = { test: 'Calendar Service Init', status: 'passed', details: 'Service initialized successfully' };
      } else {
        results[results.length - 1] = { test: 'Calendar Service Init', status: 'failed', details: 'Service initialization failed' };
      }

      // Test 3: Get calendar info
      results.push({ test: 'Get Calendar Info', status: 'running' });
      console.log('=== TEST 3: GET CALENDAR INFO ===');
      
      const info = await googleCalendarService.getCalendarInfo();
      console.log('Calendar info:', info);
      setCalendarInfo(info);
      
      if (info.isAuthenticated) {
        results[results.length - 1] = { test: 'Get Calendar Info', status: 'passed', details: `Found ${info.totalCalendars} calendars` };
      } else {
        results[results.length - 1] = { test: 'Get Calendar Info', status: 'failed', details: 'Not authenticated with Google Calendar' };
      }

      // Test 4: Check access token
      results.push({ test: 'Access Token Check', status: 'running' });
      console.log('=== TEST 4: ACCESS TOKEN CHECK ===');
      
      const token = await googleCalendarService.getAccessToken();
      console.log('Access token present:', !!token);
      
      if (token) {
        results[results.length - 1] = { test: 'Access Token Check', status: 'passed', details: 'Valid access token found' };
      } else {
        results[results.length - 1] = { test: 'Access Token Check', status: 'failed', details: 'No valid access token found' };
      }

      // Test 5: Try to get calendars
      results.push({ test: 'Get Calendars', status: 'running' });
      console.log('=== TEST 5: GET CALENDARS ===');
      
      try {
        const calendars = await googleCalendarService.getCalendars();
        console.log('Calendars:', calendars);
        results[results.length - 1] = { test: 'Get Calendars', status: 'passed', details: `Found ${calendars.length} calendars` };
      } catch (error) {
        console.error('Error getting calendars:', error);
        results[results.length - 1] = { test: 'Get Calendars', status: 'failed', details: error.message };
      }

      // Test 6: Try to get today's meetings
      results.push({ test: 'Get Today Meetings', status: 'running' });
      console.log('=== TEST 6: GET TODAY MEETINGS ===');
      
      try {
        const meetings = await googleCalendarService.getTodayMeetings();
        console.log('Today meetings:', meetings);
        results[results.length - 1] = { test: 'Get Today Meetings', status: 'passed', details: `Found ${meetings.length} meetings today` };
      } catch (error) {
        console.error('Error getting today meetings:', error);
        results[results.length - 1] = { test: 'Get Today Meetings', status: 'failed', details: error.message };
      }

    } catch (error) {
      console.error('Test error:', error);
      results.push({ test: 'General Test', status: 'failed', details: error.message });
    } finally {
      setIsLoading(false);
      setTestResults(results);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'passed': return '#4caf50';
      case 'failed': return '#f44336';
      case 'running': return '#ff9800';
      default: return '#9e9e9e';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'running': return '⏳';
      default: return '❓';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Card style={styles.card}>
          <Card.Content>
            <Title style={styles.title}>Google Calendar Test</Title>
            
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Authentication Status</Text>
              <Text style={styles.text}>
                User Authenticated: {isAuthenticated ? 'Yes' : 'No'}
              </Text>
              {user && (
                <Text style={styles.text}>
                  User Email: {user.email}
                </Text>
              )}
            </View>

            {calendarInfo && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Calendar Information</Text>
                <Text style={styles.text}>
                  Service: {calendarInfo.serviceName}
                </Text>
                <Text style={styles.text}>
                  Authenticated: {calendarInfo.isAuthenticated ? 'Yes' : 'No'}
                </Text>
                <Text style={styles.text}>
                  Initialized: {calendarInfo.isInitialized ? 'Yes' : 'No'}
                </Text>
                <Text style={styles.text}>
                  Total Calendars: {calendarInfo.totalCalendars}
                </Text>
                <Text style={styles.text}>
                  Last Sync: {calendarInfo.lastSync || 'Never'}
                </Text>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Test Results</Text>
              
              {testResults.map((result, index) => (
                <View key={index} style={styles.testResult}>
                  <View style={styles.testHeader}>
                    <Text style={styles.testIcon}>{getStatusIcon(result.status)}</Text>
                    <Text style={[styles.testName, { color: getStatusColor(result.status) }]}>
                      {result.test}
                    </Text>
                  </View>
                  {result.details && (
                    <Text style={styles.testDetails}>{result.details}</Text>
                  )}
                </View>
              ))}
            </View>

            <Button
              mode="contained"
              onPress={testGoogleCalendar}
              loading={isLoading}
              style={styles.button}
            >
              Run Tests Again
            </Button>

            <Button
              mode="outlined"
              onPress={() => navigation.goBack()}
              style={styles.button}
            >
              Back
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  card: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  text: {
    fontSize: 16,
    marginBottom: 8,
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  testResult: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
    borderRadius: 8,
  },
  testHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  testIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  testName: {
    fontSize: 16,
    fontWeight: '500',
  },
  testDetails: {
    fontSize: 14,
    color: '#666',
    marginLeft: 26,
  },
  button: {
    marginTop: 16,
  },
}); 