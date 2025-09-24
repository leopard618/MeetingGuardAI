import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
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
import { useTranslation } from './translations.jsx';
import calendarSyncManager from '../api/calendarSyncManager';
import googleCalendarService from '../api/googleCalendar';

export default function CalendarSyncSettings({ language = 'en' }) {
  const { isDarkMode } = useTheme();
  const { t } = useTranslation(language);
  const [syncSettings, setSyncSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatistics, setSyncStatistics] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState({
    isConnected: false,
    checking: true,
    message: 'Checking connection...'
  });

  useEffect(() => {
    loadSyncData();
  }, []);

  const checkRealConnectionStatus = async () => {
    try {
      console.log('🔍 Checking REAL Google Calendar connection status...');
      setConnectionStatus(prev => ({ ...prev, checking: true }));
      
      // Check if Google Calendar service is actually available
      const isGoogleAvailable = await googleCalendarService.isAvailable();
      console.log('📊 Google Calendar service available:', isGoogleAvailable);
      
      if (!isGoogleAvailable) {
        setConnectionStatus({
          isConnected: false,
          checking: false,
          message: t('googleCalendar.notConnectedMessage')
        });
        return false;
      }
      
      // Try to get a valid access token
      const tokenManager = (await import('../api/googleTokenManager.js')).default;
      const hasValidToken = await tokenManager.hasValidAccess();
      console.log('🔑 Has valid Google access token:', hasValidToken);
      
      if (hasValidToken) {
        setConnectionStatus({
          isConnected: true,
          checking: false,
          message: t('googleCalendar.connectedMessage')
        });
        return true;
      } else {
        setConnectionStatus({
          isConnected: false,
          checking: false,
          message: t('googleCalendar.disconnectedMessage')
        });
        return false;
      }
    } catch (error) {
      console.error('❌ Error checking Google Calendar connection:', error);
      setConnectionStatus({
        isConnected: false,
        checking: false,
        message: t('googleCalendar.connectionCheckFailed')
      });
      return false;
    }
  };

  const loadSyncData = async () => {
    try {
      setIsLoading(true);
      
      // Check real connection status first
      const isConnected = await checkRealConnectionStatus();
      
      const [settings, stats] = await Promise.all([
        googleCalendarService.getSyncSettings(),
        calendarSyncManager.getSyncStatistics(),
      ]);
      
      setSyncSettings(settings);
      setSyncStatistics(stats);
      
      // If not connected, zero out the statistics to reflect reality
      if (!isConnected) {
        setSyncStatistics(prev => ({
          ...prev,
          totalSynced: 0,
          successful: 0,
          errors: prev?.totalAppEvents || 0,
          lastSync: null
        }));
      }
    } catch (error) {
      console.error('Error loading sync data:', error);
      Alert.alert(t('common.error'), 'Failed to load sync settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoSyncToggle = async (value) => {
    try {
      // Update local state immediately for better UX
      setSyncSettings(prev => ({ ...prev, autoSyncEnabled: value }));
      
      if (value) {
        console.log('🔄 Starting auto sync...');
        calendarSyncManager.startAutoSync();
      } else {
        console.log('🛑 Stopping auto sync...');
        calendarSyncManager.stopAutoSync();
      }
      
      console.log(`✅ Auto sync ${value ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error updating auto sync:', error);
      Alert.alert(t('common.error'), 'Failed to update auto sync setting');
      // Revert state on error
      setSyncSettings(prev => ({ ...prev, autoSyncEnabled: !value }));
    }
  };

  const handleSyncIntervalChange = async (interval) => {
    try {
      await googleCalendarService.setSyncInterval(interval);
      setSyncSettings(prev => ({ ...prev, syncInterval: interval }));
      
      // Restart auto sync with new interval
      if (syncSettings?.autoSyncEnabled) {
        calendarSyncManager.stopAutoSync();
        calendarSyncManager.startAutoSync(interval);
      }
    } catch (error) {
      console.error('Error updating sync interval:', error);
      Alert.alert(t('common.error'), 'Failed to update sync interval');
    }
  };

  const handleReconnectGoogle = async () => {
    try {
      console.log('🔄 Initiating Google Calendar reconnection...');
      
      Alert.alert(
        t('googleCalendar.reconnectTitle'),
        t('googleCalendar.reconnectMessage'),
        [
          {
            text: t('common.cancel'),
            style: 'cancel'
          },
          {
            text: t('googleCalendar.reconnectButton'),
            onPress: async () => {
              try {
                // Use the new simplified reconnect service
                const reconnectService = (await import('../api/googleCalendarReconnectService')).default;
                const result = await reconnectService.reconnectUsingExistingAuth();
                
                if (result.success) {
                  Alert.alert(t('common.success'), result.message);
                  // Reload the page to show updated status
                  await loadSyncData();
                } else if (result.requiresReauth) {
                  Alert.alert(
                    t('googleCalendar.freshSignInRequired'), 
                    result.error + '\n\nWould you like to sign out and sign in again?',
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      { 
                        text: t('googleCalendar.signOutRestart'), 
                        onPress: async () => {
                          const { useAuth } = await import('../contexts/AuthContext');
                          // This would need to be accessed differently, showing user the instructions
                          Alert.alert(
                            t('googleCalendar.manualActionRequired'),
                            t('googleCalendar.signOutInstructions')
                          );
                        }
                      }
                    ]
                  );
                } else {
                  Alert.alert(t('googleCalendar.reconnectFailed'), result.error || 'Failed to reconnect to Google Calendar');
                }
              } catch (error) {
                console.error('❌ Reconnection failed:', error);
                Alert.alert(t('common.error'), 'Failed to reconnect. Please try again.');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('❌ Error initiating reconnection:', error);
      Alert.alert(t('common.error'), 'Failed to initiate reconnection. Please try again.');
    }
  };

  const handleForceSync = async () => {
    try {
      setIsSyncing(true);
      console.log('🔄 Starting manual sync...');
      
      const results = await calendarSyncManager.forceSync();
      console.log('📊 Sync results:', results);
      
      // Show results with better messaging
      const message = `${t('googleCalendar.syncCompleted')}\n\n• ${t('googleCalendar.created')}: ${results.created || 0}\n• ${t('googleCalendar.updated')}: ${results.updated || 0}\n• ${t('googleCalendar.skipped')}: ${results.skipped || 0}\n• ${t('googleCalendar.errors')}: ${results.errors?.length || 0}`;
      
      if (results.errors?.length > 0) {
        console.log('⚠️ Sync errors:', results.errors);
        Alert.alert(t('googleCalendar.syncCompletedWithIssues'), `${message}\n\n${t('googleCalendar.syncIssuesNote')}`);
      } else {
        Alert.alert(t('common.success'), message);
      }
      
      // Reload data
      await loadSyncData();
    } catch (error) {
      console.error('❌ Error during force sync:', error);
      Alert.alert(t('googleCalendar.syncError'), `${t('googleCalendar.syncFailed')}: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };


  const getSyncDirectionLabel = (direction) => {
    switch (direction) {
      case 'bidirectional':
        return t('googleCalendar.bidirectionalSync');
      case 'toGoogle':
        return 'App → Google Calendar';
      case 'fromGoogle':
        return 'Google Calendar → App';
      default:
        return t('googleCalendar.bidirectionalSync');
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc' }]}>
        <ActivityIndicator size="large" color={isDarkMode ? '#60a5fa' : '#3b82f6'} />
        <Text style={[styles.loadingText, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
          {t('common.loading')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc' }]}>
      {/* Google Calendar Connection Status */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <View style={styles.statusHeader}>
            <MaterialIcons
              name="sync"
              size={24}
              color={isDarkMode ? '#60a5fa' : '#3b82f6'}
            />
            <Title style={[styles.statusTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
              {t('googleCalendar.syncTitle')}
            </Title>
          </View>
          
          <View style={styles.connectionStatus}>
            <View style={styles.statusIndicator}>
              {connectionStatus.checking ? (
                <ActivityIndicator size="small" color={isDarkMode ? '#60a5fa' : '#3b82f6'} />
              ) : (
                <View style={[
                  styles.statusDot, 
                  { backgroundColor: connectionStatus.isConnected 
                    ? (isDarkMode ? '#10b981' : '#059669') 
                    : (isDarkMode ? '#ef4444' : '#dc2626') 
                  }
                ]} />
              )}
              <Text style={[
                styles.statusText, 
                { color: connectionStatus.isConnected 
                  ? (isDarkMode ? '#10b981' : '#059669') 
                  : (isDarkMode ? '#ef4444' : '#dc2626') 
                }
              ]}>
                {connectionStatus.checking ? t('googleCalendar.checking') : (connectionStatus.isConnected ? t('googleCalendar.connected') : t('googleCalendar.disconnected'))}
              </Text>
            </View>
            <Text style={[styles.statusDescription, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
              {connectionStatus.message}
            </Text>
            
            {/* Show reconnect button if disconnected */}
            {!connectionStatus.isConnected && !connectionStatus.checking && (
              <Button
                mode="contained"
                onPress={handleReconnectGoogle}
                style={[styles.reconnectButton, { backgroundColor: isDarkMode ? '#3b82f6' : '#2563eb' }]}
                icon="refresh"
              >
                        {t('googleCalendar.reconnectButton')}
              </Button>
            )}
          </View>
        </Card.Content>
      </Card>

      {/* Sync Statistics - TOP */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <Title style={[styles.sectionTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
            {t('googleCalendar.syncStatistics')}
          </Title>
          
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: isDarkMode ? '#60a5fa' : '#3b82f6' }]}>
                {connectionStatus.isConnected ? (syncStatistics?.totalSynced || 0) : 0}
              </Text>
              <Text style={[styles.statLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                {t('googleCalendar.totalSynced')}
              </Text>
            </View>
            
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: isDarkMode ? '#10b981' : '#059669' }]}>
                {connectionStatus.isConnected ? (syncStatistics?.successful || 0) : 0}
              </Text>
              <Text style={[styles.statLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                {t('googleCalendar.successful')}
              </Text>
            </View>
            
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: isDarkMode ? '#f59e0b' : '#d97706' }]}>
                {connectionStatus.isConnected ? (syncStatistics?.errors || 0) : (syncStatistics?.totalAppEvents || 0)}
              </Text>
              <Text style={[styles.statLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                {connectionStatus.isConnected ? t('googleCalendar.errors') : t('googleCalendar.notSynced')}
              </Text>
            </View>
          </View>
          
          {connectionStatus.isConnected && syncStatistics?.lastSync && (
            <Text style={[styles.lastSyncText, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
              {t('googleCalendar.lastSync')}: {new Date(syncStatistics.lastSync).toLocaleString()}
            </Text>
          )}
          
          {!connectionStatus.isConnected && !connectionStatus.checking && (
            <Text style={[styles.lastSyncText, { color: isDarkMode ? '#ef4444' : '#dc2626' }]}>
              {t('googleCalendar.notConnectedWarning')}
            </Text>
          )}
        </Card.Content>
      </Card>

      {/* Sync Settings - MIDDLE */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <Title style={[styles.sectionTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
            {t('googleCalendar.syncSettings')}
          </Title>
          
          <List.Item
            title={t('googleCalendar.autoSync')}
            description={t('googleCalendar.autoSyncDescription')}
            left={props => <List.Icon {...props} icon="sync" />}
            right={() => (
              <Switch
                value={syncSettings?.autoSyncEnabled || false}
                onValueChange={handleAutoSyncToggle}
                color={isDarkMode ? '#60a5fa' : '#3b82f6'}
              />
            )}
            titleStyle={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }}
            descriptionStyle={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
          />
          
          <Divider style={{ backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }} />
          
          <List.Item
            title={t('googleCalendar.syncDirection')}
            description={getSyncDirectionLabel(syncSettings?.syncDirection)}
            left={props => <List.Icon {...props} icon="swap-horizontal" />}
            titleStyle={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }}
            descriptionStyle={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
          />
        </Card.Content>
      </Card>

      {/* Sync Actions - BOTTOM */}
      <Card style={[styles.card, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <Card.Content>
          <Title style={[styles.sectionTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
            {t('googleCalendar.syncActions')}
          </Title>
          
          <Button
            mode="contained"
            onPress={handleForceSync}
            loading={isSyncing}
            disabled={isSyncing}
            style={[styles.actionButton, { backgroundColor: isDarkMode ? '#3b82f6' : '#2563eb' }]}
            icon="sync"
          >
            {isSyncing ? t('googleCalendar.syncing') : t('googleCalendar.syncNow')}
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
  loadingText: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 16,
  },
  card: {
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusTitle: {
    marginLeft: 12,
    fontSize: 20,
    fontWeight: 'bold',
  },
  connectionStatus: {
    marginTop: 12,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
  },
  statusDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  actionButton: {
    marginVertical: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  lastSyncText: {
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  reconnectButton: {
    marginTop: 12,
    borderRadius: 8,
  },
});