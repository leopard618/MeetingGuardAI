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
import { useTranslation, getAvailableLanguages } from './translations';
import { useTheme } from '@/contexts/ThemeContext';
import ThemeToggle from './ThemeToggle';

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
    titleKey: "nav.settings",
    screenName: "Settings",
    icon: "settings-outline",
    iconColor: "#9CA3AF", // Gray for settings
    activeIconColor: "#D1D5DB"
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

const LanguageSelector = ({ language, setLanguage, onClose }) => {
  const [isOpen, setIsOpen] = useState(false);
  const availableLanguages = getAvailableLanguages();
  const currentLang = availableLanguages.find(lang => lang.code === language);
  const { isDarkMode } = useTheme();

  const languageStyles = StyleSheet.create({
    languageContainer: {
      position: 'relative',
    },
    languageButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    languageText: {
      fontSize: 14,
      color: isDarkMode ? '#71717a' : '#9CA3AF',
      marginLeft: 8,
    },
    languageDropdown: {
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      backgroundColor: isDarkMode ? '#262626' : '#374151',
      borderRadius: 8,
      marginBottom: 8,
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 5,
    },
    languageOption: {
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    languageOptionActive: {
      backgroundColor: isDarkMode ? '#404040' : '#4B5563',
    },
    languageOptionText: {
      fontSize: 14,
      color: isDarkMode ? '#a1a1aa' : '#D1D5DB',
    },
    languageOptionTextActive: {
      color: '#FFFFFF',
    },
  });

  return (
    <View style={languageStyles.languageContainer}>
      <TouchableOpacity
        style={languageStyles.languageButton}
        onPress={() => setIsOpen(!isOpen)}
      >
        <Ionicons name="globe-outline" size={16} color={isDarkMode ? "#a1a1aa" : "#9CA3AF"} />
        <Text style={languageStyles.languageText}>
          {currentLang?.flag} {currentLang?.name}
        </Text>
      </TouchableOpacity>
      
      {isOpen && (
        <View style={languageStyles.languageDropdown}>
          {availableLanguages.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[
                languageStyles.languageOption,
                language === lang.code && languageStyles.languageOptionActive
              ]}
              onPress={() => {
                setLanguage(lang.code);
                setIsOpen(false);
              }}
            >
              <Text style={[
                languageStyles.languageOptionText,
                language === lang.code && languageStyles.languageOptionTextActive
              ]}>
                {lang.flag} {lang.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const SidebarContent = ({ language, setLanguage, onClose, currentRouteName }) => {
  const navigation = useNavigation();
  const { t } = useTranslation(language);
  const { isDarkMode } = useTheme();

  const handleNavigation = (screenName) => {
    navigation.navigate(screenName);
    onClose();
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
          <Text style={styles.logoText}>MeetingGuard AI</Text>
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

      {/* Theme Toggle */}
      <View style={styles.themeSection}>
        <View style={styles.themeContainer}>
          <Ionicons name="color-palette-outline" size={16} color={isDarkMode ? "#a1a1aa" : "#9CA3AF"} />
          <Text style={styles.themeText}>
            {isDarkMode ? "Light Mode" : "Dark Mode"}
          </Text>
          <ThemeToggle size={18} />
        </View>
      </View>

      {/* Language Selector */}
      <View style={styles.languageSection}>
        <LanguageSelector
          language={language}
          setLanguage={setLanguage}
          onClose={onClose}
        />
      </View>
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
  themeSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: isDarkMode ? '#262626' : '#374151',
  },
  themeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeText: {
    fontSize: 14,
    color: isDarkMode ? '#a1a1aa' : '#D1D5DB',
    marginLeft: 8,
    flex: 1,
  },
  languageSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: isDarkMode ? '#262626' : '#374151',
  },
});

export default MobileSidebar; 