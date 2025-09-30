import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Card, Title, Paragraph, Button, Divider } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import FloatingWidgetManager from '../services/FloatingWidgetManager';

export default function FloatingWidgetSettings({ onToggleWidget }) {
  const { isDarkMode } = useTheme();
  const [isEnabled, setIsEnabled] = useState(false);
  const [nextMeeting, setNextMeeting] = useState(null);
  const [widgetData, setWidgetData] = useState(null);

  useEffect(() => {
    loadWidgetStatus();
    
    // Set up callback to update when meeting changes
    FloatingWidgetManager.setCallbacks({
      onMeetingUpdate: (meeting) => {
        setNextMeeting(meeting);
        updateWidgetData();
      },
    });
  }, []);

  const loadWidgetStatus = async () => {
    try {
      const data = FloatingWidgetManager.getWidgetData();
      setIsEnabled(data.isEnabled);
      setNextMeeting(data.nextMeeting);
      updateWidgetData();
    } catch (error) {
      console.error('Failed to load widget status:', error);
    }
  };

  const updateWidgetData = () => {
    const data = FloatingWidgetManager.getWidgetData();
    const timeUntil = FloatingWidgetManager.getTimeUntilNextMeeting();
    const urgency = FloatingWidgetManager.getWidgetUrgency();
    const shouldShow = FloatingWidgetManager.shouldShowWidget();
    
    setWidgetData({
      ...data,
      timeUntil,
      urgency,
      shouldShow,
    });
  };

  const handleToggleWidget = async (enabled) => {
    try {
      await FloatingWidgetManager.setEnabled(enabled);
      setIsEnabled(enabled);
      
      if (onToggleWidget) {
        onToggleWidget(enabled);
      }
      
      Alert.alert(
        'Floating Widget',
        enabled 
          ? 'Floating widget enabled! It will appear when you minimize the app and have upcoming meetings.'
          : 'Floating widget disabled.'
      );
    } catch (error) {
      console.error('Failed to toggle widget:', error);
      Alert.alert('Error', 'Failed to update widget settings');
    }
  };

  const handleTestWidget = () => {
    if (!nextMeeting) {
      Alert.alert(
        'No Upcoming Meetings',
        'Create a meeting to test the floating widget functionality.'
      );
      return;
    }

    Alert.alert(
      'Test Floating Widget',
      'Minimize the app to see the floating widget in action! It will show your next meeting with a countdown timer.',
      [
        { text: 'OK', style: 'default' }
      ]
    );
  };

  const getTimeUntilText = (timeUntil) => {
    if (!timeUntil || timeUntil <= 0) return 'Meeting now';
    
    const minutes = Math.floor(timeUntil / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${minutes % 60}min`;
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  };

  const getUrgencyColor = (urgency) => {
    switch (urgency) {
      case 'now': return '#ef4444';
      case 'urgent': return '#f59e0b';
      case 'soon': return '#eab308';
      case 'upcoming': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getUrgencyText = (urgency) => {
    switch (urgency) {
      case 'now': return 'Meeting Now';
      case 'urgent': return 'Very Urgent';
      case 'soon': return 'Starting Soon';
      case 'upcoming': return 'Upcoming';
      default: return 'Scheduled';
    }
  };

  const styles = getStyles(isDarkMode);

  return (
    <Card style={styles.card}>
      <Card.Content>
        <View style={styles.header}>
          <MaterialIcons
            name="picture-in-picture-alt"
            size={24}
            color={isDarkMode ? '#60a5fa' : '#3b82f6'}
          />
          <Title style={styles.title}>Floating Widget</Title>
        </View>
        
        <Paragraph style={styles.subtitle}>
          Show a floating circle with meeting countdown when app is minimized
        </Paragraph>

        <Divider style={styles.divider} />

        {/* Enable/Disable Toggle */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Enable Floating Widget</Text>
            <Text style={styles.settingDescription}>
              Shows upcoming meetings as a floating circle overlay
            </Text>
          </View>
          <Switch
            value={isEnabled}
            onValueChange={handleToggleWidget}
            trackColor={{ false: '#767577', true: '#3b82f6' }}
            thumbColor={isEnabled ? '#ffffff' : '#f4f3f4'}
          />
        </View>

        {/* Current Status */}
        {isEnabled && (
          <>
            <Divider style={styles.divider} />
            
            <View style={styles.statusContainer}>
              <Text style={styles.sectionTitle}>Current Status</Text>
              
              {nextMeeting ? (
                <View style={styles.meetingInfo}>
                  <View style={styles.meetingHeader}>
                    <MaterialIcons
                      name="event"
                      size={20}
                      color={getUrgencyColor(widgetData?.urgency)}
                    />
                    <Text style={styles.meetingTitle} numberOfLines={1}>
                      {nextMeeting.title}
                    </Text>
                  </View>
                  
                  <View style={styles.meetingDetails}>
                    <Text style={styles.meetingTime}>
                      {nextMeeting.time} • {nextMeeting.date}
                    </Text>
                    <View style={styles.urgencyBadge}>
                      <View style={[
                        styles.urgencyDot,
                        { backgroundColor: getUrgencyColor(widgetData?.urgency) }
                      ]} />
                      <Text style={[
                        styles.urgencyText,
                        { color: getUrgencyColor(widgetData?.urgency) }
                      ]}>
                        {getUrgencyText(widgetData?.urgency)}
                      </Text>
                    </View>
                  </View>
                  
                  {widgetData?.timeUntil && (
                    <Text style={styles.timeUntil}>
                      Starts in {getTimeUntilText(widgetData.timeUntil)}
                    </Text>
                  )}
                </View>
              ) : (
                <View style={styles.noMeetingInfo}>
                  <MaterialIcons
                    name="event-busy"
                    size={32}
                    color={isDarkMode ? '#64748b' : '#9ca3af'}
                  />
                  <Text style={styles.noMeetingText}>No upcoming meetings</Text>
                  <Text style={styles.noMeetingSubtext}>
                    Widget will appear when you have meetings scheduled
                  </Text>
                </View>
              )}
            </View>

            {/* Action Buttons */}
            <Divider style={styles.divider} />
            
            <View style={styles.buttonContainer}>
              <Button
                mode="outlined"
                onPress={handleTestWidget}
                style={styles.button}
                icon="play-circle"
                disabled={!nextMeeting}
              >
                Test Widget
              </Button>
            </View>
          </>
        )}

        {/* Info Section */}
        <Divider style={styles.divider} />
        
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>How it works:</Text>
          <Text style={styles.infoText}>
            • Widget appears when app is minimized{'\n'}
            • Shows countdown to next meeting{'\n'}
            • Tap to open app instantly{'\n'}
            • Drag to move around screen{'\n'}
            • Changes color based on urgency
          </Text>
        </View>
      </Card.Content>
    </Card>
  );
}

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    card: {
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      borderRadius: 12,
      elevation: 4,
      shadowColor: isDarkMode ? '#000' : '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 8,
      marginBottom: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginLeft: 12,
    },
    subtitle: {
      fontSize: 14,
      color: isDarkMode ? '#94a3b8' : '#64748b',
      marginBottom: 16,
    },
    divider: {
      marginVertical: 16,
      backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    settingInfo: {
      flex: 1,
      marginRight: 16,
    },
    settingTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginBottom: 4,
    },
    settingDescription: {
      fontSize: 14,
      color: isDarkMode ? '#94a3b8' : '#64748b',
    },
    statusContainer: {
      marginVertical: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginBottom: 12,
    },
    meetingInfo: {
      backgroundColor: isDarkMode ? '#334155' : '#f8fafc',
      padding: 16,
      borderRadius: 8,
    },
    meetingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    meetingTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginLeft: 8,
      flex: 1,
    },
    meetingDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    meetingTime: {
      fontSize: 14,
      color: isDarkMode ? '#94a3b8' : '#64748b',
    },
    urgencyBadge: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    urgencyDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 6,
    },
    urgencyText: {
      fontSize: 12,
      fontWeight: '500',
    },
    timeUntil: {
      fontSize: 14,
      fontWeight: '500',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
    },
    noMeetingInfo: {
      alignItems: 'center',
      padding: 24,
    },
    noMeetingText: {
      fontSize: 16,
      fontWeight: '500',
      color: isDarkMode ? '#94a3b8' : '#64748b',
      marginTop: 12,
    },
    noMeetingSubtext: {
      fontSize: 14,
      color: isDarkMode ? '#64748b' : '#9ca3af',
      textAlign: 'center',
      marginTop: 4,
    },
    buttonContainer: {
      marginTop: 8,
    },
    button: {
      marginBottom: 8,
    },
    infoSection: {
      marginTop: 8,
    },
    infoTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginBottom: 8,
    },
    infoText: {
      fontSize: 13,
      color: isDarkMode ? '#94a3b8' : '#64748b',
      lineHeight: 18,
    },
  });
