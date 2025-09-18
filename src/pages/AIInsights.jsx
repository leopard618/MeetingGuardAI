import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button, TextInput } from 'react-native-paper';
import { Meeting } from '../api/entities';
import ConfidenceBadge from "../components/ConfidenceBadge";
import SourceBadge from "../components/SourceBadge";
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from '../components/translations.jsx';

export default function AIInsights({ language = "en" }) {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const { t } = useTranslation(language);
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    loadMeetings();
  }, []);

  const loadMeetings = async () => {
    setIsLoading(true);
    try {
      const allMeetings = await Meeting.list("-created_date");
      // Filter meetings that need review
      const needsReview = allMeetings.filter(meeting => {
        return meeting.confidence < 80 || 
               !meeting.description || 
               !meeting.duration ||
               (meeting.source === 'ChatGPT' || meeting.source === 'WhatsApp');
      });
      setMeetings(needsReview);
    } catch (error) {
      console.error("Error loading meetings:", error);
    }
    setIsLoading(false);
  };

  const getReviewReasons = (meeting) => {
    const reasons = [];
    if (meeting.confidence < 80) reasons.push(t('aiInsights.lowConfidence'));
    if (!meeting.description) reasons.push(t('aiInsights.missingDetails'));
    if (!meeting.duration) reasons.push(t('aiInsights.vagueDuration'));
    return reasons;
  };

  const startEditing = (meeting) => {
    setEditingMeeting(meeting.id);
    setEditForm({
      title: meeting.title || '',
      description: meeting.description || '',
      date: meeting.date || '',
      time: meeting.time || '',
      duration: meeting.duration || '',
    });
  };

  const cancelEditing = () => {
    setEditingMeeting(null);
    setEditForm({});
  };

  const saveChanges = async (meetingId) => {
    try {
      await Meeting.update(meetingId, editForm);
      Alert.alert("Success", t('aiInsights.meetingUpdated'));
      setEditingMeeting(null);
      setEditForm({});
      loadMeetings();
    } catch (error) {
      console.error("Error updating meeting:", error);
      Alert.alert("Error", "Failed to update meeting");
    }
  };

  const confirmAsCorrect = async (meetingId) => {
    try {
      await Meeting.update(meetingId, { confidence: 100 });
      Alert.alert("Success", t('aiInsights.fixed'));
      loadMeetings();
    } catch (error) {
      console.error("Error confirming meeting:", error);
      Alert.alert("Error", "Failed to confirm meeting");
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
    } catch (error) {
      return timeString;
    }
  };

  const handleBack = () => {
    navigation.navigate('Dashboard');
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Button
            mode="text"
            onPress={handleBack}
            style={styles.backButton}
            icon="arrow-left"
          >
            {t('aiInsights.backToDashboard')}
          </Button>
          
          <Text style={styles.title}>{t('aiInsights.title')}</Text>
          <Text style={styles.subtitle}>{t('aiInsights.subtitle')}</Text>
        </View>

        {meetings.length === 0 ? (
          <Card style={styles.noMeetingsCard}>
            <Card.Content style={styles.noMeetingsContent}>
              <Ionicons name="checkmark-circle" size={64} color="#10B981" />
              <Text style={styles.noMeetingsTitle}>{t('aiInsights.noReviewNeeded')}</Text>
              <Text style={styles.noMeetingsSubtext}>{t('aiInsights.noReviewSubtext')}</Text>
            </Card.Content>
          </Card>
        ) : (
          <View style={styles.meetingsContainer}>
            {meetings.map((meeting) => (
              <Card key={meeting.id} style={styles.meetingCard}>
                <Card.Content>
                  <View style={styles.meetingHeader}>
                    <View style={styles.meetingInfo}>
                      <Text style={styles.meetingTitle}>{meeting.title}</Text>
                      <View style={styles.badgesContainer}>
                        <ConfidenceBadge confidence={meeting.confidence} />
                        <SourceBadge source={meeting.source} />
                      </View>
                    </View>
                    <View style={styles.meetingActions}>
                      {editingMeeting === meeting.id ? (
                        <View style={styles.editActions}>
                          <Button
                            mode="contained"
                            onPress={() => saveChanges(meeting.id)}
                            style={styles.saveButton}
                          >
                            {t('aiInsights.save')}
                          </Button>
                          <Button
                            mode="outlined"
                            onPress={cancelEditing}
                            style={styles.cancelButton}
                          >
                            {t('aiInsights.cancel')}
                          </Button>
                        </View>
                      ) : (
                        <View style={styles.viewActions}>
                          <Button
                            mode="outlined"
                            onPress={() => startEditing(meeting)}
                            style={styles.editButton}
                          >
                            {t('aiInsights.edit')}
                          </Button>
                          <Button
                            mode="contained"
                            onPress={() => confirmAsCorrect(meeting.id)}
                            style={styles.confirmButton}
                          >
                            {t('aiInsights.confirm')}
                          </Button>
                        </View>
                      )}
                    </View>
                  </View>

                  {editingMeeting === meeting.id ? (
                    <View style={styles.editForm}>
                      <TextInput
                        label={t('aiInsights.title')}
                        value={editForm.title}
                        onChangeText={(text) => setEditForm({...editForm, title: text})}
                        style={styles.input}
                        theme={{
                          colors: {
                            primary: isDarkMode ? "#ffffff" : "#1e293b",
                            text: isDarkMode ? "#ffffff" : "#1e293b",
                            placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                          }
                        }}
                      />
                      <TextInput
                        label={t('aiInsights.description')}
                        value={editForm.description}
                        onChangeText={(text) => setEditForm({...editForm, description: text})}
                        multiline
                        numberOfLines={3}
                        style={styles.input}
                        theme={{
                          colors: {
                            primary: isDarkMode ? "#ffffff" : "#1e293b",
                            text: isDarkMode ? "#ffffff" : "#1e293b",
                            placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                          }
                        }}
                      />
                      <View style={styles.row}>
                        <TextInput
                          label={t('aiInsights.date')}
                          value={editForm.date}
                          onChangeText={(text) => setEditForm({...editForm, date: text})}
                          style={[styles.input, styles.halfInput]}
                          theme={{
                            colors: {
                              primary: isDarkMode ? "#ffffff" : "#1e293b",
                              text: isDarkMode ? "#ffffff" : "#1e293b",
                              placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                            }
                          }}
                        />
                        <TextInput
                          label={t('aiInsights.time')}
                          value={editForm.time}
                          onChangeText={(text) => setEditForm({...editForm, time: text})}
                          style={[styles.input, styles.halfInput]}
                          theme={{
                            colors: {
                              primary: isDarkMode ? "#ffffff" : "#1e293b",
                              text: isDarkMode ? "#ffffff" : "#1e293b",
                              placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                            }
                          }}
                        />
                      </View>
                      <TextInput
                        label={t('aiInsights.duration')}
                        value={editForm.duration}
                        onChangeText={(text) => setEditForm({...editForm, duration: text})}
                        style={styles.input}
                        theme={{
                          colors: {
                            primary: isDarkMode ? "#ffffff" : "#1e293b",
                            text: isDarkMode ? "#ffffff" : "#1e293b",
                            placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                          }
                        }}
                      />
                    </View>
                  ) : (
                    <View style={styles.meetingDetails}>
                      <Text style={styles.meetingDescription}>{meeting.description}</Text>
                      <View style={styles.meetingMeta}>
                        <View style={styles.metaItem}>
                          <Ionicons name="calendar" size={16} color="#64748B" />
                          <Text style={styles.metaText}>{meeting.date}</Text>
                        </View>
                        <View style={styles.metaItem}>
                          <Ionicons name="time" size={16} color="#64748B" />
                          <Text style={styles.metaText}>{formatTime(meeting.time)}</Text>
                        </View>
                        <View style={styles.metaItem}>
                          <Ionicons name="timer" size={16} color="#64748B" />
                          <Text style={styles.metaText}>{meeting.duration} min</Text>
                        </View>
                      </View>
                      
                      <View style={styles.reviewReasons}>
                        <Text style={styles.reasonsTitle}>{t('aiInsights.whyReview')}:</Text>
                        {getReviewReasons(meeting).map((reason, index) => (
                          <View key={index} style={styles.reasonItem}>
                            <Ionicons name="alert-circle" size={16} color="#F59E0B" />
                            <Text style={styles.reasonText}>{reason}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </Card.Content>
              </Card>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingTop: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748B',
  },
  header: {
    marginBottom: 24,
  },
  backButton: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
    lineHeight: 24,
  },
  noMeetingsCard: {
    marginTop: 20,
    backgroundColor: '#FFFFFF',
  },
  noMeetingsContent: {
    alignItems: 'center',
    padding: 32,
  },
  noMeetingsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1E293B',
    marginTop: 16,
    marginBottom: 8,
  },
  noMeetingsSubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  meetingsContainer: {
    gap: 16,
  },
  meetingCard: {
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  meetingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  meetingInfo: {
    flex: 1,
  },
  meetingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
    marginTop:10
  },
  badgesContainer: {
    marginTop:20,
    flexDirection: 'row',
    gap: 8,
  },
  meetingActions: {
    alignItems: 'flex-end',
  },
  editActions: {
    flexDirection: 'row',
    gap: 8,
    
  },
  viewActions: {
    flexDirection: 'row',
    gap: 8,
  },
  saveButton: {
    backgroundColor: '#10B981',
  },
  cancelButton: {
    borderColor: '#64748B',
  },
  editButton: {
    borderColor: '#8B5CF6',
  },
  confirmButton: {
    backgroundColor: '#8B5CF6',
  },
  editForm: {
    gap: 12,
  },
  input: {
    backgroundColor: '#F8FAFC',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  meetingDetails: {
    gap: 12,
  },
  meetingDescription: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  meetingMeta: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#64748B',
  },
  reviewReasons: {
    marginTop: 8,
  },
  reasonsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 8,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 12,
    color: '#64748B',
  },
});