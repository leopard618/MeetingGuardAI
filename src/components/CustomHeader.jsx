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
import { useTheme } from '../contexts/ThemeContext';
import ThemeToggle from './ThemeToggle';
import { useTranslation } from './translations.jsx';

const CustomHeader = ({ title, onMenuPress, showMenu = true, language = 'en', onLanguageToggle }) => {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const { t } = useTranslation(language);

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
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
    minWidth: 50,
    justifyContent: 'center',
  },
  flagEmoji: {
    fontSize: 16,
  },
  languageText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: isDarkMode ? '#ffffff' : '#1E293B',
    marginLeft: 4,
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