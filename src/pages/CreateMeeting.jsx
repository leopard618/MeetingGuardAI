
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Platform,
  TouchableOpacity,
} from "react-native";
import {
  TextInput,
  Button,
  Card,
  Title,
  Paragraph,
  Switch,
  Divider,
} from "react-native-paper";
import { MaterialIcons } from "@expo/vector-icons";
import { Meeting } from '..\api\entities';
import { useTheme } from '..\contexts\ThemeContext';
import { useAuth } from '..\contexts\AuthContext';
import calendarSyncManager from '../api/calendarSyncManager';

export default function CreateMeeting({ navigation, route }) {
  const { isDarkMode } = useTheme();
  const { user } = useAuth();
  // Store date and time as Date objects for picker compatibility
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    date: new Date(), // Date object
    time: new Date(), // Date object (time part used)
    duration: "30",
    location: "",
    participants: "",
    preparation_tips: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [syncToGoogle, setSyncToGoogle] = useState(true);
  const styles = getStyles(isDarkMode);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Format date as YYYY-MM-DD
  const formatDate = (dateObj) => {
    if (!(dateObj instanceof Date)) return "";
    // Use local timezone to avoid date shifting
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Format time as HH:MM (24-hour)
  const formatTime = (dateObj) => {
    if (!(dateObj instanceof Date)) return "";
    return dateObj
      .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const validateDate = (dateObj) => {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateOnly = new Date(dateObj);
    dateOnly.setHours(0, 0, 0, 0);
    return dateOnly >= today;
  };

  const validateTime = (dateObj) => {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return false;
    // Accept any valid time
    return true;
  };

  const handleDateChange = (event, selectedDate) => {
    if (selectedDate) {
      // Keep the time part from formData.time
      const prevTime = formData.time;
      const newDate = new Date(selectedDate);
      if (prevTime instanceof Date) {
        newDate.setHours(prevTime.getHours(), prevTime.getMinutes());
      }
      setFormData(prev => ({
        ...prev,
        date: newDate,
        time: newDate, // keep time in sync for display
      }));
    }
  };

  const handleTimeChange = (event, selectedTime) => {
    if (selectedTime) {
      // Update only the time part, keep the date part from formData.date
      const prevDate = formData.date;
      const newDate = new Date(prevDate);
      newDate.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
      setFormData(prev => ({
        ...prev,
        time: newDate,
        date: newDate, // keep date in sync for display
      }));
    }
  };

  const openDatePicker = () => {
    setShowDatePicker(true);
  };

  const openTimePicker = () => {
    setShowTimePicker(true);
  };

  const handleDateSelect = (year, month, day) => {
    const newDate = new Date(year, month - 1, day);
    const prevTime = formData.time;
    if (prevTime instanceof Date) {
      newDate.setHours(prevTime.getHours(), prevTime.getMinutes());
    }
    setFormData(prev => ({
      ...prev,
      date: newDate,
      time: newDate,
    }));
    setShowDatePicker(false);
  };

  const handleTimeSelect = (hour, minute) => {
    const prevDate = formData.date;
    const newDate = new Date(prevDate);
    newDate.setHours(hour, minute, 0, 0);
    setFormData(prev => ({
      ...prev,
      time: newDate,
      date: newDate,
    }));
    setShowTimePicker(false);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      Alert.alert("Error", "Please enter a meeting title");
      return;
    }

    if (!validateDate(formData.date)) {
      Alert.alert("Error", "Please enter a valid date (today or later)");
      return;
    }

    if (!validateTime(formData.time)) {
      Alert.alert("Error", "Please enter a valid time");
      return;
    }

    setIsLoading(true);
    try {
      // Calculate start and end times
      const startTime = new Date(formData.date);
      startTime.setHours(formData.time.getHours(), formData.time.getMinutes());
      const endTime = new Date(startTime.getTime() + parseInt(formData.duration) * 60000);

      const meetingData = {
        title: formData.title,
        description: formData.description,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        date: formatDate(formData.date),
        time: formatTime(formData.time),
        duration: parseInt(formData.duration),
        location: formData.location,
        participants: formData.participants ? formData.participants.split(',').map(p => p.trim()) : [],
        preparation_tips: formData.preparation_tips
          ? formData.preparation_tips.split('\n').filter(tip => tip.trim())
          : [],
        source: "Manual",
        confidence: 100,
        created_by: user?.email || "unknown@example.com",
      };

      // Create meeting in app
      const createdMeeting = await Meeting.create(meetingData);

      // Schedule alerts for the new meeting
      if (route?.params?.onMeetingCreated) {
        console.log('📅 Scheduling alerts for newly created meeting:', createdMeeting.title);
        await route.params.onMeetingCreated(createdMeeting);
      }

      // Sync to Google Calendar if enabled
      if (syncToGoogle) {
        try {
          await calendarSyncManager.syncEventToGoogle(createdMeeting.id);
          Alert.alert(
            "Success",
            "Meeting created successfully and synced to Google Calendar!",
            [
              {
                text: "OK",
                onPress: () => navigation.goBack()
              }
            ]
          );
        } catch (syncError) {
          console.error("Error syncing to Google Calendar:", syncError);
          Alert.alert(
            "Partial Success",
            "Meeting created successfully, but failed to sync to Google Calendar. You can sync manually later.",
            [
              {
                text: "OK",
                onPress: () => navigation.goBack()
              }
            ]
          );
        }
      } else {
        Alert.alert(
          "Success",
          "Meeting created successfully!",
          [
            {
              text: "OK",
              onPress: () => navigation.goBack()
            }
          ]
        );
      }
    } catch (error) {
      console.error("Error creating meeting:", error);
      Alert.alert("Error", "Failed to create meeting. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Title style={styles.headerTitle}>Create New Meeting</Title>
          <Paragraph style={styles.headerSubtitle}>
            Add a new meeting to your schedule
          </Paragraph>
        </View>

        <Card style={styles.formCard}>
          <Card.Content>
            <TextInput
              label="Meeting Title *"
              value={formData.title}
              onChangeText={(text) => handleInputChange('title', text)}
              style={styles.input}
              mode="outlined"
              theme={{
                colors: {
                  primary: isDarkMode ? "#ffffff" : "#1e293b",
                  text: isDarkMode ? "#ffffff" : "#1e293b",
                  placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                }
              }}
            />

            <TextInput
              label="Description"
              value={formData.description}
              onChangeText={(text) => handleInputChange('description', text)}
              style={styles.input}
              mode="outlined"
              multiline
              numberOfLines={3}
              theme={{
                colors: {
                  primary: isDarkMode ? "#ffffff" : "#1e293b",
                  text: isDarkMode ? "#ffffff" : "#1e293b",
                  placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                }
              }}
            />
            <View>
              <TouchableOpacity
                onPress={openDatePicker}
                style={styles.dateButton}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MaterialIcons
                    name="calendar-today"
                    size={20}
                    color={isDarkMode ? "#fff" : "#1e293b"}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={{
                    color: isDarkMode ? "#fff" : "#1e293b",
                    fontSize: 16,
                  }}>
                    {formatDate(formData.date)}
                  </Text>
                </View>
                <Text style={{
                  color: isDarkMode ? "#a1a1aa" : "#64748b",
                  fontSize: 12,
                }}>
                  Date *
                </Text>
              </TouchableOpacity>
              {showDatePicker && (
                <View style={styles.pickerContainer}>
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerTitle}>Select Date</Text>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                      <MaterialIcons name="close" size={24} color={isDarkMode ? "#fff" : "#000"} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.pickerContent}>
                    {(() => {
                      const today = new Date();
                      const currentMonth = today.getMonth();
                      const currentYear = today.getFullYear();
                      const currentDay = today.getDate();
                      
                      // Get the number of days in the current month
                      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
                      
                      // Create array of valid days for this month
                      const validDays = [];
                      for (let day = 1; day <= daysInMonth; day++) {
                        validDays.push(day);
                      }
                      
                      return validDays.map((day) => {
                        // Check if this day is in the past
                        const isDisabled = day < currentDay;
                        
                        return (
                          <TouchableOpacity
                            key={day}
                            style={[
                              styles.dateOption,
                              isDisabled && styles.disabledOption
                            ]}
                            onPress={() => !isDisabled && handleDateSelect(currentYear, currentMonth + 1, day)}
                            disabled={isDisabled}
                          >
                            <Text style={[
                              styles.dateOptionText,
                              isDisabled && styles.disabledOptionText
                            ]}>
                              {day}
                            </Text>
                          </TouchableOpacity>
                        );
                      });
                    })()}
                  </View>
                </View>
              )}
            </View>
            <View >
              <TouchableOpacity
                onPress={openTimePicker}
                style={styles.dateButton}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MaterialIcons
                    name="access-time"
                    size={20}
                    color={isDarkMode ? "#fff" : "#1e293b"}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={{
                    color: isDarkMode ? "#fff" : "#1e293b",
                    fontSize: 16,
                  }}>
                    {formatTime(formData.time)}
                  </Text>
                </View>
                <Text style={{
                  color: isDarkMode ? "#a1a1aa" : "#64748b",
                  fontSize: 12,
                }}>
                  Time *
                </Text>
              </TouchableOpacity>
              {showTimePicker && (
                <View style={styles.pickerContainer}>
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerTitle}>Select Time</Text>
                    <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                      <MaterialIcons name="close" size={24} color={isDarkMode ? "#fff" : "#000"} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.pickerContent}>
                    {[
                      { hour: 9, minute: 0, label: '9:00 AM' },
                      { hour: 10, minute: 0, label: '10:00 AM' },
                      { hour: 11, minute: 0, label: '11:00 AM' },
                      { hour: 12, minute: 0, label: '12:00 PM' },
                      { hour: 13, minute: 0, label: '1:00 PM' },
                      { hour: 14, minute: 0, label: '2:00 PM' },
                      { hour: 15, minute: 0, label: '3:00 PM' },
                      { hour: 16, minute: 0, label: '4:00 PM' },
                      { hour: 17, minute: 0, label: '5:00 PM' },
                      { hour: 18, minute: 0, label: '6:00 PM' },
                    ].map((timeOption, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.timeOption}
                        onPress={() => handleTimeSelect(timeOption.hour, timeOption.minute)}
                      >
                        <Text style={styles.timeOptionText}>
                          {timeOption.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>

            <View style={styles.row}>
              <View style={styles.halfWidth}>
                <TextInput
                  label="Duration (minutes)"
                  value={formData.duration}
                  onChangeText={(text) => handleInputChange('duration', text)}
                  style={styles.input}
                  mode="outlined"
                  keyboardType="numeric"
                  theme={{
                    colors: {
                      primary: isDarkMode ? "#ffffff" : "#1e293b",
                      text: isDarkMode ? "#ffffff" : "#1e293b",
                      placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                    }
                  }}
                />
              </View>
              <View style={styles.halfWidth}>
                <TextInput
                  label="Location"
                  value={formData.location}
                  onChangeText={(text) => handleInputChange('location', text)}
                  style={styles.input}
                  mode="outlined"
                  theme={{
                    colors: {
                      primary: isDarkMode ? "#ffffff" : "#1e293b",
                      text: isDarkMode ? "#ffffff" : "#1e293b",
                      placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                    }
                  }}
                />
              </View>
            </View>

            <TextInput
              label="Participants (comma separated)"
              value={formData.participants}
              onChangeText={(text) => handleInputChange('participants', text)}
              style={styles.input}
              mode="outlined"
              placeholder="john@example.com, jane@example.com"
              theme={{
                colors: {
                  primary: isDarkMode ? "#ffffff" : "#1e293b",
                  text: isDarkMode ? "#ffffff" : "#1e293b",
                  placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                }
              }}
            />

            <TextInput
              label="Preparation Tips (one per line)"
              value={formData.preparation_tips}
              onChangeText={(text) => handleInputChange('preparation_tips', text)}
              style={styles.input}
              mode="outlined"
              multiline
              numberOfLines={4}
              placeholder="Review agenda\nPrepare slides\nTest equipment"
              theme={{
                colors: {
                  primary: isDarkMode ? "#ffffff" : "#1e293b",
                  text: isDarkMode ? "#ffffff" : "#1e293b",
                  placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                }
              }}
            />

            <Divider style={styles.divider} />

            <View style={styles.syncSection}>
              <View style={styles.syncHeader}>
                <MaterialIcons
                  name="sync"
                  size={20}
                  color={isDarkMode ? "#60a5fa" : "#3b82f6"}
                />
                <Text style={[styles.syncTitle, { color: isDarkMode ? "#f1f5f9" : "#1e293b" }]}>
                  Google Calendar Sync
                </Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={[styles.syncLabel, { color: isDarkMode ? "#94a3b8" : "#64748b" }]}>
                  Sync to Google Calendar
                </Text>
                <Switch
                  value={syncToGoogle}
                  onValueChange={setSyncToGoogle}
                  color={isDarkMode ? "#60a5fa" : "#3b82f6"}
                />
              </View>
              <Text style={[styles.syncDescription, { color: isDarkMode ? "#94a3b8" : "#64748b" }]}>
                Automatically create this meeting in your Google Calendar
              </Text>
            </View>
          </Card.Content>
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={isLoading}
            disabled={isLoading}
            style={styles.submitButton}
            contentStyle={styles.submitButtonContent}
          >
            Create Meeting
          </Button>

          <Button
            mode="outlined"
            onPress={() => navigation.goBack()}
            style={styles.cancelButton}
          >
            Cancel
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? "#0a0a0a" : "#f8fafc",
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 24,
    paddingTop: 32,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 8,
    color: isDarkMode ? "#ffffff" : "#1e293b",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 16,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    textAlign: "center",
  },
  formCard: {
    margin: 20,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
    textColor: isDarkMode ? "#ffffff" : "#1e293b",
  },
  input: {
    marginBottom: 16,
    backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
  },
  row: {
    flexDirection: "row",
    marginBottom: 16,
  },
  halfWidth: {
    flex: 1,
    marginHorizontal: 4,
  },
  dateButton: {
    height: 56,
    justifyContent: "center",
    backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  buttonContainer: {
    padding: 20,
    gap: 12,
  },
  submitButton: {
    marginBottom: 8,
    borderRadius: 12,
  },
  submitButtonContent: {
    height: 48,
  },
  cancelButton: {
    height: 48,
    borderRadius: 12,
  },
  pickerContainer: {
    backgroundColor: isDarkMode ? "#262626" : "#ffffff",
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: isDarkMode ? "#374151" : "#e5e7eb",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? "#374151" : "#e5e7eb",
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  pickerContent: {
    padding: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dateOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: isDarkMode ? "#374151" : "#f3f4f6",
    justifyContent: "center",
    alignItems: "center",
    margin: 2,
  },
  dateOptionText: {
    fontSize: 14,
    fontWeight: "500",
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  disabledOption: {
    backgroundColor: isDarkMode ? "#1f2937" : "#f1f5f9",
  },
  disabledOptionText: {
    color: isDarkMode ? "#6b7280" : "#94a3b8",
  },
  timeOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: isDarkMode ? "#374151" : "#f3f4f6",
    borderRadius: 8,
    margin: 2,
  },
  timeOptionText: {
    fontSize: 14,
    fontWeight: "500",
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  divider: {
    marginVertical: 16,
  },
  syncSection: {
    marginTop: 8,
  },
  syncHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  syncTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  syncRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  syncLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  syncDescription: {
    fontSize: 12,
    fontStyle: "italic",
  },
});
