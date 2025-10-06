import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import ThemeToggle from './ThemeToggle';
import { useTranslation } from './translations.jsx';
import { 
  getResponsiveFontSizes, 
  getResponsiveSpacing, 
  getResponsiveIconSizes, 
  getDeviceType 
} from '../utils/responsive.js';

const CustomHeader = ({ title, onMenuPress, showMenu = true, language = 'en', onLanguageToggle }) => {
  const navigation = useNavigation();
  const { isDarkMode, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { t } = useTranslation(language);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  const styles = getStyles(isDarkMode);
  
  // Get translated title based on route name
  const getTranslatedTitle = (routeName) => {
    const titleMap = {
      'Dashboard': language === 'es' ? 'Panel Principal' : 'Meeting Guard',
      'ChooseCreationMethod': language === 'es' ? 'Elegir Método' : 'ChooseMethod',
      'CreateMeeting': language === 'es' ? 'Crear Reunión' : 'Create Meeting',
      'TotalMeetings': language === 'es' ? 'Todas las Reuniones' : 'Total Meetings',
      'MeetingDetails': language === 'es' ? 'Detalles de la Reunión' : 'Meeting Details',
      'EditMeeting': language === 'es' ? 'Editar Reunión' : 'Edit Meeting',
      'Calendar': language === 'es' ? 'Calendario' : 'Calendar',
      'Notes': language === 'es' ? 'Notas' : 'Notes',
      'Settings': language === 'es' ? 'Configuración' : 'Settings',
      'Profile': language === 'es' ? 'Perfil' : 'Profile',
      'AIChat': language === 'es' ? 'Chat IA' : 'AI Chat',
      'AIInsights': language === 'es' ? 'Información IA' : 'AI Insights',
      'ApiSettings': language === 'es' ? 'Configuración API' : 'API Settings',
      'Privacy': language === 'es' ? 'Política de Privacidad' : 'Privacy Policy',
      'Terms': language === 'es' ? 'Términos de Servicio' : 'Terms of Service',
      'WhatsAppBot': language === 'es' ? 'Bot WhatsApp' : 'WhatsApp Bot',
      'CalendarSync': language === 'es' ? 'Sincronización Google Calendar' : 'Google Calendar Sync',
      'GoogleCalendarTest': language === 'es' ? 'Prueba Google Calendar' : 'Google Calendar Test',
      'GoogleCalendarTestComponent': language === 'es' ? 'Componente Prueba Google Calendar' : 'Google Calendar Test Component',
      'NotificationDemo': language === 'es' ? 'Demo de Notificaciones' : 'Notification Demo',
      'Pricing': language === 'es' ? 'Planes de Precios' : 'Pricing Plans',
      'PaymentSuccess': language === 'es' ? 'Pago Exitoso' : 'Payment Successful',
    };
    return titleMap[routeName] || title || 'MeetingGuard AI';
  };
  
  const displayTitle = getTranslatedTitle(title);
  
  const handleProfilePress = () => {
    setShowProfileDropdown(!showProfileDropdown);
  };

  const handleSettingsPress = () => {
    setShowProfileDropdown(false);
    navigation.navigate('Settings');
  };

  const handleLogoutPress = () => {
    setShowProfileDropdown(false);
    Alert.alert(
      t('common.logout'),
      t('common.confirmLogout'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('common.logout'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Close any open modals or dropdowns first
              setShowProfileDropdown(false);
              
              // Call logout function
              await logout();
              
              // The App.js will handle the navigation to landing page
              // when isAuthenticated becomes false
            } catch (error) {
              console.error('Logout error:', error);
            }
          },
        },
      ]
    );
  };
  
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
          <Text style={styles.title}>{displayTitle}</Text>
        </TouchableOpacity>
        {/* Language Toggle */}
        <TouchableOpacity
          style={styles.languageButton}
          onPress={onLanguageToggle}
        >
          <Text style={styles.flagEmoji}>
            {language === 'es' ? '🇪🇸' : '🇬🇧'}
          </Text>
          <Text style={styles.languageText}>
            {language === 'es' ? 'ES' : 'EN'}
          </Text>
        </TouchableOpacity>

        {/* Dark/Light Mode Toggle */}
        <TouchableOpacity
          style={styles.themeButton}
          onPress={toggleTheme}
        >
          <Ionicons 
            name={isDarkMode ? "sunny" : "moon"} 
            size={20} 
            color={isDarkMode ? "#FDB813" : "#1E293B"} 
          />
        </TouchableOpacity>
        
        {/* Profile Button */}
        {user && (
          <TouchableOpacity
            style={styles.profileButton}
            onPress={handleProfilePress}
          >
            <Ionicons name="person-circle" size={24} color={isDarkMode ? "#ffffff" : "#1E293B"} />
          </TouchableOpacity>
        )}
        
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
      
      {/* Profile Dropdown Modal */}
      <Modal
        visible={showProfileDropdown}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowProfileDropdown(false)}
      >
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setShowProfileDropdown(false)}
        >
          <View style={styles.dropdownContainer}>
            <View style={styles.dropdownContent}>
              {/* User Info */}
              <View style={styles.userInfo}>
                <Ionicons name="person-circle" size={32} color={isDarkMode ? "#ffffff" : "#1E293B"} />
                <View style={styles.userDetails}>
                  <Text style={styles.userName}>{user?.name || user?.email || 'User'}</Text>
                  <Text style={styles.userEmail}>{user?.email}</Text>
                </View>
              </View>
              
              {/* Dropdown Items */}
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={handleSettingsPress}
              >
                <Ionicons name="settings-outline" size={20} color={isDarkMode ? "#ffffff" : "#1E293B"} />
                <Text style={styles.dropdownItemText}>{t('common.settings')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={handleLogoutPress}
              >
                <Ionicons name="log-out-outline" size={20} color="#ef4444" />
                <Text style={[styles.dropdownItemText, { color: '#ef4444' }]}>{t('common.logout')}</Text>
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
  const deviceType = getDeviceType();
  
  return StyleSheet.create({
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
    marginTop: 40
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logo: {
    width: icons.lg,
    height: icons.lg,
    marginRight: spacing.sm,
  },
  title: {
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
    padding: spacing.sm,
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
  themeToggle: {
    marginRight: spacing.sm,
  },
  profileButton: {
    padding: spacing.sm,
    borderRadius: spacing.sm,
    marginRight: spacing.sm,
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 100,
    paddingRight: 16,
  },
  dropdownContainer: {
    backgroundColor: isDarkMode ? '#1a1a1a' : '#ffffff',
    borderRadius: 12,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
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
  });
};

export default CustomHeader; 