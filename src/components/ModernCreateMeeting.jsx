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
import { useAuth } from '@/contexts/AuthContext';
import { Meeting } from '@/api/entities';
import calendarSyncManager from '@/api/calendarSyncManager';

export default function ModernCreateMeeting({ navigation }) {
  const { isDarkMode } = useTheme();
  const { user } = useAuth();
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    date: new Date(),
    time: new Date(),
    duration: '30',
    locationType: 'physical',
    location: '',
    virtualPlatform: 'zoom',
    participants: [],
    preparation_tips: '',
    attachments: [], // Add attachments array
  });

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [generatedMeetingLink, setGeneratedMeetingLink] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);

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

  // File upload handling
  const handlePickDocument = async () => {
    try {
      setUploadingFile(true);
      // For now, simulate file picking
      const mockFile = {
        id: Date.now().toString(),
        name: `Document_${Date.now()}.pdf`,
        type: 'application/pdf',
        size: '2.5 MB',
        uri: 'mock://document.pdf'
      };
      
      setFormData(prev => ({
        ...prev,
        attachments: [...prev.attachments, mockFile]
      }));
      
      Alert.alert('Success', 'Document added successfully!');
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    } finally {
      setUploadingFile(false);
    }
  };

  const handlePickImages = async () => {
    try {
      setUploadingFile(true);
      // For now, simulate image picking
      const mockImage = {
        id: Date.now().toString(),
        name: `Image_${Date.now()}.jpg`,
        type: 'image/jpeg',
        size: '1.2 MB',
        uri: 'mock://image.jpg'
      };
      
      setFormData(prev => ({
        ...prev,
        attachments: [...prev.attachments, mockImage]
      }));
      
      Alert.alert('Success', 'Image added successfully!');
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleRemoveAttachment = (index) => {
    setFormData(prev => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index)
    }));
  };

  const getFileIcon = (fileType) => {
    let iconText = '📎'; // default icon
    
    if (fileType.startsWith('image/')) {
      iconText = '🖼️';
    } else if (fileType.includes('pdf')) {
      iconText = '📄';
    } else if (fileType.includes('word') || fileType.includes('document')) {
      iconText = '📝';
    } else if (fileType.includes('excel') || fileType.includes('spreadsheet')) {
      iconText = '📊';
    } else if (fileType.includes('powerpoint') || fileType.includes('presentation')) {
      iconText = '📈';
    }
    
    return <Text style={styles.fileIconText}>{iconText}</Text>;
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
        date: formData.date.toISOString().split('T')[0],
        time: formData.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        duration: parseInt(formData.duration),
        location: formData.location || 'No location specified',
        participants: formData.participants.filter(p => p.name || p.email),
        preparation_tips: formData.preparation_tips,
        attachments: formData.attachments, // Include attachments
        source: 'Manual',
        confidence: 100,
        created_by: user?.email || "unknown@example.com",
      };

      console.log('Creating meeting with data:', {
        date: meetingData.date,
        time: meetingData.time,
        originalDate: formData.date,
        originalTime: formData.time
      });

      const createdMeeting = await Meeting.create(meetingData);

      // Automatically sync to Google Calendar
      try {
        await calendarSyncManager.syncEventToGoogle(createdMeeting.id);
        console.log('Meeting automatically synced to Google Calendar');
      } catch (syncError) {
        console.error('Failed to sync meeting to Google Calendar:', syncError);
        // Don't show error to user, just log it
      }

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
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? '#fff' : '#333'} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Meeting</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Basic Details Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="event" size={24} color="#3b82f6" />
              <Text style={styles.cardTitle}>Basic Details</Text>
            </View>
            
            <TextInput
              label="Meeting Title"
              value={formData.title}
              onChangeText={(text) => handleInputChange('title', text)}
              style={styles.input}
              mode="outlined"
              theme={{ colors: { primary: '#3b82f6' } }}
              left={<TextInput.Icon icon="format-title" />}
            />

            <View style={styles.dateTimeContainer}>
              <TouchableOpacity
                style={styles.dateTimeButton}
                onPress={() => setShowDatePicker(true)}
              >
                <MaterialIcons name="calendar-today" size={20} color="#3b82f6" />
                <View style={styles.dateTimeContent}>
                  <Text style={styles.dateTimeLabel}>Date</Text>
                  <Text style={styles.dateTimeValue}>{formatDate(formData.date)}</Text>
                </View>
              </TouchableOpacity>

            </View>

            <View style={styles.dateTimeContainer}>

              <TouchableOpacity
                style={styles.dateTimeButton}
                onPress={() => setShowTimePicker(true)}
              >
                <MaterialIcons name="access-time" size={20} color="#3b82f6" />
                <View style={styles.dateTimeContent}>
                  <Text style={styles.dateTimeLabel}>Time</Text>
                  <Text style={styles.dateTimeValue}>{formatTime(formData.time)}</Text>
                </View>
              </TouchableOpacity>
            </View>

            <TextInput
              label="Duration (minutes)"
              value={formData.duration}
              onChangeText={(text) => handleInputChange('duration', text)}
              style={styles.input}
              mode="outlined"
              keyboardType="numeric"
              theme={{ colors: { primary: '#3b82f6' } }}
              left={<TextInput.Icon icon="timer" />}
            />

            <TextInput
              label="Description"
              value={formData.description}
              onChangeText={(text) => handleInputChange('description', text)}
              style={styles.input}
              mode="outlined"
              multiline
              numberOfLines={3}
              theme={{ colors: { primary: '#3b82f6' } }}
              left={<TextInput.Icon icon="text" />}
            />
          </Card.Content>
        </Card>

        {/* Location Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="location-on" size={24} color="#10b981" />
              <Text style={styles.cardTitle}>Location</Text>
            </View>
            
            <View style={styles.locationTypeContainer}>
              {[
                { key: 'physical', label: 'Physical', icon: '🏢' },
                { key: 'virtual', label: 'Virtual', icon: '💻' },
                { key: 'hybrid', label: 'Hybrid', icon: '🔄' }
              ].map((type) => (
                <TouchableOpacity
                  key={type.key}
                  style={[
                    styles.locationTypeButton,
                    formData.locationType === type.key && styles.locationTypeButtonActive
                  ]}
                  onPress={() => handleInputChange('locationType', type.key)}
                >
                  <Text style={styles.locationTypeIcon}>{type.icon}</Text>
                  <Text style={[
                    styles.locationTypeText,
                    formData.locationType === type.key && styles.locationTypeTextActive
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
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
                theme={{ colors: { primary: '#10b981' } }}
                left={<TextInput.Icon icon="map-marker" />}
              />
            )}

            {(formData.locationType === 'virtual' || formData.locationType === 'hybrid') && (
              <View style={styles.virtualSection}>
                <Text style={styles.sectionSubtitle}>Video Platform</Text>
                <View style={styles.platformContainer}>
                  {[
                    { id: 'zoom', name: 'Zoom', icon: '🎥' },
                    { id: 'teams', name: 'Teams', icon: '👥' },
                    { id: 'google-meet', name: 'Meet', icon: '📹' }
                  ].map((platform) => (
                    <TouchableOpacity
                      key={platform.id}
                      style={[
                        styles.platformButton,
                        formData.virtualPlatform === platform.id && styles.platformButtonActive
                      ]}
                      onPress={() => handleInputChange('virtualPlatform', platform.id)}
                    >
                      <Text style={styles.platformIcon}>{platform.icon}</Text>
                      <Text style={[
                        styles.platformText,
                        formData.virtualPlatform === platform.id && styles.platformTextActive
                      ]}>
                        {platform.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Button
                  mode="contained"
                  onPress={handleGenerateMeetingLink}
                  loading={isLoading}
                  style={styles.generateButton}
                  labelStyle={styles.generateButtonText}
                  icon="video"
                >
                  Generate Meeting Link
                </Button>

                {generatedMeetingLink && (
                  <View style={styles.generatedLink}>
                    <MaterialIcons name="check-circle" size={20} color="#10b981" />
                    <View style={styles.generatedLinkContent}>
                      <Text style={styles.generatedLinkTitle}>
                        {generatedMeetingLink.platform} Link Generated
                      </Text>
                      <Text style={styles.generatedLinkText}>{generatedMeetingLink.meetingLink}</Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </Card.Content>
        </Card>

        {/* Participants Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="people" size={24} color="#f59e0b" />
              <Text style={styles.cardTitle}>Participants</Text>
            </View>
            
            {formData.participants.map((participant, index) => (
              <View key={index} style={styles.participantRow}>
                <TextInput
                  label="Name"
                  value={participant.name}
                  onChangeText={(text) => handleUpdateParticipant(index, 'name', text)}
                  style={styles.participantInput}
                  mode="outlined"
                  theme={{ colors: { primary: '#f59e0b' } }}
                  left={<TextInput.Icon icon="account" />}
                />
                <TextInput
                  label="Email"
                  value={participant.email}
                  onChangeText={(text) => handleUpdateParticipant(index, 'email', text)}
                  style={styles.participantInput}
                  mode="outlined"
                  keyboardType="email-address"
                  theme={{ colors: { primary: '#f59e0b' } }}
                  left={<TextInput.Icon icon="email" />}
                />
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemoveParticipant(index)}
                >
                  <MaterialIcons name="delete" size={20} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}

            <Button
              mode="outlined"
              onPress={handleAddParticipant}
              style={styles.addButton}
              labelStyle={styles.addButtonText}
              icon="account-plus"
            >
              Add Participant
            </Button>
          </Card.Content>
        </Card>

        {/* File Upload Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="attachment" size={24} color="#57606a" />
              <Text style={styles.cardTitle}>Attachments</Text>
            </View>
            <View style={styles.attachmentsContainer}>
              {formData.attachments.length === 0 && (
                <Text style={styles.noAttachmentsText}>No attachments added yet.</Text>
              )}
              {formData.attachments.map((attachment, index) => (
                <View key={attachment.id} style={styles.attachmentItem}>
                  <View style={styles.attachmentIcon}>
                    {getFileIcon(attachment.type)}
                  </View>
                  <View style={styles.attachmentInfo}>
                    <Text style={styles.attachmentName}>{attachment.name}</Text>
                    <Text style={styles.attachmentSize}>{attachment.size}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.removeAttachmentButton}
                    onPress={() => handleRemoveAttachment(index)}
                  >
                    <MaterialIcons name="delete" size={20} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.fileUploadButtons}>
              <Button
                mode="outlined"
                onPress={handlePickDocument}
                loading={uploadingFile}
                style={styles.fileUploadButton}
                labelStyle={styles.fileUploadButtonText}
                icon="file-document"
              >
                Pick Document
              </Button>
              <Button
                mode="outlined"
                onPress={handlePickImages}
                loading={uploadingFile}
                style={styles.fileUploadButton}
                labelStyle={styles.fileUploadButtonText}
                icon="image"
              >
                Pick Images
              </Button>
            </View>
          </Card.Content>
        </Card>

        {/* Submit Button */}
        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={isLoading}
          style={styles.submitButton}
          labelStyle={styles.submitButtonText}
          disabled={!formData.title.trim()}
          icon="check"
        >
          Create Meeting
        </Button>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
  },
  placeholder: {
    width: 40,
  },
  card: {
    marginBottom: 20,
    borderRadius: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? '#2d2d2d' : '#fff',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
    color: isDarkMode ? '#fff' : '#333',
  },
  input: {
    marginBottom: 16,
    backgroundColor: isDarkMode ? '#1f1f1f' : '#f8f9fa',
  },
  dateTimeContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 12,
  },
  dateTimeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: isDarkMode ? '#1f1f1f' : '#f8f9fa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDarkMode ? '#404040' : '#e5e7eb',
  },
  dateTimeContent: {
    marginLeft: 12,
    flex: 1,
  },
  dateTimeLabel: {
    fontSize: 12,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    marginBottom: 2,
  },
  dateTimeValue: {
    fontSize: 14,
    fontWeight: '500',
    color: isDarkMode ? '#fff' : '#333',
  },
  locationTypeContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  locationTypeButton: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    backgroundColor: isDarkMode ? '#1f1f1f' : '#f8f9fa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDarkMode ? '#404040' : '#e5e7eb',
  },
  locationTypeButtonActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  locationTypeIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  locationTypeText: {
    fontSize: 12,
    fontWeight: '500',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  locationTypeTextActive: {
    color: '#fff',
  },
  virtualSection: {
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: isDarkMode ? '#fff' : '#333',
  },
  platformContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  platformButton: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    backgroundColor: isDarkMode ? '#1f1f1f' : '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: isDarkMode ? '#404040' : '#e5e7eb',
  },
  platformButtonActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  platformIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  platformText: {
    fontSize: 12,
    fontWeight: '500',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  platformTextActive: {
    color: '#fff',
  },
  generateButton: {
    marginBottom: 16,
    backgroundColor: '#10b981',
  },
  generateButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  generatedLink: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#ecfdf5',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  generatedLinkContent: {
    marginLeft: 12,
    flex: 1,
  },
  generatedLinkTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#065f46',
    marginBottom: 2,
  },
  generatedLinkText: {
    fontSize: 12,
    color: '#047857',
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  participantInput: {
    flex: 1,
    backgroundColor: isDarkMode ? '#1f1f1f' : '#f8f9fa',
  },
  removeButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#fef2f2',
  },
  addButton: {
    marginBottom: 16,
    borderColor: '#f59e0b',
  },
  addButtonText: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    marginTop: 20,
    marginBottom: 40,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  attachmentsContainer: {
    marginBottom: 16,
  },
  noAttachmentsText: {
    fontSize: 14,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    textAlign: 'center',
    paddingVertical: 10,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: isDarkMode ? '#1f1f1f' : '#f8f9fa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDarkMode ? '#404040' : '#e5e7eb',
    marginBottom: 8,
  },
  attachmentIcon: {
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 14,
    fontWeight: '500',
    color: isDarkMode ? '#fff' : '#333',
  },
  attachmentSize: {
    fontSize: 12,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  removeAttachmentButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#fef2f2',
  },
  fileUploadButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10,
  },
  fileUploadButton: {
    flex: 1,
    marginHorizontal: 5,
  },
  fileUploadButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  fileIconText: {
    fontSize: 24,
  },
});
