import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  Chip,
  Divider,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '..\contexts\ThemeContext';
import { Meeting } from '..\api\entities';
import { safeStringify } from '..\utils';

export default function MeetingDetails({ navigation, route }) {
  const { meeting } = route.params;
  const { isDarkMode } = useTheme();

  const styles = getStyles(isDarkMode);

  const handleEditMeeting = () => {
    if (meeting.source === 'local') {
      navigation.navigate('EditMeeting', { meeting });
    } else {
      Alert.alert('Info', 'Google Calendar meetings can only be edited from Google Calendar');
    }
  };

  const handleDeleteMeeting = () => {
    Alert.alert(
      'Delete Meeting',
      `Are you sure you want to delete "${meeting.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (meeting.source === 'local') {
                await Meeting.delete(meeting.id);
                Alert.alert('Success', 'Meeting deleted successfully');
                navigation.goBack();
              } else {
                Alert.alert('Info', 'Google Calendar meetings can only be deleted from Google Calendar');
              }
            } catch (error) {
              console.error('Error deleting meeting:', error);
              Alert.alert('Error', 'Failed to delete meeting');
            }
          }
        }
      ]
    );
  };

  const formatDate = (date, time) => {
    console.log('MeetingDetails: Formatting date:', { date, time, dateType: typeof date, timeType: typeof time });
    
    try {
      // Handle different date formats
      let meetingDate;
      
      if (date && time) {
        // Try different date formats
        const dateTimeString = `${date} ${time}`;
        meetingDate = new Date(dateTimeString);
        
        // If invalid, try parsing the date separately
        if (isNaN(meetingDate.getTime())) {
          // Try ISO format
          meetingDate = new Date(date);
          if (isNaN(meetingDate.getTime())) {
            // Try parsing as YYYY-MM-DD
            const [year, month, day] = date.split('-');
            if (year && month && day) {
              meetingDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
          }
        }
        
        // If still invalid, try to construct the date manually
        if (isNaN(meetingDate.getTime())) {
          // Try to parse date and time separately
          let parsedDate = new Date();
          
          // Handle date parsing
          if (typeof date === 'string') {
            if (date.includes('-')) {
              // YYYY-MM-DD format
              const [year, month, day] = date.split('-');
              if (year && month && day) {
                parsedDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
              }
            } else if (date.includes('/')) {
              // MM/DD/YYYY format
              const [month, day, year] = date.split('/');
              if (month && day && year) {
                parsedDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
              }
            }
          }
          
          // Handle time parsing
          if (typeof time === 'string' && time.includes(':')) {
            const [hours, minutes] = time.split(':');
            if (hours && minutes) {
              parsedDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            }
          }
          
          meetingDate = parsedDate;
        }
      } else if (date) {
        meetingDate = new Date(date);
      } else {
        return 'Date not specified';
      }
      
      if (isNaN(meetingDate.getTime())) {
        console.log('MeetingDetails: Invalid date, returning fallback');
        return `${date || 'Unknown date'} at ${time || 'unknown time'}`;
      }
      
      console.log('MeetingDetails: Valid date created:', meetingDate);
      
      return meetingDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (error) {
      console.error('MeetingDetails: Error formatting date:', error);
      return `${date || 'Unknown date'} at ${time || 'unknown time'}`;
    }
  };

  const getSourceIcon = (source) => {
    return source === 'google' ? '🌐' : '📱';
  };

  const getSourceColor = (source) => {
    return source === 'google' ? '#4285f4' : '#3b82f6';
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? '#fff' : '#333'} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meeting Details</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Meeting Title Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.titleContainer}>
              <Text style={styles.meetingTitle}>{meeting.title}</Text>
              <View style={styles.sourceContainer}>
                <Text style={styles.sourceIcon}>{getSourceIcon(meeting.source)}</Text>
                <Chip
                  mode="outlined"
                  textStyle={{ fontSize: 12 }}
                  style={[styles.sourceChip, { borderColor: getSourceColor(meeting.source) }]}
                >
                  {meeting.source === 'google' ? 'Google Calendar' : 'Local Meeting'}
                </Chip>
              </View>
            </View>
          </Card.Content>
        </Card>

        {/* Meeting Details Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="event" size={24} color="#3b82f6" />
              <Text style={styles.cardTitle}>Meeting Details</Text>
            </View>
            
            <View style={styles.detailRow}>
              <MaterialIcons name="schedule" size={20} color="#6b7280" />
              <Text style={styles.detailLabel}>Date & Time:</Text>
              <Text style={styles.detailValue}>
                {formatDate(meeting.date, meeting.time)}
              </Text>
            </View>
            
            {/* Debug info - remove this later */}
            {__DEV__ && (
              <View style={styles.detailRow}>
                <MaterialIcons name="bug-report" size={20} color="#6b7280" />
                <Text style={styles.detailLabel}>Debug:</Text>
                <Text style={styles.detailValue}>
                  Date: {JSON.stringify(meeting.date)} | Time: {JSON.stringify(meeting.time)}
                </Text>
              </View>
            )}

            {meeting.duration && (
              <View style={styles.detailRow}>
                <MaterialIcons name="timer" size={20} color="#6b7280" />
                <Text style={styles.detailLabel}>Duration:</Text>
                <Text style={styles.detailValue}>{meeting.duration} minutes</Text>
              </View>
            )}

                         {meeting.location && (
               <View style={styles.detailRow}>
                 <MaterialIcons name="location-on" size={20} color="#6b7280" />
                 <Text style={styles.detailLabel}>Location:</Text>
                 <Text style={styles.detailValue}>
                   {typeof meeting.location === 'string' 
                     ? meeting.location 
                     : (meeting.location && typeof meeting.location === 'object' && meeting.location.address)
                     ? safeStringify(meeting.location.address)
                     : 'No address specified'
                   }
                 </Text>
               </View>
             )}

            {meeting.description && (
              <View style={styles.detailRow}>
                <MaterialIcons name="description" size={20} color="#6b7280" />
                <Text style={styles.detailLabel}>Description:</Text>
                <Text style={styles.detailValue}>{meeting.description}</Text>
              </View>
            )}
          </Card.Content>
        </Card>

        {/* Participants Card */}
        {meeting.participants?.length > 0 && (
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.cardHeader}>
                <MaterialIcons name="people" size={24} color="#3b82f6" />
                <Text style={styles.cardTitle}>Participants</Text>
              </View>
              
              {meeting.participants.map((participant, index) => (
                <View key={index} style={styles.participantRow}>
                  <MaterialIcons name="person" size={16} color="#6b7280" />
                  <Text style={styles.participantText}>
                    {participant.name || 'Unknown'} {participant.email && `(${participant.email})`}
                  </Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        {/* Actions Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="settings" size={24} color="#3b82f6" />
              <Text style={styles.cardTitle}>Actions</Text>
            </View>
            
            <View style={styles.actionButtons}>
              {meeting.source === 'local' && (
                <Button
                  mode="outlined"
                  onPress={handleEditMeeting}
                  style={styles.actionButton}
                  labelStyle={styles.actionButtonText}
                  icon="pencil"
                >
                  Edit Meeting
                </Button>
              )}
              
              <Button
                mode="outlined"
                onPress={handleDeleteMeeting}
                style={[styles.actionButton, styles.deleteButton]}
                labelStyle={[styles.actionButtonText, styles.deleteButtonText]}
                icon="delete"
              >
                Delete Meeting
              </Button>
            </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 8,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  card: {
    marginBottom: 16,
    borderRadius: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? '#2d2d2d' : '#fff',
  },
  titleContainer: {
    marginBottom: 8,
  },
  meetingTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
    marginBottom: 8,
  },
  sourceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  sourceChip: {
    height: 30,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: isDarkMode ? '#fff' : '#333',
    marginLeft: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    marginLeft: 8,
    marginRight: 8,
    minWidth: 80,
  },
  detailValue: {
    fontSize: 16,
    color: isDarkMode ? '#fff' : '#333',
    flex: 1,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  participantText: {
    fontSize: 14,
    color: isDarkMode ? '#fff' : '#333',
    marginLeft: 8,
  },
  actionButtons: {
    gap: 12,
  },
  actionButton: {
    borderColor: '#3b82f6',
  },
  actionButtonText: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    borderColor: '#ef4444',
  },
  deleteButtonText: {
    color: '#ef4444',
  },
});
