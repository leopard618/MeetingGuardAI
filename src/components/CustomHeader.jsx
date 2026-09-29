/**
 * Header of the Main group screens (owner: i18n-nav). Rendered through the stack's `header`
 * option by src/navigation/MainHeader.tsx.
 *
 * - Title: navigation:screens.<routeName> in the live language (useT), falling back to `title`.
 * - Language toggle switches EN/ES instantly (explicit user choice, synced to preferences).
 * - Top inset comes from the safe area (edge-to-edge), not a hard-coded margin.
 * - Sign-out goes through the shared confirmation flow (handles unsynced changes).
 *
 * Props: title (route name), onMenuPress, showMenu. The legacy `language` / `onLanguageToggle`
 * props are ignored: the language comes from the i18n context.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext.jsx';
import { useLanguage, useT } from '../i18n';
import { navigateToTopLevel } from '../navigation/navigationService';
import { useSignOutFlow } from '../navigation/useSignOut';
import { useAuth } from '../services/auth';
import { getResponsiveFontSizes, getResponsiveIconSizes, getResponsiveSpacing } from '../utils/responsive.js';

const APP_LOGO = require('../../assets/icon.png');

const FLAGS = { en: '🇬🇧', es: '🇪🇸' };

const CustomHeader = ({ title, onMenuPress, showMenu = true }) => {
  const { isDarkMode, toggleTheme } = useTheme();
  const { user } = useAuth();
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const insets = useSafeAreaInsets();
  const startSignOut = useSignOutFlow();
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  const styles = getStyles(isDarkMode);
  const displayTitle = title
    ? t(`navigation:screens.${title}`, { defaultValue: t('common:app.name') })
    : t('common:app.name');
  const nextLanguage = language === 'es' ? 'en' : 'es';
  const iconColor = isDarkMode ? '#ffffff' : '#1E293B';

  const handleSettingsPress = () => {
    setShowProfileDropdown(false);
    navigateToTopLevel('Settings');
  };

  const handleSignOutPress = () => {
    setShowProfileDropdown(false);
    startSignOut();
  };

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerContent}>
        <TouchableOpacity
          style={styles.logoContainer}
          onPress={() => navigateToTopLevel('Dashboard')}
          accessibilityRole="button"
          accessibilityLabel={t('navigation:header.home')}
        >
          <Image source={APP_LOGO} style={styles.logo} />
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {displayTitle}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.languageButton}
          onPress={() => {
            void setLanguage(nextLanguage);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('navigation:header.switchLanguage', {
            language: t(`common:language.${nextLanguage}`),
          })}
        >
          <Text style={styles.flagEmoji}>{FLAGS[language]}</Text>
          <Text style={styles.languageText}>{language.toUpperCase()}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.themeButton}
          onPress={toggleTheme}
          accessibilityRole="button"
          accessibilityLabel={t(isDarkMode ? 'navigation:header.lightMode' : 'navigation:header.darkMode')}
        >
          <Ionicons name={isDarkMode ? 'sunny' : 'moon'} size={20} color={isDarkMode ? '#FDB813' : '#1E293B'} />
        </TouchableOpacity>

        {user ? (
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => setShowProfileDropdown((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={t('navigation:header.account')}
          >
            <Ionicons name="person-circle" size={24} color={iconColor} />
          </TouchableOpacity>
        ) : null}

        {showMenu ? (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={onMenuPress}
            accessibilityRole="button"
            accessibilityLabel={t('navigation:header.openMenu')}
          >
            <Ionicons name="menu" size={24} color={iconColor} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal
        visible={showProfileDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfileDropdown(false)}
      >
        <TouchableOpacity
          style={[styles.dropdownOverlay, { paddingTop: insets.top + 56 }]}
          activeOpacity={1}
          onPress={() => setShowProfileDropdown(false)}
        >
          <View style={styles.dropdownContainer}>
            <View style={styles.dropdownContent}>
              <View style={styles.userInfo}>
                <Ionicons name="person-circle" size={32} color={iconColor} />
                <View style={styles.userDetails}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {user?.name || user?.email || t('navigation:header.user')}
                  </Text>
                  {user?.email ? (
                    <Text style={styles.userEmail} numberOfLines={1}>
                      {user.email}
                    </Text>
                  ) : null}
                </View>
              </View>

              <TouchableOpacity style={styles.dropdownItem} onPress={handleSettingsPress} accessibilityRole="button">
                <Ionicons name="settings-outline" size={20} color={iconColor} />
                <Text style={styles.dropdownItemText}>{t('navigation:screens.Settings')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.dropdownItem} onPress={handleSignOutPress} accessibilityRole="button">
                <Ionicons name="log-out-outline" size={20} color="#ef4444" />
                <Text style={[styles.dropdownItemText, styles.signOutText]}>{t('common:actions.signOut')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const getStyles = (isDarkMode) => {
  const fonts = getResponsiveFontSizes();
  const spacing = getResponsiveSpacing();
  const icons = getResponsiveIconSizes();

  return StyleSheet.create({
    header: {
      backgroundColor: isDarkMode ? '#1a1a1a' : '#FFFFFF',
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#404040' : '#E2E8F0',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 3.84,
      elevation: 5,
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minHeight: 56,
    },
    logoContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: spacing.sm,
    },
    logo: {
      width: icons.lg,
      height: icons.lg,
      marginRight: spacing.sm,
    },
    title: {
      flexShrink: 1,
      fontSize: fonts.lg,
      fontWeight: 'bold',
      color: isDarkMode ? '#ffffff' : '#1E293B',
    },
    languageButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.sm,
      borderRadius: spacing.sm,
      marginRight: spacing.sm,
      backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
      minWidth: 50,
      justifyContent: 'center',
    },
    flagEmoji: {
      fontSize: icons.sm,
    },
    languageText: {
      fontSize: fonts.sm,
      fontWeight: 'bold',
      color: isDarkMode ? '#ffffff' : '#1E293B',
      marginLeft: spacing.xs,
    },
    themeButton: {
      borderRadius: spacing.sm,
      marginRight: spacing.sm,
      backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    menuButton: {
      padding: spacing.sm,
      borderRadius: spacing.sm,
    },
    profileButton: {
      padding: spacing.sm,
      borderRadius: spacing.sm,
      marginRight: spacing.xs,
    },
    dropdownOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-start',
      alignItems: 'flex-end',
      paddingRight: 16,
    },
    dropdownContainer: {
      backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff',
      borderRadius: 12,
      minWidth: 220,
      maxWidth: 300,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },
    dropdownContent: {
      padding: spacing.md,
    },
    userInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#404040' : '#e5e7eb',
      marginBottom: spacing.md,
    },
    userDetails: {
      marginLeft: spacing.sm,
      flex: 1,
    },
    userName: {
      fontSize: fonts.md,
      fontWeight: '600',
      color: isDarkMode ? '#ffffff' : '#1E293B',
    },
    userEmail: {
      fontSize: fonts.sm,
      color: isDarkMode ? '#a1a1aa' : '#64748b',
      marginTop: 2,
    },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: 8,
    },
    dropdownItemText: {
      fontSize: fonts.md,
      color: isDarkMode ? '#ffffff' : '#1E293B',
      marginLeft: spacing.sm,
      fontWeight: '500',
    },
    signOutText: {
      color: '#ef4444',
    },
  });
};

export default CustomHeader;
