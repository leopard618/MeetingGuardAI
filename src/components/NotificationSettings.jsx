import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { Card, Title, Paragraph, Button, Divider } from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import EnhancedNotificationManager from '../services/EnhancedNotificationManager';
import BackgroundTaskManager from '../services/BackgroundTaskManager';

export default function NotificationSettings() {
  const { isDarkMode } = useTheme();
  const [notificationStatus, setNotificationStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadNotificationStatus();
  }, []);

  const loadNotificationStatus = async () => {
    try {
      setIsLoading(true);
      const status = await EnhancedNotificationManager.getNotificationStatus();
      setNotificationStatus(status);
    } catch (error) {
      console.error('Failed to load notification status:', error);
      Alert.alert('Error', 'Failed to load notification settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInitializeNotifications = async () => {
    try {
      setRefreshing(true);
      const success = await EnhancedNotificationManager.initialize();
      
      if (success) {
        Alert.alert('Success', 'Notification system initialized successfully!');
        await loadNotificationStatus();
      } else {
        Alert.alert('Error', 'Failed to initialize notifications. Please check permissions.');
      }
    } catch (error) {
      console.error('Failed to initialize notifications:', error);
      Alert.alert('Error', 'Failed to initialize notification system');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefreshNotifications = async () => {
    try {
      setRefreshing(true);
      const result = await EnhancedNotificationManager.refreshAllNotifications();
      
      Alert.alert(
        'Notifications Refreshed',
        `Updated ${result.meetingsProcessed} meetings with ${result.notificationsScheduled} notifications`
      );
      
      await loadNotificationStatus();
    } catch (error) {
      console.error('Failed to refresh notifications:', error);
      Alert.alert('Error', 'Failed to refresh notifications');
    } finally {
      setRefreshing(false);
    }
  };

  const handleClearAllNotifications = async () => {
    Alert.alert(
      'Clear All Notifications',
      'Are you sure you want to clear all scheduled notifications? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await EnhancedNotificationManager.clearAllNotifications();
              Alert.alert('Success', 'All notifications cleared');
              await loadNotificationStatus();
            } catch (error) {
              Alert.alert('Error', 'Failed to clear notifications');
            }
          },
        },
      ]
    );
  };

  const handleTestBackgroundTask = async () => {
    try {
      setRefreshing(true);
      const success = await BackgroundTaskManager.triggerBackgroundTask();
      
      if (success) {
        Alert.alert('Success', 'Background task triggered successfully!');
      } else {
        Alert.alert('Error', 'Failed to trigger background task');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to test background task');
    } finally {
      setRefreshing(false);
    }
  };

  const getStatusColor = (hasPermissions, isInitialized) => {
    if (!hasPermissions) return '#ef4444'; // Red
    if (!isInitialized) return '#f59e0b'; // Orange
    return '#10b981'; // Green
  };

  const getStatusText = (hasPermissions, isInitialized) => {
    if (!hasPermissions) return 'Permissions Required';
    if (!isInitialized) return 'Not Initialized';
    return 'Active';
  };

  const styles = getStyles(isDarkMode);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading notification settings...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Content>
          <Title style={styles.title}>Background Notifications</Title>
          <Paragraph style={styles.subtitle}>
            WhatsApp-style always-on meeting alerts that work even when the app is closed
          </Paragraph>

          <Divider style={styles.divider} />

          {/* Status Overview */}
          <View style={styles.statusContainer}>
            <View style={styles.statusRow}>
              <MaterialIcons
                name="notifications"
                size={24}
                color={getStatusColor(notificationStatus?.hasPermissions, notificationStatus?.isInitialized)}
              />
              <View style={styles.statusTextContainer}>
                <Text style={styles.statusTitle}>Notification System</Text>
                <Text style={[
                  styles.statusText,
                  { color: getStatusColor(notificationStatus?.hasPermissions, notificationStatus?.isInitialized) }
                ]}>
                  {getStatusText(notificationStatus?.hasPermissions, notificationStatus?.isInitialized)}
                </Text>
              </View>
            </View>

            <View style={styles.statusRow}>
              <MaterialIcons
                name="schedule"
                size={24}
                color={notificationStatus?.scheduledCount > 0 ? '#10b981' : '#6b7280'}
              />
              <View style={styles.statusTextContainer}>
                <Text style={styles.statusTitle}>Scheduled Alerts</Text>
                <Text style={styles.statusText}>
                  {notificationStatus?.scheduledCount || 0} notifications
                </Text>
              </View>
            </View>

            <View style={styles.statusRow}>
              <MaterialIcons
                name="sync"
                size={24}
                color={notificationStatus?.backgroundStatus?.isTaskRegistered ? '#10b981' : '#6b7280'}
              />
              <View style={styles.statusTextContainer}>
                <Text style={styles.statusTitle}>Background Sync</Text>
                <Text style={styles.statusText}>
                  {notificationStatus?.backgroundStatus?.statusText || 'Unknown'}
                </Text>
              </View>
            </View>

            {notificationStatus?.pushToken && (
              <View style={styles.statusRow}>
                <MaterialIcons
                  name="cloud"
                  size={24}
                  color="#10b981"
                />
                <View style={styles.statusTextContainer}>
                  <Text style={styles.statusTitle}>Push Notifications</Text>
                  <Text style={styles.statusText}>Connected</Text>
                </View>
              </View>
            )}
          </View>

          <Divider style={styles.divider} />

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {!notificationStatus?.isInitialized && (
              <Button
                mode="contained"
                onPress={handleInitializeNotifications}
                loading={refreshing}
                disabled={refreshing}
                style={styles.primaryButton}
                icon="rocket-launch"
              >
                Initialize Notifications
              </Button>
            )}

            <Button
              mode="outlined"
              onPress={handleRefreshNotifications}
              loading={refreshing}
              disabled={refreshing}
              style={styles.button}
              icon="refresh"
            >
              Refresh All Notifications
            </Button>

            <Button
              mode="outlined"
              onPress={handleTestBackgroundTask}
              loading={refreshing}
              disabled={refreshing}
              style={styles.button}
              icon="play-circle"
            >
              Test Background Task
            </Button>

            <Button
              mode="outlined"
              onPress={handleClearAllNotifications}
              disabled={refreshing}
              style={[styles.button, styles.dangerButton]}
              icon="delete-sweep"
            >
              Clear All Notifications
            </Button>
          </View>

          {/* Scheduled Notifications Preview */}
          {notificationStatus?.scheduledNotifications?.length > 0 && (
            <>
              <Divider style={styles.divider} />
              <Text style={styles.sectionTitle}>Upcoming Notifications</Text>
              {notificationStatus.scheduledNotifications.slice(0, 5).map((notification, index) => (
                <View key={index} style={styles.notificationItem}>
                  <Text style={styles.notificationTitle}>{notification.title}</Text>
                  <Text style={styles.notificationBody}>{notification.body}</Text>
                  {notification.trigger && (
                    <Text style={styles.notificationTime}>
                      {new Date(notification.trigger.value || notification.trigger).toLocaleString()}
                    </Text>
                  )}
                </View>
              ))}
              {notificationStatus.scheduledNotifications.length > 5 && (
                <Text style={styles.moreText}>
                  And {notificationStatus.scheduledNotifications.length - 5} more...
                </Text>
              )}
            </>
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
      padding: 16,
    },
    card: {
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      borderRadius: 12,
      elevation: 4,
      shadowColor: isDarkMode ? '#000' : '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 8,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginBottom: 8,
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
    statusContainer: {
      marginVertical: 8,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    statusTextContainer: {
      marginLeft: 12,
      flex: 1,
    },
    statusTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
    },
    statusText: {
      fontSize: 14,
      color: isDarkMode ? '#94a3b8' : '#64748b',
    },
    buttonContainer: {
      marginTop: 8,
    },
    button: {
      marginBottom: 8,
    },
    primaryButton: {
      marginBottom: 8,
      backgroundColor: '#3b82f6',
    },
    dangerButton: {
      borderColor: '#ef4444',
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginBottom: 12,
    },
    notificationItem: {
      backgroundColor: isDarkMode ? '#334155' : '#f8fafc',
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
    },
    notificationTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginBottom: 4,
    },
    notificationBody: {
      fontSize: 12,
      color: isDarkMode ? '#94a3b8' : '#64748b',
      marginBottom: 4,
    },
    notificationTime: {
      fontSize: 11,
      color: isDarkMode ? '#64748b' : '#9ca3af',
    },
    moreText: {
      fontSize: 12,
      color: isDarkMode ? '#64748b' : '#9ca3af',
      textAlign: 'center',
      marginTop: 8,
    },
    loadingText: {
      fontSize: 16,
      color: isDarkMode ? '#94a3b8' : '#64748b',
      textAlign: 'center',
      marginTop: 50,
    },
  });
