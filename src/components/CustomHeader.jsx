import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '..\contexts\ThemeContext';
import ThemeToggle from './ThemeToggle';

const CustomHeader = ({ title, onMenuPress, showMenu = true }) => {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();

  const styles = getStyles(isDarkMode);
  
  return (
    <View style={styles.header}>
      <View style={styles.headerContent}>
        {/* Logo and Title */}
        <TouchableOpacity
          style={styles.logoContainer}
          onPress={() => navigation.navigate('Dashboard')}
        >
          <Image
            source={{ uri: "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/816636779_file_00000000800861f89b8e5d3eba90a7691.png" }}
            style={styles.logo}
          />
          <Text style={styles.title}>{title || 'MeetingGuard AI'}</Text>
        </TouchableOpacity>
        {/* Theme Toggle */}
        <ThemeToggle size={20} style={styles.themeToggle} />
        
        {/* Menu Button */}
        {showMenu && (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={onMenuPress}
          >
            <Ionicons name="menu" size={24} color={isDarkMode ? "#ffffff" : "#1E293B"} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  header: {
    backgroundColor: isDarkMode ? '#1a1a1a' : '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? '#404040' : '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    marginTop:40
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logo: {
    width: 32,
    height: 32,
    marginRight: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: isDarkMode ? '#ffffff' : '#1E293B',
  },
  menuButton: {
    padding: 8,
    borderRadius: 8,
  },
  themeToggle: {
    marginRight: 8,
  },
});

export default CustomHeader; 