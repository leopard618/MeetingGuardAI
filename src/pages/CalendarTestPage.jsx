import React from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import {
  Title,
  Paragraph,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import CalendarSyncTest from '../components/CalendarSyncTest.jsx';

export default function CalendarTestPage({ navigation }) {
  const { isDarkMode } = useTheme();

  const styles = getStyles(isDarkMode);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons 
            name="arrow-back" 
            size={24} 
            color={isDarkMode ? "#ffffff" : "#1e293b"} 
          />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Title style={styles.title}>Calendar Integration Test</Title>
          <Paragraph style={styles.subtitle}>
            Test your Google Calendar integration with real data
          </Paragraph>
        </View>
      </View>

      <CalendarSyncTest />
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
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
    fontSize: 24,
    fontWeight: 'bold',
    color: isDarkMode ? '#f1f5f9' : '#1e293b',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: isDarkMode ? '#94a3b8' : '#64748b',
  },
});
