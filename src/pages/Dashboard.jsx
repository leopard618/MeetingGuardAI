import React, { useState, useEffect } from "react";
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
import { Meeting, UserPreferences, User } from "@/api/entities";

export default function Dashboard({ navigation, language = "en" }) {
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userPreferences, setUserPreferences] = useState(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const user = await User.me();
      const [allMeetings, prefsList] = await Promise.all([
        Meeting.list("-created_date"),
        UserPreferences.filter({ created_by: user.email })
      ]);

      setMeetings(allMeetings);

      if (prefsList.length > 0) {
        setUserPreferences(prefsList[0]);
        setAlertsEnabled(prefsList[0].alert_enabled);
      } else {
        const newPrefs = await UserPreferences.create({
          created_by: user.email,
          language: language,
          alert_enabled: true,
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
    const today = new Date().toISOString().split('T')[0];
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

  const handleGlobalTestAlert = () => {
    Alert.alert(
      "Test Alert",
      "This is a test alert to verify the notification system is working.",
      [
        { text: "OK", style: "default" },
        { text: "Snooze 5min", onPress: () => console.log("Snoozed for 5 minutes") }
      ]
    );
  };

  const todaysMeetings = getTodaysMeetings();
  const aiAssistedCount = getAiAssistedCount();
  const reviewCount = getMeetingsNeedingReview();

  const renderStatusCard = ({ title, value, icon, color, onPress, subtitle }) => (
    <TouchableOpacity onPress={onPress} style={styles.statusCard}>
      <Card style={[styles.card, { borderLeftColor: color }]}>
        <Card.Content style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <MaterialIcons name={icon} size={24} color={color} />
            <Text style={styles.cardTitle}>{title}</Text>
          </View>
          <Text style={[styles.cardValue, { color }]}>{value}</Text>
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
            <Title style={styles.meetingTitle}>{meeting.title}</Title>
            <Paragraph style={styles.meetingTime}>
              {meeting.time} • {meeting.duration}min
            </Paragraph>
          </View>
          <View style={styles.meetingActions}>
            <TouchableOpacity style={styles.actionButton}>
              <MaterialIcons name="edit" size={20} color="#666" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <MaterialIcons name="delete" size={20} color="#666" />
            </TouchableOpacity>
          </View>
        </View>
        {meeting.description && (
          <Paragraph style={styles.meetingDescription}>
            {meeting.description}
          </Paragraph>
        )}
      </Card.Content>
    </Card>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Meeting Guard</Text>
          <Text style={styles.subtitle}>Your smart meeting assistant</Text>
        </View>

        <View style={styles.statusGrid}>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: "Today's Meetings",
              value: todaysMeetings.length,
              icon: "event",
              color: "#007AFF",
              onPress: () => navigation.navigate("Calendar")
            })}
            {renderStatusCard({
              title: "AI Assisted",
              value: aiAssistedCount,
              icon: "flash-on",
              color: "#FF9500",
              // subtitle: "Smart meetings"
            })}
          </View>
          <View style={styles.statusRow}>
            {renderStatusCard({
              title: "Notes & Tasks",
              value: "📝",
              icon: "note",
              color: "#FF3B30",
              onPress: () => navigation.navigate("Notes")
            })}
            {renderStatusCard({
              title: "Smart Alerts",
              value: alertsEnabled ? "ON" : "OFF",
              icon: alertsEnabled ? "notifications-active" : "notifications-off",
              color: alertsEnabled ? "#34C759" : "#8E8E93",
              onPress: handleToggleAlerts,
              // subtitle: alertsEnabled ? "Active" : "Disabled"
            })}
          </View>
          <View style={styles.statusRow}>
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

        <Card style={styles.testAlertCard}>
          <Card.Content>
            <View style={styles.testAlertContent}>
              <View style={styles.testAlertInfo}>
                <MaterialIcons name="volume-up" size={24} color="#FF3B30" />
                <View>
                  <Title style={styles.testAlertTitle}>Test Global Alert</Title>
                  <Paragraph>Verify notification system</Paragraph>
                </View>
              </View>
              <Button
                mode="outlined"
                onPress={handleGlobalTestAlert}
                style={styles.testButton}
              >
                Test
              </Button>
            </View>
          </Card.Content>
        </Card>

        <View style={styles.meetingsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Meetings</Text>
            <View style={styles.realTimeIndicator}>
              <MaterialIcons name="schedule" size={16} color="#666" />
              <Text style={styles.realTimeText}>Real-time updates</Text>
            </View>
          </View>

          {todaysMeetings.length > 0 ? (
            todaysMeetings.map((meeting, index) => renderMeetingCard(meeting, index))
          ) : (
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <MaterialIcons name="event" size={48} color="#8E8E93" />
                <Title style={styles.emptyTitle}>No meetings today</Title>
                <Paragraph style={styles.emptyText}>
                  You're all caught up! Create a new meeting to get started.
                </Paragraph>
                <Button
                  mode="contained"
                  onPress={() => navigation.navigate("CreateMeeting")}
                  style={styles.createButton}
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
        onPress={() => navigation.navigate("CreateMeeting")}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  header: {
    padding: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
  },
  statusGrid: {
    padding: 20,
  },
  statusRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  statusCard: {
    flex: 1,
    marginHorizontal: 6,
  },
  card: {
    borderLeftWidth: 4,
    elevation: 2,
  },
  cardContent: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 12,
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
  testAlertCard: {
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
    color: "#1C1C1E",
  },
  realTimeIndicator: {
    flexDirection: "row",
    alignItems: "center",
  },
  realTimeText: {
    fontSize: 12,
    color: "#666",
    marginLeft: 4,
  },
  meetingCard: {
    marginBottom: 12,
    elevation: 2,
  },
  meetingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  meetingInfo: {
    flex: 1,
  },
  meetingTitle: {
    fontSize: 18,
    marginBottom: 4,
  },
  meetingTime: {
    fontSize: 14,
    color: "#666",
  },
  meetingActions: {
    flexDirection: "row",
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
  },
  meetingDescription: {
    marginTop: 8,
    fontSize: 14,
    color: "#666",
  },
  emptyCard: {
    elevation: 2,
  },
  emptyContent: {
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    textAlign: "center",
    marginBottom: 24,
    color: "#666",
  },
  createButton: {
    marginTop: 8,
  },
  fab: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: "#007AFF",
  },
});