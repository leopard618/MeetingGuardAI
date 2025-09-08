import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  IconButton,
  Chip,
  Searchbar,
  FAB,
  Menu,
  Divider,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { Meeting } from '@/api/entities';
import { safeStringify } from '@/utils';
import { localStorageAPI } from '@/api/localStorage';
import googleCalendarService from '../api/googleCalendar.js';
import calendarSyncManager from '../api/calendarSyncManager.js';

export default function TotalMeetings({ navigation }) {
  const { isDarkMode } = useTheme();
  
  // State
  const [meetings, setMeetings] = useState([]);
  const [filteredMeetings, setFilteredMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all'); // all, upcoming, past, today
  const [menuVisible, setMenuVisible] = useState({});

  const styles = getStyles(isDarkMode);

  useEffect(() => {
    loadMeetings();
  }, []);

  useEffect(() => {
    filterMeetings();
  }, [meetings, searchQuery, selectedFilter]);

  const loadMeetings = async () => {
    try {
      setIsLoading(true);
      console.log('=== STARTING MEETINGS LOAD ===');
      
      // Load local meetings
      let localMeetings = [];
      try {
        localMeetings = await Meeting.list();
        console.log('✅ Loaded local meetings:', localMeetings.length);
        if (localMeetings.length > 0) {
          console.log('Local meetings sample:', localMeetings[0]);
        }
      } catch (error) {
        console.error('❌ Error loading local meetings:', error);
        localMeetings = [];
      }
      
      // Load Google Calendar meetings
      let googleMeetings = [];
      try {
        console.log('🔄 Initializing Google Calendar service...');
        const initResult = await googleCalendarService.initialize();
        console.log('Google Calendar initialization result:', initResult);
        
        const hasAccess = await googleCalendarService.checkCalendarAccess();
        console.log('Google Calendar access check result:', hasAccess);
        
        if (hasAccess) {
          console.log('✅ Google Calendar access confirmed, fetching meetings...');
          
          // Fetch upcoming meetings (next 30 days)
          console.log('🔄 Fetching upcoming meetings...');
          const upcomingMeetings = await googleCalendarService.getUpcomingMeetings(30);
          console.log('✅ Fetched upcoming meetings:', upcomingMeetings.length);
          if (upcomingMeetings.length > 0) {
            console.log('Upcoming meetings sample:', upcomingMeetings[0]);
          }
          
          // Fetch today's meetings
          console.log('🔄 Fetching today meetings...');
          const todayMeetings = await googleCalendarService.getTodayMeetings();
          console.log('✅ Fetched today meetings:', todayMeetings.length);
          if (todayMeetings.length > 0) {
            console.log('Today meetings sample:', todayMeetings[0]);
          }
          
          // Combine and remove duplicates based on Google Calendar ID
          const allGoogleMeetings = [...upcomingMeetings, ...todayMeetings];
          console.log('Total Google meetings before deduplication:', allGoogleMeetings.length);
          
          const uniqueGoogleMeetings = allGoogleMeetings.filter((meeting, index, self) => 
            index === self.findIndex(m => m.id === meeting.id)
          );
          
          googleMeetings = uniqueGoogleMeetings;
          console.log('✅ Total unique Google meetings:', googleMeetings.length);
        } else {
          console.log('❌ Google Calendar access not available');
          googleMeetings = [];
        }
      } catch (error) {
        console.error('❌ Error loading Google Calendar meetings:', error);
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
        googleMeetings = [];
      }

      // Combine and sort meetings, ensuring unique IDs
      const allMeetings = [];
      
      // Add local meetings with source identifier
      localMeetings.forEach((meeting, index) => {
        allMeetings.push({
          ...meeting,
          source: 'local',
          uniqueId: `local-${meeting.id || `meeting-${index}`}`
        });
      });
      
      // Add Google meetings with source identifier
      googleMeetings.forEach((meeting, index) => {
        allMeetings.push({
          ...meeting,
          source: 'google',
          uniqueId: `google-${meeting.id || `event-${index}`}`
        });
      });
      
      // Sort by date and time
      allMeetings.sort((a, b) => {
        try {
          const dateA = new Date(a.date + ' ' + (a.time || '00:00'));
          const dateB = new Date(b.date + ' ' + (b.time || '00:00'));
          return dateA - dateB;
        } catch (error) {
          console.warn('Error sorting meetings:', error);
          return 0;
        }
      });

      console.log('=== MEETINGS LOAD SUMMARY ===');
      console.log('Total meetings loaded:', allMeetings.length);
      console.log('Meetings breakdown:', {
        local: localMeetings.length,
        google: googleMeetings.length,
        total: allMeetings.length
      });
      
      if (allMeetings.length === 0) {
        console.log('⚠️ No meetings found. This could be because:');
        console.log('1. No local meetings exist');
        console.log('2. Google Calendar is not connected');
        console.log('3. Google Calendar has no events in the specified time range');
        console.log('4. There are authentication issues');
      }
      
      setMeetings(allMeetings);
    } catch (error) {
      console.error('❌ Error loading meetings:', error);
      Alert.alert('Error', 'Failed to load meetings: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const filterMeetings = () => {
    let filtered = meetings;

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(meeting =>
        meeting.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        meeting.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        meeting.location?.address?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply date filter
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    switch (selectedFilter) {
      case 'today':
        filtered = filtered.filter(meeting => {
          const meetingDate = new Date(meeting.date);
          return meetingDate.getTime() === today.getTime();
        });
        break;
      case 'upcoming':
        filtered = filtered.filter(meeting => {
          const meetingDate = new Date(meeting.date + ' ' + meeting.time);
          return meetingDate > now;
        });
        break;
      case 'past':
        filtered = filtered.filter(meeting => {
          const meetingDate = new Date(meeting.date + ' ' + meeting.time);
          return meetingDate < now;
        });
        break;
      default:
        break;
    }

    setFilteredMeetings(filtered);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMeetings();
    setRefreshing(false);
  };

  const handleDeleteMeeting = async (meeting) => {
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
              } else {
                // For Google Calendar meetings, we can't delete them from the app
                Alert.alert('Info', 'Google Calendar meetings can only be deleted from Google Calendar');
                return;
              }
              
              await loadMeetings();
              Alert.alert('Success', 'Meeting deleted successfully');
            } catch (error) {
              console.error('Error deleting meeting:', error);
              Alert.alert('Error', 'Failed to delete meeting');
            }
          }
        }
      ]
    );
  };

  const handleViewMeeting = (meeting) => {
    navigation.navigate('MeetingDetails', { meeting });
  };

  const handleEditMeeting = (meeting) => {
    if (meeting.source === 'local') {
      navigation.navigate('EditMeeting', { meeting });
    } else {
      Alert.alert('Info', 'Google Calendar meetings can only be edited from Google Calendar');
    }
  };

  const handleClearAllMeetings = () => {
    Alert.alert(
      'Clear All Meetings',
      'Are you sure you want to delete ALL meetings from your storage? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await localStorageAPI.clearAllMeetings();
              if (success) {
                Alert.alert('Success', 'All meetings have been cleared from storage');
                await loadMeetings(); // Reload the meetings list
              } else {
                Alert.alert('Error', 'Failed to clear meetings');
              }
            } catch (error) {
              console.error('Error clearing meetings:', error);
              Alert.alert('Error', 'Failed to clear meetings: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const handleDebugGoogleCalendar = async () => {
    try {
      console.log('=== DEBUGGING GOOGLE CALENDAR ===');
      
      // Test 1: Check if we have access token
      const accessToken = await googleCalendarService.getAccessToken();
      console.log('Access token exists:', !!accessToken);
      
      // Test 2: Check calendar access
      const hasAccess = await googleCalendarService.checkCalendarAccess();
      console.log('Calendar access:', hasAccess);
      
      // Test 3: Try to get calendars
      const calendars = await googleCalendarService.getCalendars();
      console.log('Available calendars:', calendars.length);
      if (calendars.length > 0) {
        console.log('Primary calendar:', calendars.find(c => c.primary));
      }
      
      // Test 4: Try to get events
      const events = await googleCalendarService.getEvents();
      console.log('Total events found:', events.length);
      if (events.length > 0) {
        console.log('Sample event:', events[0]);
      }
      
      // Test 5: Try to get upcoming meetings
      const upcoming = await googleCalendarService.getUpcomingMeetings(7);
      console.log('Upcoming meetings (7 days):', upcoming.length);
      
      // Test 6: Try to get today's meetings
      const today = await googleCalendarService.getTodayMeetings();
      console.log('Today meetings:', today.length);
      
      Alert.alert(
        'Google Calendar Debug',
        `Access Token: ${!!accessToken}\n` +
        `Calendar Access: ${hasAccess}\n` +
        `Calendars: ${calendars.length}\n` +
        `Total Events: ${events.length}\n` +
        `Upcoming (7 days): ${upcoming.length}\n` +
        `Today: ${today.length}\n\n` +
        `Check console for detailed logs.`
      );
    } catch (error) {
      console.error('Debug error:', error);
      Alert.alert('Debug Error', error.message);
    }
  };

  const getMeetingStatus = (meeting) => {
    const now = new Date();
    const meetingDate = new Date(meeting.date + ' ' + meeting.time);
    const diff = meetingDate - now;
    
    if (diff < 0) {
      return { status: 'past', color: '#6b7280', text: 'Past' };
    } else if (diff < 24 * 60 * 60 * 1000) {
      return { status: 'today', color: '#ef4444', text: 'Today' };
    } else if (diff < 7 * 24 * 60 * 60 * 1000) {
      return { status: 'upcoming', color: '#f59e0b', text: 'This Week' };
    } else {
      return { status: 'future', color: '#10b981', text: 'Upcoming' };
    }
  };

  const formatDate = (date, time) => {
    const meetingDate = new Date(date + ' ' + time);
    return meetingDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getSourceIcon = (source) => {
    return source === 'google' ? '🌐' : '📱';
  };

  const getSourceColor = (source) => {
    return source === 'google' ? '#4285f4' : '#3b82f6';
  };

  const renderMeetingCard = (meeting, index) => {
    const status = getMeetingStatus(meeting);
    const sourceIcon = getSourceIcon(meeting.source);
    const sourceColor = getSourceColor(meeting.source);
    
    // Use uniqueId for the key to prevent duplicate key errors
    const uniqueKey = meeting.uniqueId || `${meeting.source}-${meeting.id}-${index}`;

    return (
      <Card key={uniqueKey} style={styles.meetingCard}>
        <Card.Content>
          <View style={styles.cardHeader}>
            <View style={styles.titleContainer}>
              <Text style={styles.meetingTitle} numberOfLines={2}>
                {meeting.title}
              </Text>
              <View style={styles.sourceContainer}>
                <Text style={styles.sourceIcon}>{sourceIcon}</Text>
                <Chip
                  mode="outlined"
                  textStyle={{ fontSize: 10 }}
                  style={[styles.sourceChip, { borderColor: sourceColor }]}
                >
                  {meeting.source === 'google' ? 'Google' : 'Local'}
                </Chip>
              </View>
            </View>
                         <Menu
               visible={menuVisible[uniqueKey]}
               onDismiss={() => setMenuVisible({ ...menuVisible, [uniqueKey]: false })}
               anchor={
                 <IconButton
                   icon="dots-vertical"
                   onPress={() => setMenuVisible({ ...menuVisible, [uniqueKey]: true })}
                 />
               }
             >
               <Menu.Item
                 onPress={() => {
                   setMenuVisible({ ...menuVisible, [uniqueKey]: false });
                   handleViewMeeting(meeting);
                 }}
                 title="View Details"
                 leadingIcon="eye"
               />
               {meeting.source === 'local' && (
                 <Menu.Item
                   onPress={() => {
                     setMenuVisible({ ...menuVisible, [uniqueKey]: false });
                     handleEditMeeting(meeting);
                   }}
                   title="Edit Meeting"
                   leadingIcon="pencil"
                 />
               )}
               <Divider />
               <Menu.Item
                 onPress={() => {
                   setMenuVisible({ ...menuVisible, [uniqueKey]: false });
                   handleDeleteMeeting(meeting);
                 }}
                 title="Delete Meeting"
                 leadingIcon="delete"
                 titleStyle={{ color: '#ef4444' }}
               />
             </Menu>
          </View>

          <View style={styles.meetingInfo}>
            <View style={styles.infoRow}>
              <MaterialIcons name="schedule" size={16} color="#6b7280" />
              <Text style={styles.infoText}>{formatDate(meeting.date, meeting.time)}</Text>
            </View>
            
            {meeting.location?.address && (
              <View style={styles.infoRow}>
                <MaterialIcons name="location-on" size={16} color="#6b7280" />
                <Text style={styles.infoText} numberOfLines={1}>
                  {safeStringify(meeting.location.address)}
                </Text>
              </View>
            )}

            {meeting.duration && (
              <View style={styles.infoRow}>
                <MaterialIcons name="timer" size={16} color="#6b7280" />
                <Text style={styles.infoText}>{meeting.duration} minutes</Text>
              </View>
            )}

            {meeting.participants?.length > 0 && (
              <View style={styles.infoRow}>
                <MaterialIcons name="people" size={16} color="#6b7280" />
                <Text style={styles.infoText}>
                  {meeting.participants.length} participant{meeting.participants.length !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.cardFooter}>
            <Chip
              mode="outlined"
              textStyle={{ fontSize: 10, color: status.color }}
              style={[styles.statusChip, { borderColor: status.color }]}
            >
              {status.text}
            </Chip>
            
            <Button
              mode="outlined"
              onPress={() => handleViewMeeting(meeting)}
              style={styles.viewButton}
              labelStyle={styles.viewButtonText}
              icon="eye"
            >
              View
            </Button>
          </View>
        </Card.Content>
      </Card>
    );
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
         <Text style={styles.headerTitle}>Total Meetings</Text>
         <View style={styles.headerButtons}>
           <TouchableOpacity 
             style={styles.debugButton}
             onPress={handleDebugGoogleCalendar}
           >
             <MaterialIcons name="bug-report" size={20} color="#3b82f6" />
           </TouchableOpacity>
           <TouchableOpacity 
             style={styles.clearButton}
             onPress={handleClearAllMeetings}
           >
             <MaterialIcons name="delete-sweep" size={20} color="#ef4444" />
           </TouchableOpacity>
         </View>
       </View>

      <Searchbar
        placeholder="Search meetings..."
        onChangeText={setSearchQuery}
        value={searchQuery}
        style={styles.searchbar}
        iconColor={isDarkMode ? '#9ca3af' : '#6b7280'}
      />

      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {[
          { key: 'all', label: 'All', icon: 'list' },
          { key: 'today', label: 'Today', icon: 'today' },
          { key: 'upcoming', label: 'Upcoming', icon: 'schedule' },
          { key: 'past', label: 'Past', icon: 'history' },
        ].map((filter) => (
          <TouchableOpacity
            key={filter.key}
            style={[
              styles.filterButton,
              selectedFilter === filter.key && styles.filterButtonActive
            ]}
            onPress={() => setSelectedFilter(filter.key)}
          >
            <MaterialIcons 
              name={filter.icon} 
              size={16} 
              color={selectedFilter === filter.key ? '#fff' : (isDarkMode ? '#9ca3af' : '#6b7280')} 
            />
            <Text style={[
              styles.filterText,
              selectedFilter === filter.key && styles.filterTextActive
            ]}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading meetings...</Text>
          </View>
        ) : filteredMeetings.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="event-busy" size={64} color="#9ca3af" />
            <Text style={styles.emptyTitle}>No meetings found</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? 'Try adjusting your search' : 'Create your first meeting to get started'}
            </Text>
          </View>
        ) : (
          <View style={styles.meetingsContainer}>
            {filteredMeetings.map((meeting, index) => {
              return renderMeetingCard(meeting, index);
            })}
          </View>
        )}
      </ScrollView>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('CreateMeeting')}
        label="New Meeting"
      />
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  debugButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: isDarkMode ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.1)',
    marginRight: 8,
  },
  clearButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: isDarkMode ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.1)',
  },
  searchbar: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: isDarkMode ? '#2d2d2d' : '#fff',
  },
  filterContainer: {
    width: '100%',
    maxHeight:38
  },
  filterContent: {
    flexDirection:"row",
    justifyContent:"center",
    gap:14,
    width:"100%",
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    height:30,
    marginRight: 6,
    borderRadius: 16,
    backgroundColor: isDarkMode ? '#2d2d2d' : '#fff',
    borderWidth: 1,
    borderColor: isDarkMode ? '#404040' : '#e5e7eb',
    minWidth: 60,
    justifyContent: 'center',
  },
  filterButtonActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  filterText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '500',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  filterTextActive: {
    color: '#fff',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 16,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: isDarkMode ? '#fff' : '#333',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    textAlign: 'center',
    marginTop: 8,
  },
  meetingsContainer: {
    paddingBottom: 80,
  },
  meetingCard: {
    marginBottom: 16,
    borderRadius: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? '#2d2d2d' : '#fff',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  titleContainer: {
    flex: 1,
    marginRight: 8,
  },
  meetingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: isDarkMode ? '#fff' : '#333',
    marginBottom: 4,
  },
  sourceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  sourceChip: {
    height: 30,
  },
  meetingInfo: {
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoText: {
    marginLeft: 8,
    fontSize: 14,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusChip: {
    height: 30,
  },
  viewButton: {
    borderColor: '#3b82f6',
  },
  viewButtonText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: '#3b82f6',
  },
});
