import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Animated,
  Dimensions,
  StyleSheet,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';
import { useTranslation } from './translations';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

const { width } = Dimensions.get('window');

const navigationItems = [
  {
    titleKey: "nav.dashboard",
    screenName: "Dashboard",
    icon: "grid-outline",
    iconColor: "#60A5FA", // Blue for main dashboard
    activeIconColor: "#93C5FD"
  },
  {
    titleKey: "nav.addMeeting",
    screenName: "ChooseCreationMethod",
    icon: "add-circle-outline",
    iconColor: "#34D399", // Green for creating/adding
    activeIconColor: "#6EE7B7"
  },
  {
    titleKey: "nav.totalMeetings",
    screenName: "TotalMeetings",
    icon: "list-outline",
    iconColor: "#F59E0B", // Amber for meetings list
    activeIconColor: "#FCD34D"
  },
  {
    titleKey: "nav.calendar",
    screenName: "Calendar",
    icon: "calendar-outline",
    iconColor: "#A78BFA", // Purple for calendar
    activeIconColor: "#C4B5FD"
  },
  {
    titleKey: "nav.notes",
    screenName: "Notes",
    icon: "document-text-outline",
    iconColor: "#FB923C", // Orange for notes
    activeIconColor: "#FDBA74"
  },
  {
    titleKey: "nav.aiChat",
    screenName: "AIChat",
    icon: "chatbubble-outline",
    iconColor: "#22D3EE", // Cyan for AI/chat
    activeIconColor: "#67E8F9"
  },
  {
    titleKey: "nav.apiKeys",
    screenName: "ApiSettings",
    icon: "business-outline",
    iconColor: "#FBBF24", // Amber for business/API
    activeIconColor: "#FCD34D"
  },
  {
    titleKey: "nav.pricing",
    screenName: "Pricing",
    icon: "card-outline",
    iconColor: "#10B981", // Emerald for pricing/billing
    activeIconColor: "#34D399"
  },
];

// LanguageSelector component removed - now handled in header

const SidebarContent = ({ language, setLanguage, onClose, currentRouteName }) => {
  const navigation = useNavigation();
  const { t } = useTranslation(language);
  const { isDarkMode } = useTheme();
  const { logout, user } = useAuth();

  const handleNavigation = (screenName) => {
    navigation.navigate(screenName);
    onClose();
  };

  const handleLogout = () => {
    Alert.alert(
      "Confirm Logout",
      "Are you sure you want to logout?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Logout", style: "destructive", onPress: () => {
          logout();
          onClose();
          // The AuthContext will handle the navigation automatically
          // when isAuthenticated becomes false
        }},
      ]
    );
  };

  const styles = getStyles(isDarkMode);
  
  return (
    <View style={styles.sidebarContent}>
      {/* Header */}
      <View style={styles.sidebarHeader}>
        <TouchableOpacity
          style={styles.logoContainer}
          onPress={() => handleNavigation('Dashboard')}
        >
          <Image
            source={{ uri: "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/816636779_file_00000000800861f89b8e5d3eba90a7691.png" }}
            style={styles.logo}
          />
          <Text style={styles.logoText}>Meeting Guard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
        >
          <Ionicons name="close" size={24} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      {/* Navigation Items */}
      <ScrollView style={styles.navigationContainer} showsVerticalScrollIndicator={false}>
        {navigationItems.map((item) => {
          const isActive = currentRouteName === item.screenName;
          return (
            <TouchableOpacity
              key={item.titleKey}
              style={[
                styles.navigationItem,
                isActive && styles.navigationItemActive
              ]}
              onPress={() => handleNavigation(item.screenName)}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={isActive ? item.activeIconColor : item.iconColor}
              />
              <Text style={[
                styles.navigationText,
                isActive && styles.navigationTextActive
              ]}>
                {t(item.titleKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>


      {/* Language selector removed - now in header */}

    </View>
  );
};

const MobileSidebar = ({ visible, onClose, language, setLanguage, currentRouteName }) => {
  const { isDarkMode } = useTheme();
  const slideAnim = React.useRef(new Animated.Value(-width)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    } else {
      Animated.spring(slideAnim, {
        toValue: -width,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    }
  }, [visible, slideAnim]);

  const styles = getStyles(isDarkMode);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Overlay */}
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={onClose}
        />
        
        {/* Sidebar */}
        <Animated.View
          style={[
            styles.sidebar,
            {
              transform: [{ translateX: slideAnim }]
            }
          ]}
        >
          <SidebarContent
            language={language}
            setLanguage={setLanguage}
            onClose={onClose}
            currentRouteName={currentRouteName}
          />
        </Animated.View>
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  modalContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sidebar: {
    width: width * 0.8,
    maxWidth: 320,
    backgroundColor: isDarkMode ? '#0f0f0f' : '#1F2937',
    height: '100%',
  },
  sidebarContent: {
    flex: 1,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? '#262626' : '#374151',
    height: 80,
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
  logoText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  closeButton: {
    padding: 4,
  },
  navigationContainer: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 16,
  },
  navigationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginVertical: 2,
    borderRadius: 8,
  },
  navigationItemActive: {
    backgroundColor: isDarkMode ? '#262626' : '#374151',
  },
  navigationText: {
    fontSize: 14,
    color: isDarkMode ? '#a1a1aa' : '#D1D5DB',
    marginLeft: 12,
    fontWeight: '500',
  },
  navigationTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  languageSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: isDarkMode ? '#262626' : '#374151',
  },
  userSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: isDarkMode ? '#262626' : '#374151',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userText: {
    fontSize: 14,
    color: isDarkMode ? '#a1a1aa' : '#D1D5DB',
    marginLeft: 8,
    fontWeight: '500',
  },
});

export default MobileSidebar; 