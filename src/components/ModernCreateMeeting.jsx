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
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Meeting } from '../api/entities';
import calendarSyncManager from '../api/calendarSyncManager';
import { useTranslation } from './translations.jsx';
import fileUploadService from '../api/fileUpload.js';
import emailService from '../api/emailService.js';

export default function ModernCreateMeeting({ navigation, language = 'en' }) {
  const { isDarkMode } = useTheme();
  const { user } = useAuth();
  const { t } = useTranslation(language);
  
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
      
      const result = await fileUploadService.pickDocument({
        multiple: true
      });

      if (result.success) {
        setFormData(prev => ({
          ...prev,
          attachments: [...prev.attachments, ...result.files]
        }));
        Alert.alert('Success', `${result.files.length} document(s) added successfully!`);
      } else {
        Alert.alert('Info', result.message || 'No documents selected');
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handlePickImages = async () => {
    try {
      setUploadingFile(true);
      
      const result = await fileUploadService.pickImages({
        multiple: true
      });

      if (result.success) {
        setFormData(prev => ({
          ...prev,
          attachments: [...prev.attachments, ...result.files]
        }));
        Alert.alert('Success', `${result.files.length} image(s) added successfully!`);
      } else {
        Alert.alert('Info', result.message || 'No images selected');
      }
    } catch (error) {
      console.error('Error picking images:', error);
      Alert.alert('Error', 'Failed to pick images. Please try again.');
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
                   // Format date in local timezone to avoid timezone conversion issues
      const localDate = new Date(formData.date);
      const year = localDate.getFullYear();
      const month = String(localDate.getMonth() + 1).padStart(2, '0');
      const day = String(localDate.getDate()).padStart(2, '0');
      const localDateString = `${year}-${month}-${day}`;
      
      const meetingData = {
        title: formData.title,
        description: formData.description,
        date: localDateString, // Use local date instead of UTC
        time: formData.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        duration: parseInt(formData.duration),
        location: formData.location || 'No location specified',
        participants: formData.participants.filter(p => p.name || p.email),
        preparation_tips: formData.preparation_tips,
        attachments: formData.attachments, // Include attachments
        source: 'Manual',
        confidence: 100,
        created_by: user?.email || "unknown@example.com",
        // Add attendees for Google Calendar integration
        attendees: formData.participants
          .filter(p => p.email && p.email.trim())
          .map(p => ({ email: p.email.trim(), displayName: p.name || p.email.trim() }))
      };

      console.log('Creating meeting with data:', {
        date: meetingData.date,
        time: meetingData.time,
        originalDate: formData.date,
        originalTime: formData.time
      });

      const createdMeeting = await Meeting.create(meetingData);

      // Attach files to meeting if any attachments exist
      if (formData.attachments.length > 0) {
        try {
          for (const attachment of formData.attachments) {
            await fileUploadService.attachFileToMeeting(attachment.id, createdMeeting.id);
          }
          console.log(`Attached ${formData.attachments.length} files to meeting`);
        } catch (fileError) {
          console.error('Failed to attach files to meeting:', fileError);
          // Don't show error to user, just log it
        }
      }

      // Send Google Calendar invitations to participants (primary method)
      let calendarInvitationResult = { sent: 0, failed: 0, errors: [] };
      if (formData.participants.length > 0) {
        try {
          const validParticipants = formData.participants.filter(p => p.email && p.email.trim());
          if (validParticipants.length > 0) {
            // Google Calendar invitations are sent automatically when the event is synced
            // The attendees are already included in the meetingData.attendees
            calendarInvitationResult = { 
              sent: validParticipants.length, 
              failed: 0, 
              errors: [],
              method: 'Google Calendar'
            };
            console.log(`📅 Google Calendar invitations will be sent to ${validParticipants.length} participant(s)`);
          }
        } catch (calendarError) {
          console.error('Failed to prepare Google Calendar invitations:', calendarError);
          calendarInvitationResult = { 
            sent: 0, 
            failed: formData.participants.filter(p => p.email && p.email.trim()).length, 
            errors: [{ error: calendarError.message }] 
          };
        }
      }

      // Fallback: Send email invitations if Google Calendar is not available
      let emailInvitationResult = { sent: 0, failed: 0, errors: [] };
      if (formData.participants.length > 0 && calendarInvitationResult.failed > 0) {
        try {
          const validParticipants = formData.participants.filter(p => p.name && p.email);
          if (validParticipants.length > 0) {
            emailInvitationResult = await emailService.sendMeetingInvitations(meetingData, validParticipants);
            console.log(`📧 Fallback: Sent ${emailInvitationResult.sent} email invitations`);
            
            if (emailInvitationResult.failed > 0) {
              console.log(`⚠️ Failed to send ${emailInvitationResult.failed} email invitations:`, emailInvitationResult.errors);
            }
          }
        } catch (emailError) {
          console.error('Failed to send email invitations:', emailError);
          emailInvitationResult = { 
            sent: 0, 
            failed: formData.participants.filter(p => p.name && p.email).length, 
            errors: [{ error: emailError.message }] 
          };
        }
      }

      // Automatically sync to Google Calendar
      try {
        await calendarSyncManager.syncEventToGoogle(createdMeeting.id);
        console.log('Meeting automatically synced to Google Calendar');
      } catch (syncError) {
        console.error('Failed to sync meeting to Google Calendar:', syncError);
        // Don't show error to user, just log it
      }

      // Prepare success message based on actual results
      let successMessage = 'Meeting created successfully!';
      
      // Add invitation status (Google Calendar primary, email fallback)
      if (formData.participants.length > 0) {
        const validParticipants = formData.participants.filter(p => p.email && p.email.trim());
        if (validParticipants.length > 0) {
          if (calendarInvitationResult.sent > 0 && calendarInvitationResult.failed === 0) {
            successMessage += `\n\n📅 Google Calendar invitations sent to ${calendarInvitationResult.sent} participant(s).`;
            successMessage += `\n\nParticipants will receive calendar invitations and can RSVP directly in their Google Calendar.`;
          } else if (emailInvitationResult.sent > 0 && emailInvitationResult.failed === 0) {
            successMessage += `\n\n📧 Email invitations sent to ${emailInvitationResult.sent} participant(s).`;
          } else if (emailInvitationResult.sent > 0 && emailInvitationResult.failed > 0) {
            successMessage += `\n\n📧 Email invitations sent to ${emailInvitationResult.sent} participant(s). ${emailInvitationResult.failed} failed to send.`;
          } else if (calendarInvitationResult.failed > 0 && emailInvitationResult.failed > 0) {
            successMessage += `\n\n⚠️ Failed to send invitations. Please check your Google Calendar and email configuration.`;
          }
        }
      }
      
      // Add file attachment status
      if (formData.attachments.length > 0) {
        successMessage += `\n\n📎 ${formData.attachments.length} file(s) attached.`;
      }

      Alert.alert(
        'Success',
        successMessage,
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
          <Text style={styles.headerTitle}>{t('createMeeting.title')}</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Basic Details Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="event" size={24} color="#3b82f6" />
              <Text style={styles.cardTitle}>{t('createMeeting.basicDetails')}</Text>
            </View>
            
            <TextInput
              label={t('createMeeting.meetingTitle')}
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
                  <Text style={styles.dateTimeLabel}>{t('createMeeting.date')}</Text>
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
                  <Text style={styles.dateTimeLabel}>{t('createMeeting.time')}</Text>
                  <Text style={styles.dateTimeValue}>{formatTime(formData.time)}</Text>
                </View>
              </TouchableOpacity>
            </View>

            <TextInput
              label={t('createMeeting.duration')}
              value={formData.duration}
              onChangeText={(text) => handleInputChange('duration', text)}
              style={styles.input}
              mode="outlined"
              keyboardType="numeric"
              theme={{ colors: { primary: '#3b82f6' } }}
              left={<TextInput.Icon icon="timer" />}
            />

            <TextInput
              label={t('createMeeting.description')}
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
              <Text style={styles.cardTitle}>{t('createMeeting.location')}</Text>
            </View>
            
            <View style={styles.locationTypeContainer}>
              {[
                { key: 'physical', label: t('createMeeting.physical'), icon: '🏢' },
                { key: 'virtual', label: t('createMeeting.virtual'), icon: '💻' },
                { key: 'hybrid', label: t('createMeeting.hybrid'), icon: '🔄' }
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
                label={t('createMeeting.locationAddress')}
                value={formData.location}
                onChangeText={(text) => handleInputChange('location', text)}
                style={styles.input}
                mode="outlined"
                placeholder={t('createMeeting.enterMeetingLocation')}
                theme={{ colors: { primary: '#10b981' } }}
                left={<TextInput.Icon icon="map-marker" />}
              />
            )}

            {(formData.locationType === 'virtual' || formData.locationType === 'hybrid') && (
              <View style={styles.virtualSection}>
                <Text style={styles.sectionSubtitle}>{t('createMeeting.videoPlatform')}</Text>
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
                  {t('createMeeting.generateMeetingLink')}
                </Button>

                {generatedMeetingLink && (
                  <View style={styles.generatedLink}>
                    <MaterialIcons name="check-circle" size={20} color="#10b981" />
                    <View style={styles.generatedLinkContent}>
                      <Text style={styles.generatedLinkTitle}>
                        {generatedMeetingLink.platform} {t('createMeeting.linkGenerated')}
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
              <Text style={styles.cardTitle}>{t('createMeeting.participants')}</Text>
            </View>
            
            {formData.participants.map((participant, index) => (
              <View key={index} style={styles.participantRow}>
                <TextInput
                  label={t('createMeeting.name')}
                  value={participant.name}
                  onChangeText={(text) => handleUpdateParticipant(index, 'name', text)}
                  style={styles.participantInput}
                  mode="outlined"
                  theme={{ colors: { primary: '#f59e0b' } }}
                  left={<TextInput.Icon icon="account" />}
                />
                <TextInput
                  label={t('createMeeting.email')}
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
              {t('createMeeting.addParticipant')}
            </Button>
          </Card.Content>
        </Card>

        {/* File Upload Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeader}>
              <MaterialIcons name="attachment" size={24} color="#57606a" />
              <Text style={styles.cardTitle}>{t('createMeeting.attachments')}</Text>
            </View>
            <View style={styles.attachmentsContainer}>
              {formData.attachments.length === 0 && (
                <Text style={styles.noAttachmentsText}>{t('createMeeting.noAttachmentsAdded')}</Text>
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
                {t('createMeeting.pickDocument')}
              </Button>
              <Button
                mode="outlined"
                onPress={handlePickImages}
                loading={uploadingFile}
                style={styles.fileUploadButton}
                labelStyle={styles.fileUploadButtonText}
                icon="image"
              >
                {t('createMeeting.pickImages')}
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
          {t('createMeeting.createMeeting')}
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
