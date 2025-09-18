import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useTranslation } from '../translations.jsx';

export default function MaximumAlert({ 
  meeting, 
  isOpen, 
  onClose, 
  onSnooze,
  onPostpone,
  language = "en",
  countdown = 30,
  volume = 0.3,
  isMuted = false,
  onToggleMute,
  onCustomize
}) {
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [beepInterval, setBeepInterval] = useState(null);

  const { t } = useTranslation(language);

  // Initialize audio
  useEffect(() => {
    const initAudio = async () => {
      try {
        if (Platform.OS === 'web') {
          // For web, create a simple beep using Web Audio API
          setSound({ 
            play: () => playWebBeep(),
            stop: () => stopWebBeep(),
            setVolume: (vol) => setVolume(vol)
          });
        } else {
          // For mobile, we'll use a simple approach
          setSound({ 
            play: () => playMobileBeep(),
            stop: () => stopMobileBeep(),
            setVolume: (vol) => setVolume(vol)
          });
        }
      } catch (error) {
        console.log('Error loading audio:', error);
        // Fallback: no audio
        setSound({ play: () => {}, stop: () => {}, setVolume: () => {} });
      }
    };

    initAudio();

    return () => {
      stopWebBeep();
      stopMobileBeep();
    };
  }, []);

  // Web audio functions
  let webAudioContext = null;
  let webBeepInterval = null;

  const playWebBeep = () => {
    try {
      if (Platform.OS === 'web') {
        webAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        const playBeep = () => {
          const oscillator = webAudioContext.createOscillator();
          const gainNode = webAudioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(webAudioContext.destination);
          
          oscillator.frequency.setValueAtTime(800, webAudioContext.currentTime);
          oscillator.type = 'sine';
          
          gainNode.gain.setValueAtTime(volume, webAudioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, webAudioContext.currentTime + 0.5);
          
          oscillator.start(webAudioContext.currentTime);
          oscillator.stop(webAudioContext.currentTime + 0.5);
        };
        
        playBeep();
        webBeepInterval = setInterval(playBeep, 2000);
        setIsPlaying(true);
      }
    } catch (error) {
      console.log('Error playing web beep:', error);
    }
  };

  const stopWebBeep = () => {
    if (webBeepInterval) {
      clearInterval(webBeepInterval);
      webBeepInterval = null;
    }
    setIsPlaying(false);
  };

  // Mobile audio functions (using vibration as audio feedback)
  let mobileBeepInterval = null;
  let mobileSound = null;

  const playMobileBeep = async () => {
    try {
      // For mobile, we'll use a combination of vibration and system sounds
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      
      // Try to play a system sound for both iOS and Android
      const { Audio } = await import('expo-av');
      try {
        // Use a simple beep sound that works on both platforms
        const { sound } = await Audio.Sound.createAsync(
          { uri: 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav' },
          { shouldPlay: true, volume: volume, isLooping: false }
        );
        mobileSound = sound;
        console.log('Mobile audio loaded successfully');
      } catch (error) {
        console.log('Could not load external sound, using vibration only:', error);
      }
      
      // Repeat vibration pattern as audio feedback
      mobileBeepInterval = setInterval(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }, 2000);
      
      setIsPlaying(true);
    } catch (error) {
      console.log('Error playing mobile beep:', error);
    }
  };

  const stopMobileBeep = async () => {
    if (mobileBeepInterval) {
      clearInterval(mobileBeepInterval);
      mobileBeepInterval = null;
    }
    if (mobileSound) {
      try {
        await mobileSound.unloadAsync();
        mobileSound = null;
      } catch (error) {
        console.log('Error unloading mobile sound:', error);
      }
    }
    setIsPlaying(false);
  };

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
    try {
      if (sound) {
        sound.play();
      }
    } catch (error) {
      console.log('Error playing alarm:', error);
    }
  };

  const stopAlarm = async () => {
    try {
      if (sound) {
        sound.stop();
      }
    } catch (error) {
      console.log('Error stopping alarm:', error);
    }
  };

  const startVibration = () => {
    // Complex vibration pattern for maximum intensity
    const pattern = [0, 500, 200, 500, 200, 500, 200, 1000];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    
    // Repeat vibration pattern
    const vibrateInterval = setInterval(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }, 2000);

    // Store interval for cleanup
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

  const handleMainClose = () => {
    stopAlarm();
    stopVibration();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose && onClose();
  };

  const handleToggleMute = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isMuted) {
      playAlarm();
      startVibration();
    } else {
      stopAlarm();
      stopVibration();
    }
    onToggleMute && onToggleMute();
  };

  const testVibration = async () => {
    try {
      console.log('Testing vibration...');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('Vibration test successful!');
      Alert.alert('Vibration Test', 'Vibration is working! ✅');
    } catch (error) {
      console.log('Vibration test failed:', error);
      Alert.alert('Vibration Test', 'Vibration not supported on this device/emulator ❌');
    }
  };

  const testAudio = async () => {
    try {
      console.log('Testing audio...');
      if (Platform.OS === 'web') {
        // Test web audio
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        Alert.alert('Audio Test', 'Web audio is working! ✅');
      } else {
        // Test mobile audio with multiple approaches
        try {
          // First try external sound
          const { Audio } = await import('expo-av');
          const { sound } = await Audio.Sound.createAsync(
            { uri: 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav' },
            { shouldPlay: true, volume: 0.5, isLooping: false }
          );
          
          setTimeout(async () => {
            await sound.unloadAsync();
          }, 1000);
          
          Alert.alert('Audio Test', 'Mobile audio is working! ✅');
        } catch (externalError) {
          console.log('External audio failed, trying vibration as audio:', externalError);
          // Fallback to vibration as audio feedback
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            }, i * 500);
          }
          Alert.alert('Audio Test', 'Using vibration as audio feedback! 📳');
        }
      }
    } catch (error) {
      console.log('Audio test failed:', error);
      Alert.alert('Audio Test', 'Audio not supported on this device/emulator ❌');
    }
  };

  if (!meeting) return null;

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {t('maximumAlert.title')}
            </Text>
            <Text style={styles.subtitle}>
              {t('maximumAlert.subtitle')}
            </Text>
          </View>

          {/* Meeting Info */}
          <View style={styles.meetingCard}>
            <Text style={styles.meetingTitle}>
              {meeting.title}
            </Text>
            
            <View style={styles.meetingDetails}>
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={16} color="#6B7280" />
                <Text style={styles.detailText}>
                  {meeting.date} at {meeting.time}
                </Text>
              </View>
              
              {meeting.location && (
                <View style={styles.detailRow}>
                  <Ionicons name="location-outline" size={16} color="#6B7280" />
                  <Text style={styles.detailText}>
                    {typeof meeting.location === 'object' 
                      ? meeting.location.address || meeting.location 
                      : meeting.location}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Volume Control */}
          <View style={styles.volumeSection}>
            <View style={styles.volumeHeader}>
              <Text style={styles.volumeText}>
                {isMuted ? "🔇 Muted" : "🔊 Playing"}
              </Text>
              <TouchableOpacity
                onPress={handleToggleMute}
                style={styles.muteButton}
              >
                <Ionicons 
                  name={isMuted ? "volume-mute" : "volume-high"} 
                  size={20} 
                  color="#6B7280" 
                />
              </TouchableOpacity>
            </View>
            <View style={styles.volumeBar}>
              <View 
                style={[
                  styles.volumeProgress, 
                  { width: `${volume * 100}%` }
                ]} 
              />
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            {/* Main Action */}
            <TouchableOpacity
              style={styles.mainButton}
              onPress={handleMainClose}
            >
              <Ionicons name="checkmark-circle" size={20} color="white" />
              <Text style={styles.mainButtonText}>
                {t('maximumAlert.understood')}
              </Text>
            </TouchableOpacity>

            {/* Snooze Options */}
            <View style={styles.snoozeButtons}>
              <TouchableOpacity
                style={styles.snoozeButton}
                onPress={() => handleSnooze(5)}
              >
                <Ionicons name="alarm-outline" size={16} color="#6B7280" />
                <Text style={styles.snoozeButtonText}>
                  {t('maximumAlert.snooze5')}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.snoozeButton}
                onPress={() => handleSnooze(15)}
              >
                <Ionicons name="alarm-outline" size={16} color="#6B7280" />
                <Text style={styles.snoozeButtonText}>
                  {t('maximumAlert.snooze15')}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.snoozeButton}
                onPress={() => handleSnooze(60)}
              >
                <Ionicons name="alarm-outline" size={16} color="#6B7280" />
                <Text style={styles.snoozeButtonText}>
                  {t('maximumAlert.snooze60')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Postpone Button */}
            <TouchableOpacity
              style={styles.postponeButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Alert.alert('Postpone', 'Postpone functionality coming soon');
              }}
            >
              <Ionicons name="calendar-outline" size={16} color="#6B7280" />
              <Text style={styles.postponeButtonText}>
                {t('maximumAlert.postpone')}
              </Text>
            </TouchableOpacity>

            {/* Test Vibration Button */}
            <TouchableOpacity
              style={styles.testButton}
              onPress={testVibration}
            >
              <Ionicons name="phone-portrait" size={16} color="#6B7280" />
              <Text style={styles.testButtonText}>
                Test Vibration
              </Text>
            </TouchableOpacity>

            {/* Test Audio Button */}
            <TouchableOpacity
              style={styles.testButton}
              onPress={testAudio}
            >
              <Ionicons name="volume-high" size={16} color="#6B7280" />
              <Text style={styles.testButtonText}>
                Test Audio
              </Text>
            </TouchableOpacity>

            {/* Customize Button */}
            <TouchableOpacity
              style={styles.customizeButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert('Customize', 'Customize functionality coming soon');
              }}
            >
              <Ionicons name="settings-outline" size={16} color="#6B7280" />
              <Text style={styles.customizeButtonText}>
                {t('maximumAlert.customize')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: 13,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  meetingCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  meetingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 12,
  },
  meetingDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 8,
    fontWeight: '500',
  },
  volumeSection: {
    marginBottom: 20,
  },
  volumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  volumeText: {
    fontSize: 14,
    color: '#6B7280',
  },
  muteButton: {
    padding: 4,
  },
  volumeBar: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    overflow: 'hidden',
  },
  volumeProgress: {
    height: '100%',
    backgroundColor: '#10B981',
  },
  actions: {
    gap: 12,
  },
  mainButton: {
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
  },
  mainButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  snoozeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  snoozeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: 'white',
  },
  snoozeButtonText: {
    color: '#6B7280',
    fontSize: 14,
    marginLeft: 4,
  },
  postponeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: 'white',
  },
  postponeButtonText: {
    color: '#6B7280',
    fontSize: 14,
    marginLeft: 8,
  },
  customizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  customizeButtonText: {
    color: '#6B7280',
    fontSize: 14,
    marginLeft: 8,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  testButtonText: {
    color: '#6B7280',
    fontSize: 14,
    marginLeft: 8,
  },
});
