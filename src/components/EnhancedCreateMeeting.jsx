import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Platform,
  TouchableOpacity,
  Image,
} from 'react-native';
import {
  TextInput,
  Button,
  Card,
  Title,
  Paragraph,
  Switch,
  Divider,
  Chip,
  IconButton,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../contexts/ThemeContext';
import { Meeting } from '../api/entities';
import emailService from '../api/emailService.js';

// Import services with fallbacks
let videoConferencingService = null;
let googleMapsService = null;
let fileUploadService = null;

try {
  videoConferencingService = require('@/api/videoConferencing').default;
} catch (error) {
  console.log('Video conferencing service not available:', error.message);
}

try {
  googleMapsService = require('@/api/googleMaps').default;
} catch (error) {
  console.log('Google Maps service not available:', error.message);
}

try {
  fileUploadService = require('@/api/fileUpload').default;
} catch (error) {
  console.log('File upload service not available:', error.message);
}

export default function EnhancedCreateMeeting({ navigation }) {
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
    selectedLocation: null,
    virtualPlatform: 'zoom',
    participants: [],
    attachments: [],
    preparation_tips: '',
  });

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showLocationSearch, setShowLocationSearch] = useState(false);
  const [locationSearchResults, setLocationSearchResults] = useState([]);
  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [generatedMeetingLink, setGeneratedMeetingLink] = useState(null);

  // Available platforms
  const [availablePlatforms, setAvailablePlatforms] = useState([]);

  const styles = getStyles(isDarkMode);

  useEffect(() => {
    loadAvailablePlatforms();
  }, []);

  const loadAvailablePlatforms = async () => {
    try {
      if (videoConferencingService) {
        const platforms = videoConferencingService.getAvailablePlatforms();
        setAvailablePlatforms(platforms);
      } else {
        // Fallback platforms
        setAvailablePlatforms([
          {
            id: 'zoom',
            name: 'Zoom',
            icon: '🎥',
            color: '#2D8CFF',
            enabled: true
          },
          {
            id: 'teams',
            name: 'Microsoft Teams',
            icon: '👥',
            color: '#6264A7',
            enabled: true
          },
          {
            id: 'google-meet',
            name: 'Google Meet',
            icon: '📹',
            color: '#00AC47',
            enabled: true
          }
        ]);
      }
    } catch (error) {
      console.error('Error loading platforms:', error);
    }
  };

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

  // Location handling
  const handleLocationSearch = async (query) => {
    setLocationSearchQuery(query);
    if (query.length < 3) {
      setLocationSearchResults([]);
      return;
    }

    try {
      if (googleMapsService) {
        const results = await googleMapsService.searchLocations(query);
        setLocationSearchResults(results);
      } else {
        // Fallback mock results
        const mockResults = [
          {
            id: 'mock-1',
            name: 'Office Building',
            address: '123 Main Street, City',
            fullAddress: '123 Main Street, City, State 12345'
          },
          {
            id: 'mock-2',
            name: 'Conference Center',
            address: '456 Business Ave, Downtown',
            fullAddress: '456 Business Ave, Downtown, State 67890'
          }
        ];
        setLocationSearchResults(mockResults);
      }
    } catch (error) {
      console.error('Error searching locations:', error);
      Alert.alert('Error', 'Failed to search locations');
    }
  };

  const handleLocationSelect = async (location) => {
    try {
      let details;
      if (googleMapsService) {
        details = await googleMapsService.getLocationDetails(location.id);
      } else {
        // Fallback mock details
        details = {
          id: location.id,
          name: location.name,
          address: location.address,
          location: { lat: 40.7128, lng: -74.0060 }
        };
      }
      
      setFormData(prev => ({
        ...prev,
        selectedLocation: details,
        location: details.name,
      }));
      setShowLocationSearch(false);
      setLocationSearchResults([]);
    } catch (error) {
      console.error('Error getting location details:', error);
      Alert.alert('Error', 'Failed to get location details');
    }
  };

  // Video conferencing handling
  const handleGenerateMeetingLink = async () => {
    if (formData.locationType === 'virtual' || formData.locationType === 'hybrid') {
      setIsLoading(true);
      try {
        const meetingData = {
          title: formData.title,
          date: (() => {
            const localDate = new Date(formData.date);
            const year = localDate.getFullYear();
            const month = String(localDate.getMonth() + 1).padStart(2, '0');
            const day = String(localDate.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          })(),
          time: formData.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          duration: parseInt(formData.duration),
          participants: formData.participants,
        };

        let result;
        if (videoConferencingService) {
          result = await videoConferencingService.generateMeetingLink(
            formData.virtualPlatform,
            meetingData
          );
        } else {
          // Fallback mock result
          result = {
            success: true,
            platform: formData.virtualPlatform === 'zoom' ? 'Zoom' : 
                     formData.virtualPlatform === 'teams' ? 'Teams' : 'Google Meet',
            meetingLink: `https://${formData.virtualPlatform}.com/meeting/${Math.random().toString(36).substring(2, 15)}`,
          };
        }

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

  // File handling
  const handlePickDocument = async () => {
    if (!fileUploadService) {
      Alert.alert('Info', 'File upload feature is not available. Please install required dependencies.');
      return;
    }

    try {
      const result = await fileUploadService.pickDocument({
        multiple: true,
        type: '*/*'
      });

      if (result.success) {
        setFormData(prev => ({
          ...prev,
          attachments: [...prev.attachments, ...result.files]
        }));
        Alert.alert('Success', `${result.files.length} files added`);
      }
    } catch (error) {
      console.error('Error picking documents:', error);
      Alert.alert('Error', 'Failed to pick documents');
    }
  };

  const handlePickImages = async () => {
    if (!fileUploadService) {
      Alert.alert('Info', 'Image upload feature is not available. Please install required dependencies.');
      return;
    }

    try {
      const result = await fileUploadService.pickImages({
        multiple: true
      });

      if (result.success) {
        setFormData(prev => ({
          ...prev,
          attachments: [...prev.attachments, ...result.files]
        }));
        Alert.alert('Success', `${result.files.length} images added`);
      }
    } catch (error) {
      console.error('Error picking images:', error);
      Alert.alert('Error', 'Failed to pick images');
    }
  };

  const handleRemoveAttachment = (index) => {
    setFormData(prev => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index)
    }));
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
          address: formData.selectedLocation?.address || formData.location,
          coordinates: formData.selectedLocation?.location,
          virtualPlatform: formData.virtualPlatform,
          virtualLink: generatedMeetingLink?.meetingLink,
        },
        participants: formData.participants.filter(p => p.name || p.email),
        attachments: formData.attachments,
        preparation_tips: formData.preparation_tips,
        source: 'Manual',
        confidence: 100,
      };

      const createdMeeting = await Meeting.create(meetingData);

      // Attach files to meeting if file service is available
      if (fileUploadService) {
        for (const attachment of formData.attachments) {
          await fileUploadService.attachFileToMeeting(attachment.id, createdMeeting.id);
        }
      }

      // Send email invitations to participants
      let emailInvitationResult = { sent: 0, failed: 0, errors: [] };
      if (formData.participants.length > 0) {
        try {
          const validParticipants = formData.participants.filter(p => p.name && p.email);
          if (validParticipants.length > 0) {
            emailInvitationResult = await emailService.sendMeetingInvitations(meetingData, validParticipants);
            console.log(`📧 Sent ${emailInvitationResult.sent} email invitations`);
            
            if (emailInvitationResult.failed > 0) {
              console.log(`⚠️ Failed to send ${emailInvitationResult.failed} invitations:`, emailInvitationResult.errors);
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

      // Prepare success message based on actual results
      let successMessage = 'Meeting created successfully!';
      
      // Add email invitation status
      if (formData.participants.length > 0) {
        const validParticipants = formData.participants.filter(p => p.name && p.email);
        if (validParticipants.length > 0) {
          if (emailInvitationResult.sent > 0 && emailInvitationResult.failed === 0) {
            successMessage += `\n\n📧 Email invitations sent to ${emailInvitationResult.sent} participant(s).`;
          } else if (emailInvitationResult.sent > 0 && emailInvitationResult.failed > 0) {
            successMessage += `\n\n📧 Email invitations sent to ${emailInvitationResult.sent} participant(s). ${emailInvitationResult.failed} failed to send.`;
          } else if (emailInvitationResult.failed > 0) {
            successMessage += `\n\n⚠️ Failed to send email invitations. Please check your email configuration.`;
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
                <View>
                  <TextInput
                    label="Search Location"
                    value={locationSearchQuery}
                    onChangeText={handleLocationSearch}
                    style={styles.input}
                    mode="outlined"
                    placeholder="Search for a location..."
                  />
                  
                  {locationSearchResults.length > 0 && (
                    <View style={styles.searchResults}>
                      {locationSearchResults.map((location, index) => (
                        <TouchableOpacity
                          key={location.id}
                          style={styles.searchResult}
                          onPress={() => handleLocationSelect(location)}
                        >
                          <Text style={styles.locationName}>{location.name}</Text>
                          <Text style={styles.locationAddress}>{location.address}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {formData.selectedLocation && (
                    <View style={styles.selectedLocation}>
                      <Text style={styles.locationName}>{formData.selectedLocation.name}</Text>
                      <Text style={styles.locationAddress}>{formData.selectedLocation.address}</Text>
                    </View>
                  )}
                </View>
              )}

              {(formData.locationType === 'virtual' || formData.locationType === 'hybrid') && (
                <View>
                  <Text style={styles.subsectionTitle}>Video Platform</Text>
                  <View style={styles.platformContainer}>
                    {availablePlatforms.map((platform) => (
                      <Chip
                        key={platform.id}
                        selected={formData.virtualPlatform === platform.id}
                        onPress={() => handleInputChange('virtualPlatform', platform.id)}
                        style={styles.platformChip}
                        mode="outlined"
                      >
                        {platform.icon} {platform.name}
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

            {/* Attachments */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Attachments</Text>
              
              <View style={styles.attachmentButtons}>
                <Button
                  mode="outlined"
                  onPress={handlePickDocument}
                  style={styles.attachmentButton}
                >
                  📄 Documents
                </Button>
                <Button
                  mode="outlined"
                  onPress={handlePickImages}
                  style={styles.attachmentButton}
                >
                  🖼️ Images
                </Button>
              </View>

              {formData.attachments.length > 0 && (
                <View style={styles.attachmentsList}>
                  {formData.attachments.map((attachment, index) => (
                    <View key={attachment.id} style={styles.attachmentItem}>
                      <Text style={styles.attachmentName}>{attachment.name}</Text>
                      <IconButton
                        icon="delete"
                        onPress={() => handleRemoveAttachment(index)}
                        size={20}
                      />
                    </View>
                  ))}
                </View>
              )}
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
  searchResults: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#ffffff',
  },
  searchResult: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  locationName: {
    fontSize: 16,
    fontWeight: '500',
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  locationAddress: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  selectedLocation: {
    padding: 12,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
    borderRadius: 8,
    marginTop: 8,
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
  attachmentButtons: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  attachmentButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  attachmentsList: {
    marginTop: 8,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
    borderRadius: 8,
    marginBottom: 4,
  },
  attachmentName: {
    flex: 1,
    fontSize: 14,
    color: isDarkMode ? '#ffffff' : '#000000',
  },
  submitButton: {
    marginTop: 24,
    paddingVertical: 8,
  },
});
