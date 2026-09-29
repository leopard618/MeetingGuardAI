import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { useTheme } from '../contexts/ThemeContext';
import { Meeting } from '../api/entities';
import { safeStringify } from '../utils/index.ts';
import { localStorageAPI } from '../api/localStorage';
import calendarSyncManager from '../api/calendarSyncManager.js';
import { useTranslation } from '../components/translations.jsx';
import { useT } from '../i18n';
import { useFormatters } from '../screens/shared/useFormatters';
import { 
  getResponsiveFontSizes, 
  getResponsiveSpacing, 
  getResponsiveIconSizes, 
  getResponsiveCardDimensions,
  getResponsiveButtonDimensions,
  getDeviceType 
} from '../utils/responsive.js';

export default function TotalMeetings({ navigation, language = 'en' }) {
  const { isDarkMode } = useTheme();
  const { t } = useTranslation(language);
  const tr = useT();
  const fmt = useFormatters();
  
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

  // Every meeting (MeetingGuard, Google Calendar and device-calendar imports) comes from the data
  // layer; the view's `sourceKey` says where it came from. Nothing is relabeled here.
  const loadMeetings = async () => {
    try {
      setIsLoading(true);
      const allMeetings = (await Meeting.list()).map((meeting, index) => ({
        ...meeting,
        uniqueId: `${meeting.sourceKey || 'meeting'}-${meeting.id || index}`,
      }));
      allMeetings.sort((a, b) => Date.parse(a.startTime || 0) - Date.parse(b.startTime || 0));
      setMeetings(allMeetings);
    } catch (error) {
      console.error('Error loading meetings:', error?.code || error?.name);
      Alert.alert(tr('common:errors.unknown'));
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

    // Apply date filter (the view's `date` is the local calendar date; `startTime` the UTC instant)
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    switch (selectedFilter) {
      case 'today':
        filtered = filtered.filter(meeting => meeting.date === todayKey);
        break;
      case 'upcoming':
        filtered = filtered.filter(meeting => Date.parse(meeting.startTime) > now.getTime());
        break;
      case 'past':
        filtered = filtered.filter(meeting => Date.parse(meeting.startTime) < now.getTime());
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

  // Every meeting can be deleted: MeetingGuard and Google meetings are also removed from Google
  // Calendar by the calendar engine; a device-calendar import stays in the device calendar.
  const handleDeleteMeeting = async (meeting) => {
    const isDevice = meeting.sourceKey === 'device';
    const isGoogle = meeting.sourceKey === 'google' || Boolean(meeting.googleEventId);
    Alert.alert(
      tr('meetings:details.deleteTitle', { title: meeting.title }),
      isDevice
        ? tr('meetings:details.deleteMessageDevice')
        : isGoogle
          ? tr('meetings:details.deleteMessageGoogle')
          : tr('meetings:details.deleteMessage'),
      [
        { text: tr('common:actions.cancel'), style: 'cancel' },
        {
          text: tr('meetings:details.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await Meeting.delete(meeting.id);
              await loadMeetings();
              Alert.alert(tr('meetings:details.deleted'), isDevice ? tr('meetings:details.deletedDeviceNote') : undefined);
            } catch (error) {
              console.error('Error deleting meeting:', error?.code || error?.name);
              Alert.alert(tr(`common:errors.${error?.code || 'unknown'}`, { defaultValue: tr('common:errors.unknown') }));
            }
          }
        }
      ]
    );
  };

  const handleViewMeeting = (meeting) => {
    navigation.navigate('MeetingDetails', { meetingId: meeting.id });
  };

  const handleEditMeeting = (meeting) => {
    navigation.navigate('EditMeeting', { meetingId: meeting.id });
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

  const getMeetingStatus = (meeting) => {
    const diff = Date.parse(meeting.startTime) - Date.now();
    
    if (diff < 0) {
      return { status: 'past', color: '#6b7280', text: t('totalMeetings.past') };
    } else if (diff < 24 * 60 * 60 * 1000) {
      return { status: 'today', color: '#ef4444', text: t('totalMeetings.today') };
    } else if (diff < 7 * 24 * 60 * 60 * 1000) {
      return { status: 'upcoming', color: '#f59e0b', text: t('totalMeetings.thisWeek') };
    } else {
      return { status: 'future', color: '#10b981', text: t('totalMeetings.upcoming') };
    }
  };

  // Locale-aware (UI language + the 12 h / 24 h preference).
  const formatDate = (meeting) => fmt.legacyMeetingWhen(meeting);

  const getSourceIcon = (sourceKey) => {
    return sourceKey === 'google' ? '🌐' : sourceKey === 'device' ? '📅' : '📱';
  };

  const getSourceColor = (sourceKey) => {
    return sourceKey === 'google' ? '#4285f4' : '#3b82f6';
  };

  const renderMeetingCard = (meeting, index) => {
    const status = getMeetingStatus(meeting);
    const sourceIcon = getSourceIcon(meeting.sourceKey);
    const sourceColor = getSourceColor(meeting.sourceKey);

    // Use uniqueId for the key to prevent duplicate key errors
    const uniqueKey = meeting.uniqueId || `${meeting.sourceKey}-${meeting.id}-${index}`;

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
                  {tr(`meetings:source.${meeting.sourceKey || 'manual'}`)}
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
                 title={t('totalMeetings.view')}
                 leadingIcon="eye"
               />
               <Menu.Item
                 onPress={() => {
                   setMenuVisible({ ...menuVisible, [uniqueKey]: false });
                   handleEditMeeting(meeting);
                 }}
                 title={tr('meetings:details.edit')}
                 leadingIcon="pencil"
               />
               <Divider />
               <Menu.Item
                 onPress={() => {
                   setMenuVisible({ ...menuVisible, [uniqueKey]: false });
                   handleDeleteMeeting(meeting);
                 }}
                 title={tr('meetings:details.delete')}
                 leadingIcon="delete"
                 titleStyle={{ color: '#ef4444' }}
               />
             </Menu>
          </View>

          <View style={styles.meetingInfo}>
            <View style={styles.infoRow}>
              <MaterialIcons name="schedule" size={16} color="#6b7280" />
              <Text style={styles.infoText}>{formatDate(meeting)}</Text>
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
                <Text style={styles.infoText}>{fmt.duration(meeting.duration)}</Text>
              </View>
            )}

            {meeting.participants?.length > 0 && (
              <View style={styles.infoRow}>
                <MaterialIcons name="people" size={16} color="#6b7280" />
                <Text style={styles.infoText}>
                  {meeting.participants.length} {meeting.participants.length !== 1 ? t('totalMeetings.participants') : t('totalMeetings.participant')}
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
              {t('totalMeetings.view')}
            </Button>
          </View>
        </Card.Content>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
             <View style={styles.header}>
         <TouchableOpacity 
           style={styles.backButton}
           onPress={() => navigation.goBack()}
         >
           <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? '#fff' : '#333'} />
         </TouchableOpacity>
         <Text style={styles.headerTitle}>{t('totalMeetings.title')}</Text>
         <View style={styles.headerButtons}>
           <TouchableOpacity 
             style={styles.clearButton}
             onPress={handleClearAllMeetings}
           >
             <MaterialIcons name="delete-sweep" size={20} color="#ef4444" />
           </TouchableOpacity>
         </View>
       </View>

      <Searchbar
        placeholder={t('totalMeetings.searchPlaceholder')}
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
          { key: 'all', label: t('totalMeetings.all'), icon: 'list' },
          { key: 'today', label: t('totalMeetings.today'), icon: 'today' },
          { key: 'upcoming', label: t('totalMeetings.upcoming'), icon: 'schedule' },
          { key: 'past', label: t('totalMeetings.past'), icon: 'history' },
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
            <Text style={styles.loadingText}>{t('totalMeetings.loadingMeetings')}</Text>
          </View>
        ) : filteredMeetings.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="event-busy" size={64} color="#9ca3af" />
            <Text style={styles.emptyTitle}>{t('totalMeetings.noMeetingsFound')}</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? t('totalMeetings.tryAdjustingSearch') : t('totalMeetings.createFirstMeeting')}
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
        label={t('totalMeetings.newMeeting')}
      />
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => {
  const fonts = getResponsiveFontSizes();
  const spacing = getResponsiveSpacing();
  const icons = getResponsiveIconSizes();
  const cards = getResponsiveCardDimensions();
  const buttons = getResponsiveButtonDimensions();
  const deviceType = getDeviceType();
  
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backButton: {
    padding: spacing.sm,
    borderRadius: 20,
    backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
  },
  headerTitle: {
    fontSize: fonts['3xl'],
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
  },
  placeholder: {
    width: spacing['4xl'],
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clearButton: {
    padding: spacing.sm,
    borderRadius: 20,
    backgroundColor: isDarkMode ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.1)',
  },
  searchbar: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    height: buttons.minHeight * 0.7,
    marginRight: spacing.xs,
    borderRadius: cards.borderRadius,
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
    marginLeft: spacing.xs,
    fontSize: fonts.xs,
    fontWeight: '500',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  filterTextActive: {
    color: '#fff',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing['4xl'],
  },
  loadingText: {
    fontSize: fonts.md,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing['4xl'],
  },
  emptyTitle: {
    fontSize: fonts.lg,
    fontWeight: '600',
    color: isDarkMode ? '#fff' : '#333',
    marginTop: spacing.lg,
  },
  emptyText: {
    fontSize: fonts.sm,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  meetingsContainer: {
    paddingBottom: 80,
  },
  meetingCard: {
    marginBottom: spacing.lg,
    borderRadius: cards.borderRadius,
    elevation: 4,
    backgroundColor: isDarkMode ? '#2d2d2d' : '#fff',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  titleContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  meetingTitle: {
    fontSize: fonts.lg,
    fontWeight: '600',
    color: isDarkMode ? '#fff' : '#333',
    marginBottom: spacing.xs,
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
    fontSize: fonts.xs,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    margin: spacing.lg,
    right: 0,
    bottom: 0,
    backgroundColor: '#3b82f6',
  },
  });
};
