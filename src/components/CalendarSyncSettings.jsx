import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Switch,
  Button,
  List,
  Divider,
  ActivityIndicator,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext.jsx';
import calendarSyncManager from '../api/calendarSyncManager';
import googleCalendarService from '../api/googleCalendar';

export default function CalendarSyncSettings() {
  const { isDarkMode } = useTheme();
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncSettings, setSyncSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatistics, setSyncStatistics] = useState(null);

  useEffect(() => {
    loadSyncData();
  }, []);

  const loadSyncData = async () => {
    try {
      setIsLoading(true);
      const [status, settings, stats, connectionStatus] = await Promise.all([
        calendarSyncManager.getSyncStatus(),
        googleCalendarService.getSyncSettings(),
        calendarSyncManager.getSyncStatistics(),
        googleCalendarService.getConnectionStatus(),
      ]);
      
      // Merge connection status with sync status
      const enhancedStatus = {
        ...status,
        ...connectionStatus,
        connectionDetails: connectionStatus
      };
      
      setSyncStatus(enhancedStatus);
      setSyncSettings(settings);
      setSyncStatistics(stats);
    } catch (error) {
      console.error('Error loading sync data:', error);
      Alert.alert('Error', 'Failed to load sync settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoSyncToggle = async (value) => {
    try {
      const updatedSettings = await calendarSyncManager.updateSyncSettings({
        autoSync: value,
      });
      setSyncSettings(updatedSettings);
      
      if (value) {
        Alert.alert('Success', 'Auto-sync enabled');
      } else {
        Alert.alert('Success', 'Auto-sync disabled');
      }
    } catch (error) {
      console.error('Error updating auto-sync setting:', error);
      Alert.alert('Error', 'Failed to update auto-sync setting');
    }
  };

  const handleSyncDirectionChange = async (direction) => {
    try {
      const updatedSettings = await calendarSyncManager.updateSyncSettings({
        syncDirection: direction,
      });
      setSyncSettings(updatedSettings);
      Alert.alert('Success', `Sync direction changed to ${direction}`);
    } catch (error) {
      console.error('Error updating sync direction:', error);
      Alert.alert('Error', 'Failed to update sync direction');
    }
  };

  const handleSyncIntervalChange = async (interval) => {
    try {
      const updatedSettings = await calendarSyncManager.updateSyncSettings({
        syncInterval: interval,
      });
      setSyncSettings(updatedSettings);
      Alert.alert('Success', `Sync interval changed to ${interval} minutes`);
    } catch (error) {
      console.error('Error updating sync interval:', error);
      Alert.alert('Error', 'Failed to update sync interval');
    }
  };

  const handleForceSync = async () => {
    try {
      setIsSyncing(true);
      const results = await calendarSyncManager.forceSync();
      
      Alert.alert(
        'Sync Complete',
        `Created: ${results.created}\nUpdated: ${results.updated}\nDeleted: ${results.deleted}\nErrors: ${results.errors.length}`
      );
      
      // Reload data
      await loadSyncData();
    } catch (error) {
      console.error('Error during force sync:', error);
      Alert.alert('Error', 'Failed to perform sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualReconnect = async () => {
    try {
      setIsSyncing(true);
      console.log('🔄 Attempting manual Google Calendar reconnection...');
      
      // Clear any cached tokens that might be invalid
      await googleCalendarService.clearTokens();
      
      // Try to reinitialize the service
      const reconnected = await googleCalendarService.initialize();
      
      if (reconnected) {
        Alert.alert('Success', 'Google Calendar reconnected successfully!');
        await loadSyncData();
      } else {
        Alert.alert(
          'Reconnection Failed', 
          'Unable to reconnect to Google Calendar. Please try signing in again with Google.'
        );
      }
    } catch (error) {
      console.error('Error during manual reconnect:', error);
      Alert.alert('Error', `Failed to reconnect: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setIsSyncing(true);
      console.log('🔄 Testing Google Calendar connection...');
      
      const hasAccess = await googleCalendarService.checkCalendarAccess();
      
      if (hasAccess) {
        const calendars = await googleCalendarService.getCalendars();
        Alert.alert(
          'Connection Test Successful', 
          `Connected to Google Calendar!\n\nFound ${calendars.length} calendar(s):\n${calendars.map(cal => `• ${cal.summary}`).join('\n')}`
        );
        await loadSyncData();
      } else {
        Alert.alert(
          'Connection Test Failed', 
          'Unable to connect to Google Calendar. Your tokens may have expired or been revoked.'
        );
      }
    } catch (error) {
      console.error('Error during connection test:', error);
      Alert.alert('Error', `Connection test failed: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCheckConflicts = async () => {
    try {
      const conflicts = await calendarSyncManager.getSyncConflicts();
      
      if (conflicts.length === 0) {
        Alert.alert('No Conflicts', 'All events are in sync');
      } else {
        Alert.alert(
          'Sync Conflicts Found',
          `${conflicts.length} conflicts detected. Please resolve them manually.`
        );
      }
    } catch (error) {
      console.error('Error checking conflicts:', error);
      Alert.alert('Error', 'Failed to check for conflicts');
    }
  };

  const handleCleanupMappings = async () => {
    try {
      const cleanedCount = await calendarSyncManager.cleanupOrphanedMappings();
      Alert.alert('Cleanup Complete', `Cleaned up ${cleanedCount} orphaned mappings`);
      await loadSyncData();
    } catch (error) {
      console.error('Error cleaning up mappings:', error);
      Alert.alert('Error', 'Failed to cleanup mappings');
    }
  };

  const getSyncDirectionLabel = (direction) => {
    switch (direction) {
      case 'bidirectional':
        return 'Bidirectional (App ↔ Google)';
      case 'toGoogle':
        return 'App → Google Calendar';
      case 'fromGoogle':
        return 'Google Calendar → App';
      default:
        return 'Bidirectional';
    }
  };

  const getConnectionStatusColor = () => {
    return syncStatus?.isConnected ? '#10b981' : '#ef4444';
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc' }]}>
        <ActivityIndicator size="large" color={isDarkMode ? '#60a5fa' : '#3b82f6'} />
        <Text style={[styles.loadingText, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
          Loading sync settings...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc' }]}>
      {/* Connection Status */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <View style={styles.statusHeader}>
            <MaterialIcons
              name="sync"
              size={24}
              color={getConnectionStatusColor()}
            />
            <Title style={[styles.statusTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
              Google Calendar Sync
            </Title>
          </View>
          
          <View style={styles.statusRow}>
            <Text style={[styles.statusLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
              Connection Status:
            </Text>
            <Text style={[styles.statusValue, { color: getConnectionStatusColor() }]}>
              {syncStatus?.isConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          
          {syncStatus?.connectionDetails && (
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                Details:
              </Text>
              <Text style={[styles.statusValue, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
                {syncStatus.connectionDetails.message}
              </Text>
            </View>
          )}
          
          {syncStatus?.lastSyncTime && (
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                Last Sync:
              </Text>
              <Text style={[styles.statusValue, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
                {new Date(syncStatus.lastSyncTime).toLocaleString()}
              </Text>
            </View>
          )}
        </Card.Content>
      </Card>

      {/* Sync Settings */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <Title style={[styles.sectionTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
            Sync Settings
          </Title>
          
          {/* Auto Sync Toggle */}
          <List.Item
            title="Auto Sync"
            description="Automatically sync events in the background"
            titleStyle={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }}
            descriptionStyle={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
            left={(props) => <List.Icon {...props} icon="sync" />}
            right={() => (
              <Switch
                value={syncSettings?.autoSync || false}
                onValueChange={handleAutoSyncToggle}
                color={isDarkMode ? '#60a5fa' : '#3b82f6'}
              />
            )}
          />
          
          <Divider style={styles.divider} />
          
          {/* Sync Direction */}
          <List.Item
            title="Sync Direction"
            description={getSyncDirectionLabel(syncSettings?.syncDirection)}
            titleStyle={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }}
            descriptionStyle={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
            left={(props) => <List.Icon {...props} icon="swap-horizontal" />}
            onPress={() => {
              Alert.alert(
                'Sync Direction',
                'Choose sync direction:',
                [
                  { text: 'Bidirectional', onPress: () => handleSyncDirectionChange('bidirectional') },
                  { text: 'App → Google', onPress: () => handleSyncDirectionChange('toGoogle') },
                  { text: 'Google → App', onPress: () => handleSyncDirectionChange('fromGoogle') },
                  { text: 'Cancel', style: 'cancel' },
                ]
              );
            }}
          />
          
          <Divider style={styles.divider} />
          
          {/* Sync Interval */}
          <List.Item
            title="Sync Interval"
            description={`${syncSettings?.syncInterval || 15} minutes`}
            titleStyle={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }}
            descriptionStyle={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
            left={(props) => <List.Icon {...props} icon="clock" />}
            onPress={() => {
              Alert.alert(
                'Sync Interval',
                'Choose sync interval:',
                [
                  { text: '5 minutes', onPress: () => handleSyncIntervalChange(5) },
                  { text: '15 minutes', onPress: () => handleSyncIntervalChange(15) },
                  { text: '30 minutes', onPress: () => handleSyncIntervalChange(30) },
                  { text: '1 hour', onPress: () => handleSyncIntervalChange(60) },
                  { text: 'Cancel', style: 'cancel' },
                ]
              );
            }}
          />
        </Card.Content>
      </Card>

      {/* Sync Statistics */}
      {syncStatistics && (
        <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
          <Card.Content>
            <Title style={[styles.sectionTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
              Sync Statistics
            </Title>
            
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: isDarkMode ? '#60a5fa' : '#3b82f6' }]}>
                  {syncStatistics.totalAppEvents}
                </Text>
                <Text style={[styles.statLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                  App Events
                </Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: isDarkMode ? '#10b981' : '#059669' }]}>
                  {syncStatistics.totalGoogleEvents}
                </Text>
                <Text style={[styles.statLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                  Google Events
                </Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: isDarkMode ? '#f59e0b' : '#d97706' }]}>
                  {syncStatistics.syncedAppEvents}
                </Text>
                <Text style={[styles.statLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                  Synced Events
                </Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={[styles.statNumber, { color: isDarkMode ? '#ef4444' : '#dc2626' }]}>
                  {syncStatistics.orphanedMappings}
                </Text>
                <Text style={[styles.statLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                  Orphaned
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      )}

      {/* Connection Actions */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <Title style={[styles.sectionTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
            Connection Actions
          </Title>
          
          <Button
            mode="contained"
            onPress={handleTestConnection}
            loading={isSyncing}
            disabled={isSyncing}
            style={[styles.actionButton, { backgroundColor: isDarkMode ? '#3b82f6' : '#2563eb' }]}
            icon="wifi-check"
          >
            {isSyncing ? 'Testing...' : 'Test Connection'}
          </Button>
          
          <Button
            mode="outlined"
            onPress={handleManualReconnect}
            loading={isSyncing}
            disabled={isSyncing}
            style={[styles.actionButton, { borderColor: isDarkMode ? '#f59e0b' : '#d97706' }]}
            icon="refresh"
            textColor={isDarkMode ? '#f59e0b' : '#d97706'}
          >
            {isSyncing ? 'Reconnecting...' : 'Reconnect to Google'}
          </Button>
        </Card.Content>
      </Card>

      {/* Sync Actions */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <Title style={[styles.sectionTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
            Sync Actions
          </Title>
          
          <Button
            mode="contained"
            onPress={handleForceSync}
            loading={isSyncing}
            disabled={isSyncing || !syncStatus?.isConnected}
            style={styles.actionButton}
            icon="sync"
          >
            {isSyncing ? 'Syncing...' : 'Force Sync Now'}
          </Button>
          
          <Button
            mode="outlined"
            onPress={handleCheckConflicts}
            disabled={!syncStatus?.isConnected}
            style={styles.actionButton}
            icon="alert-circle"
          >
            Check for Conflicts
          </Button>
          
          <Button
            mode="outlined"
            onPress={handleCleanupMappings}
            disabled={!syncStatus?.isConnected}
            style={styles.actionButton}
            icon="broom"
          >
            Cleanup Orphaned Mappings
          </Button>
          
          <Button
            mode="outlined"
            onPress={loadSyncData}
            style={styles.actionButton}
            icon="refresh"
          >
            Refresh Data
          </Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  card: {
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusTitle: {
    marginLeft: 12,
    fontSize: 20,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    marginBottom: 16,
  },
  divider: {
    marginVertical: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    width: '48%',
    alignItems: 'center',
    padding: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  actionButton: {
    marginBottom: 12,
  },
  loadingText: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 16,
  },
}); 