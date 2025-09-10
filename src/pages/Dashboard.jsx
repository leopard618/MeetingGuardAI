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
import calendarSyncManager from '../api/calendarSyncManager';

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
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userPreferences, setUserPreferences] = useState(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  useEffect(() => {
    loadInitialData();
  }, []);

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
      // Use the user from component level
      if (!user) {
        console.error('No authenticated user found');
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

  const [testAlertOpen, setTestAlertOpen] = useState(false);
  const [testAlertIntensity, setTestAlertIntensity] = useState('maximum');
  const [realAlertOpen, setRealAlertOpen] = useState(false);
  const [realAlertMeeting, setRealAlertMeeting] = useState(null);
  const [realAlertType, setRealAlertType] = useState(null);
  
  // Ref for AlertScheduler to access its methods
  const alertSchedulerRef = useRef(null);

  const handleGlobalTestAlert = () => {
    // Get current alert intensity from user preferences
    const currentIntensity = userPreferences?.alert_intensity || 'maximum';
    console.log('Current alert intensity:', currentIntensity);
    setTestAlertIntensity(currentIntensity);
    setTestAlertOpen(true);
  };

  // Function to manually sync preferences from Settings
  const syncPreferencesFromSettings = async () => {
    try {
      console.log('Manually syncing preferences...');
      if (!user) {
        Alert.alert('Error', 'No authenticated user found');
        return;
      }
      const currentUser = user;

      // Get all preference records for this user
      const allPrefs = await UserPreferences.filter({ created_by: currentUser.email });
      console.log('All preference records:', allPrefs);

      // Find the record with alert_intensity (the one Settings uses)
      const settingsRecord = allPrefs.find(p => p.alert_intensity);

      if (settingsRecord) {
        console.log('Found Settings record:', settingsRecord);
        setUserPreferences(settingsRecord);
        setAlertsEnabled(settingsRecord.alert_enabled);
        setTestAlertIntensity(settingsRecord.alert_intensity);
        Alert.alert('Success', `Synced intensity: ${settingsRecord.alert_intensity}`);
      } else {
        Alert.alert('Error', 'No Settings record found');
      }
    } catch (error) {
      console.log('Error syncing preferences:', error);
      Alert.alert('Error', 'Failed to sync preferences');
    }
  };

  // Update test alert intensity when user preferences change
  useEffect(() => {
    if (userPreferences?.alert_intensity) {
      setTestAlertIntensity(userPreferences.alert_intensity);
    }
  }, [userPreferences?.alert_intensity]);

  const handleTestAlertClose = () => {
    setTestAlertOpen(false);
  };

  const handleTestAlertSnooze = (minutes) => {
    Alert.alert('Snoozed', `Test alert snoozed for ${minutes} minutes`);
    setTestAlertOpen(false);
  };

  const handleTestAlertPostpone = (newDateTime) => {
    Alert.alert('Postponed', `Test meeting postponed to: ${newDateTime.date} ${newDateTime.time}`);
    setTestAlertOpen(false);
  };

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
                <Text style={styles.statLabel}>Today</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{meetings.length}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{aiAssistedCount}</Text>
                <Text style={styles.statLabel}>AI Powered</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.statusGrid}>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: "Today",
              value: todaysMeetings.length,
              icon: "event",
              color: "#007AFF",
              onPress: () => navigation.navigate("Calendar")
            })}
            <DateTimeDisplay isDarkMode={isDarkMode} styles={styles} />
          </View>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: "AI Assisted",
              value: aiAssistedCount,
              icon: "flash-on",
              color: "#FF9500",
              // subtitle: "Smart meetings"
            })}
            {renderStatusCard({
              title: "Notes & Tasks",
              value: "📝",
              icon: "note",
              color: "#FF3B30",
              onPress: () => navigation.navigate("Notes")
            })}

          </View>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: "Smart Alerts",
              value: alertsEnabled ? "ON" : "OFF",
              icon: alertsEnabled ? "notifications-active" : "notifications-off",
              color: alertsEnabled ? "#34C759" : "#8E8E93",
              onPress: handleToggleAlerts,
              subtitle: alertsEnabled ? "Active" : "Disabled"
            })}
            {renderStatusCard({
              title: "AI Insights",
              value: reviewCount > 0 ? reviewCount : "✓",
              icon: "insights",
              color: reviewCount > 0 ? "#FF9500" : "#34C759",
              onPress: () => navigation.navigate("AIInsights"),
              subtitle: reviewCount > 0 ? "Needs review" : "All good"
            })}
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: isDarkMode ? '#262626' : '#ffffff' }]}
              onPress={() => navigation.navigate("CreateMeeting")}
            >
              <MaterialIcons name="add-circle" size={32} color="#3b82f6" />
              <Text style={styles.actionText}>New Meeting</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: isDarkMode ? '#262626' : '#ffffff' }]}
              onPress={() => navigation.navigate("AIChat")}
            >
              <MaterialIcons name="chat" size={32} color="#10b981" />
              <Text style={styles.actionText}>AI Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: isDarkMode ? '#262626' : '#ffffff' }]}
              onPress={() => navigation.navigate("Calendar")}
            >
              <MaterialIcons name="calendar-today" size={32} color="#f59e0b" />
              <Text style={styles.actionText}>Calendar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Card style={styles.testAlertCard}>
          <Card.Content>
            <View style={styles.testAlertContent}>
              <View style={styles.testAlertInfo}>
                <MaterialIcons name="volume-up" size={24} color="#FF3B30" />
                <View>
                  <Title style={styles.testAlertTitle}>Test Global Alert</Title>
                </View>
              </View>
              <Button
                mode="outlined"
                onPress={handleGlobalTestAlert}
                style={styles.testButton}
                textColor={isDarkMode ? "#ffffff" : "#FF3B30"}
              >
                Test
              </Button>
            </View>
          </Card.Content>
        </Card>

        {/* Notification: Show which intensity is selected as spoken text */}
        <View style={{ marginVertical: 4, marginLeft: 24 }}>
          <Text style={{
            fontSize: 14,
            color: isDarkMode ? '#fff' : '#222',
            fontWeight: '500'
          }}>
            Selected Intensity: <Text style={{ color: '#3b82f6' }}>{userPreferences?.alert_intensity}</Text>
          </Text>
        </View>

        <View style={styles.meetingsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Meetings</Text>
            <View style={styles.realTimeIndicator}>
              <MaterialIcons name="schedule" size={16} color={isDarkMode ? "#a1a1aa" : "#666"} />
              <Text style={styles.realTimeText}>Real-time updates</Text>
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
                <Title style={styles.emptyTitle}>No meetings today</Title>
                <Text style={styles.emptyText}>
                  You're all caught up! Create a new meeting to get started.
                </Text>
                <Button
                  mode="contained"
                  onPress={() => navigation.navigate("CreateMeeting", { 
                    onMeetingCreated: handleMeetingCreated 
                  })}
                  style={styles.createButton}
                  buttonColor="#3b82f6"
                >
                  Create New Meeting
                </Button>
              </Card.Content>
            </Card>
          )}
        </View>
      </ScrollView>

      <FAB
        style={styles.fab}
        icon="plus"
        onPress={() => navigation.navigate("CreateMeeting", { 
          onMeetingCreated: handleMeetingCreated 
        })}
      />

      {/* AlertScheduler for Real Meeting Alerts */}
      <AlertScheduler
        ref={alertSchedulerRef}
        onTriggerAlert={handleRealMeetingAlert}
        language={language}
        alertsEnabled={alertsEnabled}
      />

      {/* Notification Manager for Test Alerts */}
      {testAlertOpen && (
        <NotificationManager
          meeting={{
            id: 'test-meeting',
            title: 'Test Meeting Alert',
            date: (() => {
              const todayDate = new Date();
              const year = todayDate.getFullYear();
              const month = String(todayDate.getMonth() + 1).padStart(2, '0');
              const day = String(todayDate.getDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            })(),
            time: new Date(Date.now() + 5 * 60 * 1000).toTimeString().slice(0, 5),
            location: 'Test Location',
            confidence: 0.95,
            source: 'test'
          }}
          isOpen={testAlertOpen}
          onClose={handleTestAlertClose}
          onSnooze={handleTestAlertSnooze}
          onPostpone={handleTestAlertPostpone}
          intensity={testAlertIntensity}
          language={language}
        />
      )}

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
    </View>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
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
    paddingTop: 20, // Add padding to avoid header overlap
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: isDarkMode ? "#a1a1aa" : "#666",
  },
  statsSection: {
    padding: 24,
    paddingTop: 32, // Add more top padding to avoid header overlap
  },
  statsContent: {
    alignItems: "center",
  },
  statsTitle: {
    fontSize: 32,
    fontWeight: "700",
    color: isDarkMode ? "#ffffff" : "#1e293b",
    marginBottom: 16,
    textAlign: "center",
  },
  headerStats: {
    flexDirection: "row",
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
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
    fontSize: 24,
    fontWeight: "700",
    color: isDarkMode ? "#ffffff" : "#1e293b",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    fontWeight: "500",
  },
  statDivider: {
    width: 1,
    backgroundColor: isDarkMode ? "#262626" : "#e2e8f0",
    marginHorizontal: 8,
  },
  statusGrid: {
    padding: 20,
  },
  statusRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  statusCard: {
    flex: 1,
    marginHorizontal: 6,
  },
  card: {
    borderRadius: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  cardContent: {
    padding: 20,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
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
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginLeft: 8,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 10,
    color: "#666",
  },
  quickActions: {
    padding: 20,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  actionCard: {
    flex: 1,
    marginHorizontal: 4,
    padding: 20,
    borderRadius: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "600",
    color: isDarkMode ? "#ffffff" : "#1e293b",
    marginTop: 8,
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
  debugButton: {
    marginLeft: 8,
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
    fontSize: 12,
    color: isDarkMode ? "#a1a1aa" : "#666",
    marginLeft: 4,
  },
  meetingCard: {
    marginBottom: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
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
    marginBottom: 8,
  },
  meetingTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  meetingTime: {
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    marginLeft: 4,
  },
  meetingActions: {
    flexDirection: "row",
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 8,
  },
  meetingDescription: {
    marginTop: 8,
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    lineHeight: 20,
  },
  emptyCard: {
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  emptyContent: {
    alignItems: "center",
    padding: 40,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  emptyText: {
    textAlign: "center",
    marginBottom: 24,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    fontSize: 14,
    lineHeight: 20,
  },
  createButton: {
    marginTop: 8,
  },
  fab: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: "#3b82f6",
    borderRadius: 28,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
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
    fontSize: 14,
    marginLeft: 8,
  },
});