import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from './translations.jsx';
import manualLoginGoogleCalendarService from '../api/manualLoginGoogleCalendarService';
import { 
  getResponsiveFontSizes, 
  getResponsiveSpacing, 
  getResponsiveButtonDimensions,
  isSmallDevice,
  isTabletOrLarger,
} from '../utils/responsive.js';

const GoogleCalendarConnectionPrompt = ({ 
  visible, 
  onClose, 
  onSuccess,
  userEmail,
  language = 'en' 
}) => {
  const { isDarkMode } = useTheme();
  const { t } = useTranslation(language);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Get responsive values
  const fonts = getResponsiveFontSizes();
  const spacing = getResponsiveSpacing();
  const buttonDims = getResponsiveButtonDimensions();
  const isSmall = isSmallDevice();
  const isTablet = isTabletOrLarger();

  // Check if Google Calendar is already connected
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const connected = await manualLoginGoogleCalendarService.isConnected();
        setIsConnected(connected);
      } catch (error) {
        console.error('Error checking Google Calendar connection:', error);
      }
    };

    if (visible) {
      checkConnection();
    }
  }, [visible]);

  const handleConnectGoogleCalendar = async () => {
    try {
      setIsConnecting(true);
      console.log('GoogleCalendarConnectionPrompt: Starting Google Calendar connection');

      const result = await manualLoginGoogleCalendarService.connectGoogleCalendar();
      
      if (result.success) {
        console.log('GoogleCalendarConnectionPrompt: Google Calendar connected successfully');
        setIsConnected(true);
        
        Alert.alert(
          t('common.success'),
          t('googleCalendar.connectedSuccessfully'),
          [
            {
              text: t('common.ok'),
              onPress: () => {
                onSuccess && onSuccess(result);
                onClose && onClose();
              }
            }
          ]
        );
      } else {
        console.error('GoogleCalendarConnectionPrompt: Google Calendar connection failed:', result.error);
        
        Alert.alert(
          t('common.error'),
          result.error || t('googleCalendar.connectionFailed'),
          [
            {
              text: t('common.ok'),
              style: 'default'
            }
          ]
        );
      }
    } catch (error) {
      console.error('GoogleCalendarConnectionPrompt: Error connecting Google Calendar:', error);
      
      Alert.alert(
        t('common.error'),
        error.message || t('googleCalendar.connectionError'),
        [
          {
            text: t('common.ok'),
            style: 'default'
          }
        ]
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSkip = () => {
    Alert.alert(
      t('googleCalendar.skipTitle'),
      t('googleCalendar.skipMessage'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel'
        },
        {
          text: t('googleCalendar.skipConfirm'),
          style: 'destructive',
          onPress: () => {
            onClose && onClose();
          }
        }
      ]
    );
  };

  const getStyles = () => {
    return StyleSheet.create({
      overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: isSmall ? spacing['lg'] : spacing['xl'],
      },
      modal: {
        backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
        borderRadius: isSmall ? spacing['lg'] : spacing['xl'],
        padding: isSmall ? spacing['lg'] : spacing['2xl'],
        width: '100%',
        maxWidth: isTablet ? 500 : 400,
        maxHeight: '80%',
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
      },
      header: {
        alignItems: 'center',
        marginBottom: spacing['xl'],
      },
      icon: {
        marginBottom: spacing['lg'],
      },
      title: {
        fontSize: isSmall ? fonts['xl'] : isTablet ? fonts['2xl'] + 2 : fonts['2xl'],
        fontWeight: 'bold',
        color: isDarkMode ? '#f1f5f9' : '#1e293b',
        textAlign: 'center',
        marginBottom: spacing['sm'],
      },
      subtitle: {
        fontSize: isSmall ? fonts['md'] : fonts['lg'],
        color: isDarkMode ? '#94a3b8' : '#64748b',
        textAlign: 'center',
        lineHeight: isSmall ? fonts['md'] + 4 : fonts['lg'] + 4,
      },
      content: {
        marginBottom: spacing['2xl'],
      },
      description: {
        fontSize: isSmall ? fonts['sm'] : fonts['md'],
        color: isDarkMode ? '#cbd5e1' : '#475569',
        textAlign: 'center',
        lineHeight: isSmall ? fonts['sm'] + 4 : fonts['md'] + 4,
        marginBottom: spacing['lg'],
      },
      benefitsList: {
        marginBottom: spacing['lg'],
      },
      benefitItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing['sm'],
      },
      benefitIcon: {
        marginRight: spacing['sm'],
      },
      benefitText: {
        fontSize: isSmall ? fonts['sm'] : fonts['md'],
        color: isDarkMode ? '#cbd5e1' : '#475569',
        flex: 1,
      },
      userEmail: {
        fontSize: isSmall ? fonts['sm'] : fonts['md'],
        color: isDarkMode ? '#60a5fa' : '#3b82f6',
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: spacing['lg'],
      },
      buttonContainer: {
        gap: spacing['md'],
      },
      connectButton: {
        backgroundColor: '#3b82f6',
        paddingVertical: buttonDims.paddingVertical,
        paddingHorizontal: buttonDims.paddingHorizontal,
        borderRadius: buttonDims.borderRadius,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 2,
        },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
      },
      connectButtonDisabled: {
        backgroundColor: '#94a3b8',
      },
      connectButtonText: {
        fontSize: buttonDims.fontSize,
        fontWeight: 'bold',
        color: '#ffffff',
        marginLeft: spacing['sm'],
      },
      skipButton: {
        paddingVertical: buttonDims.paddingVertical,
        paddingHorizontal: buttonDims.paddingHorizontal,
        borderRadius: buttonDims.borderRadius,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: isDarkMode ? '#475569' : '#d1d5db',
      },
      skipButtonText: {
        fontSize: buttonDims.fontSize,
        fontWeight: '600',
        color: isDarkMode ? '#94a3b8' : '#64748b',
      },
      connectedContainer: {
        alignItems: 'center',
        padding: spacing['lg'],
        backgroundColor: isDarkMode ? '#065f46' : '#d1fae5',
        borderRadius: spacing['md'],
        marginBottom: spacing['lg'],
      },
      connectedText: {
        fontSize: isSmall ? fonts['sm'] : fonts['md'],
        color: isDarkMode ? '#6ee7b7' : '#059669',
        fontWeight: '600',
        textAlign: 'center',
      },
    });
  };

  const styles = getStyles();

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <MaterialIcons 
              name="calendar-today" 
              size={isSmall ? 48 : isTablet ? 64 : 56} 
              color={isDarkMode ? '#60a5fa' : '#3b82f6'} 
              style={styles.icon}
            />
            <Text style={styles.title}>
              {t('googleCalendar.connectTitle')}
            </Text>
            <Text style={styles.subtitle}>
              {t('googleCalendar.connectSubtitle')}
            </Text>
          </View>

          <View style={styles.content}>
            <Text style={styles.description}>
              {t('googleCalendar.connectDescription')}
            </Text>

            {userEmail && (
              <Text style={styles.userEmail}>
                {userEmail}
              </Text>
            )}

            {isConnected ? (
              <View style={styles.connectedContainer}>
                <MaterialIcons 
                  name="check-circle" 
                  size={24} 
                  color={isDarkMode ? '#6ee7b7' : '#059669'} 
                />
                <Text style={styles.connectedText}>
                  {t('googleCalendar.alreadyConnected')}
                </Text>
              </View>
            ) : (
              <View style={styles.benefitsList}>
                <View style={styles.benefitItem}>
                  <MaterialIcons 
                    name="sync" 
                    size={20} 
                    color={isDarkMode ? '#60a5fa' : '#3b82f6'} 
                    style={styles.benefitIcon}
                  />
                  <Text style={styles.benefitText}>
                    {t('googleCalendar.benefit1')}
                  </Text>
                </View>
                <View style={styles.benefitItem}>
                  <MaterialIcons 
                    name="event" 
                    size={20} 
                    color={isDarkMode ? '#60a5fa' : '#3b82f6'} 
                    style={styles.benefitIcon}
                  />
                  <Text style={styles.benefitText}>
                    {t('googleCalendar.benefit2')}
                  </Text>
                </View>
                <View style={styles.benefitItem}>
                  <MaterialIcons 
                    name="people" 
                    size={20} 
                    color={isDarkMode ? '#60a5fa' : '#3b82f6'} 
                    style={styles.benefitIcon}
                  />
                  <Text style={styles.benefitText}>
                    {t('googleCalendar.benefit3')}
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.buttonContainer}>
            {!isConnected && (
              <TouchableOpacity
                style={[
                  styles.connectButton,
                  isConnecting && styles.connectButtonDisabled
                ]}
                onPress={handleConnectGoogleCalendar}
                disabled={isConnecting}
              >
                <MaterialIcons 
                  name="google" 
                  size={20} 
                  color="#ffffff" 
                />
                <Text style={styles.connectButtonText}>
                  {isConnecting ? t('googleCalendar.connecting') : t('googleCalendar.connectButton')}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
            >
              <Text style={styles.skipButtonText}>
                {isConnected ? t('common.close') : t('googleCalendar.skipButton')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default GoogleCalendarConnectionPrompt;
