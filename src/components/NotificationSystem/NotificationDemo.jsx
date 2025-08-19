import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NotificationManager from './NotificationManager';

export default function NotificationDemo() {
  const [currentAlert, setCurrentAlert] = useState(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [selectedIntensity, setSelectedIntensity] = useState('maximum');

  // Sample meeting data
  const sampleMeeting = {
    id: 'demo-1',
    title: 'Demo Meeting',
    date: new Date().toISOString().split('T')[0],
    time: new Date(Date.now() + 5 * 60 * 1000).toTimeString().slice(0, 5), // 5 minutes from now
    location: 'Conference Room A',
    confidence: 0.95,
    source: 'demo'
  };

  const handleTriggerAlert = (intensity) => {
    setSelectedIntensity(intensity);
    setCurrentAlert(sampleMeeting);
    setIsAlertOpen(true);
  };

  const handleCloseAlert = () => {
    setIsAlertOpen(false);
    setCurrentAlert(null);
  };

  const handleSnooze = (minutes) => {
    Alert.alert('Snoozed', `Alert snoozed for ${minutes} minutes`);
    handleCloseAlert();
  };

  const handlePostpone = (newDateTime) => {
    Alert.alert('Postponed', `Meeting postponed to: ${newDateTime.date} ${newDateTime.time}`);
    handleCloseAlert();
  };

  const intensityConfigs = [
    {
      intensity: 'maximum',
      title: 'Maximum Intensity',
      description: 'Full-screen takeover with progressive audio, vibration, and voice synthesis',
      color: '#EF4444',
      icon: 'warning'
    },
    {
      intensity: 'medium',
      title: 'Medium Intensity',
      description: 'Persistent banner with standard audio and vibration patterns',
      color: '#F59E0B',
      icon: 'notifications'
    },
    {
      intensity: 'light',
      title: 'Light Intensity',
      description: 'Toast notification with brief sound and auto-dismiss',
      color: '#10B981',
      icon: 'checkmark-circle'
    }
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Notification System Demo
        </Text>
        <Text style={styles.subtitle}>
          Test the different notification intensity levels and features
        </Text>
      </View>

      {/* Intensity Level Cards */}
      <View style={styles.cardsContainer}>
        {intensityConfigs.map((config) => (
          <View key={config.intensity} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconContainer, { backgroundColor: config.color }]}>
                <Ionicons name={config.icon} size={20} color="white" />
              </View>
              <Text style={styles.cardTitle}>{config.title}</Text>
            </View>
            
            <Text style={styles.cardDescription}>
              {config.description}
            </Text>
            
            <TouchableOpacity
              style={[styles.testButton, { backgroundColor: config.color }]}
              onPress={() => handleTriggerAlert(config.intensity)}
            >
              <Ionicons name="play" size={16} color="white" />
              <Text style={styles.testButtonText}>
                Test {config.title}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Features Overview */}
      <View style={styles.featuresCard}>
        <View style={styles.featuresHeader}>
          <Ionicons name="phone-portrait" size={20} color="#6B7280" />
          <Text style={styles.featuresTitle}>System Features</Text>
        </View>
        
        <View style={styles.featuresGrid}>
          <View style={styles.featureColumn}>
            <Text style={styles.featureTitle}>Audio System</Text>
            <Text style={styles.featureItem}>• Progressive volume increase</Text>
            <Text style={styles.featureItem}>• Different frequency patterns</Text>
            <Text style={styles.featureItem}>• Voice synthesis</Text>
            <Text style={styles.featureItem}>• Mute/unmute functionality</Text>
          </View>
          
          <View style={styles.featureColumn}>
            <Text style={styles.featureTitle}>Vibration System</Text>
            <Text style={styles.featureItem}>• Complex patterns (max)</Text>
            <Text style={styles.featureItem}>• Simple patterns (medium)</Text>
            <Text style={styles.featureItem}>• Single vibration (light)</Text>
            <Text style={styles.featureItem}>• Mobile-optimized</Text>
          </View>
          
          <View style={styles.featureColumn}>
            <Text style={styles.featureTitle}>Visual Design</Text>
            <Text style={styles.featureItem}>• Full-screen overlay</Text>
            <Text style={styles.featureItem}>• Persistent banner</Text>
            <Text style={styles.featureItem}>• Toast notification</Text>
            <Text style={styles.featureItem}>• Smooth animations</Text>
          </View>
          
          <View style={styles.featureColumn}>
            <Text style={styles.featureTitle}>User Actions</Text>
            <Text style={styles.featureItem}>• Snooze options</Text>
            <Text style={styles.featureItem}>• Postpone meeting</Text>
            <Text style={styles.featureItem}>• Customize settings</Text>
            <Text style={styles.featureItem}>• Auto-close countdown</Text>
          </View>
        </View>
      </View>

      {/* Current Status */}
      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Current Status</Text>
        <View style={styles.statusContent}>
          <Text style={styles.statusText}>
            <Text style={styles.statusLabel}>Selected Intensity:</Text> {selectedIntensity}
          </Text>
          <Text style={styles.statusText}>
            <Text style={styles.statusLabel}>Alert Status:</Text> {isAlertOpen ? 'Active' : 'Inactive'}
          </Text>
          
          {isAlertOpen && (
            <TouchableOpacity
              style={styles.stopButton}
              onPress={handleCloseAlert}
            >
              <Ionicons name="stop" size={16} color="white" />
              <Text style={styles.stopButtonText}>Stop Current Alert</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Notification Manager */}
      <NotificationManager
        meeting={currentAlert}
        isOpen={isAlertOpen}
        onClose={handleCloseAlert}
        onSnooze={handleSnooze}
        onPostpone={handlePostpone}
        intensity={selectedIntensity}
        language="en"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
  },
  cardsContainer: {
    gap: 16,
    marginBottom: 24,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  cardDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 20,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
  },
  testButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  featuresCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  featuresHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  featuresTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginLeft: 8,
  },
  featuresGrid: {
    gap: 16,
  },
  featureColumn: {
    marginBottom: 16,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
  },
  featureItem: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  statusCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  statusContent: {
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#6B7280',
  },
  statusLabel: {
    fontWeight: '500',
    color: '#374151',
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
  },
  stopButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
});
