import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import {
  Modal,
  Portal,
  Button,
  Card,
  Title,
  Paragraph,
  TextInput,
  Chip,
  ActivityIndicator,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { safeStringify } from '../utils';

export default function MeetingConfirmationModal({
  visible,
  onDismiss,
  meetingData,
  action,
  onConfirm,
  onCancel,
  isLoading = false,
  language = 'en',
}) {
  console.log('MeetingConfirmationModal: Received meetingData:', meetingData);
  console.log('MeetingConfirmationModal: Action:', action);
  
  const [editedData, setEditedData] = useState(meetingData || {});
  const [isEditing, setIsEditing] = useState(false);
  
  // Update editedData when meetingData changes
  useEffect(() => {
    console.log('MeetingConfirmationModal: Updating editedData with:', meetingData);
    setEditedData(meetingData || {});
  }, [meetingData]);

  const t = {
    en: {
      confirmCreate: 'Create Meeting',
      confirmUpdate: 'Update Meeting',
      confirmDelete: 'Delete Meeting',
      cancel: 'Cancel',
      edit: 'Edit',
      save: 'Save',
      meetingDetails: 'Meeting Details',
      title: 'Title',
      date: 'Date',
      time: 'Time',
      duration: 'Duration',
      location: 'Location',
      participants: 'Participants',
      description: 'Description',
      minutes: 'minutes',
      confirmDeleteMessage: 'Are you sure you want to delete this meeting?',
      delete: 'Delete',
      noParticipants: 'No participants',
      addParticipant: 'Add participant',
      participantEmail: 'Participant email',
    },
    es: {
      confirmCreate: 'Crear Reunión',
      confirmUpdate: 'Actualizar Reunión',
      confirmDelete: 'Eliminar Reunión',
      cancel: 'Cancelar',
      edit: 'Editar',
      save: 'Guardar',
      meetingDetails: 'Detalles de la Reunión',
      title: 'Título',
      date: 'Fecha',
      time: 'Hora',
      duration: 'Duración',
      location: 'Ubicación',
      participants: 'Participantes',
      description: 'Descripción',
      minutes: 'minutos',
      confirmDeleteMessage: '¿Estás seguro de que quieres eliminar esta reunión?',
      delete: 'Eliminar',
      noParticipants: 'Sin participantes',
      addParticipant: 'Agregar participante',
      participantEmail: 'Email del participante',
    },
  };

  const formatDate = (dateString) => {
    console.log('MeetingConfirmationModal: Formatting date:', dateString);
    if (!dateString) return '';
    try {
      return format(parseISO(dateString), 'EEEE, MMMM d, yyyy');
    } catch (error) {
      console.log('MeetingConfirmationModal: Error parsing date:', error);
      return dateString;
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return '';
    try {
      const [hours, minutes] = timeString.split(':');
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minutes} ${ampm}`;
    } catch {
      return timeString;
    }
  };

  const handleConfirm = () => {
    console.log('MeetingConfirmationModal: Confirming with data:', editedData);
    console.log('MeetingConfirmationModal: Title value:', editedData.title);
    console.log('MeetingConfirmationModal: Date value:', editedData.date);
    console.log('MeetingConfirmationModal: Time value:', editedData.time);
    console.log('MeetingConfirmationModal: Duration value:', editedData.duration);
    console.log('MeetingConfirmationModal: Location value:', editedData.location);
    console.log('MeetingConfirmationModal: Participants value:', editedData.participants);
    console.log('MeetingConfirmationModal: Meeting ID value:', editedData.meetingId);
    
    // For delete operations, we only need meetingId
    if (action === 'delete') {
      if (!editedData.meetingId) {
        console.error('MeetingConfirmationModal: ERROR - Meeting ID is missing for deletion!');
        Alert.alert('Error', 'Meeting ID is required for deletion');
        return;
      }
      
      // If we have meetingId but missing other fields, that's okay for deletion
      console.log('MeetingConfirmationModal: Proceeding with deletion using meeting ID:', editedData.meetingId);
      
      Alert.alert(
        t[language].confirmDelete,
        t[language].confirmDeleteMessage,
        [
          { text: t[language].cancel, style: 'cancel' },
          { text: t[language].delete, style: 'destructive', onPress: () => onConfirm(editedData) },
        ]
      );
      return;
    }
    
    // For other operations (create/update), validate all required fields
    if (!editedData.title || editedData.title.trim() === '') {
      console.error('MeetingConfirmationModal: ERROR - Title is missing!');
      Alert.alert('Error', 'Meeting title is required');
      return;
    }
    
    if (!editedData.date || editedData.date.trim() === '') {
      console.error('MeetingConfirmationModal: ERROR - Date is missing!');
      Alert.alert('Error', 'Meeting date is required');
      return;
    }
    
    if (!editedData.time || editedData.time.trim() === '') {
      console.error('MeetingConfirmationModal: ERROR - Time is missing!');
      Alert.alert('Error', 'Meeting time is required');
      return;
    }
    
    onConfirm(editedData);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = () => {
    setIsEditing(false);
    setEditedData(editedData);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedData(meetingData || {});
  };

  const addParticipant = () => {
    Alert.prompt(
      t[language].addParticipant,
      t[language].participantEmail,
      [
        { text: t[language].cancel, style: 'cancel' },
        {
          text: 'Add',
          onPress: (email) => {
            if (email && email.trim()) {
              setEditedData(prev => ({
                ...prev,
                participants: [...(prev.participants || []), email.trim()],
              }));
            }
          },
        },
      ],
      'plain-text'
    );
  };

  const removeParticipant = (index) => {
    setEditedData(prev => ({
      ...prev,
      participants: prev.participants.filter((_, i) => i !== index),
    }));
  };

  const getActionButtonText = () => {
    switch (action) {
      case 'create':
        return t[language].confirmCreate;
      case 'update':
        return t[language].confirmUpdate;
      case 'delete':
        return t[language].confirmDelete;
      default:
        return 'Confirm';
    }
  };

  const getActionButtonColor = () => {
    switch (action) {
      case 'create':
        return '#10b981';
      case 'update':
        return '#3b82f6';
      case 'delete':
        return '#ef4444';
      default:
        return '#3b82f6';
    }
  };

  if (!meetingData && action !== 'delete') {
    return null;
  }

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={styles.modal}
      >
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.header}>
              <Title style={styles.title}>{t[language].meetingDetails}</Title>
              {action !== 'delete' && (
                <Button
                  mode="text"
                  onPress={isEditing ? handleSave : handleEdit}
                  disabled={isLoading}
                >
                  {isEditing ? t[language].save : t[language].edit}
                </Button>
              )}
            </View>

            <ScrollView style={styles.content}>
              {isEditing ? (
                // Edit mode
                <View style={styles.editForm}>
                  <TextInput
                    label={t[language].title}
                    value={editedData.title || ''}
                    onChangeText={(text) => setEditedData(prev => ({ ...prev, title: text }))}
                    style={styles.input}
                    mode="outlined"
                  />
                  
                  <TextInput
                    label={t[language].date}
                    value={editedData.date || ''}
                    onChangeText={(text) => setEditedData(prev => ({ ...prev, date: text }))}
                    style={styles.input}
                    mode="outlined"
                    placeholder="YYYY-MM-DD"
                  />
                  
                  <TextInput
                    label={t[language].time}
                    value={editedData.time || ''}
                    onChangeText={(text) => setEditedData(prev => ({ ...prev, time: text }))}
                    style={styles.input}
                    mode="outlined"
                    placeholder="HH:MM"
                  />
                  
                  <TextInput
                    label={t[language].duration}
                    value={editedData.duration?.toString() || ''}
                    onChangeText={(text) => setEditedData(prev => ({ ...prev, duration: parseInt(text) || 60 }))}
                    style={styles.input}
                    mode="outlined"
                    keyboardType="numeric"
                    right={<TextInput.Affix text={t[language].minutes} />}
                  />
                  
                  <TextInput
                    label={t[language].location}
                    value={typeof editedData.location === 'string' 
                      ? editedData.location 
                      : (editedData.location && typeof editedData.location === 'object' && editedData.location.address)
                      ? editedData.location.address
                      : ''
                    }
                    onChangeText={(text) => setEditedData(prev => ({ ...prev, location: text }))}
                    style={styles.input}
                    mode="outlined"
                  />
                  
                  <TextInput
                    label={t[language].description}
                    value={editedData.description || ''}
                    onChangeText={(text) => setEditedData(prev => ({ ...prev, description: text }))}
                    style={styles.input}
                    mode="outlined"
                    multiline
                    numberOfLines={3}
                  />

                  <View style={styles.participantsSection}>
                    <Text style={styles.sectionTitle}>{t[language].participants}</Text>
                    {editedData.participants?.map((participant, index) => (
                      <Chip
                        key={index}
                        onClose={() => removeParticipant(index)}
                        style={styles.participantChip}
                      >
                        {typeof participant === 'string' 
                          ? participant 
                          : (participant && typeof participant === 'object' && participant.name)
                          ? participant.name
                          : 'Unknown participant'
                        }
                      </Chip>
                    ))}
                    <Button
                      mode="outlined"
                      onPress={addParticipant}
                      style={styles.addParticipantButton}
                    >
                      <MaterialIcons name="add" size={16} />
                      {t[language].addParticipant}
                    </Button>
                  </View>
                </View>
              ) : (
                // View mode
                <View style={styles.viewForm}>
                  {action === 'delete' && (!meetingData?.title || !meetingData?.date) ? (
                    // For delete operations with incomplete data, show a simplified view
                    <View style={styles.detailRow}>
                      <Text style={styles.label}>Meeting ID:</Text>
                      <Text style={styles.value}>{meetingData?.meetingId || 'Unknown'}</Text>
                    </View>
                  ) : (
                    // Normal view for complete meeting data
                    <>
                      <View style={styles.detailRow}>
                        <Text style={styles.label}>{t[language].title}:</Text>
                        <Text style={styles.value}>{meetingData?.title || '-'}</Text>
                      </View>
                      
                      <View style={styles.detailRow}>
                        <Text style={styles.label}>{t[language].date}:</Text>
                        <Text style={styles.value}>{formatDate(meetingData?.date) || '-'}</Text>
                      </View>
                      
                      <View style={styles.detailRow}>
                        <Text style={styles.label}>{t[language].time}:</Text>
                        <Text style={styles.value}>{formatTime(meetingData?.time) || '-'}</Text>
                      </View>
                      
                      <View style={styles.detailRow}>
                        <Text style={styles.label}>{t[language].duration}:</Text>
                        <Text style={styles.value}>
                          {meetingData?.duration ? `${meetingData.duration} ${t[language].minutes}` : '-'}
                        </Text>
                      </View>
                      
                      <View style={styles.detailRow}>
                        <Text style={styles.label}>{t[language].location}:</Text>
                        <Text style={styles.value}>
                          {typeof meetingData?.location === 'string' 
                            ? meetingData.location 
                            : (meetingData?.location && typeof meetingData.location === 'object' && meetingData.location.address)
                            ? meetingData.location.address
                            : (meetingData?.location && typeof meetingData.location === 'object' && meetingData.location.type)
                            ? `${meetingData.location.type} meeting`
                            : '-'
                          }
                        </Text>
                      </View>
                      
                      {meetingData?.description && (
                        <View style={styles.detailRow}>
                          <Text style={styles.label}>{t[language].description}:</Text>
                          <Text style={styles.value}>{meetingData.description}</Text>
                        </View>
                      )}
                    </>
                  )}
                  
                  {meetingData?.participants && meetingData.participants.length > 0 && (
                    <View style={styles.detailRow}>
                      <Text style={styles.label}>{t[language].participants}:</Text>
                      <View style={styles.participantsList}>
                        {meetingData.participants.map((participant, index) => (
                          <Chip key={index} style={styles.participantChip}>
                            {typeof participant === 'string' 
                              ? participant 
                              : (participant && typeof participant === 'object' && participant.name)
                              ? participant.name
                              : 'Unknown participant'
                            }
                          </Chip>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          </Card.Content>

          <Card.Actions style={styles.actions}>
            {isEditing ? (
              <>
                <Button onPress={handleCancel} disabled={isLoading}>
                  {t[language].cancel}
                </Button>
                <Button onPress={handleSave} disabled={isLoading}>
                  {t[language].save}
                </Button>
              </>
            ) : (
              <>
                <Button onPress={onCancel || onDismiss} disabled={isLoading}>
                  {t[language].cancel}
                </Button>
                <Button
                  mode="contained"
                  onPress={handleConfirm}
                  disabled={isLoading}
                  style={{ backgroundColor: getActionButtonColor() }}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    getActionButtonText()
                  )}
                </Button>
              </>
            )}
          </Card.Actions>
        </Card>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    maxHeight: '80%',
  },
  card: {
    maxHeight: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  content: {
    maxHeight: 400,
  },
  editForm: {
    gap: 12,
  },
  input: {
    marginBottom: 8,
  },
  viewForm: {
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  label: {
    fontWeight: '600',
    width: 80,
    marginRight: 8,
    color: '#374151',
  },
  value: {
    flex: 1,
    color: '#1f2937',
  },
  participantsSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#374151',
  },
  participantsContainer: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantsList: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantChip: {
    marginBottom: 4,
  },
  addParticipantButton: {
    marginTop: 8,
  },
  noParticipants: {
    fontStyle: 'italic',
    color: '#6b7280',
  },
  actions: {
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});