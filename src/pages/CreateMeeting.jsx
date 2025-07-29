
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Platform,
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
import { Meeting } from "@/api/entities";

export default function CreateMeeting({ navigation }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
    time: new Date().toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    }), // HH:MM format
    duration: "30",
    location: "",
    participants: "",
    preparation_tips: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const validateDate = (dateString) => {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && date >= new Date().setHours(0, 0, 0, 0);
  };

  const validateTime = (timeString) => {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeString);
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      Alert.alert("Error", "Please enter a meeting title");
      return;
    }

    if (!validateDate(formData.date)) {
      Alert.alert("Error", "Please enter a valid date (YYYY-MM-DD format)");
      return;
    }

    if (!validateTime(formData.time)) {
      Alert.alert("Error", "Please enter a valid time (HH:MM format, 24-hour)");
      return;
    }

    setIsLoading(true);
    try {
      const meetingData = {
        title: formData.title,
        description: formData.description,
        date: formData.date,
        time: formData.time,
        duration: parseInt(formData.duration),
        location: formData.location,
        participants: formData.participants,
        preparation_tips: formData.preparation_tips ? 
          formData.preparation_tips.split('\n').filter(tip => tip.trim()) : [],
        source: "Manual",
        confidence: 100,
        created_by: "user@example.com", // This should come from user context
      };

      await Meeting.create(meetingData);
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
            />

            <TextInput
              label="Description"
              value={formData.description}
              onChangeText={(text) => handleInputChange('description', text)}
              style={styles.input}
              mode="outlined"
              multiline
              numberOfLines={3}
            />

            <View style={styles.row}>
              <View style={styles.halfWidth}>
                <TextInput
                  label="Date (YYYY-MM-DD) *"
                  value={formData.date}
                  onChangeText={(text) => handleInputChange('date', text)}
                  style={styles.input}
                  mode="outlined"
                  placeholder="2024-01-15"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.halfWidth}>
                <TextInput
                  label="Time (HH:MM) *"
                  value={formData.time}
                  onChangeText={(text) => handleInputChange('time', text)}
                  style={styles.input}
                  mode="outlined"
                  placeholder="14:30"
                  keyboardType="numeric"
                />
              </View>
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
                />
              </View>
              <View style={styles.halfWidth}>
                <TextInput
                  label="Location"
                  value={formData.location}
                  onChangeText={(text) => handleInputChange('location', text)}
                  style={styles.input}
                  mode="outlined"
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
            />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  formCard: {
    margin: 20,
    elevation: 2,
  },
  input: {
    marginBottom: 16,
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
  },
  buttonContainer: {
    padding: 20,
    gap: 12,
  },
  submitButton: {
    marginBottom: 8,
  },
  submitButtonContent: {
    height: 48,
  },
  cancelButton: {
    height: 48,
  },
});
