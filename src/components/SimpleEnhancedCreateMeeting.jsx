import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import {
  TextInput,
  Button,
  Card,
  Title,
  Chip,
  IconButton,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/contexts/ThemeContext';
import { Meeting } from '@/api/entities';

export default function SimpleEnhancedCreateMeeting({ navigation }) {
  const { isDarkMode } = useTheme();
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    date: new Date(),
    time: new Date(),
    duration: '30',
    locationType: 'physical', // physical, virtual, hybrid
    location: '',
    virtualPlatform: 'zoom',
    participants: [],
    preparation_tips: '',
  });

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [generatedMeetingLink, setGeneratedMeetingLink] = useState(null);

  const styles = getStyles(isDarkMode);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Date and Time handling
  const handleDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const newDate = new Date(selectedDate);
      const prevTime = formData.time;
      if (prevTime instanceof Date) {
        newDate.setHours(prevTime.getHours(), prevTime.getMinutes());
      }
      setFormData(prev => ({
        ...prev,
        date: newDate,
        time: newDate,
      }));
    }
  };

  const handleTimeChange = (event, selectedTime) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const newTime = new Date(selectedTime);
      const prevDate = formData.date;
      if (prevDate instanceof Date) {
        newTime.setFullYear(prevDate.getFullYear(), prevDate.getMonth(), prevDate.getDate());
      }
      setFormData(prev => ({
        ...prev,
        time: newTime,
      }));
    }
  };

  // Video conferencing handling
  const handleGenerateMeetingLink = async () => {
    if (formData.locationType === 'virtual' || formData.locationType === 'hybrid') {
      setIsLoading(true);
      try {
        // Generate mock meeting link
        const platformNames = {
          'zoom': 'Zoom',
          'teams': 'Microsoft Teams',
          'google-meet': 'Google Meet'
        };
        
        const result = {
          success: true,
          platform: platformNames[formData.virtualPlatform] || 'Video Platform',
          meetingLink: `https://${formData.virtualPlatform}.com/meeting/${Math.random().toString(36).substring(2, 15)}`,
        };

        setGeneratedMeetingLink(result);
        Alert.alert('Success', `${result.platform} meeting link generated successfully!`);
      } catch (error) {
        console.error('Error generating meeting link:', error);
        Alert.alert('Error', 'Failed to generate meeting link');
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Participant handling
  const handleAddParticipant = () => {
    setFormData(prev => ({
      ...prev,
      participants: [...prev.participants, { name: '', email: '' }]
    }));
  };

  const handleUpdateParticipant = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      participants: prev.participants.map((p, i) => 
        i === index ? { ...p, [field]: value } : p
      )
    }));
  };

  const handleRemoveParticipant = (index) => {
    setFormData(prev => ({
      ...prev,
      participants: prev.participants.filter((_, i) => i !== index)
    }));
  };

  // Form submission
  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      Alert.alert('Error', 'Please enter a meeting title');
      return;
    }

    setIsLoading(true);
    try {
      const meetingData = {
        title: formData.title,
        description: formData.description,
        date: (() => {
          const localDate = new Date(formData.date);
          const year = localDate.getFullYear();
          const month = String(localDate.getMonth() + 1).padStart(2, '0');
          const day = String(localDate.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        })(),
        time: formData.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        duration: parseInt(formData.duration),
        location: {
          type: formData.locationType,
          address: formData.location,
          virtualPlatform: formData.virtualPlatform,
          virtualLink: generatedMeetingLink?.meetingLink,
        },
        participants: formData.participants.filter(p => p.name || p.email),
        preparation_tips: formData.preparation_tips,
        source: 'Manual',
        confidence: 100,
      };

      const createdMeeting = await Meeting.create(meetingData);

      Alert.alert(
        'Success',
        'Meeting created successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('Error creating meeting:', error);
      Alert.alert('Error', 'Failed to create meeting. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (date) => {
    return date.toLocaleDateString();
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Card style={styles.card}>
          <Card.Content>
            <Title style={styles.title}>Create Meeting</Title>

            {/* Basic Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Basic Details</Text>
              
              <TextInput
                label="Meeting Title"
                value={formData.title}
                onChangeText={(text) => handleInputChange('title', text)}
                style={styles.input}
                mode="outlined"
              />

              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.dateTimeButton}
                  onPress={() => setShowDatePicker(true)}
                >
                  <MaterialIcons name="calendar-today" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>
                    {formatDate(formData.date)}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dateTimeButton}
                  onPress={() => setShowTimePicker(true)}
                >
                  <MaterialIcons name="access-time" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>
                    {formatTime(formData.time)}
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                label="Duration (minutes)"
                value={formData.duration}
                onChangeText={(text) => handleInputChange('duration', text)}
                style={styles.input}
                mode="outlined"
                keyboardType="numeric"
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
            </View>

            {/* Location */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Location</Text>
              
              <View style={styles.locationTypeContainer}>
                {['physical', 'virtual', 'hybrid'].map((type) => (
                  <Chip
                    key={type}
                    selected={formData.locationType === type}
                    onPress={() => handleInputChange('locationType', type)}
                    style={styles.locationChip}
                    mode="outlined"
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Chip>
                ))}
              </View>

              {(formData.locationType === 'physical' || formData.locationType === 'hybrid') && (
                <TextInput
                  label="Location Address"
                  value={formData.location}
                  onChangeText={(text) => handleInputChange('location', text)}
                  style={styles.input}
                  mode="outlined"
                  placeholder="Enter meeting location..."
                />
              )}

              {(formData.locationType === 'virtual' || formData.locationType === 'hybrid') && (
                <View>
                  <Text style={styles.subsectionTitle}>Video Platform</Text>
                  <View style={styles.platformContainer}>
                    {['zoom', 'teams', 'google-meet'].map((platform) => (
                      <Chip
                        key={platform}
                        selected={formData.virtualPlatform === platform}
                        onPress={() => handleInputChange('virtualPlatform', platform)}
                        style={styles.platformChip}
                        mode="outlined"
                      >
                        {platform === 'zoom' ? '🎥 Zoom' : 
                         platform === 'teams' ? '👥 Teams' : '📹 Google Meet'}
                      </Chip>
                    ))}
                  </View>

                  <Button
                    mode="contained"
                    onPress={handleGenerateMeetingLink}
                    loading={isLoading}
                    style={styles.generateButton}
                  >
                    Generate Meeting Link
                  </Button>

                  {generatedMeetingLink && (
                    <View style={styles.generatedLink}>
                      <Text style={styles.linkTitle}>
                        ✅ {generatedMeetingLink.platform} Link Generated
                      </Text>
                      <Text style={styles.linkText}>{generatedMeetingLink.meetingLink}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Participants */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Participants</Text>
              
              {formData.participants.map((participant, index) => (
                <View key={index} style={styles.participantRow}>
                  <TextInput
                    label="Name"
                    value={participant.name}
                    onChangeText={(text) => handleUpdateParticipant(index, 'name', text)}
                    style={[styles.input, styles.participantInput]}
                    mode="outlined"
                  />
                  <TextInput
                    label="Email"
                    value={participant.email}
                    onChangeText={(text) => handleUpdateParticipant(index, 'email', text)}
                    style={[styles.input, styles.participantInput]}
                    mode="outlined"
                    keyboardType="email-address"
                  />
                  <IconButton
                    icon="delete"
                    onPress={() => handleRemoveParticipant(index)}
                    style={styles.removeButton}
                  />
                </View>
              ))}

              <Button
                mode="outlined"
                onPress={handleAddParticipant}
                style={styles.addButton}
              >
                Add Participant
              </Button>
            </View>

            {/* Submit Button */}
            <Button
              mode="contained"
              onPress={handleSubmit}
              loading={isLoading}
              style={styles.submitButton}
              disabled={!formData.title.trim()}
            >
              Create Meeting
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Date Picker */}
      {showDatePicker && (
        <DateTimePicker
          value={formData.date}
          mode="date"
          display="default"
          onChange={handleDateChange}
          minimumDate={new Date()}
        />
      )}

      {/* Time Picker */}
      {showTimePicker && (
        <DateTimePicker
          value={formData.time}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  card: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  input: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dateTimeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  dateTimeText: {
    marginLeft: 8,
    fontSize: 16,
  },
  locationTypeContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  locationChip: {
    marginRight: 8,
  },
  platformContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  platformChip: {
    marginRight: 8,
    marginBottom: 8,
  },
  generateButton: {
    marginBottom: 12,
  },
  generatedLink: {
    padding: 12,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
  },
  linkTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2e7d32',
  },
  linkText: {
    fontSize: 14,
    color: '#1b5e20',
    marginTop: 4,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  participantInput: {
    flex: 1,
    marginRight: 8,
  },
  removeButton: {
    margin: 0,
  },
  addButton: {
    marginTop: 8,
  },
  submitButton: {
    marginTop: 24,
    paddingVertical: 8,
  },
});
