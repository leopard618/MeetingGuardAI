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
  Chip,
} from "react-native-paper";
import {
  MaterialIcons,
  MaterialCommunityIcons,
  Ionicons,
} from "@expo/vector-icons";
import { Meeting, UserPreferences, User } from "@/api/entities";
import aiService from "@/api/aiService";
import { useTranslation } from "@/components/translations";

export default function Dashboard({ navigation, language = "en" }) {
  const { t } = useTranslation(language);
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userPreferences, setUserPreferences] = useState(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [aiInsights, setAiInsights] = useState(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

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

      // Generate AI insights if we have meetings
      if (allMeetings.length > 0) {
        generateAIInsights(allMeetings);
      }
    } catch (error) {
      console.error("Error loading initial data:", error);
      Alert.alert("Error", "Failed to load data");
    }
    setIsLoading(false);
  };

  const generateAIInsights = async (meetingsData) => {
    setIsGeneratingInsights(true);
    try {
      const recentMeetings = meetingsData.slice(0, 5); // Analyze last 5 meetings
      const insights = await aiService.getMeetingSuggestions(
        userPreferences || { language: language },
        { meetings: recentMeetings },
        language
      );
      setAiInsights(insights);
    } catch (error) {
      console.error("Error generating AI insights:", error);
    } finally {
      setIsGeneratingInsights(false);
    }
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
    return meetings.filter(m => m.source === 'ChatGPT' || m.source === 'WhatsApp' || m.source === 'AI Chat').length;
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
      "This is a test alert to verify the notification system is working correctly.",
      [
        { text: "OK", style: "default" },
        { text: "Test Again", onPress: handleGlobalTestAlert }
      ]
    );
  };

  const renderStatusCard = ({ title, value, icon, color, onPress, subtitle }) => (
    <TouchableOpacity onPress={onPress} style={styles.statusCard}>
      <Card style={[styles.card, { borderLeftColor: color }]}>
        <Card.Content style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <MaterialIcons name={icon} size={24} color={color} />
            <Text style={[styles.cardValue, { color }]}>{value}</Text>
          </View>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
        </Card.Content>
      </Card>
    </TouchableOpacity>
  );

  const renderMeetingCard = (meeting, index) => (
    <TouchableOpacity
      key={meeting.id}
      onPress={() => navigation.navigate('MeetingDetails', { meetingId: meeting.id })}
      style={styles.meetingCard}
    >
      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.meetingHeader}>
            <View style={styles.meetingInfo}>
              <Text style={styles.meetingTitle}>{meeting.title}</Text>
              <Text style={styles.meetingTime}>
                {meeting.time} • {meeting.duration} min
              </Text>
            </View>
            <View style={styles.meetingBadges}>
              {meeting.source === 'AI Chat' && (
                <Chip mode="outlined" style={styles.aiChip}>
                  <MaterialIcons name="psychology" size={16} color="#8B5CF6" />
                  AI
                </Chip>
              )}
              {meeting.confidence && meeting.confidence < 80 && (
                <Chip mode="outlined" style={styles.reviewChip}>
                  <MaterialIcons name="warning" size={16} color="#F59E0B" />
                  Review
                </Chip>
              )}
            </View>
          </View>
          {meeting.description && (
            <Text style={styles.meetingDescription} numberOfLines={2}>
              {meeting.description}
            </Text>
          )}
        </Card.Content>
      </Card>
    </TouchableOpacity>
  );

  const renderAIInsights = () => {
    if (!aiInsights) return null;

    return (
      <Card style={styles.insightsCard}>
        <Card.Content>
          <View style={styles.insightsHeader}>
            <MaterialIcons name="lightbulb" size={24} color="#8B5CF6" />
            <Title style={styles.insightsTitle}>AI Insights</Title>
            {isGeneratingInsights && <ActivityIndicator size="small" color="#8B5CF6" />}
          </View>
          
          <View style={styles.insightsSection}>
            <Text style={styles.sectionTitle}>Suggested Times</Text>
            <View style={styles.chipContainer}>
              {aiInsights.suggested_times?.slice(0, 3).map((time, index) => (
                <Chip key={index} mode="outlined" style={styles.insightChip}>
                  {time}
                </Chip>
              ))}
            </View>
          </View>

          <View style={styles.insightsSection}>
            <Text style={styles.sectionTitle}>Optimization Tips</Text>
            {aiInsights.optimization_tips?.slice(0, 2).map((tip, index) => (
              <Text key={index} style={styles.insightText}>• {tip}</Text>
            ))}
          </View>

          <Button
            mode="outlined"
            onPress={() => navigation.navigate('AIChat')}
            style={styles.insightsButton}
            icon="chat"
          >
            Get More AI Suggestions
          </Button>
        </Card.Content>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </SafeAreaView>
    );
  }

  const todaysMeetings = getTodaysMeetings();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Title style={styles.title}>{t('dashboard.title')}</Title>
            <Paragraph style={styles.subtitle}>{t('dashboard.subtitle')}</Paragraph>
          </View>
          
          <TouchableOpacity
            onPress={handleToggleAlerts}
            style={[styles.alertToggle, { backgroundColor: alertsEnabled ? '#10B981' : '#E5E7EB' }]}
          >
            <MaterialIcons
              name={alertsEnabled ? 'notifications-active' : 'notifications-off'}
              size={24}
              color={alertsEnabled ? 'white' : '#6B7280'}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.statusGrid}>
          {renderStatusCard({
            title: t('dashboard.meetingsToday'),
            value: todaysMeetings.length,
            icon: 'today',
            color: '#3B82F6',
            onPress: () => navigation.navigate('Calendar')
          })}
          
          {renderStatusCard({
            title: t('dashboard.aiAssisted'),
            value: getAiAssistedCount(),
            icon: 'psychology',
            color: '#8B5CF6',
            subtitle: t('dashboard.aiAssistedSubtext'),
            onPress: () => navigation.navigate('AIInsights')
          })}
          
          {renderStatusCard({
            title: t('dashboard.needsReview'),
            value: getMeetingsNeedingReview(),
            icon: 'warning',
            color: '#F59E0B',
            onPress: () => navigation.navigate('AIInsights')
          })}
          
          {renderStatusCard({
            title: t('dashboard.allGood'),
            value: meetings.length - getMeetingsNeedingReview(),
            icon: 'check-circle',
            color: '#10B981',
            onPress: () => navigation.navigate('Calendar')
          })}
        </View>

        {renderAIInsights()}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>{t('dashboard.todaysMeetings')}</Title>
            <TouchableOpacity onPress={() => navigation.navigate('CreateMeeting')}>
              <MaterialIcons name="add" size={24} color="#8B5CF6" />
            </TouchableOpacity>
          </View>

          {todaysMeetings.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <MaterialIcons name="event-busy" size={48} color="#9CA3AF" />
                <Text style={styles.emptyTitle}>{t('dashboard.noMeetings')}</Text>
                <Text style={styles.emptySubtext}>{t('dashboard.noMeetingsSubtext')}</Text>
                <Button
                  mode="contained"
                  onPress={() => navigation.navigate('CreateMeeting')}
                  style={styles.createButton}
                >
                  {t('dashboard.createNewMeeting')}
                </Button>
              </Card.Content>
            </Card>
          ) : (
            <View style={styles.meetingsList}>
              {todaysMeetings.map(renderMeetingCard)}
            </View>
          )}
        </View>

        <View style={styles.testSection}>
          <Button
            mode="outlined"
            onPress={handleGlobalTestAlert}
            style={styles.testButton}
            icon="notifications"
          >
            {t('dashboard.testGlobalAlert')}
          </Button>
          <Text style={styles.testSubtext}>{t('dashboard.testAlertSubtitle')}</Text>
        </View>
      </ScrollView>

      <FAB
        style={styles.fab}
        icon="add"
        onPress={() => navigation.navigate('CreateMeeting')}
        label={t('dashboard.createNewMeeting')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748B',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
  },
  alertToggle: {
    padding: 12,
    borderRadius: 12,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 20,
    paddingTop: 0,
    gap: 12,
  },
  statusCard: {
    flex: 1,
    minWidth: '45%',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 4,
    elevation: 2,
  },
  cardContent: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  insightsCard: {
    margin: 20,
    marginTop: 0,
    backgroundColor: '#F8FAFC',
    borderColor: '#8B5CF6',
    borderWidth: 1,
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  insightsTitle: {
    flex: 1,
    marginLeft: 8,
    fontSize: 18,
  },
  insightsSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  insightChip: {
    borderColor: '#8B5CF6',
  },
  insightText: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 4,
  },
  insightsButton: {
    borderColor: '#8B5CF6',
  },
  section: {
    padding: 20,
    paddingTop: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  meetingsList: {
    gap: 12,
  },
  meetingCard: {
    marginBottom: 8,
  },
  meetingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  meetingInfo: {
    flex: 1,
  },
  meetingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 4,
  },
  meetingTime: {
    fontSize: 14,
    color: '#64748B',
  },
  meetingBadges: {
    flexDirection: 'row',
    gap: 8,
  },
  aiChip: {
    borderColor: '#8B5CF6',
  },
  reviewChip: {
    borderColor: '#F59E0B',
  },
  meetingDescription: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
  },
  emptyContent: {
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1E293B',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: '#8B5CF6',
  },
  testSection: {
    alignItems: 'center',
    padding: 20,
    paddingTop: 0,
  },
  testButton: {
    borderColor: '#64748B',
    marginBottom: 8,
  },
  testSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: '#8B5CF6',
  },
});