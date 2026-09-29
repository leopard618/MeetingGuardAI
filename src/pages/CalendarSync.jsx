/**
 * Calendar sync screen (owner: calendar): Google Calendar two-way sync + device calendars.
 * The `language` prop from the legacy wrapper is not needed (strings come from the calendar
 * namespace in the current UI language).
 */
import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CalendarSyncSettings from '../components/CalendarSyncSettings.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useT } from '../i18n';

export default function CalendarSync({ navigation }) {
  const t = useT();
  const { isDarkMode } = useTheme();
  const styles = getStyles(isDarkMode);

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <View style={styles.header}>
        {navigation?.canGoBack?.() ? (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('calendar:screen.back')}
          >
            <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? '#ffffff' : '#1e293b'} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.headerContent}>
          <Text style={styles.title} accessibilityRole="header">
            {t('calendar:screen.title')}
          </Text>
          <Text style={styles.subtitle}>{t('calendar:screen.subtitle')}</Text>
        </View>
      </View>
      <CalendarSyncSettings />
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0',
    },
    backButton: {
      marginRight: 16,
      padding: 4,
    },
    headerContent: {
      flex: 1,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: isDarkMode ? '#f1f5f9' : '#1e293b',
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: isDarkMode ? '#94a3b8' : '#64748b',
    },
  });
