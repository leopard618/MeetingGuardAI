import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
} from 'react-native';
import { Card, Title, Paragraph, Button, ActivityIndicator, Divider } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '..\contexts\ThemeContext';
import googleCalendarService from '../api/googleCalendar';
import calendarSyncManager from '../api/calendarSyncManager';
import { Meeting } from '..\api\entities';

export default function CalendarSyncTest() {
  const { isDarkMode } = useTheme();
  const [calendars, setCalendars] = useState([]);
  const [events, setEvents] = useState([]);
  const [appMeetings, setAppMeetings] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newMeetingTitle, setNewMeetingTitle] = useState('');
  const [newMeetingDate, setNewMeetingDate] = useState('');
  const [syncResults, setSyncResults] = useState(null);

  const styles = getStyles(isDarkMode);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([
        loadCalendars(),
        loadEvents(),
        loadAppMeetings(),
        loadSyncStatus(),
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCalendars = async () => {
    try {
      const calendarList = await googleCalendarService.getCalendars();
      setCalendars(calendarList);
    } catch (error) {
      console.error('Error loading calendars:', error);
    }
  };

  const loadEvents = async () => {
    try {
      const eventList = await googleCalendarService.getEvents();
      setEvents(eventList);
    } catch (error) {
      console.error('Error loading events:', error);
    }
  };

  const loadAppMeetings = async () => {
    try {
      const meetings = await Meeting.list();
      setAppMeetings(meetings);
    } catch (error) {
      console.error('Error loading app meetings:', error);
    }
  };

  const loadSyncStatus = async () => {
    try {
      const status = await calendarSyncManager.getSyncStatus();
      setSyncStatus(status);
    } catch (error) {
      console.error('Error loading sync status:', error);
    }
  };

  const testCalendarAccess = async () => {
    try {
      setIsLoading(true);
      console.log('Testing Google Calendar access...');
      
      const hasAccess = await googleCalendarService.checkCalendarAccess();
      console.log('Calendar access result:', hasAccess);
      
      if (hasAccess) {
        await loadData();
        Alert.alert('Success', `Calendar access working! Found ${calendars.length} calendars and ${events.length} events`);
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

  const testSyncFromGoogle = async () => {
    try {
      setIsLoading(true);
      console.log('Testing sync from Google Calendar...');
      
      // Simulate syncing from Google Calendar to app
      const results = await calendarSyncManager.performSync();
      setSyncResults(results);
      
      // Reload data to see changes
      await loadData();
      
      Alert.alert(
        'Sync Complete',
        `Synced from Google Calendar:\nCreated: ${results.created}\nUpdated: ${results.updated}\nDeleted: ${results.deleted}\nErrors: ${results.errors.length}`
      );
    } catch (error) {
      console.error('Sync test error:', error);
      Alert.alert('Error', `Sync failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const createTestMeeting = async () => {
    try {
      if (!newMeetingTitle.trim()) {
        Alert.alert('Error', 'Please enter a meeting title');
        return;
      }

      setIsLoading(true);
      console.log('Creating test meeting...');
      
      const meetingData = {
        title: newMeetingTitle,
        description: 'Test meeting created in app',
        startTime: newMeetingDate || new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
        location: 'Test Location',
        attendees: ['snowleo1342@gmail.com'],
        priority: 'medium',
        status: 'scheduled',
      };

      const newMeeting = await Meeting.create(meetingData);
      console.log('Meeting created:', newMeeting);
      
      // Clear form
      setNewMeetingTitle('');
      setNewMeetingDate('');
      
      // Reload data
      await loadData();
      
      Alert.alert('Success', `Meeting "${newMeeting.title}" created successfully!`);
    } catch (error) {
      console.error('Error creating meeting:', error);
      Alert.alert('Error', `Failed to create meeting: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const syncMeetingToGoogle = async (meetingId) => {
    try {
      setIsLoading(true);
      console.log('Syncing meeting to Google Calendar...');
      
      await calendarSyncManager.syncEventToGoogle(meetingId);
      
      Alert.alert('Success', 'Meeting synced to Google Calendar!');
    } catch (error) {
      console.error('Error syncing meeting:', error);
      Alert.alert('Error', `Failed to sync meeting: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const checkSyncConflicts = async () => {
    try {
      setIsLoading(true);
      console.log('Checking for sync conflicts...');
      
      const conflicts = await calendarSyncManager.getSyncConflicts();
      
      if (conflicts.length === 0) {
        Alert.alert('No Conflicts', 'All events are in sync between app and Google Calendar');
      } else {
        Alert.alert(
          'Sync Conflicts Found',
          `${conflicts.length} conflicts detected:\n\n${conflicts.map(c => `• ${c.appEvent.title}`).join('\n')}`
        );
      }
    } catch (error) {
      console.error('Error checking conflicts:', error);
      Alert.alert('Error', `Failed to check conflicts: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Calendar Sync Test</Title>
          <Paragraph style={styles.subtitle}>
            Test bidirectional sync between your app and real Google Calendar
          </Paragraph>
        </Card.Content>
      </Card>

      {/* Test Calendar Access */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>1. Test Calendar Access</Title>
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
              <Text style={styles.resultTitle}>Calendars Available:</Text>
              {calendars.map((calendar, index) => (
                <Text key={index} style={styles.resultItem}>
                  • {calendar.summary} ({calendar.id})
                </Text>
              ))}
            </View>
          )}
        </Card.Content>
      </Card>

      {/* Google Calendar Events */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>2. Google Calendar Events</Title>
          {events.length > 0 ? (
            <View style={styles.results}>
              <Text style={styles.resultTitle}>Events in Google Calendar:</Text>
              {events.map((event, index) => (
                <Text key={index} style={styles.resultItem}>
                  • {event.summary} ({event.id})
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.noData}>No events found in Google Calendar</Text>
          )}
        </Card.Content>
      </Card>

      {/* App Meetings */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>3. App Meetings</Title>
          {appMeetings.length > 0 ? (
            <View style={styles.results}>
              <Text style={styles.resultTitle}>Meetings in App:</Text>
              {appMeetings.map((meeting, index) => (
                <View key={index} style={styles.meetingItem}>
                  <Text style={styles.resultItem}>• {meeting.title}</Text>
                  <Button
                    mode="outlined"
                    size="small"
                    onPress={() => syncMeetingToGoogle(meeting.id)}
                    style={styles.syncButton}
                  >
                    Sync to Google
                  </Button>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noData}>No meetings found in app</Text>
          )}
        </Card.Content>
      </Card>

      {/* Create Test Meeting */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>4. Create Test Meeting</Title>
          <TextInput
            style={styles.input}
            placeholder="Meeting Title"
            value={newMeetingTitle}
            onChangeText={setNewMeetingTitle}
            placeholderTextColor={isDarkMode ? '#94a3b8' : '#64748b'}
          />
          <TextInput
            style={styles.input}
            placeholder="Start Date (ISO string) - Optional"
            value={newMeetingDate}
            onChangeText={setNewMeetingDate}
            placeholderTextColor={isDarkMode ? '#94a3b8' : '#64748b'}
          />
          <Button
            mode="contained"
            onPress={createTestMeeting}
            loading={isLoading}
            disabled={isLoading}
            style={styles.button}
          >
            Create Meeting
          </Button>
        </Card.Content>
      </Card>

      {/* Sync Operations */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>5. Sync Operations</Title>
          
          <Button
            mode="contained"
            onPress={testSyncFromGoogle}
            loading={isLoading}
            disabled={isLoading}
            style={styles.button}
          >
            Sync from Google Calendar
          </Button>
          
          <Button
            mode="outlined"
            onPress={checkSyncConflicts}
            loading={isLoading}
            disabled={isLoading}
            style={styles.button}
          >
            Check Sync Conflicts
          </Button>
          
          {syncResults && (
            <View style={styles.results}>
              <Text style={styles.resultTitle}>Last Sync Results:</Text>
              <Text style={styles.resultItem}>Created: {syncResults.created}</Text>
              <Text style={styles.resultItem}>Updated: {syncResults.updated}</Text>
              <Text style={styles.resultItem}>Deleted: {syncResults.deleted}</Text>
              <Text style={styles.resultItem}>Errors: {syncResults.errors.length}</Text>
            </View>
          )}
        </Card.Content>
      </Card>

      {/* Sync Status */}
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.sectionTitle}>6. Sync Status</Title>
          {syncStatus ? (
            <View style={styles.results}>
              <Text style={styles.resultItem}>
                Auto Sync: {syncStatus.autoSync ? 'Enabled' : 'Disabled'}
              </Text>
              <Text style={styles.resultItem}>
                Last Sync: {syncStatus.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleString() : 'Never'}
              </Text>
              <Text style={styles.resultItem}>
                Sync Direction: {syncStatus.syncDirection || 'Bidirectional'}
              </Text>
            </View>
          ) : (
            <Text style={styles.noData}>No sync status available</Text>
          )}
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
  input: {
    borderWidth: 1,
    borderColor: isDarkMode ? '#334155' : '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    color: isDarkMode ? '#f1f5f9' : '#1e293b',
    backgroundColor: isDarkMode ? '#334155' : '#ffffff',
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
  noData: {
    fontSize: 12,
    color: isDarkMode ? '#94a3b8' : '#64748b',
    fontStyle: 'italic',
  },
  meetingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  syncButton: {
    marginLeft: 8,
  },
});
