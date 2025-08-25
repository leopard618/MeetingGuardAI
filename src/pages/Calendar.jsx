
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Dimensions,
} from "react-native";
import {
  Card,
  Title,
  Paragraph,
  Button,
  FAB,
  ActivityIndicator,
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Meeting } from "@/api/entities";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { useTheme } from "@/contexts/ThemeContext";
import GoogleCalendarService from "@/api/googleCalendar";
import { useGoogleAuth } from "@/hooks/useGoogleAuth";
import { safeStringify } from "@/utils";

const { width } = Dimensions.get('window');

export default function Calendar({ navigation, language = "en" }) {
  const { isDarkMode } = useTheme();
  const googleAuth = useGoogleAuth();
  const [meetings, setMeetings] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState(null);
  const [googleMeetings, setGoogleMeetings] = useState([]);

  const locale = language === "es" ? es : enUS;

  const t = {
    en: {
      title: "Calendar",
      subtitle: "View all your meetings organized by date",
      backToDashboard: "Back to Dashboard",
      addMeeting: "Add Meeting",
      today: "Today",
      noMeetings: "No meetings",
      meeting: "meeting",
      meetings: "meetings",
      viewDetails: "View Details",
      time: "Time",
      duration: "Duration",
      minutes: "min",
      source: "Source",
      confidence: "Confidence",
      preparation: "Preparation Tips"
    },
    es: {
      title: "Calendario",
      subtitle: "Ve todas tus reuniones organizadas por fecha",
      backToDashboard: "Volver al Panel",
      addMeeting: "Agregar Reunión",
      today: "Hoy",
      noMeetings: "Sin reuniones",
      meeting: "reunión",
      meetings: "reuniones",
      viewDetails: "Ver Detalles",
      time: "Hora",
      duration: "Duración",
      minutes: "min",
      source: "Origen",
      confidence: "Confianza",
      preparation: "Consejos de Preparación"
    }
  };

  useEffect(() => {
    loadMeetings();
    checkGoogleCalendarStatus();
  }, []);

  const loadMeetings = async () => {
    setIsLoading(true);
    try {
      const allMeetings = await Meeting.list("-created_date");
      setMeetings(allMeetings);
    } catch (error) {
      console.error("Error loading meetings:", error);
      Alert.alert("Error", "Failed to load meetings");
    }
    setIsLoading(false);
  };

  const checkGoogleCalendarStatus = async () => {
    try {
      // Check if user is signed in to Google
      const isSignedIn = googleAuth.isSignedIn;
      
      if (isSignedIn) {
        try {
          // Get Google Calendar info
          const calendarInfo = await GoogleCalendarService.getCalendarInfo();
          setGoogleCalendarStatus(calendarInfo);
          
          // Load Google Calendar meetings
          const todayMeetings = await GoogleCalendarService.getTodayMeetings();
          const upcomingMeetings = await GoogleCalendarService.getUpcomingMeetings(7);
          setGoogleMeetings([...todayMeetings, ...upcomingMeetings]);
        } catch (calendarError) {
          console.error("Error fetching Google Calendar data:", calendarError);
          setGoogleMeetings([]);
          setGoogleCalendarStatus({ isAuthenticated: false, isInitialized: false });
        }
      } else {
        setGoogleMeetings([]);
        setGoogleCalendarStatus({ isAuthenticated: false, isInitialized: false });
      }
    } catch (error) {
      console.error("Error checking Google Calendar status:", error);
      setGoogleMeetings([]);
      setGoogleCalendarStatus({ isAuthenticated: false, isInitialized: false });
    }
  };

  const refreshCalendar = async () => {
    await loadMeetings();
    await checkGoogleCalendarStatus();
  };

  const getMeetingsForDate = (date) => {
    const dateString = format(date, 'yyyy-MM-dd');
    
    // Get local meetings
    const localMeetings = meetings.filter(meeting => meeting.date === dateString);
    
    // Get Google Calendar meetings
    const googleMeetingsForDate = googleMeetings.filter(meeting => {
      const meetingDate = format(new Date(meeting.start?.dateTime || meeting.start?.date), 'yyyy-MM-dd');
      return meetingDate === dateString;
    });
    
    // Combine and mark source
    const allMeetings = [
      ...localMeetings.map(m => ({ ...m, source: 'local' })),
      ...googleMeetingsForDate.map(m => ({ 
        ...m, 
        source: 'google',
        title: m.summary || m.title,
        time: m.start?.dateTime ? format(new Date(m.start.dateTime), 'HH:mm') : '00:00',
        duration: m.duration ? Math.round(m.duration / 60000) : 60, // Convert ms to minutes
        date: format(new Date(m.start?.dateTime || m.start?.date), 'yyyy-MM-dd')
      }))
    ];
    
    return allMeetings;
  };

  const navigateMonth = (direction) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleMeetingClick = (meeting) => {
    Alert.alert(
      meeting.title,
              `${meeting.description}\n\nTime: ${meeting.time}\nDuration: ${meeting.duration} minutes\nLocation: ${typeof meeting.location === 'string' ? meeting.location : (meeting.location?.address || 'Not specified')}`,
      [
        { text: "Close", style: "cancel" },
        { text: "Edit", onPress: () => navigation.navigate('CreateMeeting', { meeting }) }
      ]
    );
  };

  const formatTime = (timeString) => {
    try {
      const [hours, minutes] = timeString.split(':');
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes));
      return format(date, 'h:mm a');
    } catch (error) {
      return timeString;
    }
  };

  const renderCalendarGrid = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });

    // Add padding days from previous month
    const startDay = start.getDay();
    const paddingDays = [];
    for (let i = startDay - 1; i >= 0; i--) {
      const date = new Date(start);
      date.setDate(date.getDate() - (i + 1));
      paddingDays.push(date);
    }

    const allDays = [...paddingDays, ...days];
    const dayWidth = (width - 40) / 7; // 40 for padding

    return (
      <View style={styles.calendarGrid}>
        {/* Day headers */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <View key={day} style={[styles.dayHeader, { width: dayWidth }]}>
            <Text style={styles.dayHeaderText}>{day}</Text>
          </View>
        ))}
        
        {/* Calendar days */}
        {allDays.map((date, index) => {
          const dayMeetings = getMeetingsForDate(date);
          const isCurrentMonth = isSameMonth(date, currentDate);
          const isTodayDate = isToday(date);
          
          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.dayCell,
                { width: dayWidth, height: dayWidth },
                !isCurrentMonth && styles.otherMonthDay,
                isTodayDate && styles.todayCell
              ]}
              onPress={() => {
                if (dayMeetings.length > 0) {
                  Alert.alert(
                    `${format(date, 'MMMM d, yyyy')}`,
                    `${dayMeetings.length} meeting${dayMeetings.length > 1 ? 's' : ''} scheduled`,
                    [
                      { text: "Close", style: "cancel" },
                      { text: "View", onPress: () => showDayMeetings(date, dayMeetings) }
                    ]
                  );
                }
              }}
            >
              <Text style={[
                styles.dayText,
                !isCurrentMonth && styles.otherMonthText,
                isTodayDate && styles.todayText
              ]}>
                {format(date, 'd')}
              </Text>
              {dayMeetings.length > 0 && (
                <View style={styles.meetingIndicators}>
                  {/* Local meetings indicator */}
                  {dayMeetings.filter(m => m.source === 'local').length > 0 && (
                    <View style={[styles.meetingIndicator, styles.localMeetingIndicator]}>
                      <Text style={styles.meetingCount}>
                        {dayMeetings.filter(m => m.source === 'local').length}
                      </Text>
                    </View>
                  )}
                  {/* Google meetings indicator */}
                  {dayMeetings.filter(m => m.source === 'google').length > 0 && (
                    <View style={[styles.meetingIndicator, styles.googleMeetingIndicator]}>
                      <Text style={styles.meetingCount}>
                        {dayMeetings.filter(m => m.source === 'google').length}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const showDayMeetings = (date, dayMeetings) => {
    const localMeetings = dayMeetings.filter(m => m.source === 'local');
    const googleMeetings = dayMeetings.filter(m => m.source === 'google');
    
    let meetingList = '';
    
    if (localMeetings.length > 0) {
      meetingList += '📱 Local Meetings:\n';
      meetingList += localMeetings.map(meeting => 
        `${meeting.time} - ${meeting.title}`
      ).join('\n');
    }
    
    if (googleMeetings.length > 0) {
      if (meetingList) meetingList += '\n\n';
      meetingList += '🌐 Google Calendar:\n';
      meetingList += googleMeetings.map(meeting => 
        `${meeting.time} - ${meeting.title}`
      ).join('\n');
    }
    
    Alert.alert(
      `Meetings for ${format(date, 'MMMM d, yyyy')}`,
      meetingList || 'No meetings scheduled',
      [
        { text: "Close", style: "cancel" },
        { text: "Add Meeting", onPress: () => navigation.navigate('CreateMeeting') }
      ]
    );
  };

  const renderMeetingCard = (meeting) => {
    // Safety check to ensure meeting data is valid
    if (!meeting || typeof meeting !== 'object') {
      console.warn('Invalid meeting data:', meeting);
      return null;
    }

    return (
      <Card key={meeting.id} style={styles.meetingCard} onPress={() => handleMeetingClick(meeting)}>
        <Card.Content>
          <View style={styles.meetingHeader}>
            <Title style={styles.meetingTitle}>{meeting.title || 'Untitled Meeting'}</Title>
            <View style={styles.meetingTime}>
              <MaterialIcons name="access-time" size={16} color="#666" />
              <Text style={styles.timeText}>{formatTime(meeting.time)}</Text>
            </View>
          </View>
          <Paragraph style={styles.meetingDescription} numberOfLines={2}>
            {meeting.description || 'No description'}
          </Paragraph>
          <View style={styles.meetingMeta}>
            <View style={styles.metaItem}>
              <MaterialIcons name="schedule" size={14} color="#666" />
              <Text style={styles.metaText}>{meeting.duration || 0} {t[language].minutes}</Text>
            </View>
            {meeting.location && (
              <View style={styles.metaItem}>
                <MaterialIcons name="location-on" size={14} color="#666" />
                <Text style={styles.metaText}>
                  {typeof meeting.location === 'string' 
                    ? meeting.location 
                    : (meeting.location && typeof meeting.location === 'object' && meeting.location.address) 
                      ? safeStringify(meeting.location.address) 
                      : 'No address specified'
                  }
                </Text>
              </View>
            )}
          </View>
        </Card.Content>
      </Card>
    );
  };

  const styles = getStyles(isDarkMode);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading calendar...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? "#ffffff" : "#1e293b"} />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Title style={styles.title}>{t[language].title}</Title>
          <Paragraph style={styles.subtitle}>{t[language].subtitle}</Paragraph>
        </View>
      </View>

      <View style={styles.calendarHeader}>
        <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.navButton}>
          <MaterialIcons name="chevron-left" size={24} color={isDarkMode ? "#ffffff" : "#1e293b"} />
        </TouchableOpacity>
        
        <Text style={styles.monthYear}>
          {format(currentDate, 'MMMM yyyy', { locale })}
        </Text>
        
        <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.navButton}>
          <MaterialIcons name="chevron-right" size={24} color={isDarkMode ? "#ffffff" : "#1e293b"} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={goToToday} style={styles.todayButton}>
        <MaterialIcons name="today" size={20} color="#3b82f6" />
        <Text style={styles.todayButtonText}>{t[language].today}</Text>
      </TouchableOpacity>


      <ScrollView style={styles.calendarContainer} showsVerticalScrollIndicator={false}>
        {renderCalendarGrid()}
        
        {/* Today's meetings */}
        <View style={styles.todayMeetingsSection}>
          <Title style={styles.sectionTitle}>
            {t[language].today} - {format(new Date(), 'MMMM d, yyyy')}
          </Title>
          {getMeetingsForDate(new Date()).length > 0 ? (
            getMeetingsForDate(new Date()).map(renderMeetingCard)
          ) : (
            <Card style={styles.emptyCard}>
              <Card.Content style={styles.emptyContent}>
                <MaterialIcons name="event-busy" size={48} color="#ccc" />
                <Text style={styles.emptyText}>{t[language].noMeetings}</Text>
              </Card.Content>
            </Card>
          )}
        </View>

        {/* Google Calendar Meetings */}
        {googleCalendarStatus?.isAuthenticated && googleMeetings.length > 0 && (
          <View style={styles.todayMeetingsSection}>
            <Title style={styles.sectionTitle}>
              Google Calendar Meetings
            </Title>
            {googleMeetings.map((meeting, index) => {
              // Safety check for Google Calendar meetings
              if (!meeting || typeof meeting !== 'object') {
                console.warn('Invalid Google meeting data:', meeting);
                return null;
              }

              // Use meeting.id or a unique identifier instead of index
              const uniqueKey = meeting.id || `google-${meeting.startTime || Date.now()}-${index}`;

              return (
                <Card key={uniqueKey} style={[styles.meetingCard, { borderLeftColor: '#4caf50' }]}>
                  <Card.Content>
                    <View style={styles.meetingHeader}>
                      <View style={styles.meetingTitleContainer}>
                        <Text style={styles.meetingTitle}>{meeting.title || 'Untitled Meeting'}</Text>
                        <View style={styles.googleBadge}>
                          <MaterialIcons name="event" size={12} color="#4caf50" />
                          <Text style={styles.googleBadgeText}>Google</Text>
                        </View>
                      </View>
                      <Text style={styles.timeText}>
                        {meeting.startTime ? format(new Date(meeting.startTime), 'HH:mm') : 'TBD'}
                      </Text>
                    </View>
                    <Paragraph style={styles.meetingDescription} numberOfLines={2}>
                      {meeting.description || 'No description'}
                    </Paragraph>
                    <View style={styles.meetingMeta}>
                      {meeting.location && (
                        <View style={styles.metaItem}>
                          <MaterialIcons name="location-on" size={14} color="#666" />
                          <Text style={styles.metaText}>
                            {typeof meeting.location === 'string' 
                              ? meeting.location 
                              : (meeting.location && typeof meeting.location === 'object' && meeting.location.address) 
                                ? safeStringify(meeting.location.address) 
                                : 'No address specified'
                            }
                          </Text>
                        </View>
                      )}
                      <View style={styles.metaItem}>
                        <MaterialIcons name="calendar-today" size={14} color="#666" />
                        <Text style={styles.metaText}>
                          {meeting.startTime ? format(new Date(meeting.startTime), 'MMM d, yyyy') : 'TBD'}
                        </Text>
                      </View>
                    </View>
                  </Card.Content>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('CreateMeeting')}
        label={t[language].addMeeting}
      />
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? "#0a0a0a" : "#f8fafc",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 24,
    paddingTop: 32,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? "#262626" : "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  subtitle: {
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  calendarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? "#262626" : "#e2e8f0",
  },
  navButton: {
    padding: 8,
  },
  monthYear: {
    fontSize: 18,
    fontWeight: "600",
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  todayButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? "#262626" : "#e2e8f0",
  },
  todayButtonText: {
    marginLeft: 8,
    color: "#3b82f6",
    fontWeight: "500",
  },
  googleStatusCard: {
    margin: 16,
    borderWidth: 2,
    borderRadius: 12,
  },
  googleStatusContent: {
    padding: 16,
  },
  googleStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  googleStatusTitle: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  googleStatusText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  googleSignInButton: {
    alignSelf: "flex-start",
  },
  calendarContainer: {
    flex: 1,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 20,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
  },
  dayHeader: {
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  dayHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  dayCell: {
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: isDarkMode ? "#262626" : "#e2e8f0",
    backgroundColor: isDarkMode ? "#262626" : "#ffffff",
    position: "relative",
  },
  otherMonthDay: {
    backgroundColor: isDarkMode ? "#1a1a1a" : "#f8fafc",
  },
  otherMonthText: {
    color: isDarkMode ? "#71717a" : "#cbd5e1",
  },
  todayCell: {
    backgroundColor: "#3b82f6",
  },
  todayText: {
    color: "#ffffff",
    fontWeight: "bold",
  },
  dayText: {
    fontSize: 14,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  meetingIndicators: {
    position: "absolute",
    bottom: 2,
    right: 2,
    flexDirection: "row",
    gap: 2,
  },
  meetingIndicator: {
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  localMeetingIndicator: {
    backgroundColor: "#3b82f6", // Blue for local meetings
  },
  googleMeetingIndicator: {
    backgroundColor: "#4285f4", // Google blue for Google Calendar meetings
  },
  meetingCount: {
    fontSize: 10,
    color: "#ffffff",
    fontWeight: "bold",
  },
  todayMeetingsSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    color: "#1e293b",
  },
  meetingCard: {
    marginBottom: 12,
    elevation: 2,
  },
  meetingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  meetingTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  meetingTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  googleBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e8f5e8",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  googleBadgeText: {
    fontSize: 10,
    color: "#4caf50",
    fontWeight: "600",
    marginLeft: 2,
  },
  meetingTime: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeText: {
    fontSize: 12,
    color: "#666",
    marginLeft: 4,
  },
  meetingDescription: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 8,
  },
  meetingMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  metaText: {
    fontSize: 12,
    color: "#666",
    marginLeft: 4,
  },
  emptyCard: {
    marginTop: 8,
  },
  emptyContent: {
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: "#64748b",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#64748b",
  },
  fab: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: "#3b82f6",
  },
});
