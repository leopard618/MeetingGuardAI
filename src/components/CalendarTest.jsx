import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Card, Title, Paragraph, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import googleCalendarService from '../api/googleCalendar.js';
import calendarSyncManager from '../api/calendarSyncManager.js';

export default function CalendarTest() {
  const { isDarkMode } = useTheme();
  const [calendars, setCalendars] = useState([]);
  const [events, setEvents] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const styles = getStyles(isDarkMode);

  const testCalendarAccess = async () => {
    try {
      setIsLoading(true);
      console.log('Testing Google Calendar access...');
      
      // Test calendar access
      const hasAccess = await googleCalendarService.checkCalendarAccess();
      console.log('Calendar access result:', hasAccess);
      
      if (hasAccess) {
        // Get calendars
        const calendarList = await googleCalendarService.getCalendars();
        setCalendars(calendarList);
        console.log('Calendars found:', calendarList);
        
        // Get events
        const eventList = await googleCalendarService.getEvents();
        setEvents(eventList);
        console.log('Events found:', eventList);
        
        Alert.alert('Success', `Found ${calendarList.length} calendars and ${eventList.length} events`);
      } else {
        Alert.alert('Error', 'Google Calendar access failed');
      }
    } catch (error) {
      console.error('Calendar test error:', error);
      Alert.alert('Error', `Calendar test failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const testSyncManager = async () => {
    try {
      setIsLoading(true);
      console.log('Testing calendar sync manager...');
      
      // Initialize sync manager
      const initialized = await calendarSyncManager.initialize();
      console.log('Sync manager initialized:', initialized);
      
      if (initialized) {
        // Get sync status
        const status = await calendarSyncManager.getSyncStatus();
        setSyncStatus(status);
        console.log('Sync status:', status);
        
        Alert.alert('Success', 'Calendar sync manager working correctly');
      } else {
        Alert.alert('Error', 'Calendar sync manager failed to initialize');
      }
    } catch (error) {
      console.error('Sync manager test error:', error);
      Alert.alert('Error', `Sync manager test failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const testForceSync = async () => {
    try {
      setIsLoading(true);
      console.log('Testing force sync...');
      
      const results = await calendarSyncManager.forceSync();
      console.log('Force sync results:', results);
      
      Alert.alert(
        'Sync Complete',
        `Created: ${results.created}\nUpdated: ${results.updated}\nDeleted: ${results.deleted}\nErrors: ${results.errors.length}`
      );
    } catch (error) {
      console.error('Force sync test error:', error);
      Alert.alert('Error', `Force sync failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Google Calendar Integration Test</Title>
          <Paragraph style={styles.subtitle}>
            Test your Google Calendar integration with mock data
          </Paragraph>
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>Test Calendar Access</Title>
          <Button
            mode="contained"
            onPress={testCalendarAccess}
            loading={isLoading}
            disabled={isLoading}
            style={styles.button}
          >
            Test Calendar Access
          </Button>
          
          {calendars.length > 0 && (
            <View style={styles.results}>
              <Text style={styles.resultTitle}>Calendars Found:</Text>
              {calendars.map((calendar, index) => (
                <Text key={index} style={styles.resultItem}>
                  • {calendar.summary} ({calendar.id})
                </Text>
              ))}
            </View>
          )}
          
          {events.length > 0 && (
            <View style={styles.results}>
              <Text style={styles.resultTitle}>Events Found:</Text>
              {events.map((event, index) => (
                <Text key={index} style={styles.resultItem}>
                  • {event.summary} ({event.id})
                </Text>
              ))}
            </View>
          )}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>Test Sync Manager</Title>
          <Button
            mode="contained"
            onPress={testSyncManager}
            loading={isLoading}
            disabled={isLoading}
            style={styles.button}
          >
            Test Sync Manager
          </Button>
          
          {syncStatus && (
            <View style={styles.results}>
              <Text style={styles.resultTitle}>Sync Status:</Text>
              <Text style={styles.resultItem}>
                • Auto Sync: {syncStatus.autoSync ? 'Enabled' : 'Disabled'}
              </Text>
              <Text style={styles.resultItem}>
                • Last Sync: {syncStatus.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleString() : 'Never'}
              </Text>
            </View>
          )}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>Test Force Sync</Title>
          <Button
            mode="contained"
            onPress={testForceSync}
            loading={isLoading}
            disabled={isLoading}
            style={styles.button}
          >
            Force Sync
          </Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
    padding: 16,
  },
  card: {
    marginBottom: 16,
    backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: isDarkMode ? '#f1f5f9' : '#1e293b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: isDarkMode ? '#94a3b8' : '#64748b',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: isDarkMode ? '#f1f5f9' : '#1e293b',
    marginBottom: 12,
  },
  button: {
    marginTop: 8,
    marginBottom: 16,
  },
  results: {
    marginTop: 12,
    padding: 12,
    backgroundColor: isDarkMode ? '#334155' : '#f1f5f9',
    borderRadius: 8,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: isDarkMode ? '#f1f5f9' : '#1e293b',
    marginBottom: 8,
  },
  resultItem: {
    fontSize: 12,
    color: isDarkMode ? '#cbd5e1' : '#475569',
    marginBottom: 4,
  },
});
