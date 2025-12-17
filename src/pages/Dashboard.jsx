import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
  Alert,
  Image,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  Card,
  Title,
  Paragraph,
  Button,
  FAB,
  ActivityIndicator,
} from "react-native-paper";
import {
  MaterialIcons,
  MaterialCommunityIcons,
  Ionicons,
} from "@expo/vector-icons";
import { useFocusEffect } from '@react-navigation/native';
import { Meeting, UserPreferences, User } from '../api/entities';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import NotificationManager from '../components/NotificationSystem/NotificationManager';
import AlertScheduler from '../components/AlertScheduler';
import ImageSlider from '../components/ImageSlider';
import calendarSyncManager from '../api/calendarSyncManager.js';
import { useTranslation } from '../components/translations.jsx';
import { 
  getResponsiveFontSizes, 
  getResponsiveSpacing, 
  getResponsiveIconSizes, 
  getResponsiveCardDimensions,
  getResponsiveButtonDimensions,
  getDeviceType 
} from '../utils/responsive.js';
import { getLocationString, safeStringify } from '../utils/meetingHelpers.js';
import GoogleCalendarConnectionPrompt from '../components/GoogleCalendarConnectionPrompt.jsx';
import manualLoginGoogleCalendarService from '../api/manualLoginGoogleCalendarService.js';
import { usePersistentNotification } from '../hooks/usePersistentNotification.js';

