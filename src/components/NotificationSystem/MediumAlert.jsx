import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useTranslation } from '../translations.jsx';
import { getLocationString } from '../../utils/meetingHelpers';

export default function MediumAlert({ 
  meeting, 
  isOpen, 
  onClose, 
  onSnooze,
  language = "en",
  volume = 0.3,
  isMuted = false,
  onToggleMute
}) {
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const { t } = useTranslation(language);

  // Initialize audio (simplified for now)
  useEffect(() => {
    setSound({ play: () => {}, stop: () => {}, setVolume: () => {} });
  }, []);

  // Play alarm when alert opens
  useEffect(() => {
    if (isOpen && sound && !isMuted) {
      playAlarm();
      startVibration();
    } else if (!isOpen || isMuted) {
      stopAlarm();
      stopVibration();
    }
  }, [isOpen, sound, isMuted]);

  const playAlarm = async () => {
    // Simplified - just vibration for now
    setIsPlaying(true);
  };

  const stopAlarm = async () => {
    setIsPlaying(false);
  };

  const startVibration = () => {
    // Simple vibration pattern for medium intensity
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    
    // Repeat vibration pattern
    const vibrateInterval = setInterval(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }, 3000);

    setVibrationInterval(vibrateInterval);
  };

  const stopVibration = () => {
    if (vibrationInterval) {
      clearInterval(vibrationInterval);
      setVibrationInterval(null);
    }
  };

  const [vibrationInterval, setVibrationInterval] = useState(null);

  const handleSnooze = (minutes) => {
    stopAlarm();
    stopVibration();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSnooze && onSnooze(minutes);
  };

  const handleClose = () => {
    stopAlarm();
    stopVibration();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose && onClose();
  };

  if (!meeting || !isOpen) return null;

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Ionicons name="notifications" size={20} color="#F59E0B" />
            <Text style={styles.title}>
              {t('mediumAlert.title')}
            </Text>
          </View>
          
          <Text style={styles.meetingTitle}>
            {meeting.title}
          </Text>
          
          <Text style={styles.meetingTime}>
            {meeting.date} at {meeting.time}
          </Text>
          
          {meeting.location && (
            <Text style={styles.meetingLocation}>
              📍 {getLocationString(meeting.location)}
            </Text>
          )}
        </View>
        
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.snoozeButton}
            onPress={() => handleSnooze(5)}
          >
            <Text style={styles.snoozeText}>{t('mediumAlert.snooze5')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.snoozeButton}
            onPress={() => handleSnooze(15)}
          >
            <Text style={styles.snoozeText}>{t('mediumAlert.snooze15')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleClose}
          >
            <Text style={styles.dismissText}>{t('mediumAlert.dismiss')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  banner: {
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  content: {
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginLeft: 8,
  },
  meetingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  meetingTime: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  meetingLocation: {
    fontSize: 14,
    color: '#6B7280',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  snoozeButton: {
    flex: 1,
    backgroundColor: '#FEF3C7',
    padding: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  snoozeText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
  dismissButton: {
    backgroundColor: '#EF4444',
    padding: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
});
