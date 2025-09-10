import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  Card,
  Button,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

export default function EditMeeting({ navigation, route }) {
  const { meeting } = route.params;
  const { isDarkMode } = useTheme();

  const styles = getStyles(isDarkMode);

  const handleSave = () => {
    Alert.alert('Info', 'Edit functionality is coming soon!');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? '#fff' : '#333'} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Meeting</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.content}>
        <Card style={styles.card}>
          <Card.Content>
            <Text style={styles.title}>{meeting.title}</Text>
            <Text style={styles.subtitle}>Edit functionality coming soon!</Text>
            <Text style={styles.description}>
              This feature is currently under development. You can view meeting details and delete meetings for now.
            </Text>
            
            <View style={styles.buttonContainer}>
              <Button
                mode="outlined"
                onPress={() => navigation.goBack()}
                style={styles.button}
                labelStyle={styles.buttonText}
              >
                Go Back
              </Button>
              
              <Button
                mode="contained"
                onPress={handleSave}
                style={styles.button}
                labelStyle={styles.buttonText}
              >
                Save Changes
              </Button>
            </View>
          </Card.Content>
        </Card>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 8,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? '#2d2d2d' : '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3b82f6',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
    lineHeight: 24,
    marginBottom: 24,
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    marginVertical: 4,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
