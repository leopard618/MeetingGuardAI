import React, { useState } from 'react';
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
  const [editedData, setEditedData] = useState(meetingData || {});
  const [isEditing, setIsEditing] = useState(false);

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
    if (!dateString) return '';
    try {
      return format(parseISO(dateString), 'EEEE, MMMM d, yyyy');
    } catch {
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
    if (action === 'delete') {
      Alert.alert(
        t[language].confirmDelete,
        t[language].confirmDeleteMessage,
        [
          { text: t[language].cancel, style: 'cancel' },
          { text: t[language].delete, style: 'destructive', onPress: () => onConfirm(editedData) },
        ]
      );
    } else {
      onConfirm(editedData);
    }
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
                    value={editedData.location || ''}
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
                        {participant}
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
                    <Text style={styles.value}>{meetingData?.location || '-'}</Text>
                  </View>
                  
                  {meetingData?.description && (
                    <View style={styles.detailRow}>
                      <Text style={styles.label}>{t[language].description}:</Text>
                      <Text style={styles.value}>{meetingData.description}</Text>
                    </View>
                  )}
                  
                  <View style={styles.detailRow}>
                    <Text style={styles.label}>{t[language].participants}:</Text>
                    <View style={styles.participantsContainer}>
                      {meetingData?.participants?.length > 0 ? (
                        meetingData.participants.map((participant, index) => (
                          <Chip key={index} style={styles.participantChip}>
                            {participant}
                          </Chip>
                        ))
                      ) : (
                        <Text style={styles.noParticipants}>{t[language].noParticipants}</Text>
                      )}
                    </View>
                  </View>
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