// Date and Time Display Component
const DateTimeDisplay = ({ isDarkMode, styles }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatDate = (date) => {
    const options = { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    };
    return date.toLocaleDateString('en-US', options);
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  return (
    <TouchableOpacity style={styles.statusCard}>
      <View style={[styles.dateTimeContainer, { backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff' }]}>
        <View style={styles.dateTimeContent}>
          <View style={styles.timeSection}>
            <MaterialIcons 
              name="schedule" 
              size={20} 
              color={isDarkMode ? "#3b82f6" : "#3b82f6"} 
            />
            <Text style={[styles.timeText, { color: isDarkMode ? "#ffffff" : "#1e293b" }]}>
              {formatTime(currentTime)}
            </Text>
          </View>
          <View style={styles.dateSection}>
            <MaterialIcons 
              name="event" 
              size={16} 
              color={isDarkMode ? "#a1a1aa" : "#64748b"} 
            />
            <Text style={[styles.dateText, { color: isDarkMode ? "#a1a1aa" : "#64748b" }]}>
              {formatDate(currentTime)}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default function Dashboard({ navigation, language = "en" }) {
  const { isDarkMode } = useTheme();
  const { isAuthenticated, refreshUserPlan, user } = useAuth();
  const { t } = useTranslation(language);
  
  // Debug: Log the language and translation
  console.log('Dashboard language:', language);
  console.log('Dashboard translation for today:', t('dashboard.today'));
  
  // Early return if not authenticated - this prevents the component from rendering
  // and causing the "No authenticated user found" error
  if (!isAuthenticated || !user) {
    console.log('Dashboard: User not authenticated, not rendering component');
    return null;
  }
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userPreferences, setUserPreferences] = useState(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [showGoogleCalendarPrompt, setShowGoogleCalendarPrompt] = useState(false);
  const [isManualLoginUser, setIsManualLoginUser] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);

  useEffect(() => {
    loadInitialData();
    checkUserLoginType();
  }, []);

  // Check if user is a manual login user (no Google ID)
  const checkUserLoginType = async () => {
    try {
      if (user) {
        // Check if user has Google ID (indicates Google login)
        const hasGoogleId = user.google_id || user.id?.includes('google') || user.picture?.includes('googleusercontent');
        const isManual = !hasGoogleId;
        
        console.log('Dashboard: User login type check:', {
          hasGoogleId,
          isManual,
          userEmail: user.email
        });
        
        setIsManualLoginUser(isManual);
        
        // Show Google Calendar prompt for manual login users
        if (isManual) {
          const isConnected = await manualLoginGoogleCalendarService.isConnected();
          if (!isConnected) {
            // Show prompt after a short delay to let the dashboard load
            setTimeout(() => {
              setShowGoogleCalendarPrompt(true);
            }, 2000);
          }
        }
      }
    } catch (error) {
      console.error('Dashboard: Error checking user login type:', error);
    }
  };

  // Refresh data when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadInitialData();
    });

    return unsubscribe;
  }, [navigation]);

  // Only refresh user plan when returning from payment (minimal calls)
  useFocusEffect(
    React.useCallback(() => {
      console.log('=== DASHBOARD: PAGE FOCUSED ===');
      // Only refresh occasionally to avoid 429 errors
      if (isAuthenticated) {
        // Use a longer delay and only refresh occasionally
        const shouldRefresh = Math.random() < 0.3; // 30% chance to refresh
        if (shouldRefresh) {
          console.log('🔄 Refreshing user plan on page focus (occasional)');
          setTimeout(() => {
            refreshUserPlan(2000); // 2 second delay
          }, 1000);
        } else {
          console.log('⏭️ Skipping plan refresh to avoid 429 errors');
        }
      }
    }, [isAuthenticated, refreshUserPlan])
  );

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      // Check authentication state first
      if (!isAuthenticated || !user) {
        console.log('User not authenticated, skipping data load');
        setIsLoading(false);
        return;
      }
      const currentUser = user;

      const [allMeetings, prefsList] = await Promise.all([
        Meeting.list("-created_date"),
        UserPreferences.filter({ created_by: currentUser.email })
      ]);

      setMeetings(allMeetings);

      if (prefsList.length > 0) {
        // Preferences loaded successfully

        // If we have multiple preference records, use the one with alert_intensity
        let bestPrefs = prefsList[0];
        if (prefsList.length > 1) {
          const prefsWithIntensity = prefsList.find(p => p.alert_intensity);
          if (prefsWithIntensity) {
            bestPrefs = prefsWithIntensity;
            // Using preferences with alert intensity
          }
        }

        setUserPreferences(bestPrefs);
        setAlertsEnabled(bestPrefs.alert_enabled);

        // Clean up duplicate preference records if they exist
        if (prefsList.length > 1) {
          console.log('Found multiple preference records, cleaning up...');
          const recordsToDelete = prefsList.filter(p => p.id !== bestPrefs.id);
          for (const record of recordsToDelete) {
            try {
              await UserPreferences.delete(record.id);
              console.log('Deleted duplicate preference record:', record.id);
            } catch (error) {
              console.log('Error deleting duplicate record:', error);
            }
          }
        }
      } else {
        // Creating new preferences for user
        const newPrefs = await UserPreferences.create({
          created_by: currentUser.email,
          language: language,
          alert_enabled: true,
          alert_intensity: 'maximum', // Add default alert intensity
        });
        setUserPreferences(newPrefs);
        setAlertsEnabled(newPrefs.alert_enabled);
      }
    } catch (error) {
      console.error("Error loading initial data:", error);
      Alert.alert("Error", "Failed to load data");
    }
    setIsLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInitialData();
    setRefreshing(false);
  };

  const getTodaysMeetings = () => {
    // Use local timezone to avoid date shifting
    const todayDate = new Date();
    const year = todayDate.getFullYear();
    const month = String(todayDate.getMonth() + 1).padStart(2, '0');
    const day = String(todayDate.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    return meetings.filter(meeting => meeting.date === today);
  };

  const getAiAssistedCount = () => {
    return meetings.filter(m => m.source === 'ChatGPT' || m.source === 'WhatsApp').length;
  };

  const getMeetingsNeedingReview = () => {
    return meetings.filter(m => m.confidence && m.confidence < 80).length;
  };

  const handleToggleAlerts = async () => {
    if (!userPreferences) return;

    try {
      const updatedPrefs = await UserPreferences.update(userPreferences.id, {
        alert_enabled: !alertsEnabled
      });
      setUserPreferences(updatedPrefs);
      setAlertsEnabled(updatedPrefs.alert_enabled);
    } catch (error) {
      console.error("Error toggling alerts:", error);
      Alert.alert("Error", "Failed to update alert settings");
    }
  };

  const [realAlertOpen, setRealAlertOpen] = useState(false);
  const [realAlertMeeting, setRealAlertMeeting] = useState(null);
  const [realAlertType, setRealAlertType] = useState(null);
  
  // Ref for AlertScheduler to access its methods
  const alertSchedulerRef = useRef(null);

  // Handle real meeting alerts
  const handleRealMeetingAlert = (meeting, alertType, intensity) => {
    console.log('Real meeting alert triggered:', { meeting, alertType, intensity });
    setRealAlertMeeting(meeting);
    setRealAlertType(alertType);
    setRealAlertOpen(true);
  };

  const handleRealAlertClose = () => {
    setRealAlertOpen(false);
    setRealAlertMeeting(null);
    setRealAlertType(null);
  };

  const handleRealAlertSnooze = (minutes) => {
    Alert.alert('Snoozed', `Meeting alert snoozed for ${minutes} minutes`);
    setRealAlertOpen(false);
  };

  const handleRealAlertPostpone = (newDateTime) => {
    Alert.alert('Postponed', `Meeting postponed to: ${newDateTime.date} ${newDateTime.time}`);
    setRealAlertOpen(false);
  };

  // Function to handle meeting creation with alert scheduling
  const handleMeetingCreated = async (newMeeting) => {
    console.log('📅 Meeting created, scheduling alerts:', newMeeting.title);
    if (alertSchedulerRef.current) {
      await alertSchedulerRef.current.scheduleAlertsForMeeting(newMeeting);
    }
  };

  // Function to handle meeting update with alert rescheduling
  const handleMeetingUpdated = async (updatedMeeting) => {
    console.log('📅 Meeting updated, rescheduling alerts:', updatedMeeting.title);
    if (alertSchedulerRef.current) {
      // Clear old alerts and schedule new ones
      await alertSchedulerRef.current.clearAlertsForMeeting(updatedMeeting.id);
      await alertSchedulerRef.current.scheduleAlertsForMeeting(updatedMeeting);
    }
  };

  // Function to handle meeting deletion with alert cleanup
  const handleMeetingDeleted = async (meetingId) => {
    console.log('🗑️ Meeting deleted, clearing alerts for ID:', meetingId);
    if (alertSchedulerRef.current) {
      await alertSchedulerRef.current.clearAlertsForMeeting(meetingId);
    }
  };

  // Function to refresh all alerts (useful after bulk operations)
  const refreshAllAlerts = async () => {
    console.log('🔄 Refreshing all alerts...');
    if (alertSchedulerRef.current) {
      await alertSchedulerRef.current.refreshAlerts();
    }
  };

  // Set up calendar sync manager callbacks
  useEffect(() => {
    calendarSyncManager.setCallbacks({
      onMeetingCreated: handleMeetingCreated,
      onMeetingUpdated: handleMeetingUpdated,
      onMeetingDeleted: handleMeetingDeleted
    });
  }, []);

  const todaysMeetings = getTodaysMeetings();
  const aiAssistedCount = getAiAssistedCount();
  const reviewCount = getMeetingsNeedingReview();
  const styles = getStyles(isDarkMode);

  // Get next meeting for persistent notification
  const nextMeeting = React.useMemo(() => {
    const now = new Date();
    
    const upcoming = meetings
      .filter(m => {
        try {
          const meetingTime = new Date(m.startTime || `${m.date}T${m.time}`);
          const isFuture = meetingTime > now;
          return isFuture;
        } catch (error) {
          console.error('Error parsing meeting time:', error);
          return false;
        }
      })
      .sort((a, b) => {
        const timeA = new Date(a.startTime || `${a.date}T${a.time}`);
        const timeB = new Date(b.startTime || `${b.date}T${b.time}`);
        return timeA - timeB;
      });
    
    console.log('📅 Upcoming meetings found:', upcoming.length);
    if (upcoming[0]) {
      console.log('📅 Next meeting:', upcoming[0].title, 'at', new Date(upcoming[0].startTime || `${upcoming[0].date}T${upcoming[0].time}`).toISOString());
    } else {
      console.log('📅 No upcoming meetings found');
    }
    
    return upcoming[0] || null;
  }, [meetings]);

  // Use persistent notification hook
  usePersistentNotification(nextMeeting);

  const renderStatusCard = ({ title, value, icon, color, onPress, subtitle }) => (
    <TouchableOpacity onPress={onPress} style={styles.statusCard}>
      <Card style={[styles.card, { borderLeftColor: color }]}>
        <Card.Content style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
              <MaterialIcons name={icon} size={24} color={color} />
            </View>
            <Text style={styles.cardTitle}>{title}</Text>
          </View>
          <Text style={[styles.cardValue, { color: isDarkMode ? '#ffffff' : '#1e293b' }]}>{value}</Text>
          {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
        </Card.Content>
      </Card>
    </TouchableOpacity>
  );

  const renderMeetingCard = (meeting, index) => (
    <Card key={meeting.id} style={styles.meetingCard}>
      <Card.Content>
        <View style={styles.meetingHeader}>
          <View style={styles.meetingInfo}>
            <View style={styles.meetingTimeContainer}>
              <MaterialIcons name="schedule" size={16} color={isDarkMode ? "#a1a1aa" : "#666"} />
              <Text style={styles.meetingTime}>
                {meeting.time} • {meeting.duration}min
              </Text>
            </View>
            <Title style={styles.meetingTitle}>{meeting.title}</Title>
            {meeting.description && (
              <Text style={styles.meetingDescription}>
                {meeting.description}
              </Text>
            )}
          </View>
          <View style={styles.meetingActions}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: isDarkMode ? '#262626' : '#f1f5f9' }]}>
              <MaterialIcons name="edit" size={18} color={isDarkMode ? "#a1a1aa" : "#666"} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: isDarkMode ? '#262626' : '#f1f5f9' }]}>
              <MaterialIcons name="delete" size={18} color={isDarkMode ? "#ef4444" : "#dc2626"} />
            </TouchableOpacity>
          </View>
        </View>
      </Card.Content>
    </Card>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Date and Time Display */}

        {/* Stats Section */}
        <View style={styles.statsSection}>
          <View style={styles.statsContent}>
            <Text style={styles.statsTitle}>Meeting Guard</Text>
            
            {/* Image Slider for Advertising */}
            <ImageSlider 
              autoPlay={true} 
              interval={8000} 
              context="default"
            />
            
            <View style={styles.headerStats}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{todaysMeetings.length}</Text>
                <Text style={styles.statLabel}>{t('dashboard.today')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{meetings.length}</Text>
                <Text style={styles.statLabel}>{t('dashboard.total')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{aiAssistedCount}</Text>
                <Text style={styles.statLabel}>{t('dashboard.aiPowered')}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.statusGrid}>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: t('dashboard.today'),
              value: todaysMeetings.length,
              icon: "event",
              color: "#007AFF",
              onPress: () => navigation.navigate("Calendar")
            })}
            <DateTimeDisplay isDarkMode={isDarkMode} styles={styles} />
          </View>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: t('dashboard.aiAssisted'),
              value: aiAssistedCount,
              icon: "flash-on",
              color: "#FF9500",
              // subtitle: "Smart meetings"
            })}
            {renderStatusCard({
              title: t('dashboard.notesAndTasks'),
              value: "📝",
              icon: "note",
              color: "#FF3B30",
              onPress: () => navigation.navigate("Notes")
            })}

          </View>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: t('settings.smartAlerts'),
              value: alertsEnabled ? "ON" : "OFF",
              icon: alertsEnabled ? "notifications-active" : "notifications-off",
              color: alertsEnabled ? "#34C759" : "#8E8E93",
              onPress: handleToggleAlerts,
              subtitle: alertsEnabled ? t('dashboard.active') : t('dashboard.disabled')
            })}
            {renderStatusCard({
              title: t('dashboard.aiInsights'),
              value: reviewCount > 0 ? reviewCount : "✓",
              icon: "insights",
              color: reviewCount > 0 ? "#FF9500" : "#34C759",
              onPress: () => navigation.navigate("AIInsights"),
              subtitle: reviewCount > 0 ? t('dashboard.needsReview') : t('dashboard.allGood')
            })}
          </View>
        </View>

        {/* Quick Actions */}
        

      

        <View style={styles.meetingsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('dashboard.todaysMeetings')}</Text>
            <View style={styles.realTimeIndicator}>
              <MaterialIcons name="schedule" size={16} color={isDarkMode ? "#a1a1aa" : "#666"} />
              <Text style={styles.realTimeText}>{t('dashboard.realTimeUpdates')}</Text>
            </View>
          </View>

          {todaysMeetings.length > 0 ? (
            todaysMeetings.map((meeting, index) => renderMeetingCard(meeting, index))
          ) : (
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <View style={[styles.emptyIconContainer, { backgroundColor: isDarkMode ? '#262626' : '#f1f5f9' }]}>
                  <MaterialIcons name="event" size={48} color={isDarkMode ? "#71717a" : "#8E8E93"} />
                </View>
                <Title style={styles.emptyTitle}>{t('dashboard.noMeetingsToday')}</Title>
                <Text style={styles.emptyText}>
                  {t('dashboard.allCaughtUp')}
                </Text>
                <Button
                  mode="contained"
                  onPress={() => navigation.navigate("CreateMeeting", { 
                    onMeetingCreated: handleMeetingCreated 
                  })}
                  style={styles.createButton}
                  buttonColor="#3b82f6"
                >
                  {t('dashboard.createNewMeeting')}
                </Button>
              </Card.Content>
            </Card>
          )}
        </View>
      </ScrollView>

      {/* Speed Dial FAB Menu */}
      <View style={styles.fabContainer}>
        {/* Action Buttons (shown when menu is open) - Compact Diagonal */}
        {fabMenuOpen && (
          <>
            {/* Backdrop/Overlay - Must be FIRST so buttons are on top */}
            <TouchableOpacity
              style={styles.fabBackdrop}
              activeOpacity={1}
              onPress={() => setFabMenuOpen(false)}
            />

            {/* Create Meeting - Position 1 */}
            <TouchableOpacity
              style={[styles.fabAction, { 
                bottom: 0,
                right: 140,
              }]}
              onPress={() => {
                setFabMenuOpen(false);
                navigation.navigate("CreateMeeting", { 
                  onMeetingCreated: handleMeetingCreated 
                });
              }}
            >
              <MaterialIcons name="add" size={22} color="#fff" />
            </TouchableOpacity>

            {/* AI Chat - Position 2 */}
            <TouchableOpacity
              style={[styles.fabAction, { 
                bottom: 70,
                right: 120,
              }]}
              onPress={() => {
                setFabMenuOpen(false);
                navigation.navigate("AIChat");
              }}
            >
              <MaterialIcons name="chat" size={22} color="#fff" />
            </TouchableOpacity>

            {/* Calendar - Position 3 */}
            <TouchableOpacity
              style={[styles.fabAction, { 
                bottom: 120,
                right: 70,
              }]}
              onPress={() => {
                setFabMenuOpen(false);
                navigation.navigate("Calendar");
              }}
            >
              <MaterialIcons name="calendar-today" size={22} color="#fff" />
            </TouchableOpacity>

            {/* Settings - Position 4 */}
            <TouchableOpacity
              style={[styles.fabAction, { 
                bottom: 140,
                right: 0,
              }]}
              onPress={() => {
                setFabMenuOpen(false);
                navigation.navigate("Settings");
              }}
            >
              <MaterialIcons name="settings" size={22} color="#fff" />
            </TouchableOpacity>
          </>
        )}

        {/* Main FAB Button with App Icon */}
        <TouchableOpacity
          style={styles.fabCustom}
          onPress={() => setFabMenuOpen(!fabMenuOpen)}
          activeOpacity={0.8}
        >
          {fabMenuOpen ? (
            <MaterialIcons name="close" size={28} color="#fff" />
          ) : (
            <Image
              source={require('../../assets/fab.png')}
              style={styles.fabIcon}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* AlertScheduler for Real Meeting Alerts */}
      <AlertScheduler
        ref={alertSchedulerRef}
        onTriggerAlert={handleRealMeetingAlert}
        language={language}
        alertsEnabled={alertsEnabled}
      />

      {/* Notification Manager for Real Meeting Alerts */}
      {realAlertOpen && realAlertMeeting && (
        <NotificationManager
          meeting={realAlertMeeting}
          isOpen={realAlertOpen}
          onClose={handleRealAlertClose}
          onSnooze={handleRealAlertSnooze}
          onPostpone={handleRealAlertPostpone}
          alertType={realAlertType}
          intensity={userPreferences?.alert_intensity || 'maximum'}
          language={language}
        />
      )}

      {/* Google Calendar Connection Prompt for Manual Login Users */}
      <GoogleCalendarConnectionPrompt
        visible={showGoogleCalendarPrompt}
        onClose={() => setShowGoogleCalendarPrompt(false)}
        onSuccess={(result) => {
          console.log('Dashboard: Google Calendar connected successfully:', result);
          setShowGoogleCalendarPrompt(false);
        }}
        userEmail={user?.email}
        language={language}
      />
    </View>
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
    backgroundColor: isDarkMode ? "#0a0a0a" : "#f8fafc",
    // Ensure container doesn't overlap with header
    marginTop: 0,
    paddingTop: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.md, // Add padding to avoid header overlap
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: spacing.lg,
    fontSize: fonts.md,
    color: isDarkMode ? "#a1a1aa" : "#666",
  },
  statsSection: {
    padding: spacing['2xl'],
    paddingTop: spacing['3xl'], // Add more top padding to avoid header overlap
  },
  statsContent: {
    alignItems: "center",
  },
  statsTitle: {
    fontSize: fonts['4xl'],
    fontWeight: "700",
    color: isDarkMode ? "#ffffff" : "#1e293b",
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  headerStats: {
    flexDirection: "row",
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: cards.borderRadius,
    padding: cards.padding,
    marginTop: spacing.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: fonts['2xl'],
    fontWeight: "700",
    color: isDarkMode ? "#ffffff" : "#1e293b",
    marginBottom: spacing.xs,
  },
  statLabel: {
    fontSize: fonts.xs,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    fontWeight: "500",
  },
  statDivider: {
    width: 1,
    backgroundColor: isDarkMode ? "#262626" : "#e2e8f0",
    marginHorizontal: spacing.sm,
  },
  statusGrid: {
    padding: spacing.xl,
  },
  statusRow: {
    flexDirection: "row",
    marginBottom: spacing.lg,
  },
  statusCard: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  card: {
    borderRadius: cards.borderRadius,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  cardContent: {
    padding: cards.padding,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  cardTitle: {
    fontSize: fonts.sm,
    fontWeight: "600",
    color: "#666",
    marginLeft: spacing.sm,
  },
  cardValue: {
    fontSize: fonts['2xl'],
    fontWeight: "bold",
    marginBottom: spacing.xs,
  },
  cardSubtitle: {
    fontSize: fonts.xs,
    color: "#666",
  },
  quickActions: {
    padding: spacing.xl,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  actionCard: {
    flex: 1,
    marginHorizontal: spacing.xs,
    padding: spacing.xl,
    borderRadius: cards.borderRadius,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  actionText: {
    fontSize: fonts.xs,
    fontWeight: "600",
    color: isDarkMode ? "#ffffff" : "#1e293b",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  testAlertCard: {
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    margin: 20,
    elevation: 2,
  },
  testAlertContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  testAlertInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  testAlertTitle: {
    fontSize: 16,
    marginBottom: 4,
    marginLeft: 10,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  testAlertSubtitle: {
    fontSize: 12,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    marginLeft: 10,
    marginTop: 2,
  },
  testAlertDescription: {
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    marginLeft: 10,
  },
  testButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  testButton: {
    borderColor: "#FF3B30",
  },
  meetingsSection: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: isDarkMode ? "#ffffff" : "#1C1C1E",
  },
  realTimeIndicator: {
    flexDirection: "row",
    alignItems: "center",
  },
  realTimeText: {
    fontSize: fonts.xs,
    color: isDarkMode ? "#a1a1aa" : "#666",
    marginLeft: spacing.xs,
  },
  meetingCard: {
    marginBottom: spacing.lg,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: cards.borderRadius,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  meetingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  meetingInfo: {
    flex: 1,
  },
  meetingTimeContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  meetingTitle: {
    fontSize: fonts.lg,
    fontWeight: "700",
    marginBottom: spacing.sm,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  meetingTime: {
    fontSize: fonts.sm,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    marginLeft: spacing.xs,
  },
  meetingActions: {
    flexDirection: "row",
  },
  actionButton: {
    padding: spacing.sm,
    marginLeft: spacing.sm,
    borderRadius: spacing.sm,
  },
  meetingDescription: {
    marginTop: spacing.sm,
    fontSize: fonts.sm,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    lineHeight: 20,
  },
  emptyCard: {
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: cards.borderRadius,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  emptyContent: {
    alignItems: "center",
    padding: spacing['4xl'],
  },
  emptyIconContainer: {
    width: icons['2xl'] * 2,
    height: icons['2xl'] * 2,
    borderRadius: icons['2xl'],
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fonts.xl,
    fontWeight: "700",
    marginBottom: spacing.sm,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  emptyText: {
    textAlign: "center",
    marginBottom: spacing['2xl'],
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    fontSize: fonts.sm,
    lineHeight: 20,
  },
  createButton: {
    marginTop: spacing.sm,
  },
  fabContainer: {
    position: "absolute",
    right: 30,
    bottom: 30,
  },
  fab: {
    backgroundColor: "#3b82f6",
    elevation: 4,
  },
  fabCustom: {
    width: 56,
    height: 56,
    // borderRadius: 50,
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
  },
  fabIcon: {
    width: 60,
    height: 60,
  },
  fabAction: {
    position: "absolute",
    right: 0,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#3b82f6",
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  fabBackdrop: {
    position: "absolute",
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  dateTimeContainer: {
    flex: 1,
    padding: 20,
    borderRadius: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  dateTimeContent: {
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  timeSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeText: {
    fontSize: 24,
    fontWeight: "bold",
    marginLeft: 8,
  },
  dateSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  dateText: {
    fontSize: fonts.sm,
    marginLeft: spacing.sm,
  },
  });
};