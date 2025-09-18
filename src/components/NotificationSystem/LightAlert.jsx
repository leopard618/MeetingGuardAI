import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useTranslation } from '../translations.jsx';

export default function LightAlert({ 
  meeting, 
  isOpen, 
  onClose, 
  language = "en",
  autoCloseDelay = 3000
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const [sound, setSound] = useState(null);

  const { t } = useTranslation(language);

  // Initialize audio (simplified for now)
  useEffect(() => {
    setSound({ play: () => {}, stop: () => {}, setVolume: () => {} });
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Slide in and fade in
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Play light sound and vibration
      playLightAlert();

      // Auto close after delay
      const timer = setTimeout(() => {
        handleClose();
      }, autoCloseDelay);

      return () => clearTimeout(timer);
    } else {
      // Slide out and fade out
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOpen]);

  const playLightAlert = async () => {
    // Light vibration for light intensity
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Info);
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose && onClose();
  };

  if (!meeting) return null;

  return (
    <Animated.View 
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }]
        }
      ]}
    >
      <View style={styles.toast}>
        <View style={styles.content}>
          <Ionicons name="notifications-outline" size={16} color="#10B981" />
          <View style={styles.textContainer}>
            <Text style={styles.title}>
              {t('lightAlert.title')}
            </Text>
            <Text style={styles.meetingTitle}>
              {meeting.title}
            </Text>
            <Text style={styles.meetingTime}>
              {meeting.date} at {meeting.time}
            </Text>
          </View>
        </View>
        
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={handleClose}
        >
          <Ionicons name="close" size={16} color="#6B7280" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 1000,
  },
  toast: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  textContainer: {
    marginLeft: 8,
    flex: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
    marginBottom: 2,
  },
  meetingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  meetingTime: {
    fontSize: 12,
    color: '#6B7280',
  },
  dismissButton: {
    padding: 4,
  },
});
