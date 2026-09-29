/**
 * Slide-in navigation menu of the Main group (owner: i18n-nav). Rendered ONCE by the navigator
 * (src/navigation/sidebar.tsx); strings follow the live language (useT), navigation goes through
 * the navigation service, the hardware back button closes it (Modal onRequestClose).
 *
 * Props: visible, onClose, currentRouteName. (The legacy `language` / `setLanguage` props are no
 * longer needed: the language comes from the i18n context.)
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext.jsx';
import { useLanguage, useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { useSignOutFlow } from '../navigation/useSignOut';

const APP_LOGO = require('../../assets/icon.png');

const NAVIGATION_ITEMS = [
  { titleKey: 'navigation:nav.dashboard', screenName: 'Dashboard', icon: 'grid-outline', iconColor: '#60A5FA', activeIconColor: '#93C5FD' },
  { titleKey: 'navigation:nav.addMeeting', screenName: 'ChooseCreationMethod', icon: 'add-circle-outline', iconColor: '#34D399', activeIconColor: '#6EE7B7' },
  { titleKey: 'navigation:nav.totalMeetings', screenName: 'TotalMeetings', icon: 'list-outline', iconColor: '#F59E0B', activeIconColor: '#FCD34D' },
  { titleKey: 'navigation:nav.calendar', screenName: 'Calendar', icon: 'calendar-outline', iconColor: '#A78BFA', activeIconColor: '#C4B5FD' },
  { titleKey: 'navigation:nav.notes', screenName: 'Notes', icon: 'document-text-outline', iconColor: '#FB923C', activeIconColor: '#FDBA74' },
  { titleKey: 'navigation:nav.aiChat', screenName: 'AIChat', icon: 'chatbubble-outline', iconColor: '#22D3EE', activeIconColor: '#67E8F9' },
  { titleKey: 'navigation:nav.pricing', screenName: 'Pricing', icon: 'card-outline', iconColor: '#10B981', activeIconColor: '#34D399' },
  { titleKey: 'navigation:nav.settings', screenName: 'Settings', icon: 'settings-outline', iconColor: '#94A3B8', activeIconColor: '#CBD5E1' },
];

const SidebarContent = ({ onClose, currentRouteName }) => {
  const t = useT();
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const startSignOut = useSignOutFlow();
  const styles = getStyles(isDarkMode);

  const handleNavigation = (screenName) => {
    onClose();
    navigateToTopLevel(screenName);
  };

  const handleSignOut = () => {
    onClose();
    startSignOut();
  };

  return (
    <View style={[styles.sidebarContent, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.sidebarHeader}>
        <TouchableOpacity
          style={styles.logoContainer}
          onPress={() => handleNavigation('Dashboard')}
          accessibilityRole="button"
          accessibilityLabel={t('navigation:header.home')}
        >
          <Image source={APP_LOGO} style={styles.logo} />
          <Text style={styles.logoText}>{t('common:app.name')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('navigation:sidebar.close')}
        >
          <Ionicons name="close" size={24} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.navigationContainer} showsVerticalScrollIndicator={false}>
        {NAVIGATION_ITEMS.map((item) => {
          const isActive = currentRouteName === item.screenName;
          return (
            <TouchableOpacity
              key={item.screenName}
              style={[styles.navigationItem, isActive && styles.navigationItemActive]}
              onPress={() => handleNavigation(item.screenName)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Ionicons name={item.icon} size={20} color={isActive ? item.activeIconColor : item.iconColor} />
              <Text style={[styles.navigationText, isActive && styles.navigationTextActive]}>{t(item.titleKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footerSection}>
        <Text style={styles.sectionLabel}>{t('navigation:sidebar.language')}</Text>
        <View style={styles.languageRow}>
          {supportedLanguages.map((code) => {
            const selected = code === language;
            return (
              <TouchableOpacity
                key={code}
                style={[styles.languageChip, selected && styles.languageChipSelected]}
                onPress={() => {
                  void setLanguage(code);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.languageChipText, selected && styles.languageChipTextSelected]}>
                  {t(`common:language.${code}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={20} color="#F87171" />
          <Text style={styles.signOutText}>{t('common:actions.signOut')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const MobileSidebar = ({ visible, onClose, currentRouteName }) => {
  const { isDarkMode } = useTheme();
  const { width } = useWindowDimensions();
  const sidebarWidth = Math.min(width * 0.8, 320);
  const [slideAnim] = useState(() => new Animated.Value(-sidebarWidth));

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : -sidebarWidth,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, [visible, slideAnim, sidebarWidth]);

  const styles = getStyles(isDarkMode);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalContainer}>
        <Animated.View style={[styles.sidebar, { width: sidebarWidth, transform: [{ translateX: slideAnim }] }]}>
          <SidebarContent onClose={onClose} currentRouteName={currentRouteName} />
        </Animated.View>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityRole="button" />
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    modalContainer: {
      flex: 1,
      flexDirection: 'row',
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    sidebar: {
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
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#262626' : '#374151',
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
      padding: 8,
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
    footerSection: {
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? '#262626' : '#374151',
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: '#9CA3AF',
      marginBottom: 8,
      textTransform: 'uppercase',
    },
    languageRow: {
      flexDirection: 'row',
      marginBottom: 16,
    },
    languageChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: '#4B5563',
      marginRight: 8,
    },
    languageChipSelected: {
      backgroundColor: '#2563EB',
      borderColor: '#2563EB',
    },
    languageChipText: {
      color: '#D1D5DB',
      fontSize: 14,
    },
    languageChipTextSelected: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    signOutButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
    },
    signOutText: {
      color: '#F87171',
      fontSize: 14,
      fontWeight: '600',
      marginLeft: 12,
    },
  });

export default MobileSidebar;
