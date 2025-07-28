
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

const { width } = Dimensions.get('window');

export default function Calendar({ navigation, language = "en" }) {
  const [meetings, setMeetings] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);

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

  const getMeetingsForDate = (date) => {
    const dateString = format(date, 'yyyy-MM-dd');
    return meetings.filter(meeting => meeting.date === dateString);
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
      `${meeting.description}\n\nTime: ${meeting.time}\nDuration: ${meeting.duration} minutes\nLocation: ${meeting.location || 'Not specified'}`,
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
                <View style={styles.meetingIndicator}>
                  <Text style={styles.meetingCount}>{dayMeetings.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const showDayMeetings = (date, dayMeetings) => {
    const meetingList = dayMeetings.map(meeting => 
      `${meeting.time} - ${meeting.title}`
    ).join('\n');
    
    Alert.alert(
      `Meetings for ${format(date, 'MMMM d, yyyy')}`,
      meetingList || 'No meetings scheduled',
      [
        { text: "Close", style: "cancel" },
        { text: "Add Meeting", onPress: () => navigation.navigate('CreateMeeting') }
      ]
    );
  };

  const renderMeetingCard = (meeting) => (
    <Card key={meeting.id} style={styles.meetingCard} onPress={() => handleMeetingClick(meeting)}>
      <Card.Content>
        <View style={styles.meetingHeader}>
          <Title style={styles.meetingTitle}>{meeting.title}</Title>
          <View style={styles.meetingTime}>
            <MaterialIcons name="access-time" size={16} color="#666" />
            <Text style={styles.timeText}>{formatTime(meeting.time)}</Text>
          </View>
        </View>
        <Paragraph style={styles.meetingDescription} numberOfLines={2}>
          {meeting.description}
        </Paragraph>
        <View style={styles.meetingMeta}>
          <View style={styles.metaItem}>
            <MaterialIcons name="schedule" size={14} color="#666" />
            <Text style={styles.metaText}>{meeting.duration} {t[language].minutes}</Text>
          </View>
          {meeting.location && (
            <View style={styles.metaItem}>
              <MaterialIcons name="location-on" size={14} color="#666" />
              <Text style={styles.metaText}>{meeting.location}</Text>
            </View>
          )}
        </View>
      </Card.Content>
    </Card>
  );

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
          <MaterialIcons name="arrow-back" size={24} color="#1e293b" />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Title style={styles.title}>{t[language].title}</Title>
          <Paragraph style={styles.subtitle}>{t[language].subtitle}</Paragraph>
        </View>
      </View>

      <View style={styles.calendarHeader}>
        <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.navButton}>
          <MaterialIcons name="chevron-left" size={24} color="#1e293b" />
        </TouchableOpacity>
        
        <Text style={styles.monthYear}>
          {format(currentDate, 'MMMM yyyy', { locale })}
        </Text>
        
        <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.navButton}>
          <MaterialIcons name="chevron-right" size={24} color="#1e293b" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
  },
  calendarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  navButton: {
    padding: 8,
  },
  monthYear: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
  },
  todayButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  todayButtonText: {
    marginLeft: 8,
    color: "#3b82f6",
    fontWeight: "500",
  },
  calendarContainer: {
    flex: 1,
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 20,
    backgroundColor: "#ffffff",
  },
  dayHeader: {
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  dayHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  dayCell: {
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    position: "relative",
  },
  otherMonthDay: {
    backgroundColor: "#f8fafc",
  },
  otherMonthText: {
    color: "#cbd5e1",
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
    color: "#1e293b",
  },
  meetingIndicator: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "#ef4444",
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
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
