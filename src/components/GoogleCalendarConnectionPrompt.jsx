/**
 * "Connect Google Calendar" modal (owner: calendar). Connects through
 * googleCalendarService.connect() (incremental Calendar consent + first two-way sync) and reports
 * the real outcome. Props kept for the Dashboard: visible, onClose, onSuccess(result), userEmail.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../contexts/ThemeContext.jsx';
import { errorMessageKey, toAppError } from '../core/errors';
import { createLogger } from '../core/logger';
import { useT } from '../i18n';
import { calendarSyncEngine, googleCalendarService, useCalendarStatus } from '../services/calendar';

const log = createLogger('calendar');

const BENEFITS = [
  { icon: 'notifications-active', key: 'alerts' },
  { icon: 'sync', key: 'twoWay' },
  { icon: 'videocam', key: 'meet' },
];

function benefitText(t, key) {
  if (key === 'alerts') return t('calendar:prompt.benefits.alerts');
  if (key === 'twoWay') return t('calendar:prompt.benefits.twoWay');
  return t('calendar:prompt.benefits.meet');
}

export default function GoogleCalendarConnectionPrompt({ visible, onClose, onSuccess, userEmail }) {
  const t = useT();
  const { isDarkMode } = useTheme();
  const status = useCalendarStatus();
  const [isConnecting, setIsConnecting] = useState(false);
  const isConnected = status.google.connected;
  const styles = getStyles(isDarkMode);
  const accentColor = isDarkMode ? '#60a5fa' : '#2563eb';

  // Refresh the shared status when the prompt opens (it may already be connected).
  useEffect(() => {
    if (!visible) return;
    googleCalendarService.isConnected().catch((error) =>
      log.warn('Could not read the Google Calendar state', { code: toAppError(error).code }),
    );
  }, [visible]);
  const successColor = isDarkMode ? '#6ee7b7' : '#059669';

  const close = () => {
    if (!isConnecting) onClose?.();
  };

  const connect = async () => {
    setIsConnecting(true);
    try {
      const result = await googleCalendarService.connect();
      if (result.status === 'connected') {
        const lastError = calendarSyncEngine.getStatus().google.lastError;
        const message = result.initialSync
          ? t('calendar:google.firstSyncSummary', {
              created: result.initialSync.counts.created,
              pushed: result.initialSync.counts.pushed,
            })
          : t('calendar:google.firstSyncFailed', { error: lastError ? t(errorMessageKey(lastError)) : '' });
        Alert.alert(t('calendar:google.connectedTitle'), message, [
          {
            text: t('calendar:actions.ok'),
            onPress: () => {
              onSuccess?.(result);
              onClose?.();
            },
          },
        ]);
      } else if (result.status === 'scope_denied') {
        Alert.alert(t('calendar:prompt.title'), t('calendar:google.scopeDenied'));
      }
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'cancelled') {
        Alert.alert(t('calendar:errorTitle'), t(errorMessageKey(appError.code)));
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <MaterialIcons name="calendar-today" size={52} color={accentColor} />
            <Text style={styles.title} accessibilityRole="header">
              {t('calendar:prompt.title')}
            </Text>
            <Text style={styles.subtitle}>{t('calendar:prompt.subtitle')}</Text>
            {userEmail ? <Text style={styles.email}>{userEmail}</Text> : null}
          </View>

          {isConnected ? (
            <View style={styles.connected}>
              <MaterialIcons name="check-circle" size={24} color={successColor} />
              <Text style={styles.connectedText}>{t('calendar:prompt.alreadyConnected')}</Text>
            </View>
          ) : (
            <View style={styles.benefits}>
              {BENEFITS.map((benefit) => (
                <View key={benefit.key} style={styles.benefit}>
                  <MaterialIcons name={benefit.icon} size={20} color={accentColor} />
                  <Text style={styles.benefitText}>{benefitText(t, benefit.key)}</Text>
                </View>
              ))}
              <Text style={styles.privacy}>{t('calendar:prompt.privacy')}</Text>
            </View>
          )}

          <View style={styles.buttons}>
            {!isConnected ? (
              <TouchableOpacity
                style={[styles.primary, isConnecting && styles.primaryDisabled]}
                onPress={connect}
                disabled={isConnecting}
                accessibilityRole="button"
                accessibilityState={{ disabled: isConnecting, busy: isConnecting }}
              >
                {isConnecting ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                <Text style={styles.primaryText}>
                  {isConnecting ? t('calendar:google.connecting') : t('calendar:prompt.connect')}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondary} onPress={close} disabled={isConnecting} accessibilityRole="button">
              <Text style={styles.secondaryText}>
                {isConnected ? t('calendar:actions.close') : t('calendar:prompt.notNow')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modal: {
      width: '100%',
      maxWidth: 440,
      borderRadius: 16,
      padding: 24,
      gap: 20,
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      elevation: 8,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    header: {
      alignItems: 'center',
      gap: 8,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      textAlign: 'center',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
    },
    subtitle: {
      fontSize: 15,
      textAlign: 'center',
      color: isDarkMode ? '#94a3b8' : '#64748b',
    },
    email: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#60a5fa' : '#2563eb',
    },
    benefits: {
      gap: 10,
    },
    benefit: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    benefitText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: isDarkMode ? '#cbd5e1' : '#475569',
    },
    privacy: {
      fontSize: 12,
      lineHeight: 18,
      color: isDarkMode ? '#94a3b8' : '#64748b',
    },
    connected: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 16,
      borderRadius: 12,
      backgroundColor: isDarkMode ? '#065f46' : '#d1fae5',
    },
    connectedText: {
      fontSize: 15,
      fontWeight: '600',
      color: isDarkMode ? '#d1fae5' : '#065f46',
    },
    buttons: {
      gap: 12,
    },
    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 10,
      paddingVertical: 14,
      backgroundColor: '#2563eb',
    },
    primaryDisabled: {
      backgroundColor: '#94a3b8',
    },
    primaryText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#ffffff',
    },
    secondary: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: isDarkMode ? '#475569' : '#d1d5db',
    },
    secondaryText: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#94a3b8' : '#64748b',
    },
  });
